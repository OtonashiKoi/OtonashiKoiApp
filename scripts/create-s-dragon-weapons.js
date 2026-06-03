"use strict";
/**
 * 建立 S 階龍系武器：每種武器一把。
 * - 數值對齊對應 A 階（秘銀系列），不超過 A。
 * - 特效：在「龍族之領 / 龍王巢穴」造成的傷害 +20%（final_damage_up + condition.zone），只在該區生效。
 * - 名稱皆與龍相關。
 * 以 id 冪等 upsert，可重複執行。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const DRAGON_ZONES = ["dragon_realm", "dragon_king_lair"];
const dragonAffinity = () => ({
  key: "final_damage_up",
  target: "self",
  trigger: "passive",
  chance: 100,
  sourcePhase: "passive",
  params: { value: 20 },
  condition: { zone: [...DRAGON_ZONES] },
  notes: "龍族之領／龍王巢穴：造成的傷害 +20%",
});

const zeroStats = () => ({ str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 });

// 每把：[id後綴, 名稱, weaponType, isTwoHanded, atkStat, 對齊A的 equipStats 覆寫]
const DEFS = [
  ["sword_1h", "幼龍牙劍",   "sword_1h", false, "str", { str: 19 }],
  ["sword_2h", "龍脊巨劍",   "sword_2h", true,  "str", { str: 25 }],
  ["mace_1h",  "龍顎戰錘",   "mace_1h",  false, "str", { str: 14, vit: 5 }],
  ["mace_2h",  "龍骨碎天槌", "mace_2h",  true,  "str", { str: 20, vit: 5 }],
  ["axe_1h",   "裂龍手斧",   "axe_1h",   false, "str", { str: 14, luk: 5 }],
  ["axe_2h",   "屠龍巨斧",   "axe_2h",   true,  "str", { str: 20, luk: 5 }],
  ["dagger",   "龍鱗短刃",   "dagger",   false, "str", { str: 4, agi: 15 }],
  ["staff_1h", "龍語法杖",   "staff_1h", false, "int", { int: 14, dex: 5 }],
  ["staff_2h", "龍脈長杖",   "staff_2h", true,  "int", { int: 19, dex: 4 }],
  ["bow",      "龍筋獵弓",   "bow",      true,  "dex", { agi: 4, dex: 19 }],
];

(async () => {
  const db = await getMongoDb();
  const now = new Date().toISOString();
  let upserted = 0;
  for (const [suffix, name, weaponType, isTwoHanded, atkStat, statOverride] of DEFS) {
    const id = `s-dragon-${suffix}`;
    const equipStats = { ...zeroStats(), ...statOverride };
    const doc = {
      id,
      name,
      description: `S 階龍系武器。平時與 A 階同級；於【龍族之領／龍王巢穴】造成的傷害 +20%（屠龍特攻）。`,
      itemType: "equipment",
      equipSlot: "weapon",
      weaponType,
      isTwoHanded,
      atkStat,
      tier: "S",
      equipStats,
      effect: { type: "none", value: 0 },
      passiveEffects: [dragonAffinity()],
      procEffects: [],
      combatEffects: [],
      useEffects: [],
      imageUrl: null,
      imageThumbnailUrl: null,
      updatedAt: now,
    };
    const res = await db.collection("items").updateOne(
      { id },
      { $set: doc, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
    if (res.upsertedCount || res.modifiedCount) upserted++;
    console.log(`  ${name.padEnd(6)} (${weaponType}) -> ${id}  ${Object.entries(equipStats).filter(([, v]) => v).map(([k, v]) => k + "+" + v).join(" ")}`);
  }
  console.log(`\n完成。寫入/更新 ${upserted} 把 S 龍系武器。`);
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
