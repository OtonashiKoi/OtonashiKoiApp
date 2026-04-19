"use strict";
const { MongoClient, ObjectId } = require("mongodb");
const crypto = require("crypto");
const client = new MongoClient("mongodb://localhost:27017");

const D_ITEMS = [
  { id: "33d319ec-cb62-4826-8bcc-82a6fe52b8fa", name: "初級單手法杖" },
  { id: "d5936211-685a-4cd7-a1e9-24524725da96", name: "初級雙手法杖" },
  { id: "a91fab15-a786-490a-ae7f-6ecd536febb1", name: "布口罩" },
  { id: "7bdf0277-dcd5-4173-b3ff-d93ccaa9e293", name: "布帽" },
  { id: "912125cb-6738-4694-9657-81e7f6a5c2da", name: "布披風" },
  { id: "ee883bee-93c6-450d-b196-754d3e345d2a", name: "布衣" },
  { id: "3667cf4f-18cb-4861-b4cb-8700805d8bcf", name: "木框護目鏡" },
  { id: "4a7c2dd6-1d33-4613-a5aa-913924d12eed", name: "木盾" },
  { id: "421196aa-83e4-4f2e-82f6-dc05077b115a", name: "木製匕首" },
  { id: "a56bd609-cf0b-4924-b724-891f221fc0b9", name: "木製單手劍" },
  { id: "4885e098-3624-4c6c-9eb9-e4b27c2fb5ab", name: "木製單手斧" },
  { id: "6da9f4e6-aac1-4088-9000-7111fd4926b0", name: "木製單手槌" },
  { id: "d95a76a8-79ab-4dc7-ab07-82a39dbb5912", name: "木製弓" },
  { id: "ce6f0608-2750-47b4-aa26-14d9c1aa0f4c", name: "木製雙手劍" },
  { id: "2271e23c-9648-430e-944b-cea2107ee8ec", name: "木製雙手斧" },
  { id: "2fcf7576-4e74-4280-b1e6-0d7da7b58dda", name: "木製雙手槌" },
  { id: "8c9ac7c4-e00d-44fb-9582-8c68b99c2357", name: "草鞋" },
  { id: "be6f16fa-4e72-47ab-9a08-d580bd5490ef", name: "銅戒指(右)" },
  { id: "19e24aca-92f5-4f81-8ab9-cc4f8ba73a72", name: "銅戒指(左)" },
];

const B_ITEMS = [
  { id: "6c47d7a3-0937-4f9b-b447-2cc9f55ba749", name: "精鋼匕首" },
  { id: "e3bcdb33-4a28-499e-9c65-50240368550f", name: "精鋼單手劍" },
  { id: "8218a81c-98ed-49d3-8a16-a38189e00be6", name: "精鋼單手斧" },
  { id: "49a6108d-a199-4a7a-91ea-630814945399", name: "精鋼單手槌" },
  { id: "a314493c-efcd-43e5-bebc-935ef1d588a5", name: "精鋼弓" },
  { id: "3cdbaafb-df15-41e5-bca9-16453b72669e", name: "精鋼盾" },
  { id: "f005d0bb-7510-4905-a1bd-6fe55cc84af5", name: "精鋼護目鏡" },
  { id: "e17d3bad-4b8e-4603-9351-0e1432a21a11", name: "精鋼雙手劍" },
  { id: "25648e7c-d628-4d5d-bfed-1dfbe6a5e650", name: "精鋼雙手斧" },
  { id: "9e7fc009-c3ab-4c3f-b7d0-b1c17cb2e9d4", name: "精鋼雙手槌" },
  { id: "255bd660-555d-47a9-bdad-d1fd8eb36c1b", name: "精鋼靴" },
  { id: "8534e2da-47c0-4493-8051-a831b6476f03", name: "絲綢披風" },
  { id: "11c00245-6d43-4ab5-a68b-a7494a9fba84", name: "鎖甲" },
  { id: "7cdbe248-2e54-4798-9ddf-c103e80d2755", name: "鐵盔" },
  { id: "0a2c7f28-4b49-4f3b-9ee7-2c951b4699f2", name: "鐵面罩" },
  { id: "d08f99f6-6a4f-4afb-a02d-ec1a2cd69b2e", name: "高級單手法杖" },
  { id: "c9c7bbfb-ea75-4ac1-92cf-a897dcd32137", name: "高級雙手法杖" },
  { id: "feb40b36-5558-44af-a0d4-294bc8acaf46", name: "魔晶石戒(右)" },
  { id: "4196e3d5-811f-4816-aa94-a1e8cc31ebfc", name: "魔晶石戒(左)" },
];

const A_ITEMS = [
  { id: "5da1f2b3-ad07-46b5-9d24-eb2d849d3381", name: "秘銀匕首" },
  { id: "99d23a47-89a6-4291-9b03-8f15e7356eec", name: "秘銀單手劍" },
  { id: "b24ee5cd-c74b-409e-9326-14bd056d9af8", name: "秘銀單手斧" },
  { id: "3787b328-db67-4513-950e-0cfb8e503457", name: "秘銀單手槌" },
  { id: "bc3d565e-6d15-4080-b79f-b7f0b76e9042", name: "秘銀弓" },
  { id: "585ad0b3-2c75-462a-ade6-882e5929831b", name: "秘銀盾" },
  { id: "3eb62dad-c75f-46bb-997e-bf34c593c125", name: "秘銀護目鏡" },
  { id: "acfebb62-91b8-4989-8aab-431256ffd202", name: "秘銀雙手劍" },
  { id: "8c1782df-9823-405c-ade8-423c854a467e", name: "秘銀雙手斧" },
  { id: "0635861a-8bb0-4516-b16d-0351539ba5e7", name: "秘銀雙手槌" },
  { id: "6603a67d-aa9b-4c92-8171-f3da825afe50", name: "秘銀靴" },
  { id: "1039c921-d77d-4223-8d7b-321721484850", name: "天使翼披風" },
  { id: "c0eb5730-e014-4286-9aac-61ba7fb38d6e", name: "板甲" },
  { id: "ec5118e5-4ce6-494f-8d14-d9b91f3e0b48", name: "精鋼盔" },
  { id: "e7eef959-3e12-4435-bcf3-cdc9c9e7f813", name: "秘銀面罩" },
  { id: "d87fbd00-8882-4a95-8418-f0c7a7804343", name: "大師單手法杖" },
  { id: "ca32c28a-864b-44b5-becd-1242d910f718", name: "大師雙手法杖" },
  { id: "ef5eca0d-c422-48eb-860f-5d8a4dafa95a", name: "龍晶戒指(右)" },
  { id: "72b20cc5-b0e0-4897-98d5-30f9e4d03225", name: "龍晶戒指(左)" },
];

function pickDrops(pool, count, chance) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(item => ({ itemId: item.id, itemName: item.name, chance }));
}

const now = new Date().toISOString();

const beginnerMonsters = [
  { seq:1, name:"小史(超小)", level:1, maxHp:2000, def:5,  str:1, agi:2, vit:2, int:1, dex:2, luk:1, expReward:40,  goldReward:150,  spawnRate:10, isBoss:false },
  { seq:2, name:"野兔",       level:2, maxHp:2500, def:5,  str:1, agi:5, vit:2, int:1, dex:3, luk:2, expReward:60,  goldReward:200,  spawnRate:10, isBoss:false },
  { seq:3, name:"蘑菇怪",     level:2, maxHp:3000, def:8,  str:2, agi:2, vit:3, int:2, dex:2, luk:1, expReward:75,  goldReward:220,  spawnRate:10, isBoss:false },
  { seq:4, name:"小史(中)",   level:3, maxHp:3500, def:10, str:2, agi:4, vit:3, int:1, dex:3, luk:1, expReward:90,  goldReward:280,  spawnRate:10, isBoss:false },
  { seq:5, name:"大野兔(B)",  level:3, maxHp:5500, def:15, str:3, agi:8, vit:4, int:1, dex:5, luk:3, expReward:200, goldReward:800,  spawnRate:2,  isBoss:true  },
];

const hardMonsters = [
  { seq:1,  name:"城牆衛兵",    level:20, maxHp:30000, def:55, str:20, agi:5,  vit:25, int:2,  dex:5,  luk:3,  expReward:4500,  goldReward:6500,  spawnRate:10, isBoss:false },
  { seq:2,  name:"古城弓手",    level:20, maxHp:25000, def:30, str:18, agi:35, vit:12, int:3,  dex:28, luk:7,  expReward:3800,  goldReward:5500,  spawnRate:10, isBoss:false },
  { seq:3,  name:"石像鬼",      level:22, maxHp:35000, def:60, str:28, agi:3,  vit:32, int:2,  dex:3,  luk:2,  expReward:6000,  goldReward:8800,  spawnRate:10, isBoss:false },
  { seq:4,  name:"古城法師",    level:22, maxHp:22000, def:25, str:12, agi:10, vit:10, int:35, dex:12, luk:8,  expReward:5200,  goldReward:7600,  spawnRate:10, isBoss:false },
  { seq:5,  name:"廢墟蠍兵",    level:23, maxHp:28000, def:38, str:22, agi:25, vit:18, int:3,  dex:30, luk:5,  expReward:5500,  goldReward:8000,  spawnRate:10, isBoss:false },
  { seq:6,  name:"冰封騎士",    level:24, maxHp:38000, def:62, str:30, agi:4,  vit:35, int:5,  dex:4,  luk:2,  expReward:7000,  goldReward:10200, spawnRate:8,  isBoss:false },
  { seq:7,  name:"詛咒祭司",    level:24, maxHp:26000, def:28, str:16, agi:20, vit:14, int:22, dex:18, luk:10, expReward:6200,  goldReward:9000,  spawnRate:8,  isBoss:false },
  { seq:8,  name:"鐵甲衛將",    level:25, maxHp:32000, def:68, str:25, agi:6,  vit:28, int:3,  dex:6,  luk:3,  expReward:7500,  goldReward:11000, spawnRate:8,  isBoss:false },
  { seq:9,  name:"古城刺客",    level:25, maxHp:28000, def:32, str:20, agi:38, vit:15, int:5,  dex:35, luk:8,  expReward:7000,  goldReward:10200, spawnRate:8,  isBoss:false },
  { seq:10, name:"毒霧蜘蛛",    level:26, maxHp:24000, def:20, str:18, agi:30, vit:12, int:15, dex:28, luk:12, expReward:6800,  goldReward:9800,  spawnRate:8,  isBoss:false },
  { seq:11, name:"古城狂戰士",  level:27, maxHp:40000, def:50, str:35, agi:15, vit:30, int:2,  dex:12, luk:4,  expReward:9000,  goldReward:13000, spawnRate:6,  isBoss:false },
  { seq:12, name:"黑焰巫師",    level:27, maxHp:30000, def:22, str:14, agi:12, vit:12, int:40, dex:15, luk:10, expReward:8500,  goldReward:12400, spawnRate:6,  isBoss:false },
  { seq:13, name:"城堡魔像(B)", level:28, maxHp:60000, def:70, str:32, agi:5,  vit:40, int:5,  dex:5,  luk:5,  expReward:15000, goldReward:22000, spawnRate:2,  isBoss:true  },
  { seq:14, name:"古城將軍(B)", level:30, maxHp:55000, def:48, str:38, agi:42, vit:25, int:8,  dex:38, luk:12, expReward:18000, goldReward:26000, spawnRate:1,  isBoss:true  },
  { seq:15, name:"廢都魔王(B)", level:35, maxHp:80000, def:65, str:45, agi:20, vit:45, int:20, dex:22, luk:15, expReward:25000, goldReward:38000, spawnRate:1,  isBoss:true  },
];

client.connect().then(async () => {
  const db = client.db("equipment_game");
  const col = db.collection("monsters");

  const beginnerDocs = beginnerMonsters.map(m => ({
    _id: new ObjectId(),
    id: crypto.randomUUID(),
    zone: "beginner",
    ...m,
    drops: pickDrops(D_ITEMS, 3, 25),
    passiveEffects: [], procEffects: [], battleStartEffects: [], skills: [],
    enabled: true,
    createdAt: now
  }));

  const hardDocs = hardMonsters.map(m => ({
    _id: new ObjectId(),
    id: crypto.randomUUID(),
    zone: "hard",
    ...m,
    drops: m.isBoss ? pickDrops(A_ITEMS, 3, 10) : pickDrops(B_ITEMS, 3, 15),
    passiveEffects: [], procEffects: [], battleStartEffects: [], skills: [],
    enabled: true,
    createdAt: now
  }));

  const result = await col.insertMany([...beginnerDocs, ...hardDocs]);
  console.log("Inserted:", result.insertedCount, "monsters");

  const inserted = await col.find({ zone: { $in: ["beginner", "hard"] } }).sort({ zone: 1, seq: 1 }).toArray();
  inserted.forEach(m => {
    const dropStr = m.drops.map(d => d.itemName + "(" + d.chance + "%)").join(", ");
    console.log("[" + m.zone + "] seq" + m.seq + " " + m.name + " Lv." + m.level + " HP:" + m.maxHp + " DEF:" + m.def + "% | " + dropStr);
  });

  await client.close();
}).catch(err => { console.error(err); process.exit(1); });
