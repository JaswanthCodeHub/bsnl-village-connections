const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const dns = require('dns');
const fsp = require('fs/promises');
const { MongoClient } = require('mongodb');

// Use Google DNS to resolve SRV records (fixes BSNL broadband DNS issues)
dns.setServers(['8.8.8.8', '8.8.4.4']);

/* ===========================
   Configuration
   =========================== */
const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bsnl';
const DB_NAME = 'bsnl_manager';
const COLLECTION_NAME = 'connections';
const COMPLAINTS_COLLECTION = 'complaints';
const LANDLINE_PREFIX = '08643';
const USER_ID_SUFFIX = '_sid@ftth.bsnl.in';

// Telegram Alert Config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const FIELDS = ['area', 'vlanNo', 'customerName', 'landlineNo', 'userId', 'notes'];

const HEADER_ALIASES = {
  area: ['area', 'village', 'location', 'place'],
  vlanNo: ['vlan no', 'vlan number', 'vlan', 'vlanno'],
  customerName: ['customer name', 'name', 'customer', 'subscriber name', 'customername'],
  landlineNo: ['landline no', 'landline number', 'landline', 'connection number', 'connection no', 'bsnl number', 'number', 'landlineno'],
  userId: ['user id', 'userid', 'bsnl user id', 'account id'],
  notes: ['notes', 'remark', 'remarks', 'comment', 'comments']
};

const EXPORT_COLUMNS = [
  ['Village', 'area', 18],
  ['VLAN No', 'vlanNo', 12],
  ['Name', 'customerName', 34],
  ['Landline No', 'landlineNo', 20],
  ['User ID', 'userId', 35],
  ['Notes', 'notes', 36]
];

/* ===========================
   MongoDB Connection
   =========================== */
let client = null;
let db = null;
let connectionsCollection = null;
let complaintsCollection = null;

async function getCollection() {
  if (connectionsCollection && client?.topology?.s?.state === 'connected') {
    return connectionsCollection;
  }
  // Close stale client if exists
  if (client) { try { await client.close(); } catch {} }
  client = new MongoClient(MONGODB_URI, { maxPoolSize: 5 });
  await client.connect();
  db = client.db(DB_NAME);
  connectionsCollection = db.collection(COLLECTION_NAME);
  complaintsCollection = db.collection(COMPLAINTS_COLLECTION);

  // Create indexes for connections
  await connectionsCollection.createIndex({ id: 1 }, { unique: true }).catch(() => {});
  await connectionsCollection.createIndex({ area: 1 }).catch(() => {});
  await connectionsCollection.createIndex({ landlineNo: 1 }).catch(() => {});
  await connectionsCollection.createIndex({ customerName: 'text', landlineNo: 'text', userId: 'text' }).catch(() => {});

  // Create indexes for complaints
  await complaintsCollection.createIndex({ id: 1 }, { unique: true }).catch(() => {});
  await complaintsCollection.createIndex({ customerId: 1 }).catch(() => {});
  await complaintsCollection.createIndex({ status: 1 }).catch(() => {});
  await complaintsCollection.createIndex({ createdAt: -1 }).catch(() => {});

  console.log('Connected to MongoDB successfully.');
  return connectionsCollection;
}

async function getComplaintsCollection() {
  await getCollection();
  return complaintsCollection;
}

/* ===========================
   Helper Functions
   =========================== */
function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

// Send Telegram notification (fire-and-forget)
async function sendTelegramAlert(complaint) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const msg = `🚨 *New Complaint Received*\n\n` +
      `👤 *Customer:* ${complaint.customerName}\n` +
      `📞 *Landline:* ${complaint.customerId}\n` +
      `📍 *Area:* ${complaint.area}\n` +
      `📋 *Category:* ${complaint.category}\n` +
      `📝 *Issue:* ${complaint.description.slice(0, 200)}\n` +
      `🕐 *Time:* ${new Date(complaint.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error('Telegram alert failed:', err.message);
  }
}

function normaliseStatus(value) {
  const status = cleanText(value, 30).toLowerCase();
  return ['active', 'inactive', 'pending', 'disconnected'].includes(status) ? status : 'active';
}

function normaliseLandline(value) {
  const text = cleanText(value, 100);
  const digits = text.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith(LANDLINE_PREFIX)
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : text;
}

function normaliseUserId(value) {
  const text = cleanText(value, 500);
  if (!text) return '';
  const prefix = text.replace(/_?sid@.*$/i, '').trim();
  return `${prefix}${USER_ID_SUFFIX}`;
}

/* areaFromFilename() removed — area is now selected from UI dropdown */

function validateConnection(connection) {
  if (!connection.area) return 'Please select a village.';
  if (!connection.customerName) return 'Customer name is required.';
  if (!connection.landlineNo) return 'Landline number is required.';
  const landlineDigits = connection.landlineNo.replace(/\D/g, '');
  if (!landlineDigits.startsWith(LANDLINE_PREFIX)) return 'Landline number must start with 08643.';
  if (landlineDigits.length !== 11) return 'Enter the full 11-digit landline number.';
  if (!connection.userId) return 'User ID is required.';
  if (!connection.userId.toLowerCase().endsWith(USER_ID_SUFFIX)) return 'User ID must end with _sid@ftth.bsnl.in.';
  if (connection.userId.length <= USER_ID_SUFFIX.length) return 'Enter the User ID number before the fixed suffix.';
  return null;
}

function cleanConnection(source, existing = {}) {
  const record = {};
  for (const field of FIELDS) record[field] = cleanText(source[field], field === 'notes' ? 2000 : 500);
  record.landlineNo = normaliseLandline(record.landlineNo);
  record.userId = normaliseUserId(record.userId);
  record.status = normaliseStatus(source.status ?? existing.status ?? 'active');
  return {
    ...existing,
    ...record,
    updatedAt: new Date().toISOString()
  };
}

function findValue(row, expected) {
  const keys = Object.keys(row);
  const aliases = HEADER_ALIASES[expected];
  const matchingKey = keys.find((key) => aliases.includes(String(key).trim().toLowerCase()));
  return matchingKey === undefined ? '' : row[matchingKey];
}

function sheetRows(sheet) {
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column] = cell.text.trim();
  });
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    headers.forEach((header, column) => {
      if (header) item[header] = row.getCell(column).text;
    });
    if (Object.values(item).some((value) => value.trim())) rows.push(item);
  });
  return rows;
}

/* Strip MongoDB _id from documents before sending to client */
function stripId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

/* ===========================
   Multer (File Upload) Setup
   =========================== */
const UPLOAD_DIR = path.join(os.tmpdir(), 'bsnl-uploads');

const storage = multer.diskStorage({
  destination: async (_req, _file, callback) => {
    await fsp.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});
    callback(null, UPLOAD_DIR);
  },
  filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const accepted = ['.xlsx', '.csv'].includes(path.extname(file.originalname).toLowerCase());
    callback(accepted ? null : new Error('Only .xlsx or .csv files are allowed.'), accepted);
  }
});

/* ===========================
   Express Middleware
   =========================== */
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// Portal URL Aliases
app.get(['/user', '/customer'], (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'user.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  next();
});

// CORS headers
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ===========================
   Authentication Helpers & Routes
   =========================== */
const SESSION_SECRET = process.env.SESSION_SECRET || 'bsnl-fiber-manager-secure-salt-2026';
const SESSION_MAX_AGE_SEC = parseInt(process.env.SESSION_MAX_AGE_SEC, 10) || 1800; // 30 minutes

function generateToken(username) {
  const timestamp = Date.now();
  const payload = `${username}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  // Token format: hmac.timestamp
  return `${hmac}.${timestamp}`;
}

function verifyToken(token, username) {
  if (!token || !token.includes('.')) return false;
  const [hmac, timestampStr] = token.split('.');
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check expiry
  const ageMs = Date.now() - timestamp;
  if (ageMs > SESSION_MAX_AGE_SEC * 1000) return false;

  // Check HMAC integrity (timing-safe)
  const payload = `${username}:${timestamp}`;
  const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'));
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  if (!req.headers.cookie) return null;
  const match = req.headers.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function requireAuth(req, res, next) {
  const token = getCookie(req, 'session_token');
  const adminUser = process.env.ADMIN_USERNAME || 'sai krishna';
  if (verifyToken(token, adminUser)) {
    return next();
  }
  res.status(401).json({ error: 'Session expired. Please login again.' });
}

// Rate limiting for login
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 60000;

// Cleanup stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now - record.first >= LOGIN_LOCKOUT_MS) loginAttempts.delete(ip);
  }
}, 300000);

// POST login
app.post('/api/login', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record && (now - record.first) < LOGIN_LOCKOUT_MS && record.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 1 minute.' });
  }

  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'sai krishna';
  const adminPass = process.env.ADMIN_PASSWORD || '9030999657';

  if (username === adminUser && password === adminPass) {
    loginAttempts.delete(ip);
    const token = generateToken(adminUser);
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE_SEC}; SameSite=Strict${isProd ? '; Secure' : ''}`);
    res.json({ success: true, username, sessionMaxAge: SESSION_MAX_AGE_SEC });
  } else {
    // Track failed attempt
    if (!record || (now - record.first) >= LOGIN_LOCKOUT_MS) {
      loginAttempts.set(ip, { first: now, count: 1 });
    } else {
      record.count++;
    }
    res.status(401).json({ error: 'Invalid username or password.' });
  }
});

// POST logout
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'session_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict');
  res.json({ success: true });
});

// GET auth check
app.get('/api/auth-check', (req, res) => {
  const token = getCookie(req, 'session_token');
  const adminUser = process.env.ADMIN_USERNAME || 'sai krishna';
  if (verifyToken(token, adminUser)) {
    res.json({ authenticated: true, username: adminUser, sessionMaxAge: SESSION_MAX_AGE_SEC });
  } else {
    res.json({ authenticated: false });
  }
});

/* ===========================
   API Routes
   =========================== */

// GET all connections (supports pagination: ?limit=500&skip=0)
app.get('/api/connections', requireAuth, async (req, res, next) => {
  try {
    const connectionsCollection = await getCollection();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const total = await connectionsCollection.countDocuments();
    const connections = await connectionsCollection
      .find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    res.json({
      connections: connections.map(stripId),
      total,
      limit,
      skip,
      updatedAt: new Date().toISOString()
    });
  } catch (error) { next(error); }
});

// POST new connection
app.post('/api/connections', requireAuth, async (req, res, next) => {
  try {
    const connectionsCollection = await getCollection();
    const connection = cleanConnection(req.body);
    const validationError = validateConnection(connection);
    if (validationError) return res.status(400).json({ error: validationError });
    connection.id = crypto.randomUUID();
    connection.createdAt = connection.updatedAt;
    await connectionsCollection.insertOne(connection);
    res.status(201).json({ connection: stripId(connection) });
  } catch (error) { next(error); }
});

// PUT update connection
app.put('/api/connections/:id', requireAuth, async (req, res, next) => {
  try {
    const connectionsCollection = await getCollection();
    const existing = await connectionsCollection.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Connection not found.' });
    const connection = cleanConnection(req.body, stripId(existing));
    const validationError = validateConnection(connection);
    if (validationError) return res.status(400).json({ error: validationError });
    await connectionsCollection.updateOne(
      { id: req.params.id },
      { $set: connection }
    );
    res.json({ connection: stripId(connection) });
  } catch (error) { next(error); }
});

// DELETE connection
app.delete('/api/connections/:id', requireAuth, async (req, res, next) => {
  try {
    const connectionsCollection = await getCollection();
    const result = await connectionsCollection.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Connection not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

// POST import Excel / CSV
app.post('/api/import', requireAuth, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Please select an Excel or CSV file.' });
  try {
    const connectionsCollection = await getCollection();
    const selectedArea = cleanText(req.body.area, 100);
    if (!selectedArea) return res.status(400).json({ error: 'Please select an area or route before replacing data.' });
    const workbook = new ExcelJS.Workbook();
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (extension === '.csv') await workbook.csv.readFile(req.file.path);
    else await workbook.xlsx.readFile(req.file.path);
    const sheet = workbook.worksheets[0];
    const rows = sheet ? sheetRows(sheet) : [];
    if (!rows.length) return res.status(400).json({ error: 'The selected file has no data rows.' });

    const importedConnections = [];
    let skipped = 0;
    for (const row of rows) {
      const mapped = {};
      for (const field of FIELDS) mapped[field] = findValue(row, field);
      mapped.area = selectedArea;
      const connection = cleanConnection(mapped);
      if (validateConnection(connection)) { skipped += 1; continue; }
      connection.id = crypto.randomUUID();
      connection.createdAt = connection.updatedAt;
      importedConnections.push(connection);
    }
    if (!importedConnections.length) return res.status(400).json({ error: 'No records with a customer name were found in this file. Your existing data was not changed.' });

    // Count existing records for the selected area before deleting
    const replaced = await connectionsCollection.countDocuments({ area: selectedArea });

    // Delete old records for this area and insert new ones
    await connectionsCollection.deleteMany({ area: selectedArea });
    await connectionsCollection.insertMany(importedConnections);

    res.json({ added: importedConnections.length, skipped, replaced, totalRows: rows.length, area: selectedArea });
  } catch (error) { next(error); }
  finally { if (req.file?.path) fsp.unlink(req.file.path).catch(() => {}); }
});

// GET export to Excel
app.get('/api/export', requireAuth, async (req, res, next) => {
  try {
    const connectionsCollection = await getCollection();
    const selectedArea = cleanText(req.query.area, 100);
    const query = selectedArea ? { area: selectedArea } : {};
    const connections = await connectionsCollection.find(query).toArray();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BSNL Connection Manager';
    const sheet = workbook.addWorksheet('BSNL Connections', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = EXPORT_COLUMNS.map(([header, key, width]) => ({ header, key, width }));
    for (const item of connections) sheet.addRow(item);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C61B9' } };
    sheet.autoFilter = { from: 'A1', to: `F${Math.max(1, connections.length + 1)}` };
    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    const filePart = selectedArea ? selectedArea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'all-connections';
    res.setHeader('Content-Disposition', `attachment; filename="bsnl-${filePart}-${date}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
  } catch (error) { next(error); }
});

// GET backup as JSON download
app.get('/api/backup', requireAuth, async (_req, res, next) => {
  try {
    const connectionsCollection = await getCollection();
    const connections = await connectionsCollection.find({}).toArray();
    const backup = {
      connections: connections.map(stripId),
      updatedAt: new Date().toISOString()
    };
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="bsnl-backup-${date}.json"`);
    res.type('application/json').send(JSON.stringify(backup, null, 2));
  } catch (error) { next(error); }
});

/* ===========================
   Customer Authentication
   =========================== */
const CUSTOMER_SESSION_SECRET = process.env.CUSTOMER_SESSION_SECRET || 'bsnl-customer-session-2026';
const CUSTOMER_SESSION_MAX_AGE = 3600; // 1 hour

function generateCustomerToken(landlineNo) {
  const timestamp = Date.now();
  const payload = `customer:${landlineNo}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', CUSTOMER_SESSION_SECRET).update(payload).digest('hex');
  return `${hmac}.${landlineNo}.${timestamp}`;
}

function verifyCustomerToken(token) {
  if (!token || token.split('.').length !== 3) return null;
  const [hmac, landlineNo, timestampStr] = token.split('.');
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;
  const ageMs = Date.now() - timestamp;
  if (ageMs > CUSTOMER_SESSION_MAX_AGE * 1000) return null;
  const payload = `customer:${landlineNo}:${timestamp}`;
  const expectedHmac = crypto.createHmac('sha256', CUSTOMER_SESSION_SECRET).update(payload).digest('hex');
  try {
    if (crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      return landlineNo;
    }
  } catch {}
  return null;
}

function requireCustomerAuth(req, res, next) {
  const token = getCookie(req, 'customer_token');
  const landlineNo = verifyCustomerToken(token);
  if (landlineNo) {
    req.customerLandline = landlineNo;
    return next();
  }
  res.status(401).json({ error: 'Please login again.' });
}

// Customer registration / account creation
app.post('/api/customer/register', async (req, res, next) => {
  try {
    const { area, customerName, landlineNo, userIdPrefix, password, notes } = req.body;
    if (!area || !area.trim()) return res.status(400).json({ error: 'Please select your area/village.' });
    if (!customerName || !customerName.trim()) return res.status(400).json({ error: 'Customer name is required.' });
    if (!landlineNo) return res.status(400).json({ error: 'Landline number is required.' });

    const cleanedLandline = landlineNo.replace(/\D/g, '');
    if (cleanedLandline.length !== 11 || !cleanedLandline.startsWith(LANDLINE_PREFIX)) {
      return res.status(400).json({ error: 'Enter a valid 11-digit landline number starting with 08643.' });
    }
    const formattedLandline = `${cleanedLandline.slice(0, 5)}-${cleanedLandline.slice(5)}`;

    const connectionsCol = await getCollection();
    const existing = await connectionsCol.findOne({ landlineNo: formattedLandline });
    if (existing) {
      return res.status(400).json({ error: 'This landline number is already registered! Please login directly.' });
    }

    // Password: use provided or default to last 6 digits
    const customerPassword = (password && password.trim()) ? password.trim() : cleanedLandline.slice(-6);
    if (customerPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    const hashedPassword = crypto.createHash('sha256').update(customerPassword).digest('hex');

    const prefix = (userIdPrefix || '').trim().replace(/_?sid@.*$/i, '') || cleanedLandline.slice(-5);
    const userId = `${prefix}${USER_ID_SUFFIX}`;

    const newCustomer = {
      id: crypto.randomUUID(),
      area: cleanText(area, 100),
      vlanNo: '100',
      customerName: cleanText(customerName, 200),
      landlineNo: formattedLandline,
      userId: userId,
      customerPassword: hashedPassword,
      notes: cleanText(notes || 'Self-registered customer', 500),
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await connectionsCol.insertOne(newCustomer);

    // Auto-login
    const token = generateCustomerToken(formattedLandline);
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', `customer_token=${token}; Path=/; HttpOnly; Max-Age=${CUSTOMER_SESSION_MAX_AGE}; SameSite=Strict${isProd ? '; Secure' : ''}`);

    res.status(201).json({
      success: true,
      customer: {
        customerName: newCustomer.customerName,
        landlineNo: newCustomer.landlineNo,
        area: newCustomer.area,
        userId: newCustomer.userId
      },
      sessionMaxAge: CUSTOMER_SESSION_MAX_AGE
    });
  } catch (error) { next(error); }
});

// Customer login
app.post('/api/customer/login', async (req, res, next) => {
  try {
    const { landlineNo, password } = req.body;
    if (!landlineNo) return res.status(400).json({ error: 'Landline number is required.' });
    if (!password) return res.status(400).json({ error: 'Password is required.' });
    const cleaned = landlineNo.replace(/\D/g, '');
    if (cleaned.length !== 11 || !cleaned.startsWith(LANDLINE_PREFIX)) {
      return res.status(400).json({ error: 'Enter a valid 11-digit landline number starting with 08643.' });
    }
    const formatted = `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
    const connectionsCol = await getCollection();
    const customer = await connectionsCol.findOne({ landlineNo: formatted });
    if (!customer) {
      return res.status(404).json({ error: 'This landline number is not registered. Please contact your BSNL office.' });
    }
    // Verify password
    const hashedInput = crypto.createHash('sha256').update(password).digest('hex');
    if (!customer.customerPassword || customer.customerPassword !== hashedInput) {
      return res.status(401).json({ error: 'Incorrect password. Your default password is the last 6 digits of your landline number.' });
    }
    const token = generateCustomerToken(formatted);
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', `customer_token=${token}; Path=/; HttpOnly; Max-Age=${CUSTOMER_SESSION_MAX_AGE}; SameSite=Strict${isProd ? '; Secure' : ''}`);
    res.json({
      success: true,
      customer: {
        customerName: customer.customerName,
        landlineNo: customer.landlineNo,
        area: customer.area,
        userId: customer.userId,
        status: customer.status || 'active'
      },
      sessionMaxAge: CUSTOMER_SESSION_MAX_AGE
    });
  } catch (error) { next(error); }
});

// Customer auth check
app.get('/api/customer/auth-check', async (req, res, next) => {
  try {
    const token = getCookie(req, 'customer_token');
    const landlineNo = verifyCustomerToken(token);
    if (!landlineNo) return res.json({ authenticated: false });
    const connectionsCol = await getCollection();
    const customer = await connectionsCol.findOne({ landlineNo });
    if (!customer) return res.json({ authenticated: false });
    res.json({
      authenticated: true,
      customer: {
        customerName: customer.customerName,
        landlineNo: customer.landlineNo,
        area: customer.area,
        userId: customer.userId,
        status: customer.status || 'active'
      },
      sessionMaxAge: CUSTOMER_SESSION_MAX_AGE
    });
  } catch (error) { next(error); }
});

// Customer logout
app.post('/api/customer/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'customer_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict');
  res.json({ success: true });
});

// Customer profile update
app.put('/api/customer/profile', requireCustomerAuth, async (req, res, next) => {
  try {
    const { customerName, area, userIdPrefix, newPassword } = req.body;
    const connectionsCol = await getCollection();
    const customer = await connectionsCol.findOne({ landlineNo: req.customerLandline });
    if (!customer) return res.status(404).json({ error: 'Account not found.' });

    const updates = { updatedAt: new Date().toISOString() };

    if (customerName && customerName.trim()) {
      updates.customerName = cleanText(customerName, 200);
    }
    if (area && area.trim()) {
      updates.area = cleanText(area, 100);
    }
    if (typeof userIdPrefix === 'string') {
      const prefix = userIdPrefix.trim().replace(/_?sid@.*$/i, '') || customer.landlineNo.replace(/\D/g, '').slice(-5);
      updates.userId = `${prefix}${USER_ID_SUFFIX}`;
    }
    if (newPassword && newPassword.trim()) {
      if (newPassword.trim().length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters.' });
      }
      updates.customerPassword = crypto.createHash('sha256').update(newPassword.trim()).digest('hex');
    }

    await connectionsCol.updateOne({ _id: customer._id }, { $set: updates });

    const updated = await connectionsCol.findOne({ landlineNo: req.customerLandline });
    res.json({
      success: true,
      customer: {
        customerName: updated.customerName,
        landlineNo: updated.landlineNo,
        area: updated.area,
        userId: updated.userId,
        status: updated.status || 'active'
      }
    });
  } catch (error) { next(error); }
});

/* ===========================
   Customer Complaint Routes
   =========================== */
const COMPLAINT_CATEGORIES = ['No Internet', 'Slow Speed', 'Disconnection', 'Billing Issue', 'Other'];
const COMPLAINT_STATUSES = ['open', 'in-progress', 'resolved', 'closed'];

// Customer: Book a new complaint
app.post('/api/customer/complaints', requireCustomerAuth, async (req, res, next) => {
  try {
    const { category, description } = req.body;
    if (!category || !COMPLAINT_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Please select a valid complaint category.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Please describe your issue.' });
    }
    if (description.trim().length > 2000) {
      return res.status(400).json({ error: 'Description is too long (max 2000 characters).' });
    }
    const connectionsCol = await getCollection();
    const customer = await connectionsCol.findOne({ landlineNo: req.customerLandline });
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const complaintsCol = await getComplaintsCollection();
    const now = new Date().toISOString();
    const complaint = {
      id: crypto.randomUUID(),
      customerId: req.customerLandline,
      customerName: customer.customerName,
      area: customer.area,
      userId: customer.userId,
      category: category,
      description: cleanText(description, 2000),
      status: 'open',
      adminNote: '',
      createdAt: now,
      updatedAt: now,
      resolvedAt: null
    };
    await complaintsCol.insertOne(complaint);
    // Send Telegram alert to admin (fire-and-forget, don't block response)
    sendTelegramAlert(complaint).catch(() => {});
    res.status(201).json({ complaint: stripId(complaint) });
  } catch (error) { next(error); }
});

// Customer: Get my complaints
app.get('/api/customer/complaints', requireCustomerAuth, async (req, res, next) => {
  try {
    const complaintsCol = await getComplaintsCollection();
    const complaints = await complaintsCol
      .find({ customerId: req.customerLandline })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ complaints: complaints.map(stripId) });
  } catch (error) { next(error); }
});

// Admin: Get all complaints
app.get('/api/complaints', requireAuth, async (req, res, next) => {
  try {
    const complaintsCol = await getComplaintsCollection();
    const filter = {};
    if (req.query.status && COMPLAINT_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const complaints = await complaintsCol
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    const counts = {
      total: await complaintsCol.countDocuments(),
      open: await complaintsCol.countDocuments({ status: 'open' }),
      'in-progress': await complaintsCol.countDocuments({ status: 'in-progress' }),
      resolved: await complaintsCol.countDocuments({ status: 'resolved' }),
      closed: await complaintsCol.countDocuments({ status: 'closed' })
    };
    res.json({ complaints: complaints.map(stripId), counts });
  } catch (error) { next(error); }
});

// Admin: Check for new complaints since timestamp (for polling/notifications)
app.get('/api/complaints/new-count', requireAuth, async (req, res, next) => {
  try {
    const since = req.query.since || new Date(Date.now() - 30000).toISOString();
    const complaintsCol = await getComplaintsCollection();
    const newComplaints = await complaintsCol
      .find({ createdAt: { $gt: since }, status: 'open' })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    const openCount = await complaintsCol.countDocuments({ status: 'open' });
    res.json({
      newCount: newComplaints.length,
      openCount,
      complaints: newComplaints.map(c => ({
        customerName: c.customerName,
        category: c.category,
        area: c.area,
        createdAt: c.createdAt
      }))
    });
  } catch (error) { next(error); }
});

// Admin: Update complaint status
app.put('/api/complaints/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    if (!status || !COMPLAINT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const complaintsCol = await getComplaintsCollection();
    const existing = await complaintsCol.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Complaint not found.' });

    const update = {
      status,
      adminNote: cleanText(adminNote || existing.adminNote, 2000),
      updatedAt: new Date().toISOString()
    };
    if (status === 'resolved' || status === 'closed') {
      update.resolvedAt = update.updatedAt;
    }
    await complaintsCol.updateOne({ id: req.params.id }, { $set: update });
    const updated = await complaintsCol.findOne({ id: req.params.id });
    res.json({ complaint: stripId(updated) });
  } catch (error) { next(error); }
});

/* ===========================
   Error Handler
   =========================== */
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Something went wrong. Please try again.' });
});

/* ===========================
   Start Server
   =========================== */
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  getCollection().then(() => {
    app.listen(PORT, () => console.log(`BSNL Connection Manager running at http://localhost:${PORT}`));
  }).catch((error) => {
    console.error('Failed to connect to MongoDB:', error.message);
    process.exit(1);
  });
}

// Export for Vercel serverless
module.exports = app;
