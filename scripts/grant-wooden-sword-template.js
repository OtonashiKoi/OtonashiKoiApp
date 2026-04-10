require('dotenv').config();
const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

const WOODEN_SWORD_TEMPLATE = {
  itemId: "a56bd609-cf0b-4924-b724-891f221fc0b9",
  itemName: "木製單手劍",
  itemEffect: { type: "none", value: 0 },
  itemType: "equipment",
  imageUrl: "/uploads/items/7c05953f08d1de62ccf325f177a92b00.png",
  imageThumbnailUrl: "/uploads/items/7c05953f08d1de62ccf325f177a92b00_thumb.webp",
  equipSlot: "weapon",
  equipStats: { str: 3 },
  weaponType: "sword_1h",
  isTwoHanded: false,
  atkStat: "str",
  tier: "D",
  enhanceLevel: 0
};

async function main(){
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(DB_NAME);

  const progress = db.collection('progress');

  const cursor = progress.find({}, { projection: { playerId:1, inventory:1, equipment:1 } });
  const toGrant = [];

  while (await cursor.hasNext()){
    const doc = await cursor.next();
    const inv = Array.isArray(doc.inventory) ? doc.inventory : [];
    const equippedWeapon = doc.equipment?.weapon || null;
    const hasInInventory = inv.find(i => i.itemId === WOODEN_SWORD_TEMPLATE.itemId || i.itemName === WOODEN_SWORD_TEMPLATE.itemName || i.name === WOODEN_SWORD_TEMPLATE.itemName || i.displayName === WOODEN_SWORD_TEMPLATE.itemName);
    const hasEquipped = equippedWeapon && (equippedWeapon.itemId === WOODEN_SWORD_TEMPLATE.itemId || equippedWeapon.itemName === WOODEN_SWORD_TEMPLATE.itemName || equippedWeapon.name === WOODEN_SWORD_TEMPLATE.itemName);
    if (!hasInInventory && !hasEquipped) toGrant.push(doc.playerId);
  }

  console.log(`Found ${toGrant.length} players without 木製單手劍.`);

  for (const pid of toGrant){
    const entry = {
      uuid: randomUUID(),
      ...WOODEN_SWORD_TEMPLATE,
      grantedAt: new Date().toISOString(),
      grantedBy: 'grant-wooden-sword-template-script'
    };

    await progress.updateOne({ playerId: pid }, { $push: { inventory: entry }, $set: { updatedAt: new Date().toISOString() } }, { upsert: true });
    console.log('Granted to', pid, entry.uuid);
  }

  await client.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
