"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI);

// D 級裝備
const D = {
  sword1h:  { id: "a56bd609-cf0b-4924-b724-891f221fc0b9", name: "木製單手劍" },
  sword2h:  { id: "ce6f0608-2750-47b4-aa26-14d9c1aa0f4c", name: "木製雙手劍" },
  mace1h:   { id: "6da9f4e6-aac1-4088-9000-7111fd4926b0", name: "木製單手槌" },
  mace2h:   { id: "2fcf7576-4e74-4280-b1e6-0d7da7b58dda", name: "木製雙手槌" },
  axe1h:    { id: "4885e098-3624-4c6c-9eb9-e4b27c2fb5ab", name: "木製單手斧" },
  axe2h:    { id: "2271e23c-9648-430e-944b-cea2107ee8ec", name: "木製雙手斧" },
  dagger:   { id: "421196aa-83e4-4f2e-82f6-dc05077b115a", name: "木製匕首" },
  staff1h:  { id: "33d319ec-cb62-4826-8bcc-82a6fe52b8fa", name: "初級單手法杖" },
  staff2h:  { id: "d5936211-685a-4cd7-a1e9-24524725da96", name: "初級雙手法杖" },
  bow:      { id: "d95a76a8-79ab-4dc7-ab07-82a39dbb5912", name: "木製弓" },
  shield:   { id: "4a7c2dd6-1d33-4613-a5aa-913924d12eed", name: "木盾" },
  armor:    { id: "ee883bee-93c6-450d-b196-754d3e345d2a", name: "布衣" },
  head_top: { id: "7bdf0277-dcd5-4173-b3ff-d93ccaa9e293", name: "布帽" },
  head_mid: { id: "3667cf4f-18cb-4861-b4cb-8700805d8bcf", name: "木框護目鏡" },
  head_low: { id: "a91fab15-a786-490a-ae7f-6ecd536febb1", name: "布口罩" },
  garment:  { id: "912125cb-6738-4694-9657-81e7f6a5c2da", name: "布披風" },
  shoes:    { id: "8c9ac7c4-e00d-44fb-9582-8c68b99c2357", name: "草鞋" },
  acc_l:    { id: "19e24aca-92f5-4f81-8ab9-cc4f8ba73a72", name: "銅戒指(左)" },
  acc_r:    { id: "be6f16fa-4e72-47ab-9a08-d580bd5490ef", name: "銅戒指(右)" },
};

// C 級裝備
const C = {
  sword1h:  { id: "9c809436-d8d5-4b21-bf15-e26e881cac9b", name: "鐵製單手劍" },
  sword2h:  { id: "24d71d06-5df8-446d-b2e5-f4cb49818e3f", name: "鐵製雙手劍" },
  mace1h:   { id: "fbf8fdec-72a4-4d76-bcb5-117952352dec", name: "鐵製單手槌" },
  mace2h:   { id: "1f04c0db-e5cb-4b84-9a43-e7150799eecb", name: "鐵製雙手槌" },
  axe1h:    { id: "fcdbb6c1-bb21-45e1-9637-3aa58a76c79e", name: "鐵製單手斧" },
  axe2h:    { id: "ab533d4a-3d07-4d41-8a40-511a8e6a455d", name: "鐵製雙手斧" },
  dagger:   { id: "a5bf4a8c-2f89-4b35-9f23-8cb519bb0292", name: "鐵製匕首" },
  staff1h:  { id: "234e9a7f-1220-48fa-824a-690ce0648ae6", name: "中級單手法杖" },
  staff2h:  { id: "c0545f31-455e-4846-b914-79302f8bea03", name: "中級雙手法杖" },
  bow:      { id: "efd48300-f4b6-40d6-a1c5-8c2014ae4b55", name: "鐵製弓" },
  shield:   { id: "dcb0ab95-aff6-4961-ae44-79bd49a2f0e8", name: "鐵盾" },
  armor:    { id: "73884cf9-67b5-47b4-af3c-b6d79a39ec57", name: "皮甲" },
  head_top: { id: "12cddc4e-58ef-433e-a50d-e8ca04b1041e", name: "皮帽" },
  head_mid: { id: "45a8eba1-f558-4c9b-8c60-7dcc42ba2cf9", name: "鐵護目鏡" },
  head_low: { id: "099d5496-e0d4-49e5-af89-ac6580262d5a", name: "皮口罩" },
  garment:  { id: "bb26be45-2910-4034-8db6-e02d9d473513", name: "皮披風" },
  shoes:    { id: "34e4afa6-d9a9-44f1-8af6-8b3c1bd929a9", name: "皮靴" },
  acc_l:    { id: "eb852c75-f487-4086-b8b3-0b10adab2db3", name: "銀戒指(左)" },
  acc_r:    { id: "353b7c41-1d23-4a43-ac3c-38517bb235a5", name: "銀戒指(右)" },
};

// B 級（只給 mid boss 米拉桑用）
const B = {
  sword2h:  { id: "e17d3bad-4b8e-4603-9351-0e1432a21a11", name: "精鋼雙手劍" },
  bow:      { id: "a314493c-efcd-43e5-bebc-935ef1d588a5", name: "精鋼弓" },
  staff2h:  { id: "c9c7bbfb-ea75-4ac1-92cf-a897dcd32137", name: "高級雙手法杖" },
  armor:    { id: "11c00245-6d43-4ab5-a68b-a7494a9fba84", name: "鎖甲" },
  shield:   { id: "3cdbaafb-df15-41e5-bca9-16453b72669e", name: "精鋼盾" },
};

function d(item, chance) {
  return { itemId: item.id, itemName: item.name, chance };
}

const UPDATES = [
  // ── NORMAL ZONE ─────────────────────────────────────────────
  {
    name: "小史(小)", zone: "normal",
    drops: [
      d(D.armor,    8),
      d(D.head_top, 8),
      d(D.shoes,    8),
      d(D.garment,  6),
    ]
  },
  {
    name: "哥布", zone: "normal",
    drops: [
      d(D.sword1h, 8),
      d(D.mace1h,  8),
      d(D.dagger,  8),
      d(D.shield,  6),
    ]
  },
  {
    name: "石頭", zone: "normal",
    drops: [
      d(D.head_mid, 8),
      d(D.head_low, 8),
      d(D.acc_l,    6),
      d(D.acc_r,    6),
    ]
  },
  {
    name: "小狼", zone: "normal",
    drops: [
      d(D.axe1h,   8),
      d(D.bow,     8),
      d(D.garment, 8),
      d(D.shoes,   6),
    ]
  },
  {
    name: "大史(B)", zone: "normal", // boss
    drops: [
      d(D.sword2h, 20),
      d(D.mace2h,  20),
      d(D.axe2h,   20),
      d(D.staff1h, 15),
      d(D.staff2h, 15),
      d(D.acc_l,   15),
      d(D.acc_r,   15),
    ]
  },
  {
    name: "小金(稀)", zone: "normal",
    drops: [
      d(D.acc_l,  15),
      d(D.acc_r,  15),
      d(D.armor,  10),
      d(D.shield, 10),
    ]
  },

  // ── MID ZONE ────────────────────────────────────────────────
  {
    name: "甲蟹", zone: "mid",
    drops: [
      d(C.shield,   10),
      d(C.armor,    10),
      d(C.head_top,  8),
      d(C.mace1h,    8),
      d(C.mace2h,    6),
    ]
  },
  {
    name: "牙牙狼", zone: "mid",
    drops: [
      d(C.dagger,  10),
      d(C.bow,     10),
      d(C.axe1h,    8),
      d(C.garment,  8),
      d(C.shoes,    8),
    ]
  },
  {
    name: "巨巨", zone: "mid",
    drops: [
      d(C.sword2h,  10),
      d(C.axe2h,    10),
      d(C.mace2h,   10),
      d(C.head_mid,  8),
      d(C.head_low,  8),
    ]
  },
  {
    name: "黑暗弓手", zone: "mid",
    drops: [
      d(C.bow,     12),
      d(C.sword1h, 10),
      d(C.staff1h,  8),
      d(C.acc_l,    8),
      d(C.acc_r,    8),
    ]
  },
  {
    name: "米拉桑(B)", zone: "mid", // boss
    drops: [
      d(C.sword2h,  25),
      d(C.staff2h,  25),
      d(C.bow,      25),
      d(C.armor,    20),
      d(C.shield,   20),
      d(C.acc_l,    15),
      d(C.acc_r,    15),
      // boss 限定：低機率 B 級
      d(B.sword2h,   5),
      d(B.bow,        5),
      d(B.staff2h,   5),
      d(B.armor,     5),
      d(B.shield,    5),
    ]
  },
];

(async () => {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");
  for (const u of UPDATES) {
    const result = await db.collection("monsters").updateOne(
      { name: u.name, zone: u.zone },
      { $set: { drops: u.drops } }
    );
    console.log(`${u.name}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }
  await client.close();
  console.log("Done.");
})();
