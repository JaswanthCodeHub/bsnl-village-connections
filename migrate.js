/**
 * Migration Script: Upload existing connections.json data to MongoDB Atlas.
 *
 * Usage:
 *   set MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
 *   node migrate.js
 *
 * This script reads data/connections.json and inserts all records into the
 * MongoDB 'bsnl_manager.connections' collection. It is safe to run multiple
 * times — it will skip records that already exist (based on the 'id' field).
 */

const { MongoClient } = require('mongodb');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

// Use Google DNS to resolve SRV records (fixes BSNL broadband DNS issues)
dns.setServers(['8.8.8.8', '8.8.4.4']);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'bsnl_manager';
const COLLECTION_NAME = 'connections';
const DB_FILE = path.join(__dirname, 'data', 'connections.json');

async function migrate() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI environment variable is not set.');
    console.error('');
    console.error('Set it first:');
    console.error('  Windows (CMD):   set MONGODB_URI=mongodb+srv://...');
    console.error('  Windows (PS):    $env:MONGODB_URI="mongodb+srv://..."');
    console.error('  Linux/Mac:       export MONGODB_URI="mongodb+srv://..."');
    process.exit(1);
  }

  if (!fs.existsSync(DB_FILE)) {
    console.error(`❌ File not found: ${DB_FILE}`);
    console.error('No data to migrate.');
    process.exit(1);
  }

  console.log('📂 Reading local data file...');
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const data = JSON.parse(raw);
  const connections = data.connections || [];

  if (!connections.length) {
    console.log('⚠️  No connections found in the file. Nothing to migrate.');
    process.exit(0);
  }

  console.log(`📊 Found ${connections.length} connections in local file.`);
  console.log('🔗 Connecting to MongoDB Atlas...');

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Create indexes
    await collection.createIndex({ id: 1 }, { unique: true }).catch(() => {});
    await collection.createIndex({ area: 1 }).catch(() => {});

    // Check how many already exist
    const existingCount = await collection.countDocuments();
    console.log(`📦 MongoDB currently has ${existingCount} records.`);

    // Insert records one-by-one, skipping duplicates
    let inserted = 0;
    let skipped = 0;
    for (const connection of connections) {
      try {
        await collection.insertOne({ ...connection });
        inserted++;
      } catch (error) {
        if (error.code === 11000) {
          // Duplicate key — record already exists
          skipped++;
        } else {
          throw error;
        }
      }
    }

    const finalCount = await collection.countDocuments();
    console.log('');
    console.log('✅ Migration complete!');
    console.log(`   ➕ Inserted: ${inserted} new records`);
    console.log(`   ⏭️  Skipped:  ${skipped} duplicates`);
    console.log(`   📦 Total in MongoDB: ${finalCount} records`);
    console.log('');
    console.log('🎉 Your data is now safely in MongoDB Atlas!');
    console.log('   You can now deploy to Vercel.');

  } finally {
    await client.close();
  }
}

migrate().catch((error) => {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
});
