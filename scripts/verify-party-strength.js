"use strict";
// Offline strength diagnostics: real equipment, point budget, monster data and party core.
const fs = require("node:fs"), crypto = require("node:crypto");
require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => { throw Error("offline diagnosis: Mongo writes forbidden"); };
const { loadBson, buildPlayer } = require("./verify-normal-progression");
const { MonsterService } = require("../src/services/monster/monsterService");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { fightFloor, refreshTowerMemberMaxHp } = require("../src/bot/handlers/towerHandlers");
const rules = require("../src/shared/partyTowerRules");
const jobs = require("../src/shared/jobAdvancement");
const snapshot = process.argv.find(v => v.startsWith("--snapshot="))?.slice(11);
const output = process.argv.find(v => v.startsWith("--output="))?.slice(9);
const runs = Number(process.argv.find(v => v.startsWith("--runs="))?.slice(7)) || 20;
if (!snapshot || !output) throw Error("snapshot and output required");
const items = loadBson(`${snapshot}/items.bson`), raw = loadBson(`${snapshot}/monsters.bson`);
const sourceFiles = ["src/shared/partyTowerRules.js", "src/shared/partyTowerEncounters.js", "src/shared/combatLoop.js", "src/bot/handlers/towerHandlers.js", "src/shared/partyCombatState.js", "src/shared/combatStats.js", "src/services/tower/partyTowerRoomsV2.js", "src/services/tower/partyTowerPotions.js", "scripts/verify-party-strength.js"];
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const initialHashes = Object.fromEntries(sourceFiles.map(p => [p, hash(p)]));
let seed = 937451;
function members(profile, size) {
  return Array.from({ length: size }, (_, i) => {
    const role = i === 0 ? "tank" : i === 1 && size >= 3 ? "support" : "dps";
    const job = i === 0 ? "swordsman" : role === "support" ? "mage" : "archer";
    const p = buildPlayer(items, profile.level, profile.tier, job);
    const badgeId = profile.t2 ? { tank: "job_holyblade_t2_v1", support: "job_spiritmaster_t2_v1", dps: "job_sniper_t2_v1" }[role]
      : role === "support" ? jobs.BASE_JOBS.healer.badgeId : jobs.BASE_JOBS[job].badgeId;
    const badge = items.find(x => x.id === badgeId); if (!badge) throw Error(`Missing actual badge ${badgeId}`);
    p.equipped.job_eq = { ...badge, itemId: badge.id, itemName: badge.name };
    // Keep the same total chosen-point budget; only change where points go.
    if (profile.rolePoints) {
      const points = profile.level - 1;
      p.attrs = Object.fromEntries(["str", "agi", "vit", "int", "dex", "luk"].map(k => [k, 1 + points / 6]));
      const main = { swordsman: "str", mage: "int", archer: "dex" }[job];
      p.attrs[main] += points * (role === "tank" ? .2 : .7);
      p.attrs.vit += points * (role === "tank" ? .7 : .2);
      p.attrs.agi += points * .1;
    }
    const stats = calcPlayerStats(p.attrs, p.equipped, [], []), maxHp = rules.roleStats(stats, role).maxHp;
    return { discordId: `probe-${i}`, name: `probe-${i}`, level: profile.level, job: { name: badge.name }, towerRole: role,
      partyV2: true, stats, equipped: p.equipped, inventory: [], activeEffects: [], maxHp, currentHp: maxHp,
      strategy: { stance: role === "tank" && profile.t2 ? "defense" : "attack" } };
  });
}
function trace(result, initialHp) {
  let previous = initialHp, heal = 0, monsterActs = 0, memberActs = 0, grossDamage = 0;
  const healCycles = []; let sinceHeal = 0;
  for (const a of result.memberLogs) {
    const damage = Math.max(0, previous - a.monsterHpAfter);
    grossDamage += damage; sinceHeal += damage;
    if (a.type === "monster") { monsterActs++; const gain = Math.max(0, a.monsterHpAfter - previous); if (gain) { heal += gain; healCycles.push({ damageSinceLastHeal: sinceHeal, heal: gain, hpAfter: a.monsterHpAfter }); sinceHeal = 0; } }
    else memberActs++;
    previous = a.monsterHpAfter;
  }
  return { actions: result.memberLogs.length, monsterActs, memberActs, grossDamage, healing: heal, healCycles: healCycles.slice(-5),
    monsterHpLeft: result.monsterHpFinal, survivors: result.members?.filter(x => x.alive).length,
    lastActions: result.memberLogs.slice(-8).map(a => ({ type: a.type, name: a.name, hp: a.monsterHpAfter, partyHp: a.partyHpAfter, logs: a.logs })) };
}
async function main() {
  const all = await new MonsterService({ findAll: async () => raw }).listMonsters();
  const pool = all.filter(m => !m.allZones && !require("../src/services/worldBoss/worldBossService").isWorldBossZone(m.zone) && !require("../src/shared/zones").isEventZone(m.zone));
  const profiles = [
    { key: "normal-30B", difficulty: "normal", level: 30, tier: "B" },
    { key: "normal-35B", difficulty: "normal", level: 35, tier: "B" },
    { key: "normal-30A", difficulty: "normal", level: 30, tier: "A" },
    { key: "normal-35A-t2", difficulty: "normal", level: 35, tier: "A", t2: true, rolePoints: true },
    { key: "challenge-40A", difficulty: "challenge", level: 40, tier: "A" },
    { key: "challenge-40A-t2", difficulty: "challenge", level: 40, tier: "A", t2: true, rolePoints: true },
    { key: "challenge-45A-t2", difficulty: "challenge", level: 45, tier: "A", t2: true, rolePoints: true },
    { key: "challenge-50A-t2", difficulty: "challenge", level: 50, tier: "A", t2: true, rolePoints: true },
  ];
  const rows = [], failures = [], isolated = []; const oldRandom = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    for (const profile of profiles) for (const size of [2, 3, 5]) {
      seed = 937451; let clears = 0, wipes = 0, stalls = 0, floors = 0, seconds = 0;
      const failuresByMonster = {}, partyStats = members(profile, size).map(m => ({ role: m.towerRole, job: m.job.name, atk: m.stats.atk, maxHp: m.maxHp, agi: m.stats.agi, def: m.stats.def, flatDef: m.stats.flatDef }));
      for (let run = 0; run < runs; run++) {
        const team = members(profile, size), d = rules.difficulty(profile.difficulty); let cleared = 0;
        for (let floor = 1; floor <= d.totalFloors; floor++) {
          const base = require("../src/shared/partyTowerEncounters").pickMonster(pool, profile.difficulty, floor), monster = rules.scaleMonster(base, profile.difficulty);
          refreshTowerMemberMaxHp({ members: team }, floor, { zone: base.zone });
          const result = await fightFloor({ partyV2: true, currentFloor: floor, members: team }, monster, monster.calc.maxHp, monster.calc.atk);
          seconds += result.memberLogs.reduce((sum, a) => sum + require("../src/shared/battleTiming").calculateBattleTickMs(a.agi || 1) / 2000, 0);
          if (result.interrupted || !result.monsterKilled || !result.survived) {
            const reason = result.interrupted ? "action safeguard" : "wipe"; stalls += Number(result.interrupted); wipes += Number(!result.interrupted);
            failuresByMonster[base.name] = (failuresByMonster[base.name] || 0) + 1;
            failures.push({ profile: profile.key, size, run, floor, monster: base.name, reason, hpLeft: result.monsterHpFinal,
              diagnostics: run === 0 ? trace(result, monster.calc.maxHp) : undefined }); break;
          }
          cleared = floor;
          require("../src/services/tower/partyTowerPotions").systemRecovery(team, floor);
        }
        clears += Number(cleared === d.totalFloors); floors += cleared;
      }
      const row = { ...profile, size, runs, clearPct: clears / runs * 100, wipes, stalls, averageClearedFloor: +(floors / runs).toFixed(2), animationSeconds: +(seconds / runs).toFixed(1), failuresByMonster, partyStats };
      rows.push(row); console.log(JSON.stringify(row));
      fs.writeFileSync(output + ".checkpoint.json", JSON.stringify({ rows, failures, incomplete: true }, null, 2));
    }
    const golem = pool.find(m => m.monsterCardSkill?.key === "castle_golem_petrify");
    if (!golem) throw Error("Missing castle golem");
    for (const profile of profiles.filter(p => ["normal-30B", "challenge-40A", "challenge-40A-t2"].includes(p.key))) for (const size of [2, 3, 5]) for (const cardOn of [true, false]) {
      seed = 937451; let kills = 0, wipes = 0, stalls = 0; const samples = [];
      for (let run = 0; run < runs; run++) {
        const monster = rules.scaleMonster(structuredClone(golem), profile.difficulty);
        if (!cardOn) { monster.monsterCardSkill = null; monster.equipment.special_1 = null; }
        const team = members(profile, size); refreshTowerMemberMaxHp({ members: team }, 30, { zone: golem.zone });
        const result = await fightFloor({ partyV2: true, currentFloor: 30, members: team }, monster, monster.calc.maxHp, monster.calc.atk);
        kills += Number(result.monsterKilled); stalls += Number(result.interrupted); wipes += Number(!result.monsterKilled && !result.interrupted);
        if (run === 0) samples.push(trace(result, monster.calc.maxHp));
      }
      isolated.push({ profile: profile.key, size, cardOn, runs, killPct: kills / runs * 100, wipes, stalls, samples });
      console.log(JSON.stringify({ golem: profile.key, size, cardOn, killPct: kills / runs * 100, stalls, wipes }));
    }
  } finally { Math.random = oldRandom; }
  const hashes = Object.fromEntries(sourceFiles.map(p => [p, hash(p)]));
  const sourceStable = Object.entries(initialHashes).every(([p, h]) => hashes[p] === h);
  const report = { generatedAt: new Date().toISOString(), source: "current code + parse-verified live BSON; production unchanged", seed: 937451, runs,
    assumptions: "Equal point budget: one random + one chosen per level, random points evenly distributed; unenhanced matching tier gear; no pets, cards, anchors, bestiary, potions or manual bard; simulated point averages are fractional. T2 models use defense holyblade, spiritmaster and sniper. Living members recover 30% HP every 10 floors; no automatic revive. Times are animation only, excluding the 30-second strategy windows.",
    hashes, sourceStable, snapshotHashes: { monsters: hash(`${snapshot}/monsters.bson`), items: hash(`${snapshot}/items.bson`) }, rows, failures, isolated,
    acceptance: "Diagnostic only; no approved overall clear-rate target. Stalls and all failures retained; no balance or full profession acceptance claim." };
  fs.writeFileSync(output, JSON.stringify(report, null, 2)); process.exitCode = sourceStable ? 0 : 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
