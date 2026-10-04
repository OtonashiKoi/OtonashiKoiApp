'use strict';
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient, BSON } = require('mongodb');
const costs = {
  'craft-gem-d-to-c': 500, 'craft-gem-c-to-b': 2000, 'craft-gem-b-to-a': 6000,
  'craft-element-wood-to-fire': 1000, 'craft-element-fire-to-earth': 1000,
  'craft-element-earth-to-metal': 1000, 'craft-element-metal-to-water': 1000,
  'craft-element-water-to-wood': 1000, 'craft-element-sun-to-moon': 2000,
  'craft-element-moon-to-sun': 2000,
};
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const collection = client.db(process.env.MONGODB_DB_NAME || 'equipment_game').collection('craftingRecipes');
    const before = await collection.find({}).sort({ id: 1 }).toArray();
    for (const [id, cost] of Object.entries(costs)) {
      const recipe = before.find(row => row.id === id);
      assert(recipe && recipe.enabled && recipe.accessMode === 'public' && !recipe.testOnly, id);
      assert(recipe.goldCost === 0 || recipe.goldCost === cost, `${id}: unexpected existing fee`);
      assert.equal(recipe.inputs.length, 1); assert.equal(recipe.inputs[0].quantity, 5);
      assert.equal(recipe.outputs.length, 1); assert.equal(recipe.outputs[0].quantity, 1);
    }
    console.log(JSON.stringify({ plan: costs, apply: process.argv.includes('--apply') }));
    if (!process.argv.includes('--apply')) return;
    const directory = path.join('/Users/riuchen/Backups/otonashiKoi', `crafting-fees-${Date.now()}`);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'craftingRecipes.bson');
    fs.writeFileSync(file, Buffer.concat(before.map(row => BSON.serialize(row))), { flag: 'wx' });
    const raw = fs.readFileSync(file); const parsed = [];
    for (let offset = 0; offset < raw.length;) {
      const size = raw.readInt32LE(offset); assert(size >= 5 && offset + size <= raw.length);
      parsed.push(BSON.deserialize(raw.subarray(offset, offset + size))); offset += size;
    }
    assert.deepEqual(parsed, before);
    fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({ indexes: await collection.indexes(), costs }, null, 2));
    for (const [id, cost] of Object.entries(costs)) {
      const old = before.find(row => row.id === id);
      const result = await collection.updateOne({ _id: old._id, goldCost: old.goldCost, enabled: true, accessMode: 'public', inputs: old.inputs, outputs: old.outputs }, { $set: { goldCost: cost } });
      assert.equal(result.matchedCount, 1, `${id}: configuration drift; restore from backup if necessary`);
    }
    const after = await collection.find({}).sort({ id: 1 }).toArray();
    assert.deepEqual(after, before.map(row => Object.hasOwn(costs, row.id) ? { ...row, goldCost: costs[row.id] } : row));
    fs.writeFileSync(path.join(directory, 'readback.json'), JSON.stringify(after, null, 2));
    console.log(JSON.stringify({ verifiedRecipes: Object.keys(costs).length, backup: directory }));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { costs };
