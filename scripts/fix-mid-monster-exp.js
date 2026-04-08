require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('equipment_game');
  const col = db.collection('monsters');
  const updates = [
    { _id: new ObjectId('69d540cd4f8d71d6b0c50b42'), name: '鐵甲蟹',     expReward: 600,  goldReward: 500  },
    { _id: new ObjectId('69d540cd4f8d71d6b0c50b43'), name: '毒牙狼',     expReward: 650,  goldReward: 550  },
    { _id: new ObjectId('69d540cd4f8d71d6b0c50b44'), name: '石巨人',     expReward: 850,  goldReward: 750  },
    { _id: new ObjectId('69d540cd4f8d71d6b0c50b45'), name: '黑暗弓手',   expReward: 680,  goldReward: 600  },
    { _id: new ObjectId('69d540cd4f8d71d6b0c50b46'), name: '中級史萊姆', expReward: 1400, goldReward: 1200 },
  ];
  for (const u of updates) {
    const { _id, ...fields } = u;
    const r = await col.updateOne({ _id }, { $set: fields });
    console.log(fields.name, 'exp:', fields.expReward, 'gold:', fields.goldReward, '(matched:', r.matchedCount, ')');
  }
  await client.close();
}
main().catch(console.error);
