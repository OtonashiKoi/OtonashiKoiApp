"use strict";
/**
 * 為缺少第二掉落來源的非卡片裝備，依照主題配對補上第二個怪物掉落。
 * 原則：D 階 → 初始/普通區怪物；C 階 → 普通/中等區怪物；B 階 → 中等/困難區怪物
 * 武器依類型對應怪物戰鬥風格，防具依素材/主題對應怪物
 */

const { MongoClient, ObjectId } = require("mongodb");

// beginner/hard 怪物 _id 是 ObjectId；normal/mid 怪物 _id 是字串
const MONSTER_IDS = {
  小史小:   new ObjectId("69e4c55eff9008d81d74625e"),  // beginner OID
  野兔:     new ObjectId("69e4c55eff9008d81d74625f"),  // beginner OID
  蘑菇怪:   new ObjectId("69e4c55eff9008d81d746260"),  // beginner OID
  小史中:   new ObjectId("69e4c55eff9008d81d746261"),  // beginner OID
  大野兔B:  new ObjectId("69e4c55eff9008d81d746262"),  // beginner OID
  小史:     "69d2ab22edbb0450da0495a1",               // normal STR
  哥布:     "69d2ab22edbb0450da0495a3",               // normal STR
  小狼:     "69d2ab22edbb0450da0495a4",               // normal STR
  石頭:     "69d2ab22edbb0450da0495a8",               // normal STR
  大史B:    "69d5207fedbb0450da04f126",               // normal STR
  小金稀:   "69d71d34edbb0450da0544a2",               // normal STR
  青草地精: "69df9edd1240ccbeba205a2e",               // normal STR
  綠野狼:   "69df9edd1240ccbeba205a2f",               // normal STR
  甲蟹:     "69d540cd4f8d71d6b0c50b42",               // mid STR
  牙牙狼:   "69d540cd4f8d71d6b0c50b43",               // mid STR
  巨巨:     "69d540cd4f8d71d6b0c50b44",               // mid STR
  黑暗弓手: "69d540cd4f8d71d6b0c50b45",               // mid STR
  米拉桑B:  "69d540cd4f8d71d6b0c50b46",               // mid STR
  中金稀:   "69d744b8edbb0450da054a4d",               // mid STR
  林地妖靈: "69df9edd1240ccbeba205a34",               // mid STR
  森林古樹: "69df9edd1240ccbeba205a35",               // mid STR
  暗夜獵豹: "69df9edd1240ccbeba205a36",               // mid STR
  森林巫師: "69df9edd1240ccbeba205a37",               // mid STR
  森林盜賊: "69df9edd1240ccbeba205a38",               // mid STR
  森林之獸: "69df9edd1240ccbeba205a39",               // mid STR
  城牆衛兵: new ObjectId("69e4c55eff9008d81d746263"),  // hard OID
  古城弓手: new ObjectId("69e4c55eff9008d81d746264"),  // hard OID
  石像鬼:   new ObjectId("69e4c55eff9008d81d746265"),  // hard OID
  古城法師: new ObjectId("69e4c55eff9008d81d746266"),  // hard OID
  廢墟蠍兵: new ObjectId("69e4c55eff9008d81d746267"),  // hard OID
  冰封騎士: new ObjectId("69e4c55eff9008d81d746268"),  // hard OID
  鐵甲衛將: new ObjectId("69e4c55eff9008d81d74626a"),  // hard OID
  古城刺客: new ObjectId("69e4c55eff9008d81d74626b"),  // hard OID
  古城狂戰士: new ObjectId("69e4c55eff9008d81d74626d"), // hard OID
  黑焰巫師: new ObjectId("69e4c55eff9008d81d74626e"),  // hard OID
  城堡魔像B: new ObjectId("69e4c55eff9008d81d74626f"), // hard OID
};

/**
 * 新增掉落規則
 * 格式: { itemId, itemName, monsterKey, chance }
 * 選擇邏輯備注已附在每條
 */
const NEW_DROPS = [
  // ── D 階防具 ──────────────────────────────────────────────────────
  // 木盾 → 石頭（石質防禦主題）& 已有 青草地精 → 加 小史(中)
  { itemId: "4a7c2dd6-1d33-4613-a5aa-913924d12eed", itemName: "木盾", monsterKey: "小史中", chance: 4 },
  // 布衣 → 已有 小史(小) → 加 野兔（初始怪都穿布）
  { itemId: "ee883bee-93c6-450d-b196-754d3e345d2a", itemName: "布衣", monsterKey: "野兔", chance: 4 },
  // 布帽 → 已有 石頭 → 加 小史(小)
  { itemId: "7bdf0277-dcd5-4173-b3ff-d93ccaa9e293", itemName: "布帽", monsterKey: "小史小", chance: 4 },
  // 布鞋 → 已有 野兔（快腿）→ 加 小史(小)
  { itemId: "d8c97439-b3f6-488b-8e69-97b4dacf3e2a", itemName: "布鞋", monsterKey: "小史小", chance: 4 },
  // 銅戒指(右) → 已有 小狼 → 加 哥布（哥布常戴戒指）
  { itemId: "be6f16fa-4e72-47ab-9a08-d580bd5490ef", itemName: "銅戒指(右)", monsterKey: "哥布", chance: 4 },

  // ── D 階武器 ──────────────────────────────────────────────────────
  // 木製雙手劍 → 已有 哥布 → 加 青草地精（近戰型地精）
  { itemId: "ce6f0608-2750-47b4-aa26-14d9c1aa0f4c", itemName: "木製雙手劍", monsterKey: "青草地精", chance: 4 },
  // 木製雙手槌 → 已有 青草地精 → 加 大野兔(B)（重擊主題）
  { itemId: "2fcf7576-4e74-4280-b1e6-0d7da7b58dda", itemName: "木製雙手槌", monsterKey: "大野兔B", chance: 3.5 },
  // 木製雙手斧 → 已有 青草地精 → 加 大史(B)（力量型怪）
  { itemId: "2271e23c-9648-430e-944b-cea2107ee8ec", itemName: "木製雙手斧", monsterKey: "大史B", chance: 3.5 },
  // 木製單手法杖 → 已有 蘑菇怪 → 加 小史(中)（學魔法的小史）
  { itemId: "e986b09f-aad4-4a1a-8db8-1219ad238fa3", itemName: "木製單手法杖", monsterKey: "小史中", chance: 4 },
  // 木製雙手法杖 → 已有 蘑菇怪 → 加 青草地精（地精巫師用長杖）
  { itemId: "e3794447-e19d-41a2-9b0a-c5050dcdd9ea", itemName: "木製雙手法杖", monsterKey: "青草地精", chance: 3.5 },

  // ── D 階特殊裝備 ─────────────────────────────────────────────────
  // 鬥紋銅戒指(左) → 已有 哥布 → 加 小史（同等級近戰型）
  { itemId: "871bc362-1ea4-40e1-8617-b5ff03dd7e9e", itemName: "鬥紋銅戒指(左)", monsterKey: "小史", chance: 4 },
  // 智紋銅戒指(左) → 已有 蘑菇怪 → 加 石頭（智力礦石主題）
  { itemId: "0e2ede69-4bd1-4ce1-9ec8-fe4df6463dfa", itemName: "智紋銅戒指(左)", monsterKey: "石頭", chance: 4 },
  // 鬥紋銅戒指(右) → 已有 蘑菇怪 → 加 哥布
  { itemId: "feee43ab-4b22-44d6-b86b-0655da4acf57", itemName: "鬥紋銅戒指(右)", monsterKey: "哥布", chance: 4 },

  // ── D 階速度/技能布裝 ────────────────────────────────────────────
  // 迅紋布帽 → 已有 小史 → 加 綠野狼（迅速主題）
  { itemId: "7a438607-fb9e-4f31-baf7-d3e0b0f2221c", itemName: "迅紋布帽", monsterKey: "綠野狼", chance: 4 },
  // 智紋布鏡片 → 已有 石頭 → 加 蘑菇怪（智力道具）
  { itemId: "cd5175ba-66bd-4719-a316-b1de5540a677", itemName: "智紋布鏡片", monsterKey: "蘑菇怪", chance: 4 },
  // 迅紋布面罩 → 已有 綠野狼 → 加 小狼（同狼族迅速主題）
  { itemId: "5608761a-e8cb-44bc-91d0-449efff03d1e", itemName: "迅紋布面罩", monsterKey: "小狼", chance: 4 },
  // 智紋布口飾 → 已有 小史(中) → 加 蘑菇怪
  { itemId: "ee223bf7-986d-44f3-be07-9cf7ea8b9cfa", itemName: "智紋布口飾", monsterKey: "蘑菇怪", chance: 4 },
  // 迅紋布甲 → 已有 小史 → 加 小狼（敏捷輕甲）
  { itemId: "48180673-7800-48c6-93df-a30fa03a957b", itemName: "迅紋布甲", monsterKey: "小狼", chance: 4 },
  // 智紋布披風 → 已有 小狼 → 加 石頭（魔法礦石主題）
  { itemId: "9fc5e65a-269b-429c-9cd9-5fd9a00f977a", itemName: "智紋布披風", monsterKey: "石頭", chance: 4 },

  // ── C 階防具 ──────────────────────────────────────────────────────
  // 鐵盾 → 已有 大史(B) → 加 甲蟹（甲殼防禦主題）
  { itemId: "dcb0ab95-aff6-4961-ae44-79bd49a2f0e8", itemName: "鐵盾", monsterKey: "甲蟹", chance: 4 },
  // 迅紋皮甲 → 已有 甲蟹 → 加 牙牙狼（輕盔甲+速度）
  { itemId: "770da6ff-a1d6-49a9-af30-3acbe3cd3cc3", itemName: "迅紋皮甲", monsterKey: "牙牙狼", chance: 4 },
  // 迅紋皮面罩 → 已有 小金(稀) → 加 暗夜獵豹（夜戰面罩）
  { itemId: "71f8cf22-9f9a-4f73-9eed-e4f23becd8a5", itemName: "迅紋皮面罩", monsterKey: "暗夜獵豹", chance: 3.5 },
  // 鬥紋皮甲 → 已有 大史(B) → 加 巨巨（力量型皮甲）
  { itemId: "4d72c88d-e632-492e-bb6c-7f7b6f93e624", itemName: "鬥紋皮甲", monsterKey: "巨巨", chance: 4 },
  // 鬥紋皮披肩 → 已有 甲蟹 → 加 森林之獸（野性主題）
  { itemId: "159e76d1-467a-4235-b364-5b7d85d9d79d", itemName: "鬥紋皮披肩", monsterKey: "森林之獸", chance: 3.5 },

  // ── C 階武器 ──────────────────────────────────────────────────────
  // 鐵製單手劍 → 已有 甲蟹 → 加 城牆衛兵（衛兵配劍）
  { itemId: "9c809436-d8d5-4b21-bf15-e26e881cac9b", itemName: "鐵製單手劍", monsterKey: "城牆衛兵", chance: 4 },
  // 鐵製雙手劍 → 已有 森林盜賊 → 加 古城狂戰士（狂戰士用大劍）
  { itemId: "24d71d06-5df8-446d-b2e5-f4cb49818e3f", itemName: "鐵製雙手劍", monsterKey: "古城狂戰士", chance: 3.5 },
  // 鐵製單手槌 → 已有 甲蟹 → 加 巨巨（重擊型怪物）
  { itemId: "fbf8fdec-72a4-4d76-bcb5-117952352dec", itemName: "鐵製單手槌", monsterKey: "巨巨", chance: 4 },
  // 鐵製雙手槌 → 已有 森林古樹 → 加 城堡魔像(B)（重型巨物）
  { itemId: "1f04c0db-e5cb-4b84-9a43-e7150799eecb", itemName: "鐵製雙手槌", monsterKey: "城堡魔像B", chance: 3 },
  // 鐵製單手斧 → 已有 森林盜賊 → 加 古城刺客（快速斬擊）
  { itemId: "fcdbb6c1-bb21-45e1-9637-3aa58a76c79e", itemName: "鐵製單手斧", monsterKey: "古城刺客", chance: 3.5 },
  // 鐵製雙手斧 → 已有 森林古樹 → 加 鐵甲衛將（重武器主題）
  { itemId: "ab533d4a-3d07-4d41-8a40-511a8e6a455d", itemName: "鐵製雙手斧", monsterKey: "鐵甲衛將", chance: 3.5 },
  // 立直棒 → 已有 黑暗弓手 → 加 森林盜賊（刺客/盜賊用棒）
  { itemId: "bb4a624b-c5df-4ace-ae50-d5ec16248e6d", itemName: "立直棒", monsterKey: "森林盜賊", chance: 4 },

  // ── C 階戒指 ─────────────────────────────────────────────────────
  // 鐵戒指(左) → 已有 林地妖靈 → 加 甲蟹
  { itemId: "e1ba9e0c-3e3a-4ebe-97a0-6fa166651463", itemName: "鐵戒指(左)", monsterKey: "甲蟹", chance: 4 },
  // 鐵戒指(右) → 已有 大史(B) → 加 甲蟹
  { itemId: "4a4e5575-c48c-4613-83df-7f0f30a906fe", itemName: "鐵戒指(右)", monsterKey: "甲蟹", chance: 4 },
  // 鬥紋鐵戒指(右) → 已有 林地妖靈 → 加 巨巨（力量型）
  { itemId: "baadc603-e28d-4721-9f4e-96a2a33c561c", itemName: "鬥紋鐵戒指(右)", monsterKey: "巨巨", chance: 4 },

  // ── B 階裝備 ──────────────────────────────────────────────────────
  // 鋼製單手槌 → 已有 鐵甲衛將 → 加 城堡魔像(B)（重甲重擊）
  { itemId: "dec0d571-15e7-405d-a2e6-03f06548f828", itemName: "鋼製單手槌", monsterKey: "城堡魔像B", chance: 3 },
  // 智紋鐵鏡片 → 已有 古城弓手 → 加 古城法師（法師鏡片）
  { itemId: "864131cc-f27a-454f-af5c-eb53ef2eb143", itemName: "智紋鐵鏡片", monsterKey: "古城法師", chance: 3 },
  // 智紋鐵口飾 → 已有 古城法師 → 加 黑焰巫師（施法口飾）
  { itemId: "6cff4f87-354c-4fd7-9b2c-146ba6407f19", itemName: "智紋鐵口飾", monsterKey: "黑焰巫師", chance: 3 },
];

async function main() {
  const client = new MongoClient("mongodb://localhost:27017");
  await client.connect();
  const db = client.db("equipment_game");
  const col = db.collection("monsters");

  let updated = 0;
  let skipped = 0;

  for (const entry of NEW_DROPS) {
    const monsterId = MONSTER_IDS[entry.monsterKey];
    if (!monsterId) {
      console.error(`Unknown monsterKey: ${entry.monsterKey}`);
      continue;
    }

    // Check if this item already has this drop (avoid duplicates)
    const existing = await col.findOne({
      _id: monsterId,
      "drops.itemId": entry.itemId,
    });

    if (existing) {
      console.log(`SKIP (already exists): ${entry.itemName} on ${entry.monsterKey}`);
      skipped++;
      continue;
    }

    const result = await col.updateOne(
      { _id: monsterId },
      {
        $push: {
          drops: {
            itemId: entry.itemId,
            itemName: entry.itemName,
            chance: entry.chance,
          },
        },
      }
    );

    if (result.modifiedCount === 1) {
      console.log(`OK: ${entry.itemName} → ${entry.monsterKey} (${entry.chance}%)`);
      updated++;
    } else {
      console.error(`FAIL: ${entry.itemName} → ${entry.monsterKey} (monster not found?)`);
    }
  }

  console.log(`\nDone: ${updated} drops added, ${skipped} skipped.`);
  await client.close();
}

main().catch(console.error);
