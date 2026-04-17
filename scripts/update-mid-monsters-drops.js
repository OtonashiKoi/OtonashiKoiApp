require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || process.env.MONGODB_CLOUD_URI || process.env.MONGO_URI;
const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || 'equipment_game';

if (!uri) {
  console.error('Missing MongoDB URI in env (MONGODB_URI or MONGODB_CLOUD_URI).');
  process.exit(1);
}

function sampleArray(arr, n) {
  const copy = arr.slice();
  const res = [];
  while (res.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    res.push(copy.splice(i, 1)[0]);
  }
  return res;
}

(async () => {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const itemsCol = db.collection('items');
    const monstersCol = db.collection('monsters');

    console.log('Connected to', uri, 'db:', dbName);

    // load C-tier equipment
    const cEquip = await itemsCol.find({ itemType: 'equipment', tier: 'C' }).toArray();
    const cWeapons = cEquip.filter(i => i.weaponType);
    const cArmors = cEquip.filter(i => !i.weaponType);
    console.log(`Found ${cEquip.length} C-tier equipment (${cWeapons.length} weapons, ${cArmors.length} armors)`);

    // load mid-zone monsters
    const monstersCursor = monstersCol.find({ zone: 'mid' });
    const updates = [];
    let processed = 0;

    while (await monstersCursor.hasNext()) {
      const m = await monstersCursor.next();
      processed++;

      const existingDrops = Array.isArray(m.drops) ? m.drops.map(d => d.itemId || d.id || d.item) : [];

        // choose 4 random C-tier items (weapons or armors)
        const equipPool = cEquip.filter(it => it.weaponType || it.equipSlot);
        const chosen = sampleArray(equipPool, 4).map(it => ({ itemId: it.id || it._id, chance: 15 }));

      // add exactly one monster card (the card that references this monster), chance 3%
      const cardItem = await itemsCol.findOne({ monsterCardOf: m.id || m._id });
      const cardDrop = cardItem ? { itemId: cardItem.id || cardItem._id, chance: 3 } : null;

      // filter out duplicates: only add items not already present
      const toAdd = chosen.filter(c => !existingDrops.includes(c.itemId));
      if (cardDrop && !existingDrops.includes(cardDrop.itemId)) {
        toAdd.push(cardDrop);
      }

      if (toAdd.length === 0) continue;

      updates.push({ id: m.id || m._id, add: toAdd });

      // perform update: push to drops array
      await monstersCol.updateOne(
        { _id: m._id },
        { $push: { drops: { $each: toAdd } } }
      );
    }

    console.log(`Processed ${processed} monsters in zone 'mid'. Applied updates to ${updates.length} monsters.`);
    // print a brief sample of updates
    console.log(updates.slice(0, 10));
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 2;
  } finally {
    await client.close();
  }
})();
