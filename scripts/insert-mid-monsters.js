require('dotenv').config();
const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');

const monsters = [
  {
    id: randomUUID(), seq: 6, zone: 'mid', name: '鐵甲蟹',
    level: 8, str: 5, agi: 5, vit: 450, int: 1, dex: 5, luk: 3,
    entryFee: 50, expReward: 1500, goldReward: 1000, spawnRate: 15, enabled: true,
    drops: [
      { itemId: '4d9030c7-9d87-43a1-8471-d1cb6b2fe651', itemName: '鐵盾',    chance: 15 },
      { itemId: '240bb9de-bb09-47f1-ad1f-b26012fd398b', itemName: '皮甲',    chance: 10 },
      { itemId: '8b3afbf7-44db-40cb-98e0-3345009723b0', itemName: '鐵盔',    chance: 8  }
    ]
  },
  {
    id: randomUUID(), seq: 7, zone: 'mid', name: '毒牙狼',
    level: 10, str: 3, agi: 100, vit: 380, int: 2, dex: 30, luk: 10,
    entryFee: 50, expReward: 1500, goldReward: 1200, spawnRate: 15, enabled: true,
    drops: [
      { itemId: '240bb9de-bb09-47f1-ad1f-b26012fd398b', itemName: '皮甲',    chance: 10 },
      { itemId: 'edee321f-bce7-4867-a46c-cdebfabfac70', itemName: '皮靴',    chance: 10 },
      { itemId: '9e944358-08b7-40d9-97fa-a92bc3751633', itemName: '月影匕首', chance: 5  }
    ]
  },
  {
    id: randomUUID(), seq: 8, zone: 'mid', name: '石巨人',
    level: 12, str: 25, agi: 3, vit: 550, int: 1, dex: 3, luk: 2,
    entryFee: 80, expReward: 2200, goldReward: 1800, spawnRate: 10, enabled: true,
    drops: [
      { itemId: 'bb48ac88-8c02-4d1c-9169-e2ef67bb8319', itemName: '大鐵斧',  chance: 10 },
      { itemId: '8b3afbf7-44db-40cb-98e0-3345009723b0', itemName: '鐵盔',    chance: 10 },
      { itemId: '2ac8590e-e3eb-44a3-b389-b6a08761ffaf', itemName: '鎖甲',    chance: 8  }
    ]
  },
  {
    id: randomUUID(), seq: 9, zone: 'mid', name: '黑暗弓手',
    level: 10, str: 5, agi: 50, vit: 400, int: 5, dex: 60, luk: 15,
    entryFee: 50, expReward: 1800, goldReward: 1500, spawnRate: 12, enabled: true,
    drops: [
      { itemId: 'd5851a1d-5b3e-4d99-8fb0-a2d7e3879f80', itemName: '精鐵弓',  chance: 8  },
      { itemId: '066638ee-dcc6-4f4d-8486-511ba1acdc81', itemName: '皮帽',    chance: 10 },
      { itemId: 'f72d4a7f-ceb9-4a60-856f-51baa1312bf4', itemName: '鐵護目鏡', chance: 10 }
    ]
  },
  {
    id: randomUUID(), seq: 10, zone: 'mid', name: '中級史萊姆',
    level: 15, str: 20, agi: 25, vit: 700, int: 15, dex: 20, luk: 10,
    entryFee: 100, expReward: 3500, goldReward: 3000, spawnRate: 5, enabled: true,
    drops: [
      { itemId: '8f156fec-4915-4052-8091-395effbfa4de', itemName: '大鐵劍',  chance: 8  },
      { itemId: 'bb48ac88-8c02-4d1c-9169-e2ef67bb8319', itemName: '大鐵斧',  chance: 8  },
      { itemId: '47ec67e5-e136-45bb-8edc-0cd09d9b1403', itemName: '鐵法杖',  chance: 8  },
      { itemId: '77e9bc7f-b7df-432f-99ef-443615f9c858', itemName: '精鐵匕首', chance: 5  }
    ]
  }
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('equipment_game');
  const result = await db.collection('monsters').insertMany(monsters);
  console.log('已插入:', result.insertedCount, '隻怪物');
  monsters.forEach(m => {
    const hp = m.vit * 15 + 50;
    const atk = m.str * 3;
    console.log(`  seq:${m.seq} ${m.name} | Lv.${m.level} | HP:${hp} ATK:${atk} | exp:${m.expReward} gold:${m.goldReward}`);
  });
  await client.close();
}
main().catch(console.error);
