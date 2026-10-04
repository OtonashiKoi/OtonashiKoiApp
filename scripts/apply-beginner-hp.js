"use strict";
// Narrow, guarded HP migration. Never resets players, rewards, or active battle state.
require('dotenv').config({ quiet: true });
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { MongoClient, BSON } = require('mongodb');
async function main() {
  const arg = k => process.argv.find(a => a.startsWith(k + '='))?.slice(k.length + 1);
  const planFile = arg('--plan'), backup = arg('--backup-dir');
  if (!planFile) throw Error('--plan required');
  const plan = JSON.parse(fs.readFileSync(planFile));
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'equipment_game');
    const coll = db.collection('monsters'), ids = plan.plan.map(r => r.id);
    const rows = await coll.find({ id: { $in: ids } }).toArray();
    assert.equal(rows.length, 4);
    for (const row of rows) assert.ok(row.zone === 'beginner' && !row.isBoss && !row.allZones);
    if (!process.argv.includes('--apply')) { console.log(plan.plan.map(r => ({ name: r.name, hp: [r.beforeHp, r.values.maxHp] }))); return; }
    if (!backup || !path.isAbsolute(backup) || backup.startsWith(path.resolve('.') + '/')) throw Error('external absolute backup directory required');
    fs.mkdirSync(backup, { recursive: true });
    const bytes = Buffer.concat(rows.map(r => BSON.serialize(r)));
    fs.writeFileSync(path.join(backup, 'monsters.bson'), bytes, { flag: 'wx' });
    const parsed = [];
    for (let offset = 0; offset < bytes.length;) { const n = bytes.readInt32LE(offset); parsed.push(BSON.deserialize(bytes.subarray(offset, offset + n))); offset += n; }
    assert.deepEqual(parsed, rows);
    fs.writeFileSync(path.join(backup, 'monsters.metadata.json'), JSON.stringify({ count: rows.length, indexes: await coll.indexes() }, null, 2), { flag: 'wx' });
    fs.writeFileSync(path.join(backup, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
    const result = [];
    for (const change of plan.plan) {
      const original = rows.find(r => r.id === change.id);
      assert.deepEqual(Object.keys(change.values).sort(), ['beginnerHpRevision', 'maxHp']);
      assert.equal(original.maxHp, change.beforeHp, 'HP drift; stop and re-preview');
      const updated = await coll.updateOne({ id: change.id, zone: 'beginner', maxHp: change.beforeHp }, { $set: change.values });
      assert.equal(updated.matchedCount, 1, 'concurrent HP change');
      const live = await coll.findOne({ id: change.id });
      for (const [key, value] of Object.entries(change.values)) assert.deepEqual(live[key], value);
      // Fields this migration never changes are also read back.
      for (const key of ['str','agi','level','def','flatDef','expReward','goldReward','drops','entryFee']) assert.deepEqual(live[key], original[key], key);
      result.push({ name: live.name, beforeHp: original.maxHp, hp: live.maxHp });
    }
    fs.writeFileSync(path.join(backup, 'readback.json'), JSON.stringify(result, null, 2));
    console.log('BSON backup parsed and readback verified', result);
  } finally { await client.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
