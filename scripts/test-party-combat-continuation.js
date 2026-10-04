"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => { throw Error("offline verification: DB access forbidden"); };
const { loadBson } = require("./verify-normal-progression");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { fightFloor } = require("../src/bot/handlers/towerHandlers");
const party = require("../src/shared/partyCombatState");
const checks = [];
async function check(name, fn) { try { await fn(); checks.push({ name, ok: true }); console.log("PASS", name); } catch (e) { checks.push({ name, ok: false, error: e.stack }); console.error("FAIL", name, e.message); } }
const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11);
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
if (!snapshot || !output) throw Error("--snapshot and --output are required");
const items = loadBson(`${snapshot}/items.bson`);
const badge = id => ({ ...items.find(i => i.id === id), itemId: id });
const stats = { atk: 30, maxHp: 10000, agi: 20, dex: 20, level: 40, int: 0, def: 0, flatDef: 0, hit: 100, dodge: 0, crit: 0, dmgMin: 1, dmgMax: 1 };
const monster = { ...stats, atk: 100, maxHp: 1e8, critRate: 0 };
function actor(id) {
  let hp = stats.maxHp, enemyHp = monster.maxHp, effects = [], enemyEffects = [], cooldowns = { player: {}, monster: {} }, stunned = 0;
  const session = {};
  return (type, extra = {}) => {
    const opts = { equipped: { job_eq: badge(id) }, actionSession: session, partyActorId: "subject", playerName: "subject", startPlayerHp: hp,
      startMonsterHp: enemyHp, playerActiveEffects: effects, monsterActiveEffects: enemyEffects, cardCooldowns: cooldowns,
      stunRoundsLeft: stunned, tickJobSkillCooldowns: type === "player", skipPlayerAttack: type !== "player", skipMonsterAttack: type === "player", ...extra };
    const r = runCombatLoop(stats, monster, "測試怪", monster.maxHp, 1, opts);
    hp = r.finalPlayerHp; enemyHp = r.finalMonsterHp; effects = opts.playerActiveEffects; enemyEffects = r.monsterActiveEffects;
    cooldowns = r.cardCooldowns; stunned = r.stunRoundsLeft;
    return r;
  };
}
async function main() {
  const old = Math.random; let seed = 937451;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    await check("精靈代承後HP不重設；第五次本人攻擊才施放大治療", () => {
      const act = actor("job_spiritmaster_t2_v1");
      const first = act("player"); const hit = act("monster"); assert.ok(hit.sunSpirit.hp < stats.maxHp); assert.equal(hit.finalPlayerHp, stats.maxHp);
      const next = act("player"); assert.equal(next.sunSpirit.hp, hit.sunSpirit.hp);
      const enemy = act("monster"); const third = act("player"); assert.equal(third.sunSpirit.hp, enemy.sunSpirit.hp);
      let attackRounds = first.combatStats.attackRounds + next.combatStats.attackRounds + third.combatStats.attackRounds;
      let healed = false;
      for (let i = 0; i < 12 && !healed; i++) {
        const r = act("player"); attackRounds += r.combatStats.attackRounds;
        if (r.roundLogs.some(l => l.includes("大治療術"))) { assert.equal(attackRounds % 5, 0); healed = true; }
      }
      assert.equal(healed, true);
    });
    await check("結界及吸收量跨敵我行動保留；不把一個行動當終幕", () => {
      const act = actor("job_sanctum_t2_v1"); const start = act("player"); const hit = act("monster");
      assert.ok(hit.sanctum.barrier < start.sanctum.barrier); assert.ok(hit.sanctum.absorbed > 0);
      const next = act("player"); assert.equal(next.sanctum.barrier, hit.sanctum.barrier);
      assert.equal(next.sanctum.absorbed, hit.sanctum.absorbed); assert.equal(next.sanctum.detonated, false);
    });
    await check("怪物HOT只在怪物行動回血，玩家出手不重複恢復", () => {
      const act = actor("job_swordsman_v1");
      const effects = [{ key: "heal_over_time", params: { value: 15, mode: "pct" }, appliedAt: 1 }];
      const first = act("player", { startMonsterHp: 1e7, monsterActiveEffects: effects });
      assert.ok(first.finalMonsterHp <= 1e7);
      const second = act("player"); assert.ok(second.finalMonsterHp <= first.finalMonsterHp);
      const healed = act("monster"); assert.equal(healed.finalMonsterHp - second.finalMonsterHp, 15e6);
    });
    await check("護盾在怪物出手時仍生效，吸收後不重新充滿", () => {
      const act = actor("job_swordsman_v1"); act("player");
      const one = act("monster", { playerActiveEffects: [{ key: "shield", params: { amount: 1000, value: 1000, mode: "flat" }, appliedAt: 1 }] });
      assert.equal(one.finalPlayerHp, stats.maxHp);
      const remaining = one.playerActiveEffects.find(e => e.key === "shield").params.amount;
      assert.ok(remaining < 1000);
      let current = remaining;
      for (let i = 0; i < 5 && current === remaining; i++) {
        const two = act("monster"); assert.equal(two.finalPlayerHp, stats.maxHp);
        const next = two.playerActiveEffects.find(e => e.key === "shield").params.amount;
        assert.ok(next <= current); current = next;
      }
      assert.ok(current < remaining);
    });
    await check("團隊冰凍在實際怪物出手時阻止攻擊，不被行動更新清掉", () => {
      const act = actor("job_swordsman_v1");
      const start = act("player", { teamStunRounds: 999999, teamStunStyle: "freeze" });
      for (let i = 0; i < 3; i++) {
        const r = act("monster"); assert.equal(r.damageTaken, 0);
        assert.equal(r.finalPlayerHp, start.finalPlayerHp); assert.ok(r.stunRoundsLeft > 0);
        assert.ok(r.roundLogs.some(l => l.includes("冰") || l.includes("凍")));
      }
    });
    await check("高AGI怪物可連續出手，行動條資料與伺服器排序一致", async () => {
      const member = (id, role) => ({ discordId: id, name: id, partyV2: true, towerRole: role, level: 40, stats: { ...stats, maxHp: 1e8 }, equipped: {}, inventory: [], currentHp: 1e8, maxHp: 1e8 });
      const result = await fightFloor({ partyV2: true, currentFloor: 1, members: [member("a", "tank"), member("b", "dps")] }, { name: "高速怪", zone: "mistwood", calc: { ...monster, maxHp: 5000, atk: 1, agi: 800 } }, 5000, 1);
      const events = result.memberLogs.slice(0, 99), count = id => events.filter(a => a.actionClock.actorId === id).length;
      assert.ok(Math.abs(count("monster") / count("a") - 900 / 120) < .5);
      assert.ok(events.some((a, i) => i && a.type === "monster" && events[i-1].type === "monster"));
      for (const a of events) { const c = a.actionClock; assert.ok(c.ready.find(g => g.id === c.actorId).value >= 999.99); assert.ok(c.after.find(g => g.id === c.actorId).value < .001); }
    });
    await check("跨怪資源：氣條／手氣延續，精靈倒下下一場50%重召", () => {
      const m = { equipped: { job_eq: badge("job_dicegod_t2_v1") }, progressSnapshot: {}, strategy: {}, currentHp: 100 };
      party.beginFloor(m, { name: "x" }); party.recordAction(m, { diceGauge: 5, diceLuck: 7, sunSpirit: { hpPct: 0 } });
      party.endFloor(m, true); party.beginFloor(m, { name: "y" }); const o = party.battleOptions(m);
      assert.equal(o.diceGaugeGrids, 5); assert.equal(o.diceLuckStacks, 7); assert.equal(o.sunSpiritHpPct, 50);
    });
    await check("聖域／冰凍沿用原門檻20秒窗口與2分鐘免疫，且房間隔離", () => {
      const m = { equipped: { job_eq: badge("job_sanctum_t2_v1") }, floorAttackRounds: 10 };
      const room = { members: [m] }; for (let i = 0; i < 4; i++) party.knockEnvironment(room, "mistwood", 1000);
      assert.equal(party.zoneEnvironment(room, "mistwood", 1001).sanctumOn, true);
      assert.equal(party.zoneEnvironment(room, "mistwood", 21000).sanctumOn, false);
      party.knockEnvironment(room, "mistwood", 22000); assert.equal(room.zoneEnvironments.mistwood.sanctum.gauge, 0);
      let empty = { members: [] }; assert.equal(party.zoneEnvironment(empty, "mistwood", 1001).sanctumOn, false);
      m.equipped.job_eq = badge("job_elementalist_t2_v1"); m.strategy = { stance: "frost" }; m.floorAttackRounds = 300;
      party.knockEnvironment(empty = { members: [m] }, "mistwood", 1000);
      assert.equal(party.zoneEnvironment(empty, "mistwood", 1001).freezeOn, true);
    });
  } finally { Math.random = old; }
  const paths = ["src/shared/combatLoop.js", "src/shared/partyCombatState.js", "src/bot/handlers/towerHandlers.js", "src/services/tower/partyTowerRoomsV2.js"];
  fs.writeFileSync(output, JSON.stringify({ seed: 937451, productionWrites: false, currentSnapshot: snapshot, checks,
    hashes: Object.fromEntries(paths.map(p => [p, crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")])) }, null, 2), { flag: "wx" });
  process.exit(checks.every(c => c.ok) ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
