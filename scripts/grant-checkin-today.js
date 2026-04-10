require('dotenv').config();
const { MongoClient } = require('mongodb');
const { createServiceContext } = require('../src/services/createServiceContext');
const config = require('../src/config');
const { readStore } = require('../src/adapters/json/jsonStore');

function toTWDateIso(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 480);
  return d.toISOString().slice(0, 10);
}

async function run() {
  const ctx = createServiceContext();

  const grantAmount = 100;
  const operator = 'admin:grant-checkin-today';
  const source = 'admin:daily-checkin-bonus';

  let discordIds = [];

  if (config.storage.driver === 'mongo') {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not set');
    const client = new MongoClient(uri, { useUnifiedTopology: true });
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || 'equipment_game');

    const now = new Date();
    // TW date
    const twDate = (() => {
      const d = new Date(now);
      d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 480);
      return d.toISOString().slice(0, 10);
    })();

    const start = new Date(twDate + 'T00:00:00.000Z');
    const end = new Date(twDate + 'T23:59:59.999Z');

    const rows = await db.collection('checkins').find({ occurredAt: { $gte: start.toISOString(), $lte: end.toISOString() } }).toArray();
    discordIds = Array.from(new Set(rows.map(r => r.discordId).filter(Boolean)));
    await client.close();
  } else {
    const store = await readStore();
    const now = new Date();
    const today = (() => {
      const d = new Date(now);
      d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 480);
      return d.toISOString().slice(0, 10);
    })();

    const rows = (store.checkins || []).filter(c => toTWDateIso(c.occurredAt) === today);
    discordIds = Array.from(new Set(rows.map(r => r.discordId).filter(Boolean)));
  }

  console.log('Found', discordIds.length, 'unique checkin players today');

  for (const id of discordIds) {
    try {
      // try to get displayName from playerService
      const player = await ctx.playerService.getProfile(id);
      const displayName = player?.player?.displayName || id;
      const res = await ctx.rewardService.grantCurrency({
        discordId: id,
        displayName,
        currencyType: 'gold',
        amount: grantAmount,
        source,
        operator
      });
      console.log('Granted', grantAmount, 'gold to', id, 'tx:', res.transaction?.id || '(no-tx)');
    } catch (e) {
      console.error('Failed for', id, e.message || e);
    }
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
