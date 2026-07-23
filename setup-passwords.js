const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bsnl';

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('Connected to MongoDB');
  
  const col = client.db('bsnl_manager').collection('connections');
  const total = await col.countDocuments();
  console.log('Total customers:', total);
  
  // Find customers without password
  const customers = await col.find({}).toArray();
  let updated = 0;
  let skipped = 0;
  
  for (const cust of customers) {
    if (cust.customerPassword) {
      skipped++;
      continue;
    }
    const digits = (cust.landlineNo || '').replace(/\D/g, '');
    const defaultPw = digits.slice(-6);
    if (defaultPw.length < 6) {
      console.log('  SKIP (bad landline):', cust.customerName, cust.landlineNo);
      skipped++;
      continue;
    }
    const hashed = crypto.createHash('sha256').update(defaultPw).digest('hex');
    await col.updateOne({ _id: cust._id }, { $set: { customerPassword: hashed } });
    updated++;
  }
  
  console.log('---');
  console.log('Passwords SET:', updated);
  console.log('Already had password (skipped):', skipped);
  
  // Verify
  const withPw = await col.countDocuments({ customerPassword: { $exists: true, $ne: '' } });
  console.log('Verified: ' + withPw + '/' + total + ' customers have passwords');
  
  // Print sample accounts
  console.log('\n--- SAMPLE ACCOUNTS ---');
  const samples = await col.find({}).sort({ area: 1, customerName: 1 }).limit(10).toArray();
  for (const s of samples) {
    const digits = (s.landlineNo || '').replace(/\D/g, '');
    console.log(`  Name: ${s.customerName}`);
    console.log(`  Username: ${s.landlineNo}`);
    console.log(`  Password: ${digits.slice(-6)}`);
    console.log(`  Area: ${s.area}`);
    console.log('  ---');
  }
  
  await client.close();
  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
