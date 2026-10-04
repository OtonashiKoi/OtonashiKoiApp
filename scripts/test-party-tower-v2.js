"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const rules = require("../src/shared/partyTowerRules");
const { createPartyTowerRooms } = require("../src/services/tower/partyTowerRoomsV2");
const { createGameProgress } = require("../src/domain/progress/createGameProgress");
const { ProgressService } = require("../src/services/progress/progressService");
const { fightFloor } = require("../src/bot/handlers/towerHandlers");
const clone = structuredClone;
const checks = [];
async function check(name, fn) { try { await fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, error: e.stack }); } finally { require("../src/shared/battlePresence").setTowerPresence(Array.from({ length: 7 }, (_, i) => `party-test-${i + 1}`), false); } }
function fixture() {
  const rooms = new Map(), players = new Map(), gold = new Map(), receipts = new Set();
  for (let i = 1; i <= 7; i++) {
    const p = createGameProgress(`party-test-${i}`); p.level = 40;
    p.attributes = { str: 500, agi: 40, vit: 500, int: 100, dex: 100, luk: 0 }; p.updatedAt = "initial";
    players.set(p.playerId, p);
  }
  const progressRepository = {
    findByPlayerId: async id => clone(players.get(id)),
    saveIfUnchanged: async (p, old) => { if (players.get(p.playerId)?.updatedAt !== old) return false; players.set(p.playerId, clone(p)); return true; },
  };
  const sc = {
    progressRepository, itemRepository: { findById: async id => ({ id, name: "測試區域装", itemType: "equipment", equipSlot: "armor", equipStats: { vit: 1 }, tier: "B" }) },
    rewardService: { grantCurrency: async q => { if (!receipts.has(q.sourceRef)) { gold.set(q.discordId, (gold.get(q.discordId) || 0) + q.amount); receipts.add(q.sourceRef); } } },
    monsterService: { listMonsters: async () => ["ancient_city", "mistwood", "ancient_city_deep", "dragon_realm", "hellfire", "metal_mine"].flatMap(zone => Array.from({ length: 31 }, (_, i) => i + 20).flatMap(level => [false, true].map(isBoss => ({ id: `monster-${zone}-${level}-${isBoss}`, name: isBoss ? "測試王" : "測試怪", zone, level,
      isBoss, maxHp: 20, goldReward: 100, expReward: 100, drops: [{ itemId: "test-item", chance: 100 }],
      calc: { maxHp: 20, atk: 1, level: 30, def: 0, flatDef: 0, dodge: 0, hit: 100, crit: 0, agi: 1, dex: 1, dmgMin: 1, dmgMax: 1 } })))) },
    partyTowerRepository: {
      find: async id => clone(rooms.get(id)), findForPlayer: async id => clone([...rooms.values()].find(r => r.active && r.members.some(m => m.discordId === id))),
      list: async () => clone([...rooms.values()].filter(r => r.active)),
      save: async (r, old) => { if (old != null && rooms.get(r._id)?.version !== old) throw Object.assign(new Error("CAS"), { status: 409 }); r.version = (old || 0) + 1; rooms.set(r._id, clone(r)); },
      grantItems: async (id, entries, key, pending) => { const p = players.get(id); if ((p.partyItemReceipts || []).includes(key)) return; p.partyItemReceipts = [...(p.partyItemReceipts || []), key]; const field = pending ? "partyPendingDrops" : "inventory"; p[field] = [...(p[field] || []), ...clone(entries)]; },
    },
  };
  sc.progressService = new ProgressService({ ensurePlayer: async id => ({ player: { discordId: id }, progress: clone(players.get(id)) }) }, progressRepository);
  let time = 1_000_000;
  const opts = { auto: false, now: () => time, playbackMs: 0, capacity: async () => 0, fightFloor };
  return { sc, opts, rooms, players, gold, advance: (amount = 100000) => { time += amount; } };
}
async function setup(f, difficulty = "normal", count = 2) {
  const service = createPartyTowerRooms(f.sc, f.opts);
  const first = await service.createRoom("party-test-1", "坦", "secret", "tank", difficulty);
  for (let i = 2; i <= count; i++) await service.joinRoom(`party-test-${i}`, `隊友${i}`, first.roomId, "secret", i === 3 ? "support" : "dps");
  for (let i = 1; i <= count; i++) await service.setReady(`party-test-${i}`, true);
  return service;
}
async function main() {
  await check("角色倍率與五倍HP／一般1.5、挑戰普通2／BOSS2.5倍攻擊", () => {
    const p = { maxHp: 100, def: 20, flatDef: 10, magicDef: 20, dodge: 20, atk: 100 };
    assert.deepEqual(rules.roleStats(p, "tank"), { ...p, maxHp: 120, def: 24, flatDef: 12, magicDef: 24 });
    assert.equal(rules.roleStats(p, "support").maxHp, 100); assert.equal(rules.roleStats(p, "dps").dodge, 16);
    assert.equal(rules.scaleMonster({ calc: { maxHp: 100, atk: 100 } }, "normal").calc.atk, 150);
    assert.equal(rules.scaleMonster({ calc: { maxHp: 100, atk: 100 } }, "challenge").calc.atk, 200);
    assert.equal(rules.scaleMonster({ isBoss: true, calc: { maxHp: 100, atk: 100 } }, "challenge").calc.atk, 250);
    assert.equal(rules.scaleMonster({ isBoss: true, calc: { maxHp: 100, atk: 100 } }, "normal").calc.atk, 150);
    assert.equal(rules.scaleMonster({ isBoss: true, calc: { maxHp: 100, atk: 100 } }, "challenge").calc.maxHp, 500);
    assert.equal(rules.scaleMonster({ calc: { maxHp: 100, atk: 100 } }).calc.maxHp, 500);
  });
  await check("坦→最高累積輸出→最高累積輔助、倒地排除及同分隨機", () => {
    const ms = [{ discordId: "t", towerRole: "tank", currentHp: 1 }, { discordId: "a", towerRole: "dps", currentHp: 1 }, { discordId: "b", towerRole: "dps", currentHp: 1 }, { discordId: "h", towerRole: "support", currentHp: 1 }];
    const damage = new Map([["a", { damageDealt: 10 }], ["b", { damageDealt: 20 }], ["h", { damageDealt: 100 }]]);
    assert.equal(rules.selectTarget(ms, damage).discordId, "t"); ms[0].currentHp = 0;
    assert.equal(rules.selectTarget(ms, damage).discordId, "b"); damage.get("a").damageDealt = 30;
    assert.equal(rules.selectTarget(ms, damage).discordId, "a"); ms[1].currentHp = 0; ms[2].currentHp = 0;
    assert.equal(rules.selectTarget(ms, damage).discordId, "h"); ms[3].currentHp = 0;
    assert.equal(rules.selectTarget(ms, damage), null);
    ms[1].currentHp = ms[2].currentHp = 1; damage.get("a").damageDealt = 20;
    assert.equal(rules.selectTarget(ms, damage, () => 0).discordId, "a"); assert.equal(rules.selectTarget(ms, damage, () => .99).discordId, "b");
  });
  await check("單人／缺坦／多坦／未準備／Lv門檻均不可出發", async () => {
    const f = fixture(); const s = createPartyTowerRooms(f.sc, f.opts);
    const r = await s.createRoom("party-test-1", "坦", "", "tank");
    await s.setReady("party-test-1"); await assert.rejects(s.startRoom("party-test-1"), /2～5/);
    await s.joinRoom("party-test-2", "打", r.roomId, "", "dps"); await assert.rejects(s.startRoom("party-test-1"), /準備/);
    await s.setRole("party-test-2", "tank"); await assert.rejects(s.startRoom("party-test-1"), /一名坦克/);
    await s.setRole("party-test-1", "dps"); await s.setRole("party-test-2", "dps"); await assert.rejects(s.startRoom("party-test-1"), /一名坦克/);
    f.players.get("party-test-4").level = 29; await assert.rejects(s.joinRoom("party-test-4", "低等", r.roomId, "", "dps"), /Lv.30/);
    f.players.get("party-test-5").level = 39; await assert.rejects(s.createRoom("party-test-5", "低等", "", "dps", "challenge"), /Lv.40/);
    await s.disband("party-test-1");
  });
  await check("密碼、五人上限、踢人及非隊長權限", async () => {
    const f = fixture(); const s = await setup(f, "normal", 5); const r = await s.getState("party-test-1");
    await assert.rejects(s.joinRoom("party-test-6", "x", r.roomId, "wrong", "dps"), /密碼/);
    await assert.rejects(s.joinRoom("party-test-6", "x", r.roomId, "secret", "dps"), /五人/);
    await assert.rejects(s.kickMember("party-test-2", "party-test-3"), /隊長/);
    await s.kickMember("party-test-1", "party-test-5"); assert.equal(await s.getState("party-test-5"), null);
    assert.equal((await s.getState("party-test-1")).members.every(m => !m.ready), true); await s.disband("party-test-1");
  });
  for (const difficulty of ["normal", "challenge"]) await check(`${difficulty}真實核心、自動完整30／50樓、重連續跑、獨立掉落與防重`, async () => {
    const f = fixture(); let s = await setup(f, difficulty, 3); await s.startRoom("party-test-1");
    await s.tick(); const first = await s.getState("party-test-1"); assert.equal(first.clearedFloor, 1); assert.ok(first.lastFloorResult.monsterKilled);
    s.close(); s = createPartyTowerRooms(f.sc, f.opts);
    for (let i = 0; i < rules.difficulty(difficulty).totalFloors * 2 + 3; i++) { f.advance(); await s.tick(); }
    const ended = await s.getState("party-test-1"); assert.equal(ended.status, "ended"); assert.equal(ended.failReason, null);
    assert.equal(ended.clearedFloor, rules.difficulty(difficulty).totalFloors); assert.equal(ended.settled, true);
    const before = clone([...f.players.values()]); const walletBefore = clone([...f.gold]); await s.tick();
    assert.deepEqual([...f.players.values()], before); assert.deepEqual([...f.gold], walletBefore);
    for (let i = 1; i <= 3; i++) assert.equal(f.players.get(`party-test-${i}`).partyPendingDrops.length, ended.totalFloors);
    assert.notEqual(f.players.get("party-test-1").partyPendingDrops[0].uuid, f.players.get("party-test-2").partyPendingDrops[0].uuid);
    await s.returnLobby("party-test-2"); assert.equal((await s.getState("party-test-1")).status, "lobby"); await s.disband("party-test-1");
  });
  await check("職業資源結算CAS防重、重新組隊沿用並保留其他玩家欄位", async () => {
    const f = fixture();
    const jobs = require("../src/shared/jobAdvancement");
    const p = f.players.get("party-test-1");
    const branch = jobs.T2_BRANCHES.warrior.find(b => b.id === "job_berserker_t2_v1");
    p.equipment.job_eq = { itemId: branch.id, itemName: branch.name };
    p.berserkGauge = { count: 3 }; p.storyFlags = { keep: true };
    const s = await setup(f); await s.startRoom("party-test-1"); await s.tick();
    const inFight = [...f.rooms.values()][0];
    assert.equal(inFight.members[0].partyJobState.berserkGauge, 4);
    await s.retreat("party-test-1");
    const stored = clone(f.players.get("party-test-1"));
    assert.equal(stored.berserkGauge.count, 4); assert.deepEqual(stored.storyFlags, { keep: true });
    await s.tick(); assert.deepEqual(f.players.get("party-test-1"), stored);
    await s.returnLobby("party-test-1");
    for (const id of ["party-test-1", "party-test-2"]) await s.setReady(id);
    await s.startRoom("party-test-1"); await s.tick();
    assert.equal([...f.rooms.values()][0].members[0].partyJobState.berserkGauge, 5);
    await s.disband("party-test-1");
  });
  await check("擊敗後連續接怪，沒有整備倒數，戰中策略runId及倒地操作防呆", async () => {
    const f = fixture(); const s = await setup(f); await s.startRoom("party-test-1"); await s.tick();
    const first = await s.getState("party-test-1"); assert.equal(first.status, "climbing"); assert.equal(first.selectionEndsAt, null);
    await assert.rejects(s.setStrategy("party-test-1", { runId: "stale" }), /副本已變更/);
    await s.setStrategy("party-test-1", { runId: first.runId });
    await s.tick(); assert.equal((await s.getState("party-test-1")).clearedFloor, 2);
    [...f.rooms.values()][0].members[0].currentHp = 0;
    await assert.rejects(s.setStrategy("party-test-1", { runId: first.runId }), /倒地/);
    await s.disband("party-test-1");
  });
  await check("手動演奏沿用原計分、token一次性、準備及出發保留已選策略", async () => {
    const f = fixture(); f.players.get("party-test-2").equipment.job_eq = { itemId: "job_minstrel_t2_v1", itemName: "吟遊詩人徽章" };
    f.sc.itemRepository.findById = async id => id === "job_minstrel_t2_v1" ? { id, name: "吟遊詩人徽章", equipSlot: "job_eq", effect: [] } : null;
    const s = await setup(f); const view = await s.getState("party-test-2"); const challenge = view.strategyControls.bardChallenge;
    await s.setStrategy("party-test-2", { bardInput: { token: challenge.token, inputs: challenge.seq } });
    const chosen = await s.getState("party-test-2"); assert.equal(chosen.strategy.bardResult.dmgMult, 1.3); assert.equal(chosen.strategy.bardResult.chordPct, 170);
    await assert.rejects(s.setStrategy("party-test-2", { bardInput: { token: challenge.token, inputs: challenge.seq } }), /題目已失效/);
    await s.setReady("party-test-2", true); await s.startRoom("party-test-1");
    assert.deepEqual((await s.getState("party-test-2")).strategy, chosen.strategy);
    await s.disband("party-test-1"); s.close();
  });
  await check("EXP原子CAS收據防重", async () => {
    const f = fixture(); const q = { discordId: "party-test-1", amount: 100, source: "tower:reward-exp", operationId: "one-award" };
    await f.sc.progressService.grantExp(q); const p = clone(f.players.get(q.discordId)); await f.sc.progressService.grantExp(q); assert.deepEqual(f.players.get(q.discordId), p);
  });
  await check("全滅自動停止、零通關不發獎、可回組隊框", async () => {
    const f = fixture();
    f.sc.monsterService.listMonsters = async () => [{ id: "wipe", name: "強敵", level: 20, zone: "ancient_city", calc: { maxHp: 1e8, atk: 1e7, agi: 100, hit: 100, def: 0, flatDef: 0, dodge: 0, level: 30, dmgMin: 1, dmgMax: 1 } }];
    const s = await setup(f); await s.startRoom("party-test-1"); await s.tick(); f.advance(); await s.tick();
    const r = await s.getState("party-test-1"); assert.equal(r.status, "ended"); assert.match(r.failReason, /全隊倒地/);
    assert.equal(r.clearedFloor, 0); assert.equal(r.reward.exp, 0); assert.equal(r.reward.drops.length, 0);
    await s.returnLobby("party-test-1"); assert.equal((await s.getState("party-test-1")).status, "lobby"); await s.disband("party-test-1");
  });
  await check("輔助只強化光環、補血不增加、光環不會復活倒地成員", () => {
    const { buildTowerPartyEffects, refreshTowerMemberMaxHp } = require("../src/bot/handlers/towerHandlers");
    const aura = { key: "party_damage_up", target: "party", params: { value: 20 } };
    const heal = { key: "heal_over_time", target: "party", params: { value: 10 } };
    const hp = { key: "party_max_hp_up", target: "party", params: { value: 20 } };
    const m = { discordId: "a", partyV2: true, name: "輔助", towerRole: "support", currentHp: 100, maxHp: 100, stats: { maxHp: 100 }, equipped: { accessory_l: { passiveEffects: [aura, heal, hp] } } };
    const effects = buildTowerPartyEffects([m]);
    assert.equal(effects.find(e => e.key === aura.key).params.value, 25);
    assert.equal(effects.find(e => e.key === heal.key).params.value, 10);
    const dead = { discordId: "b", partyV2: true, name: "倒地", towerRole: "dps", currentHp: 0, maxHp: 85, stats: { maxHp: 100 }, equipped: {} };
    refreshTowerMemberMaxHp({ members: [m, dead] }, 1); assert.equal(dead.currentHp, 0);
  });
  await check("重算輔助光環不改寫徽章、長戰鬥不連乘膨脹", () => {
    const { buildTowerPartyEffects } = require("../src/bot/handlers/towerHandlers");
    const m = { discordId: "a", partyV2: true, name: "輔助", job: { name: "聖靈師", key: "healer" }, towerRole: "support", currentHp: 100, stats: {},
      equipped: { job_eq: { itemId: "job_spiritmaster_t2_v1", passiveEffects: [{ key: "party_damage_up", target: "party", params: { value: 20 } }] } } };
    const before = clone(m.equipped);
    for (let i = 0; i < 100; i++) assert.equal(buildTowerPartyEffects([m])[0].params.value, 50);
    assert.deepEqual(m.equipped, before);
  });
  await check("職業冷卻只在本人出手扣、同怪一次技能與HP成本不重放", () => {
    const { runCombatLoop } = require("../src/shared/combatLoop");
    const p = { atk: 100, maxHp: 10000, agi: 20, dex: 20, level: 40, def: 0, flatDef: 0, hit: 100, dodge: 0, dmgMin: 1, dmgMax: 1 };
    const badge = { itemId: "job_warrior_v1", jobSkills: [{ key: "once", name: "一次血祭測試", cooldownTurns: 3, oncePerBattle: true, cost: { type: "hp", value: 10 }, procEffects: [{ key: "atk_up", target: "self", params: { value: 10 } }] }] };
    const monster = { ...p, maxHp: 1e8, atk: 1 };
    let o = { equipped: { job_eq: badge }, skipMonsterAttack: true, startPlayerHp: p.maxHp, startMonsterHp: monster.maxHp, startRound: 1 };
    const old = Math.random; Math.random = () => .1;
    try {
      const first = runCombatLoop(p, monster, "測試怪", monster.maxHp, 1, o);
      assert.equal(first.jobSkillCooldowns.once, 3); assert.deepEqual(first.jobSkillsUsedThisBattle, ["once"]); assert.equal(first.finalPlayerHp, 9000);
      o = { ...o, startPlayerHp: first.finalPlayerHp, startMonsterHp: first.finalMonsterHp, startRound: 2, jobSkillCooldowns: first.jobSkillCooldowns, jobSkillsUsedThisBattle: first.jobSkillsUsedThisBattle };
      const enemy = runCombatLoop(p, monster, "測試怪", monster.maxHp, 1, { ...o, skipMonsterAttack: false, skipPlayerAttack: true, tickJobSkillCooldowns: false });
      assert.equal(enemy.jobSkillCooldowns.once, 3);
      for (let i = 0; i < 6; i++) {
        const r = runCombatLoop(p, monster, "測試怪", monster.maxHp, 1, o);
        assert.equal(r.finalPlayerHp, 9000); assert.ok(!r.roundLogs.join("\n").includes("【一次血祭測試】"));
        o = { ...o, startRound: o.startRound + 1, startMonsterHp: r.finalMonsterHp, jobSkillCooldowns: r.jobSkillCooldowns, jobSkillsUsedThisBattle: r.jobSkillsUsedThisBattle };
      }
    } finally { Math.random = old; }
  });
  await check("實際AGI行動軸：高敏捷更常出手、同時到點按DEX排序", async () => {
    const stats = { atk: 20, maxHp: 1e6, agi: 20, dex: 20, level: 40, def: 0, flatDef: 0, hit: 100, dodge: 0, dmgMin: 1, dmgMax: 1 };
    const member = (id, agi, dex, role) => ({ discordId: id, name: id, partyV2: true, towerRole: role, level: 40, stats: { ...stats, agi, dex }, equipped: {}, inventory: [], currentHp: 1e6, maxHp: 1e6 });
    const monster = { name: "monster", zone: "mistwood", calc: { ...stats, atk: 1, agi: 20, dex: 10, maxHp: 10000 } };
    const result = await fightFloor({ partyV2: true, currentFloor: 1, members: [member("a", 20, 20, "tank"), member("b", 20, 30, "dps")] }, monster, monster.calc.maxHp, monster.calc.atk);
    const order = result.memberLogs.slice(0, 9).map(a => a.type === "monster" ? "monster" : a.actorId);
    assert.deepEqual(order, ["b", "a", "monster", "b", "a", "monster", "b", "a", "monster"]);
    const fast = await fightFloor({ partyV2: true, currentFloor: 1, members: [member("a", 20, 20, "tank"), member("b", 100, 30, "dps")] }, monster, monster.calc.maxHp, monster.calc.atk);
    assert.equal(fast.memberLogs[0].actorId, "b");
    const first99 = fast.memberLogs.slice(0, 99);
    const count = id => first99.filter(a => (a.type === "monster" ? "monster" : a.actorId) === id).length;
    assert.ok(count("b") > count("a")); assert.ok(Math.abs(count("b") / count("a") - 200 / 120) < .12);
  });
  await check("EXP增加50%、金幣不增加、獨立掉率15%邊界及屬性裝掉落", async () => {
    for (const randomValue of [.149, .151]) {
      const f = fixture(); f.sc.monsterService.listMonsters = async () => [{ id: "drop-check", name: "屬性測試怪", level: 20, zone: "ancient_city", element: "wood", elementLevel: 1,
        expReward: 100, goldReward: 100, drops: [{ itemId: "test-item", chance: 10 }], calc: { maxHp: 10, atk: 1 } }];
      f.opts.fightFloor = async () => ({ monsterKilled: true, survived: true, memberLogs: [], memberDamage: [], monsterHpFinal: 0 });
      const s = await setup(f); await s.startRoom("party-test-1");
      const old = Math.random;
      try { Math.random = () => randomValue; await s.tick(); } finally { Math.random = old; }
      const r = await s.getState("party-test-1"); assert.equal(r.reward.exp, Math.round(50 * .45 * 1.5)); assert.equal(r.reward.gold, 50);
      assert.equal(r.reward.drops.length, randomValue < .15 ? 1 : 0);
      if (randomValue < .15) assert.equal(r.reward.drops[0].element, "wood");
      await s.disband("party-test-1");
    }
  });
  await check("輸出終傷只乘一次，包含連擊", () => {
    const { runCombatLoop } = require("../src/shared/combatLoop");
    const p = { atk: 100, maxHp: 1000, def: 0, flatDef: 0, hit: 100, crit: 0, agi: 10, dex: 10, luk: 0, dmgMin: 1, dmgMax: 1, guaranteedCombo: 2 };
    const m = { maxHp: 1e6, atk: 1, level: 30, def: 0, flatDef: 0, dodge: 0, agi: 1, dex: 1 };
    const saved = Math.random;
    try {
      const run = mult => { let seed = 937451; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; return runCombatLoop({ ...p }, { ...m }, "終傷怪", m.maxHp, 1, { playerLevel: 30, equipped: { weapon: { combatEffects: [{ key: "guaranteed_combo", trigger: "passive", target: "self", chance: 100, params: { value: 2 } }] } }, skipMonsterAttack: true, partyRoleDamageMultiplier: mult }); };
      const base = run(1), boosted = run(1.2); assert.ok(base.totalDamage > 0);
      assert.ok(base.combatStats.comboCount >= 2, "必須實際觸發連擊");
      assert.ok(Math.abs(boosted.totalDamage / base.totalDamage - 1.2) < .025, JSON.stringify({ base: base.totalDamage, boosted: boosted.totalDamage }));
    } finally { Math.random = saved; }
  });
  if (process.argv.includes("--mongo")) await check("實際Mongo房間CAS、玩家唯一隊伍、重連結算及待領防重", async () => {
    require("dotenv").config();
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
    const database = `party_verification_${Date.now()}`;
    const db = client.db(database);
    try {
      const f = fixture(); const season = require("../src/services/access/seasonStateStore"); await season.ensureLoaded();
      await db.collection("progress").insertMany([...f.players.values()].map(p => ({ ...p, seasonKey: season.getActiveKey() })));
      await db.collection("partyTowerRooms").createIndex({ activePlayers: 1 }, { unique: true, partialFilterExpression: { active: true } });
      f.sc.partyTowerRepository = require("../src/adapters/mongo/createPartyTowerRepository").createPartyTowerRepository({ collection: async name => db.collection(name) });
      f.sc.progressRepository = {
        findByPlayerId: id => db.collection("progress").findOne({ playerId: id }),
        saveIfUnchanged: async (p, old) => { const next = { ...p }; delete next._id; return (await db.collection("progress").updateOne({ playerId: p.playerId, updatedAt: old }, { $set: next })).matchedCount === 1; },
      };
      f.sc.progressService = new ProgressService({ ensurePlayer: async id => ({ player: { discordId: id }, progress: await f.sc.progressRepository.findByPlayerId(id) }) }, f.sc.progressRepository);
      let s = await setup(f); const original = await f.sc.partyTowerRepository.findForPlayer("party-test-1");
      await assert.rejects(f.sc.partyTowerRepository.save({ ...original, _id: "DUPLICATE", version: null }, null), e => e.code === 11000);
      await assert.rejects(f.sc.partyTowerRepository.save({ ...original }, original.version - 1), e => e.status === 409);
      await s.startRoom("party-test-1"); await s.tick(); s.close(); s = createPartyTowerRooms(f.sc, f.opts);
      for (let i = 0; i < 64; i++) { f.advance(); await s.tick(); }
      assert.equal((await s.getState("party-test-1")).settled, true);
      let p = await f.sc.progressRepository.findByPlayerId("party-test-1"); assert.equal(p.partyPendingDrops.length, 30);
      await f.sc.partyTowerRepository.grantItems(p.playerId, [{ itemId: "wrong", uuid: "duplicate" }], p.partyItemReceipts[0], true);
      assert.equal((await f.sc.progressRepository.findByPlayerId(p.playerId)).partyPendingDrops.length, 30);
      f.opts.capacity = async () => 7; s.close(); s = createPartyTowerRooms(f.sc, f.opts);
      assert.deepEqual(await s.claimPending(p.playerId), { claimed: 7, pending: 23 });
      assert.deepEqual(await s.claimPending(p.playerId), { claimed: 0, pending: 23 });
      p = await f.sc.progressRepository.findByPlayerId(p.playerId); assert.equal(p.inventory.length, 7);
      await s.disband("party-test-1"); checks.push({ name: "隔離資料庫保留供追查", ok: true, database });
    } finally { await client.close(); }
  });
  await check("战斗中離隊停止、獎勵保留與隊長移交", async () => {
    const f = fixture(); const s = await setup(f); await s.startRoom("party-test-1"); await s.tick();
    await s.leaveRoom("party-test-1"); const r = await s.getState("party-test-2"); assert.equal(r.status, "ended"); assert.equal(r.leaderId, "party-test-2"); assert.ok(r.settled); assert.equal(await s.getState("party-test-1"), null); await s.disband("party-test-2");
  });
  const report = { generatedAt: new Date().toISOString(), source: "current code, real fightFloor with synthetic functional fixtures", checks };
  const output = process.argv.find(x => x.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
  for (const c of checks) console.log(c.ok ? `PASS ${c.name}` : `FAIL ${c.name}: ${c.error}`);
  process.exit(checks.some(c => !c.ok) ? 1 : 0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { fixture, setup };
