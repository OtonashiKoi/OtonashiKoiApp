"use strict";
/**
 * 夏日活動限定裝備「海灘系列」（dropTheme: event_beach）。
 *
 * 設計（2026-08-03 定案）：
 *   ‧ **賣點＝自帶屬性洞**：限定裝掉落時 100% 帶水屬性（通用裝只有 30%），
 *     而裝備上的 element/elementLevel 就是「已鑲好的洞」（見 elementSystem.resolveElementsMap），
 *     等於直接送玩家 1~3 顆已鑲嵌的屬性石 → 省下 2.9~39.5 顆的期望鑲嵌成本。
 *     機制靠道具上的 elementDrop 欄位驅動（見 shared/elementDropRoll.js 的 override）。
 *   ‧ **數值對標同階**：每件的屬性總和與同類型秘銀/鋼鐵系完全相同（A 階武器 19/23/25、
 *     副手 12、盾 14、鎧 15、披風 12、鞋 13），但**不再單押一項**，改分散到 2~3 個屬性。
 *     → 不動戰鬥數值平衡，只換配點風格。
 *   ‧ S 階（龜王）在本遊戲的屬性總和與 A 階相同，差別是屬性洞 5 vs 4＋自帶濃度更高。
 *     龜王 S 階覆蓋 11 種主要武器，不開 S 階防具先例。
 *   ‧ 島島寶箱：龜王卡 1%，其餘 99% 由 11 把 S 武器等機率分配（每把 9%）。
 *
 * 用法：
 *   node scripts/upsert-event-beach-gear.js              # 試跑，只印不寫
 *   node scripts/upsert-event-beach-gear.js --apply      # 寫入道具，並自動同步龜王寶箱獎池
 *   node scripts/upsert-event-beach-gear.js --apply --wire-drops   # 另同步活動小怪掉落表
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const WIRE_DROPS = process.argv.includes("--wire-drops");
// 專案內的可部署備援圖；已上傳到 Cloudinary 的既有圖片會在更新時保留。
const IMAGE_BASE = "https://otonashikoi.org/item-art/generated/2026-08-05";
const TURTLE_MONSTER_ID = "event-island-turtle";
const TURTLE_CARD_ID = "monster-card-island-turtle";
const TURTLE_CARD_DROP_RATE = 1;
const TURTLE_SET_KEY = "island_turtle";
const TURTLE_SET_NAME = "島島龜王套裝・潮生";

// 限定裝掉落時必定帶水屬性（濃度區間依階級）
const EL_A = { element: "water", chancePct: 100, minLevel: 1, maxLevel: 2 };
const EL_S = { element: "water", chancePct: 100, minLevel: 2, maxLevel: 3 };

const S = (str = 0, agi = 0, vit = 0, int = 0, dex = 0, luk = 0) => ({ str, agi, vit, int, dex, luk });

// ── A 階小怪限定（13 武器＋4 防具）──────────────────────────────
// baseline＝同類型秘銀/鋼鐵系的屬性總和，redistributed 後總和不變
const GEAR = [
  // 武器
  { id: "beach-sword-1h", name: "斬浪貝刃劍", slot: "weapon", wType: "sword_1h", atk: "str", twoH: false, base: 19, stats: S(14, 3, 0, 0, 0, 2), desc: "貝殼磨成的劍身，斬下去有海浪的聲音。" },
  { id: "beach-sword-2h", name: "碎浪巨劍", slot: "weapon", wType: "sword_2h", atk: "str", twoH: true, base: 25, stats: S(18, 3, 4, 0, 0, 0), desc: "整片礁岩削出來的巨劍，揮動時像在推開一道浪。" },
  { id: "beach-axe-1h", name: "蟹螯手斧", slot: "weapon", wType: "axe_1h", atk: "str", twoH: false, base: 19, stats: S(13, 0, 2, 0, 0, 4), desc: "從某隻不肯放手的螃蟹身上請來的。" },
  { id: "beach-axe-2h", name: "裂殼巨斧", slot: "weapon", wType: "axe_2h", atk: "str", twoH: true, base: 25, stats: S(18, 0, 3, 0, 0, 4), desc: "專門對付硬殼類的斧頭。對椰子也很有效。" },
  { id: "beach-dagger", name: "魚骨匕首", slot: "weapon", wType: "dagger", atk: "str", twoH: false, base: 19, stats: S(4, 11, 0, 0, 0, 4), desc: "某條大魚的肋骨，磨得比鐵還利。" },
  { id: "beach-dice", name: "珊瑚骰", slot: "weapon", wType: "dice", atk: "luk", twoH: true, base: 23, stats: S(0, 4, 0, 0, 4, 15), desc: "浪打了三十年才磨成六面。點數據說偏大。" },
  { id: "beach-mace-1h", name: "蟹螯鉗錘", slot: "weapon", wType: "mace_1h", atk: "str", twoH: false, base: 19, stats: S(12, 0, 5, 0, 2, 0), desc: "鉗子還會反射性地夾緊，握把處請小心。" },
  { id: "beach-mace-2h", name: "碎島貝槌", slot: "weapon", wType: "mace_2h", atk: "str", twoH: true, base: 25, stats: S(17, 3, 5, 0, 0, 0), desc: "巨貝配上漂流木柄。砸下去會濺起水花。" },
  { id: "beach-staff-1h", name: "潮鳴單手杖", slot: "weapon", wType: "staff_1h", atk: null, twoH: false, base: 19, stats: S(0, 0, 4, 11, 4, 0), desc: "貼耳可聽見退潮的聲音。" },
  { id: "beach-staff-2h", name: "深海燈籠杖", slot: "weapon", wType: "staff_2h", atk: null, twoH: true, base: 23, stats: S(0, 0, 4, 15, 4, 0), desc: "杖頭那顆會發光的東西，最好不要問它是什麼。" },
  { id: "beach-bow", name: "浪紋長弓", slot: "weapon", wType: "bow", atk: "dex", twoH: true, base: 23, stats: S(0, 5, 0, 0, 15, 3), desc: "弓身的紋路和沙灘上的浪痕一模一樣。" },
  { id: "beach-offhand-sword", name: "貝刃・副手劍", slot: "shield", wType: "offhand_sword", atk: "str", twoH: false, base: 12, stats: S(6, 3, 3, 0, 0, 0), desc: "比主手短一截，拿來擋比拿來砍順手。" },
  { id: "beach-offhand-dagger", name: "蝦劍・貝刃", slot: "shield", wType: "offhand_dagger", atk: "str", twoH: false, base: 12, stats: S(0, 7, 0, 0, 2, 3), desc: "在下是蝦。" },
  // 防具
  { id: "beach-shield", name: "潮鳴貝殼盾", slot: "shield", wType: null, atk: null, twoH: false, base: 14, stats: S(0, 2, 10, 0, 0, 2), desc: "闔起來時聽得見海。擋箭也很稱職。" },
  { id: "beach-armor", name: "龜甲重鎧", slot: "armor", wType: null, atk: null, twoH: false, base: 15, stats: S(3, 2, 10, 0, 0, 0), desc: "背了三十年的那種厚度。" },
  { id: "beach-garment", name: "海藻披風", slot: "garment", wType: null, atk: null, twoH: false, base: 12, stats: S(0, 2, 8, 0, 2, 0), desc: "曬乾後意外地韌。有點鹹。" },
  { id: "beach-shoes", name: "踏浪涼鞋", slot: "shoes", wType: null, atk: null, twoH: false, base: 13, stats: S(0, 6, 5, 0, 0, 2), desc: "在濕沙上跑不會陷下去。" },
];

// ── S 階龜王限定（只做武器）─────────────────────────────────────
const BOSS_GEAR = [
  { id: "beach-s-sword", name: "怒濤斬浪劍", slot: "weapon", wType: "sword_1h", atk: "str", twoH: false, base: 19, stats: S(14, 3, 0, 0, 0, 2), desc: "龜王背了三十年的浪，全在這把劍裡。" },
  { id: "beach-s-sword-2h", artId: "beach-sword-2h", name: "鎮潮斷海巨劍", slot: "weapon", wType: "sword_2h", atk: "str", twoH: true, base: 25, stats: S(18, 3, 4, 0, 0, 0), desc: "劍脊像龜王背上的山稜，一斬足以分開潮頭。" },
  { id: "beach-s-axe-1h", artId: "beach-axe-1h", name: "礁甲破浪斧", slot: "weapon", wType: "axe_1h", atk: "str", twoH: false, base: 19, stats: S(13, 0, 2, 0, 0, 4), desc: "斧刃嵌著千年礁甲，浪花一觸即碎。" },
  { id: "beach-s-axe-2h", artId: "beach-axe-2h", name: "開島裂海巨斧", slot: "weapon", wType: "axe_2h", atk: "str", twoH: true, base: 25, stats: S(18, 0, 3, 0, 0, 4), desc: "傳說龜王每次轉身，這把斧就會在海面留下裂谷。" },
  { id: "beach-s-dagger", artId: "beach-dagger", name: "深潮魚骨匕首", slot: "weapon", wType: "dagger", atk: "str", twoH: false, base: 19, stats: S(4, 11, 0, 0, 0, 4), desc: "深海巨魚的骨刺，連潮水也追不上它的鋒芒。" },
  { id: "beach-s-dice", artId: "beach-dice", name: "龜島命運骰", slot: "weapon", wType: "dice", atk: "luk", twoH: true, base: 23, stats: S(0, 4, 0, 0, 4, 15), desc: "由龜甲與珊瑚磨成，擲出的不是點數，而是海的心情。" },
  { id: "beach-s-mace-1h", artId: "beach-mace-1h", name: "潮核碎甲錘", slot: "weapon", wType: "mace_1h", atk: "str", twoH: false, base: 19, stats: S(12, 0, 5, 0, 2, 0), desc: "錘心封著一枚潮汐核，每次命中都像海浪拍岸。" },
  { id: "beach-s-mace", name: "碎島巨槌", slot: "weapon", wType: "mace_2h", atk: "str", twoH: true, base: 25, stats: S(17, 3, 5, 0, 0, 0), desc: "據說龜王的甲殼就是被這種東西敲出裂痕的。" },
  { id: "beach-s-staff-1h", artId: "beach-staff-1h", name: "潮心珊瑚杖", slot: "weapon", wType: "staff_1h", atk: null, twoH: false, base: 19, stats: S(0, 0, 4, 11, 4, 0), desc: "珊瑚杖心與龜王的呼吸同步，潮起潮落都在掌中。" },
  { id: "beach-s-staff", name: "龜王燈籠杖", slot: "weapon", wType: "staff_2h", atk: null, twoH: true, base: 23, stats: S(0, 0, 4, 15, 4, 0), desc: "杖頭是龜王甲上那盞從沒熄過的燈。" },
  { id: "beach-s-bow", artId: "beach-bow", name: "穿潮海天弓", slot: "weapon", wType: "bow", atk: "dex", twoH: true, base: 23, stats: S(0, 5, 0, 0, 15, 3), desc: "弓弦拉滿時會傳來海鳴，箭矢隨後穿過浪與雲。" },
];

const BOSS_WEAPON_DROP_RATE = (100 - TURTLE_CARD_DROP_RATE) / BOSS_GEAR.length;

function buildBossDrops(existingDrops = []) {
  // 只接管龜王海灘 S 武器與龜王卡；其他實戰掉落（例如寶石）保留。
  const kept = existingDrops.filter((drop) => {
    const itemId = String(drop?.itemId || "");
    return itemId !== TURTLE_CARD_ID && !itemId.startsWith("beach-s-");
  });
  return [
    ...kept,
    { itemId: TURTLE_CARD_ID, itemName: "島島龜王卡", chance: TURTLE_CARD_DROP_RATE },
    ...BOSS_GEAR.map((g) => ({ itemId: g.id, itemName: g.name, chance: BOSS_WEAPON_DROP_RATE })),
  ];
}

function buildItem(g, tier, elementDrop) {
  const sum = Object.values(g.stats).reduce((a, b) => a + b, 0);
  if (sum !== g.base) throw new Error(`${g.name} 屬性總和 ${sum} ≠ 基準 ${g.base}`);
  const imageUrl = `${IMAGE_BASE}/${g.artId || g.id}.png`;
  return {
    id: g.id,
    name: g.name,
    description: g.desc,
    itemType: "equipment",
    tier,
    equipSlot: g.slot,
    equipStats: g.stats,
    weaponType: g.wType,
    isTwoHanded: g.twoH,
    atkStat: g.atk,
    effect: { type: "none", value: 0 },
    imageUrl,
    imageThumbnailUrl: imageUrl,
    enhanceLevel: 0,
    useEffects: [],
    passiveEffects: [],
    procEffects: [],
    combatEffects: [],
    setKey: TURTLE_SET_KEY,
    setKeys: [TURTLE_SET_KEY],
    setName: TURTLE_SET_NAME,
    dropTheme: "event_beach",
    elementDrop,                       // ★ 掉落時必定帶水屬性（見 elementDropRoll）
    _eventBeach: true,                 // 活動結束要批次回收找得到
    createdAt: new Date().toISOString(),
  };
}

// 小怪 → 掛哪幾件（照主題分配，每隻 2~3 件）
const DROP_MAP = {
  "貝貝寄居蟹": ["beach-shield", "beach-offhand-dagger", "beach-mace-1h"],
  "溜溜沙蟹": ["beach-shoes", "beach-garment", "beach-dagger"],
  "蝦蝦劍士": ["beach-sword-1h", "beach-offhand-sword", "beach-sword-2h"],
  "墨墨章魚": ["beach-staff-2h", "beach-staff-1h", "beach-dice"],
  "椰椰大蟹": ["beach-axe-1h", "beach-axe-2h", "beach-mace-2h"],
  "鼓鼓河豚": ["beach-bow", "beach-dagger"],
  "龜龜大將": ["beach-armor", "beach-mace-2h", "beach-shield"],
};
const LIMITED_DROP_RATE = 1;   // 1%（通用裝維持 2% 不動 → 限定裝是稀有加碼，不是主力）
async function main() {
  const db = await getMongoDb();
  const items = db.collection("items");

  const all = [
    ...GEAR.map((g) => buildItem(g, "A", EL_A)),
    ...BOSS_GEAR.map((g) => buildItem(g, "S", EL_S)),
  ];

  console.log("═══ 海灘系列 " + all.length + " 件 ═══");
  let created = 0, updated = 0;
  for (const doc of all) {
    const existing = await items.findOne({ id: doc.id });
    const st = Object.entries(doc.equipStats).filter(([, v]) => v > 0).map(([k, v]) => `${k.toUpperCase()}${v}`).join(" ");
    const sum = Object.values(doc.equipStats).reduce((a, b) => a + b, 0);
    console.log(`  ${existing ? "~" : "+"} [${doc.tier}] ${doc.name.padEnd(8)} ${String(doc.weaponType || doc.equipSlot).padEnd(16)} ${st.padEnd(24)} (總和 ${sum})  水${doc.elementDrop.minLevel}~${doc.elementDrop.maxLevel}`);
    if (existing) updated++; else created++;
    if (APPLY) {
      const { createdAt, ...rest } = doc;
      if (existing) {
        // 已經上傳或落地的圖片永遠優先；重跑腳本不會清空玩家已看得到的圖。
        const hasExistingImage = typeof existing.imageUrl === "string" && existing.imageUrl.length > 0;
        const next = hasExistingImage
          ? {
              ...rest,
              imageUrl: existing.imageUrl,
              imageThumbnailUrl: existing.imageThumbnailUrl || existing.imageUrl,
            }
          : rest;
        await items.updateOne({ id: doc.id }, { $set: next });
      }
      else await items.insertOne(doc);
    }
  }
  console.log(`\n新增 ${created} 件、更新 ${updated} 件。`);

  if (WIRE_DROPS) {
    console.log("\n═══ 掛進掉落表 ═══");
    const monsters = db.collection("monsters");
    for (const [name, ids] of Object.entries(DROP_MAP)) {
      const m = await monsters.findOne({ name, zone: "event_1" });
      if (!m) { console.log(`  ⚠️ 找不到 ${name}`); continue; }
      const existingDrops = Array.isArray(m.drops) ? m.drops : [];
      const kept = existingDrops.filter((d) => !ids.includes(d.itemId));
      const added = ids.map((itemId) => ({ itemId, chance: LIMITED_DROP_RATE }));
      const next = [...kept, ...added];
      console.log(`  ${name}: 原 ${existingDrops.length} 項 → ${next.length} 項（加 ${added.length} 件限定 @${LIMITED_DROP_RATE}%）`);
      if (APPLY) await monsters.updateOne({ _id: m._id }, { $set: { drops: next, updatedAt: new Date().toISOString() } });
    }
  }

  // 龜王獎池與 S 武器清單同源：只要 --apply，不需要另加 --wire-drops。
  const monsters = db.collection("monsters");
  const boss = await monsters.findOne({ id: TURTLE_MONSTER_ID });
  if (boss) {
    const bossDrops = buildBossDrops(Array.isArray(boss.drops) ? boss.drops : []);
    console.log(`\n  島島龜王（寶箱獎池）: ${(boss.drops || []).length} 項 → ${bossDrops.length} 項（龜王卡 ${TURTLE_CARD_DROP_RATE}%＋11 把武器各 ${BOSS_WEAPON_DROP_RATE.toFixed(1)}%）`);
    if (APPLY) {
      const now = new Date().toISOString();
      await monsters.updateOne({ _id: boss._id }, { $set: { drops: bossDrops, updatedAt: now } });
      await items.updateOne(
        { id: "chest-island-turtle" },
        { $set: {
          description: "從龜王背上的沙灘裡挖出來的藏寶箱，還帶著椰子的香氣。\n【隨機內容・機率公開】開啟後獲得 1 項：島島龜王卡 1%｜S 階龜王武器 99%（11 種等機率，各 9%）。\n※本寶箱無保底機制。",
          updatedAt: now,
        } },
      );
    }
  } else {
    console.warn(`\n  ⚠️ 找不到島島龜王 ${TURTLE_MONSTER_ID}，寶箱獎池未同步`);
  }

  console.log(APPLY ? "\n✅ 已寫入" : "\n（試跑，未寫入；加 --apply 才會生效）");
  process.exit(0);
}

module.exports = {
  GEAR,
  BOSS_GEAR,
  BOSS_WEAPON_DROP_RATE,
  TURTLE_CARD_DROP_RATE,
  TURTLE_CARD_ID,
  buildBossDrops,
  buildItem,
};

if (require.main === module) main().catch((err) => {
  console.error("失敗：", err);
  process.exit(1);
});
