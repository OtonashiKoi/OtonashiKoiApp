require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

async function main(){
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(DB_NAME);

  // 計算台灣時區今天 00:00 的 UTC 範圍 (inclusive start, exclusive end)
  const now = new Date();
  const twNow = new Date(now.getTime() + 8 * 3600000); // UTC+8
  const twYear = twNow.getUTCFullYear();
  const twMonth = twNow.getUTCMonth();
  const twDate = twNow.getUTCDate();
  const twMidnight = Date.UTC(twYear, twMonth, twDate, 0, 0, 0); // this is in UTC ms representing TW 00:00
  const startUTC = new Date(twMidnight - 8 * 3600000); // convert back to UTC ms
  const endUTC = new Date(startUTC.getTime() + 24 * 3600000);

  console.log('Deleting checkins with occurredAt >=', startUTC.toISOString(), 'and <', endUTC.toISOString());

  const res = await db.collection('checkins').deleteMany({
    occurredAt: { $gte: startUTC.toISOString(), $lt: endUTC.toISOString() }
  });

  console.log('Deleted', res.deletedCount, 'checkin(s)');
  await client.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
