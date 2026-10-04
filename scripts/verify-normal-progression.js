"use strict";

// Read-only combat benchmark. Uses current items/monsters, production stat and
// combat services, current pacing, and persistent monster HP across 15-round bouts.
require("dotenv").config();
const fs = require("node:fs");
const { MongoClient, BSON } = require("mongodb");
const { MonsterService } = require("../src/services/monster/monsterService");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calculateBattleTickMs, calculateWebBattleCooldownMs } = require("../src/shared/battleTiming");
const { BASE_JOBS } = require("../src/shared/jobAdvancement");
const { buildBattleOptions } = require("./lib/jobBattleOptions");
const { buildPlan } = require("./lib/normal-progression-balance");

function loadBson(file) {
  const bytes = fs.readFileSync(file), rows = [];
  for (let offset = 0; offset < bytes.length;) {
    const len = bytes.readInt32LE(offset);
    rows.push(BSON.deserialize(bytes.subarray(offset, offset + len)));
    offset += len;
  }
  return rows;
}

function buildPlayer(items, level, tier, job) {
  const types = { swordsman: "sword_1h", mage: "staff_2h", archer: "bow" };
  const flavor = { swordsman: "鬥紋", mage: "智紋", archer: "迅紋" }[job];
  const sorted = [...items].sort((a, b) => Number(String(b.name).startsWith(flavor)) - Number(String(a.name).startsWith(flavor)));
  const equipped = {};
  for (const slot of ["weapon", "shield", "armor", "garment", "shoes", "head_top", "head_mid", "head_low", "accessory_l", "accessory_r"]) {
    if (tier === "none") continue;
    if (slot === "shield" && job !== "swordsman") continue;
    const item = sorted.find(x => x.tier === tier && x.itemType === "equipment" && x.equipSlot === slot
      && (slot !== "weapon" || x.weaponType === types[job]) && (!x.setKey || !["dragon", "hellfire"].includes(x.setKey)));
    if (!item) throw new Error(`Missing ${tier} ${job} ${slot}`);
    equipped[slot] = { ...structuredClone(item), itemId: item.id, itemName: item.name, enhanceLevel: 0 };
  }
  if (level >= 10) {
    const item = items.find(x => x.id === BASE_JOBS[job].badgeId);
    if (!item) throw new Error(`Missing badge: ${job}`);
    equipped.job_eq = { ...structuredClone(item), itemId: item.id, itemName: item.name, jobExp: 0 };
  }
  const points = level - 1;
  const attrs = Object.fromEntries(["str", "agi", "vit", "int", "dex", "luk"].map(k => [k, 1 + points / 6]));
  attrs[{ swordsman: "str", mage: "int", archer: "dex" }[job]] += points * 0.55;
  attrs.vit += points * 0.3;
  attrs.agi += points * 0.15;
  return { equipped, attrs };
}

async function benchmark(monsters, items, runs = 40) {
  const service = new MonsterService({ findAll: async () => monsters }, null);
  const zones = {};
  for (const z of ["beginner", "normal", "mid", "ancient_city", "mistwood", "ancient_city_deep", "dragon_realm", "hellfire"]) {
    zones[z] = (await service.listMonsters({ zone: z })).filter(m => m.zone === z && !m.isBoss && !m.allZones);
  }
  const rows = [];
  const cases = [
    [5, "D", ["beginner", "normal"]], [10, "D", ["normal", "mid"]], [15, "C", ["normal", "mid"]],
    [20, "C", ["mid", "ancient_city"]], [25, "B", ["mid", "ancient_city"]],
    [30, "B", ["ancient_city", "mistwood"]], [35, "B", ["ancient_city", "mistwood"]],
    [40, "B", ["mistwood", "ancient_city_deep", "dragon_realm", "hellfire"]], [45, "A", ["mistwood", "ancient_city_deep", "dragon_realm", "hellfire"]],
  ];
  for (const [level, tier, routes] of cases) for (const job of ["swordsman", "mage", "archer"]) for (const zone of routes) {
    const { equipped, attrs } = buildPlayer(items, level, tier, job);
    const stats = calcPlayerStats(attrs, equipped, [], [], { zone });
    let seconds = 0, deaths = 0, bouts = 0, weight = 0, exp = 0;
    for (const monster of zones[zone]) {
      const w = monster.spawnRate || 0;
      for (let n = 0; n < runs; n++) {
        let hp = monster.calc.maxHp, attempts = 0;
        while (hp > 0 && attempts++ < 100) {
          const result = runCombatLoop(structuredClone(stats), { ...monster.calc }, monster.name, hp, 15, {
            ...buildBattleOptions({ equipped, pStats: stats }),
            playerLevel: level, equipped, inventory: [], monsterEquipped: monster.equipment || {},
            monsterElement: monster.element, monsterElementLevel: monster.elementLevel,
          });
          hp = result.finalMonsterHp;
          const lost = result.outcome === "lose";
          seconds += w * calculateWebBattleCooldownMs({ roundCount: Math.min(15, result.nextRound - 1), perRoundMs: calculateBattleTickMs(stats.agi), lost }) / 1000;
          deaths += w * Number(lost);
          bouts += w;
        }
        if (hp > 0) throw new Error(`Unkillable: ${job} ${level} ${monster.name}`);
        weight += w;
        exp += w * monster.expReward;
      }
    }
    rows.push({ level, tier, job, zone, secondsPerKill: +(seconds / weight).toFixed(1), deathPct: +(100 * deaths / bouts).toFixed(1), expPerMinute: Math.round(exp / seconds * 60) });
  }
  return rows;
}

async function main() {
  const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11);
  let monsters, items;
  if (snapshot) {
    monsters = loadBson(`${snapshot}/monsters.bson`);
    items = loadBson(`${snapshot}/items.bson`);
  } else {
    if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) throw new Error("Explicit MongoDB config required");
    const c = new MongoClient(process.env.MONGODB_URI);
    await c.connect();
    try {
      const db = c.db(process.env.MONGODB_DB_NAME);
      [monsters, items] = await Promise.all([db.collection("monsters").find({}).toArray(), db.collection("items").find({}).toArray()]);
    } finally { await c.close(); }
  }
  if (process.argv.includes("--planned")) {
    const changes = new Map(buildPlan(monsters).map(x => [x.id, x.values]));
    monsters = monsters.map(m => ({ ...m, ...changes.get(m.id) }));
  }
  // Repeatable stochastic sample; never change random behavior in the live server.
  let seed = 20260929;
  const random = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    const rows = await benchmark(monsters, items, Number(process.env.RUNS) || 40);
    if (process.argv.includes("--assert") || process.argv.includes("--assert-rewards")) {
      for (const [level, previous, next] of [[15, "normal", "mid"], [25, "mid", "ancient_city"], [35, "ancient_city", "mistwood"], [45, "mistwood", "ancient_city_deep"], [45, "mistwood", "dragon_realm"], [45, "mistwood", "hellfire"]]) {
        for (const job of ["swordsman", "mage", "archer"]) {
          const before = rows.find(r => r.level === level && r.zone === previous && r.job === job);
          const after = rows.find(r => r.level === level && r.zone === next && r.job === job);
          if (after.expPerMinute < before.expPerMinute * 1.1 || (process.argv.includes("--assert") && after.deathPct > 10)) {
            throw new Error(`Progression gate failed: ${job} Lv${level} ${next}: ${JSON.stringify({ before, after })}`);
          }
        }
      }
    }
    console.log(JSON.stringify(rows, null, 2));
  }
  finally { Math.random = random; }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { benchmark, buildPlayer, loadBson };
