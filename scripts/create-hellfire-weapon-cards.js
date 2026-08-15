"use strict";
/**
 * 地獄火焰 10 基礎怪 + 1 菁英 的「武器流派複合卡」（A 階，特殊槽）。
 * 每張＝基礎常駐(全職通用) + 裝對武器時追加(condition.weaponType 閘門)。
 * 卡圖用各怪立繪；掛進該怪 drops @1%。可重複執行（依卡名 upsert）。
 *
 *   node scripts/create-hellfire-weapon-cards.js --dry-run
 *   node scripts/create-hellfire-weapon-cards.js
 */
require("dotenv").config();
const crypto = require("crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

// 基礎常駐（無條件）
function base(key, value, extra = {}) {
  return { key, target: "self", trigger: "passive", chance: 100, stacks: 1, stackMode: "replace",
    duration: { mode: "battle", value: 1 }, params: { value, ...(extra.params || {}) } };
}
// 裝對武器才生效（wt 可為字串或字串陣列＝任一）
function wpn(key, value, wt, extra = {}) {
  const condition = Array.isArray(wt) ? { any: wt.map((w) => ({ weaponType: w })) } : { weaponType: wt };
  return { ...base(key, value, extra), condition };
}

const CARDS = [
  { monster: "焰爪幼狼", card: "焰爪幼狼卡", skill: "幼焰連咬", wtLabel: "匕首（盜賊）",
    desc: "[A階 / 匕首流] 常駐：連擊率+6；持匕首時額外 連擊傷害+18%、爆擊率+8。",
    effects: [ base("combo_up", 6), wpn("combo_damage_up", 18, "dagger"), wpn("crit_rate_up", 8, "dagger") ] },

  { monster: "灰燼豺", card: "灰燼豺卡", skill: "灰燼破甲", wtLabel: "單手斧（戰士）",
    desc: "[A階 / 單手斧流] 常駐：爆擊率+5；持單手斧時額外 無視目標12%防、對破防目標傷害+15%。",
    effects: [ base("crit_rate_up", 5), wpn("def_ignore", 12, "axe_1h"), wpn("bonus_vs_def_broken", 15, "axe_1h") ] },

  { monster: "熔岩犬", card: "熔岩犬卡", skill: "熔岩護壁", wtLabel: "單手劍（劍士/軍師）",
    desc: "[A階 / 單手劍流] 常駐：物理受傷-6%；持單手劍時額外 反彈25%受到傷害、DEF+12。",
    effects: [ base("physical_damage_reduction", 6), wpn("reflect_damage", 25, "sword_1h"), wpn("def_up", 12, "sword_1h") ] },

  { monster: "硫火蝙蝠", card: "硫火蝙蝠卡", skill: "硫煙疾影", wtLabel: "弓（弓箭手/詩人）",
    desc: "[A階 / 弓流·迴避] 常駐：命中+8；持弓時額外 迴避+15、戰鬥首擊傷害+15%。",
    effects: [ base("hit_up", 8), wpn("dodge_up", 15, "bow"), wpn("bonus_first_hit", 15, "bow") ] },

  { monster: "焦炎蜥", card: "焦炎蜥卡", skill: "焦炎貫穿", wtLabel: "雙手法杖（法師/結界師）",
    desc: "[A階 / 雙手法杖流] 常駐：最終傷害+8%；持雙手法杖時額外 無視目標22%防、最終傷害再+12%。",
    effects: [ base("final_damage_up", 8), wpn("def_ignore", 22, "staff_2h"), wpn("final_damage_up", 12, "staff_2h") ] },

  { monster: "火髓魔蟲", card: "火髓魔蟲卡", skill: "火髓回魂", wtLabel: "單手法杖（治療師）",
    desc: "[A階 / 單手法杖流·續戰] 常駐：每回合回復3%MaxHP；持單手法杖時額外 命中回復造成傷害10%、擊殺回復15%MaxHP。",
    effects: [ base("life_regen", 3), wpn("on_hit_heal", 10, "staff_1h"), wpn("on_kill_heal", 15, "staff_1h") ] },

  { monster: "餘燼骷髏", card: "餘燼骷髏卡", skill: "餘燼重斬", wtLabel: "雙手劍（劍士）",
    desc: "[A階 / 雙手劍流] 常駐：攻擊+6%；持雙手劍時額外 攻擊+12%、戰鬥首擊傷害+18%。",
    effects: [ base("atk_multiplier_up", 6), wpn("atk_multiplier_up", 12, "sword_2h"), wpn("bonus_first_hit", 18, "sword_2h") ] },

  { monster: "炙炎鴉", card: "炙炎鴉卡", skill: "炙羽爆襲", wtLabel: "弓（弓箭手/詩人）",
    desc: "[A階 / 弓流·爆擊] 常駐：爆擊率+6；持弓時額外 爆擊傷害+20%、迴避+10。",
    effects: [ base("crit_rate_up", 6), wpn("crit_damage_up", 20, "bow"), wpn("dodge_up", 10, "bow") ] },

  { monster: "岩漿巨蟲", card: "岩漿巨蟲卡", skill: "岩漿碎鎧", wtLabel: "雙手斧（戰士）",
    desc: "[A階 / 雙手斧流] 常駐：對BOSS傷害+10%；持雙手斧時額外 對破防目標傷害+22%、爆擊傷害+15%。",
    effects: [ base("bonus_vs_boss", 10), wpn("bonus_vs_def_broken", 22, "axe_2h"), wpn("crit_damage_up", 15, "axe_2h") ] },

  { monster: "烈焰狼", card: "烈焰狼卡", skill: "烈焰狂擊", wtLabel: "任一雙手武器（重武器）",
    desc: "[A階 / 重武器流] 常駐：攻擊+6%；持任一雙手武器時額外 攻擊+12%、爆擊傷害+18%。",
    effects: [ base("atk_multiplier_up", 6),
      wpn("atk_multiplier_up", 12, ["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow", "dice"]),
      wpn("crit_damage_up", 18, ["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow", "dice"]) ] },

  { monster: "煉獄烈焰狼王", card: "煉獄烈焰狼王卡", skill: "煉獄君臨", wtLabel: "雙手槌（矮人戰士）· 菁英",
    desc: "[A階 / 雙手槌流·菁英] 常駐：每次出手 STR/DEX+3(最高+15)；持雙手槌時額外 暈眩率+10、對暈眩中目標傷害+25%。",
    effects: [ base("stack_on_hit_offense", 3, { params: { cap: 15 } }),
      wpn("stun_chance_up", 10, "mace_2h"), wpn("bonus_vs_stunned", 25, "mace_2h") ] },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  console.log(`建立地獄火焰武器流派卡 ${CARDS.length} 張（dryRun=${dryRun}）\n` + "-".repeat(90));

  let cardsUpserted = 0, dropsAdded = 0;
  for (const c of CARDS) {
    const monster = await db.collection("monsters").findOne({ zone: "hellfire", name: c.monster });
    if (!monster) { console.warn(`SKIP 找不到怪：${c.monster}`); continue; }

    const skill = {
      key: `hellfire_wpn_${c.card.replace(/[^a-zA-Z0-9一-龥]/g, "_")}`,
      name: c.skill, description: c.desc, chance: 100, cooldownTurns: 0, trigger: "passive", procEffects: [],
    };
    const existing = await db.collection("items").findOne({ name: c.card, equipSlot: "special" });
    const id = existing?.id || `monster-card-${crypto.randomUUID()}`;
    const doc = {
      id, seq: 0, name: c.card,
      imageUrl: monster.imageUrl || null, imageThumbnailUrl: monster.imageThumbnailUrl || null,
      itemType: "equipment", equipSlot: "special", tier: "A",
      equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
      monsterCardSkill: skill,
      passiveEffects: c.effects, procEffects: [], combatEffects: [], useEffects: [],
      weaponType: null, isTwoHanded: false, atkStat: null, effect: { type: "none", value: 0 },
      monsterCardOf: monster.id, monsterName: c.monster,
      description: c.desc,
      createdAt: existing?.createdAt || NOW, updatedAt: NOW,
    };
    console.log(`${existing ? "UPDATE" : "CREATE"} ${c.card.padEnd(16)} [${c.wtLabel}]`);
    console.log(`       ${c.desc}`);
    if (!dryRun) await db.collection("items").updateOne({ id }, { $set: doc }, { upsert: true });
    cardsUpserted++;

    // 掛進該怪 drops @1%
    const drops = Array.isArray(monster.drops) ? [...monster.drops] : [];
    if (!drops.find((d) => d.itemId === id)) {
      drops.push({ itemId: id, itemName: c.card, chance: 1 });
      if (!dryRun) await db.collection("monsters").updateOne({ _id: monster._id }, { $set: { drops } });
      dropsAdded++;
      console.log(`       + drops on ${c.monster} @1%`);
    }
  }
  console.log("-".repeat(90));
  console.log(`完成：${dryRun ? "預覽" : "寫入"} 卡 ${cardsUpserted} 張、新 drops ${dropsAdded}`);
  process.exit(0);
}
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { CARDS, base, wpn };
