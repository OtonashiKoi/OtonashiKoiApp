"use strict";
// Diagnostic only: current real badges/weapons, actual room service and party core.
// It deliberately reports integration failures instead of treating an attack as a complete class.
const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
// seasonStateStore normally starts a refresh at import time. Keep this process offline.
require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => { throw new Error("offline party audit: database access prohibited"); };
const { loadBson, buildPlayer } = require("./verify-normal-progression");
const jobs = require("../src/shared/jobAdvancement");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { createGameProgress } = require("../src/domain/progress/createGameProgress");
const { createPartyTowerRooms } = require("../src/services/tower/partyTowerRoomsV2");
const { detectMechanics } = require("./lib/jobBattleOptions");
const core = require("../src/shared/combatLoop");
const originalCore = core.runCombatLoop;
let capture = null;
const bounded = new Error("diagnostic sample complete");
core.runCombatLoop = (...args) => {
  if (capture && (capture.ownTurns >= 40 || capture.calls.length >= 400)) throw bounded;
  const options = args[5];
  const before = capture ? structuredClone(options) : null;
  const result = originalCore(...args);
  if (capture) {
    const own = options.playerName === "subject" && options.skipPlayerAttack !== true;
    if (own) capture.ownTurns++;
    capture.calls.push({ own, before, result: structuredClone(result), stats: args[0], turn: capture.ownTurns });
  }
  return result;
};
const tower = require("../src/bot/handlers/towerHandlers");
const rules = require("../src/shared/partyTowerRules");
const weaponTypes = { swordsman: "sword_1h", warrior: "axe_2h", dwarf_warrior: "mace_2h", rogue: "dagger", mage: "staff_2h", healer: "staff_1h", archer: "bow", tactician: "staff_2h", bard: "bow", barrier_mage: "staff_1h", gambler: "dice" };
const gaugeOptions = { shadowGauge: "shadowGaugeGrids", oniGauge: "oniGaugeGrids", sniperGauge: "sniperGaugeGrids", sageGauge: "sageGaugeGrids", diceGauge: "diceGaugeGrids", diceLuck: "diceLuckStacks" };
function equipment(items, base, badgeId) {
  const p = buildPlayer(items, 40, "A", "swordsman");
  const asSlot = item => ({ ...item, itemId: item.id, itemName: item.name, uuid: `audit-${item.id}`, enhanceLevel: 0 });
  const weapon = items.find(i => i.itemType === "equipment" && i.tier === "A" && i.weaponType === weaponTypes[base]);
  const badge = items.find(i => i.id === badgeId);
  assert.ok(weapon && badge, `Missing actual item: ${base}/${badgeId}`);
  p.equipped.weapon = asSlot(weapon); p.equipped.job_eq = asSlot(badge);
  if (["swordsman", "healer", "barrier_mage"].includes(base)) {
    p.equipped.shield = asSlot(items.find(i => i.tier === "A" && i.equipSlot === "shield" && !i.weaponType));
  } else if (base === "rogue") {
    p.equipped.shield = asSlot(items.find(i => i.tier === "A" && i.weaponType === "offhand_dagger"));
  } else delete p.equipped.shield;
  return p.equipped;
}
async function roomSnapshot(items, def, role, size) {
  const players = new Map(), rooms = new Map();
  for (let i = 0; i < size; i++) {
    const p = createGameProgress(`job-audit-${i}`); p.level = 40;
    p.attributes = { str: 20, agi: 20, vit: 30, int: 30, dex: 20, luk: 20 };
    p.equipment = equipment(items, i === 0 ? def.base : "swordsman", i === 0 ? def.id : jobs.BASE_JOBS.swordsman.badgeId);
    p.updatedAt = "audit"; players.set(p.playerId, p);
  }
  const sc = {
    progressRepository: { findByPlayerId: async id => structuredClone(players.get(id)) },
    itemRepository: { findById: async id => items.find(i => i.id === id) },
    partyTowerRepository: {
      find: async id => structuredClone(rooms.get(id)),
      findForPlayer: async id => structuredClone([...rooms.values()].find(r => r.active && r.members.some(m => m.discordId === id))),
      save: async r => { r.version = (r.version || 0) + 1; rooms.set(r._id, structuredClone(r)); },
    },
  };
  const service = createPartyTowerRooms(sc, { auto: false });
  try {
    const r = await service.createRoom("job-audit-0", "subject", "", role, "challenge");
    for (let i = 1; i < size; i++) await service.joinRoom(`job-audit-${i}`, `ally-${i}`, r.roomId, "", role === "tank" || i > 1 ? "dps" : "tank");
    for (let i = 0; i < size; i++) await service.setReady(`job-audit-${i}`, true);
    const room = structuredClone([...rooms.values()][0]);
    rules.assertParty(room.members, "challenge");
    return room;
  } finally { service.close(); }
}
async function main() {
  const snapshot = process.argv.find(v => v.startsWith("--snapshot="))?.slice(11);
  const output = process.argv.find(v => v.startsWith("--output="))?.slice(9);
  if (!snapshot || !output) throw new Error("--snapshot and --output required");
  const items = loadBson(`${snapshot}/items.bson`);
  const defs = Object.entries(jobs.BASE_JOBS).flatMap(([base, b]) => [{ base, id: b.badgeId, name: b.name, tier: 1 }, ...(jobs.T2_BRANCHES[base] || []).map(b => ({ base, ...b, tier: 2 }))]);
  const rows = [];
  const oldRandom = Math.random; let seed = 937451;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    for (const def of defs) {
      const samples = [], cooldownViolations = [], missingOptions = new Set(), lostResources = new Set();
      for (const size of [2, 5]) for (const role of ["tank", "dps", "support"]) {
        const room = await roomSnapshot(items, def, role, size);
        const subject = room.members[0];
        const monster = { name: "bounded diagnostic", zone: "mistwood", isBoss: false, calc: { level: 40, atk: 30, maxHp: 1e9, agi: 20, dex: 20, def: 0, flatDef: 0, hit: 100, dodge: 0, critRate: 0, dmgMin: 1, dmgMax: 1 } };
        capture = { ownTurns: 0, calls: [] };
        try { await tower.fightFloor({ ...room, partyV2: true, currentFloor: 1 }, monster, monster.calc.maxHp, monster.calc.atk); }
        catch (e) { if (e !== bounded) throw e; }
        const own = capture.calls.filter(c => c.own), allSubject = capture.calls.filter(c => c.before.playerName === "subject");
        const skills = subject.equipped.job_eq.jobSkills || [], lastSkillTurn = new Map();
        for (const c of own) {
          for (const mechanic of detectMechanics(subject.equipped)) for (const key of mechanic.options) if (c.before[key] === undefined) missingOptions.add(key);
          for (const sk of skills) if (c.result.roundLogs.some(line => line.includes(`【${sk.name}】`))) {
            if (lastSkillTurn.has(sk.key) && c.turn - lastSkillTurn.get(sk.key) < Number(sk.cooldownTurns || 0)) cooldownViolations.push({ size, role, skill: sk.name, previous: lastSkillTurn.get(sk.key), current: c.turn, expectedCooldown: sk.cooldownTurns });
            lastSkillTurn.set(sk.key, c.turn);
          }
        }
        for (const [resultKey, optionKey] of Object.entries(gaugeOptions)) if (allSubject.some((c, i) => i + 1 < allSubject.length && Number(c.result[resultKey]) > 0 && allSubject[i + 1].before[optionKey] !== c.result[resultKey])) lostResources.add(resultKey);
        if (def.key === "spiritmaster" && allSubject.some((c, i) => i + 1 < allSubject.length && c.result.sunSpirit?.hpPct < 100 && allSubject[i + 1].before.sunSpiritHpPct === undefined)) lostResources.add("sunSpiritHp");
        if (def.key === "sanctum" && allSubject.some((c, i) => i > 0 && c.result.sanctum && (c.result.sanctum.barrier > allSubject[i-1].result.sanctum.barrier || c.result.sanctum.absorbed < allSubject[i-1].result.sanctum.absorbed))) lostResources.add("sanctumBarrierState");
        const aura = tower.buildTowerPartyEffects(room.members, { zone: monster.zone }).filter(e => e.sourceDiscordId === subject.discordId);
        samples.push({ size, role, roomReady: room.members.every(m => m.ready), ownTurns: own.length,
          attacks: own.reduce((s, c) => s + (c.result.combatStats?.attackCount || 0), 0), damage: own.reduce((s, c) => s + Math.max(0, c.result.totalDamage || 0), 0),
          skillsObserved: [...lastSkillTurn.keys()], auraKeys: [...new Set(aura.map(e => e.key))],
          resourceResultRanges: Object.fromEntries(Object.keys(gaugeOptions).filter(k => own.some(c => c.result[k] != null)).map(k => [k, { min: Math.min(...own.map(c => c.result[k])), max: Math.max(...own.map(c => c.result[k])) }])) });
        capture = null;
      }
      rows.push({ name: def.name, badgeId: def.id, tier: def.tier, seasonLocked: !!def.seasonLocked,
        basicEntryAndDamagePassed: samples.every(s => s.roomReady && s.attacks > 0 && s.damage > 0),
        missingOptions: [...missingOptions], lostResources: [...lostResources], cooldownViolations, samples,
        completeClassAccepted: false,
        acceptanceNote: "This bounded integration audit does not approve balance, every conditional skill, UI gauges, or between-monster selections." });
      console.log(JSON.stringify({ job: def.name, basic: rows.at(-1).basicEntryAndDamagePassed, cooldownViolations: cooldownViolations.length, missingOptions: [...missingOptions], lostResources: [...lostResources] }));
    }
  } finally { Math.random = oldRandom; core.runCombatLoop = originalCore; capture = null; }
  const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const report = { generatedAt: new Date().toISOString(), seed: 937451, productionWrites: false,
    fixture: "Live BSON badges and A equipment; Lv40 controlled stats, synthetic low-ATK high-HP monster; 2/5 players, all 3 roles, bounded 40 subject turns. NOT a clear-rate/balance test. Locked badges audited without unlocking.",
    currentSnapshot: JSON.parse(fs.readFileSync(`${snapshot}/snapshot.json`)),
    hashes: Object.fromEntries(["src/shared/jobAdvancement.js", "src/shared/combatLoop.js", "src/bot/handlers/towerHandlers.js", "src/services/tower/partyTowerRoomsV2.js", "scripts/verify-party-jobs.js"].map(p => [p, hash(p)])), rows,
    summary: { jobs: rows.length, available: rows.filter(r => !r.seasonLocked).length, locked: rows.filter(r => r.seasonLocked).length, samples: rows.reduce((s, r) => s + r.samples.length, 0), basicPassed: rows.filter(r => r.basicEntryAndDamagePassed).length,
      jobsWithCooldownViolation: rows.filter(r => r.cooldownViolations.length).length, jobsWithMissingOptions: rows.filter(r => r.missingOptions.length).length, jobsWithLostResources: rows.filter(r => r.lostResources.length).length },
    integrationPassed: rows.every(r => r.basicEntryAndDamagePassed && !r.missingOptions.length && !r.cooldownViolations.length && !r.lostResources.length) };
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report.summary));
  process.exitCode = report.integrationPassed ? 0 : 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
