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
const LANDLINE_PREFIX = '08643';
const USER_ID_SUFFIX = '_sid@ftth.bsnl.in';

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

  // Create index on 'id' field for fast lookups
  await connectionsCollection.createIndex({ id: 1 }, { unique: true }).catch(() => {});
  // Create index on 'area' field for fast area-based queries
  await connectionsCollection.createIndex({ area: 1 }).catch(() => {});
  // Create text index for full-text search
  await connectionsCollection.createIndex({ customerName: 'text', landlineNo: 'text', userId: 'text' }).catch(() => {});

  console.log('Connected to MongoDB successfully.');
  return connectionsCollection;
}

/* ===========================
   Helper Functions
   =========================== */
function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
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

function areaFromFilename(filename) {
  const value = filename.toLowerCase();
  if (value.includes('parchur side')) return 'OLT to Parchur Side';
  if (value.includes('sai temple to nagulapadu')) return 'PNP Sai Temple to Nagulapadu';
  if (value.includes('olt to varagani')) return 'OLT to Varagani';
  if (value.includes('bodaraya to kommuru')) return 'PNP Bodaraya to Kommuru';
  if (value.includes('bankers')) return 'Bankers';
  if (value.includes('garalapadu')) return 'Garalapadu';
  if (value.includes('pedavaripalem')) return 'Pedavaripalem';
  if (value.includes('kommuru')) return 'Kommuru';
  return 'Imported file';
}

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

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
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

// GET all connections
app.get('/api/connections', requireAuth, async (_req, res, next) => {
  try {
    const connectionsCollection = await getCollection();
    const connections = await connectionsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.json({
      connections: connections.map(stripId),
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
