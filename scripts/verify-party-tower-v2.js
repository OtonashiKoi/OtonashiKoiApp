"use strict";
// Read-only stochastic dungeon benchmark using verified live BSON and the real party core.
const fs = require("node:fs");
const crypto = require("node:crypto");
const { loadBson, buildPlayer } = require("./verify-normal-progression");
const { MonsterService } = require("../src/services/monster/monsterService");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { fightFloor, refreshTowerMemberMaxHp } = require("../src/bot/handlers/towerHandlers");
const rules = require("../src/shared/partyTowerRules");
const { calculateBattleTickMs } = require("../src/shared/battleTiming");
async function main() {
  const snapshot = process.argv.find(v => v.startsWith("--snapshot="))?.slice(11);
  const output = process.argv.find(v => v.startsWith("--output="))?.slice(9);
  const runs = Number(process.argv.find(v => v.startsWith("--runs="))?.slice(7)) || 200;
  if (!snapshot || !output) throw new Error("snapshot and output required");
  const items = loadBson(`${snapshot}/items.bson`);
  const raw = loadBson(`${snapshot}/monsters.bson`);
  const all = await new MonsterService({ findAll: async () => raw }).listMonsters();
  const pool = all.filter(m => !m.allZones && !require("../src/services/worldBoss/worldBossService").isWorldBossZone(m.zone) && !require("../src/shared/zones").isEventZone(m.zone));
  let seed = 937451; const original = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const rows = [], failures = [];
  try {
    for (const key of ["normal", "challenge"]) for (const size of [2, 3, 5]) {
      const d = rules.difficulty(key); const floors = [], seconds = []; let wins = 0, interrupted = 0;
      for (let run = 0; run < runs; run++) {
        const members = Array.from({ length: size }, (_, i) => {
          const role = i === 0 ? "tank" : i === 1 && size >= 3 ? "support" : "dps";
          const job = i === 0 ? "swordsman" : role === "support" ? "mage" : "archer";
          const p = buildPlayer(items, d.minLevel, key === "normal" ? "B" : "A", job);
          if (role === "support") { const badge = items.find(x => x.id === require("../src/shared/jobAdvancement").BASE_JOBS.healer.badgeId); if (!badge) throw new Error("Missing actual healer badge"); p.equipped.job_eq = { ...badge, itemId: badge.id, itemName: badge.name }; }
          const stats = calcPlayerStats(p.attrs, p.equipped, [], []);
          const maxHp = rules.roleStats(stats, role).maxHp;
          return { discordId: `bench-${i}`, name: `bench-${i}`, level: d.minLevel, job: { name: p.equipped.job_eq?.itemName || "新手" },
            towerRole: role, partyV2: true, stats, equipped: p.equipped, inventory: [], activeEffects: [], maxHp, currentHp: maxHp };
        });
        let cleared = 0, time = 0;
        for (let floor = 1; floor <= d.totalFloors; floor++) {
          const base = require("../src/shared/partyTowerEncounters").pickMonster(pool, key, floor);
          const monster = rules.scaleMonster(base, key);
          refreshTowerMemberMaxHp({ members }, floor, { zone: base.zone });
          const r = await fightFloor({ partyV2: true, currentFloor: floor, members }, monster, monster.calc.maxHp, monster.calc.atk);
          time += r.memberLogs.reduce((s, a) => s + calculateBattleTickMs(a.agi || 1) / 2000, 0) + .45;
          if (r.interrupted) { interrupted++; failures.push({ key, size, floor, monster: base.name, reason: "action safeguard" }); break; }
          if (!r.monsterKilled || !r.survived) break;
          cleared = floor;
          require("../src/services/tower/partyTowerPotions").systemRecovery(members, floor);
        }
        wins += Number(cleared === d.totalFloors); floors.push(cleared); seconds.push(time);
      }
      rows.push({ difficulty: key, partySize: size, level: d.minLevel, tier: key === "normal" ? "B" : "A", runs, clearPct: wins / runs * 100,
        averageClearedFloor: +(floors.reduce((a, b) => a + b) / runs).toFixed(2), averageSeconds: +(seconds.reduce((a, b) => a + b) / runs).toFixed(1), interrupted });
      fs.writeFileSync(output + ".checkpoint.json", JSON.stringify({ rows, failures, source: "incomplete checkpoint" }, null, 2));
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
  } finally { Math.random = original; }
  const hash = path => crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
  const hashes = Object.fromEntries(["src/shared/partyTowerRules.js", "src/shared/partyTowerEncounters.js", "src/shared/combatLoop.js", "src/bot/handlers/towerHandlers.js", "scripts/verify-party-tower-v2.js"].map(p => [p, hash(p)]));
  const report = { generatedAt: new Date().toISOString(), seed: 937451, source: "current code + verified live BSON, no production writes", model: "1 random point evenly distributed plus 1 chosen point per level, no anchors/cards/pets/enhancement; existing buildPlayer model", snapshotHashes: { monsters: hash(`${snapshot}/monsters.bson`), items: hash(`${snapshot}/items.bson`) }, hashes, rows, failures, passed: failures.length === 0, balanceAcceptance: "No clear-rate target approved; report is evidence, not a balance completion claim" };
  fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ rows, failures }, null, 2)); process.exit(failures.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
