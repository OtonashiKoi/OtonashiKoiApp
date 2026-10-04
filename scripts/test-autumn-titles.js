"use strict";
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
async function main() {
  const mongo = await MongoMemoryServer.create(), client = await MongoClient.connect(mongo.getUri());
  const db = client.db("autumn_titles_isolated");
  require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => db;
  const rules = require("../src/shared/autumnTitleRules");
  const { titleItems, questPatch } = require("./migrate-autumn-titles");
  const { WeeklyQuestService } = require("../src/services/weeklyQuest/weeklyQuestService");
  const currency = require("../src/adapters/mongo/standaloneCurrencySettlement").createStandaloneCurrencySettlement({ getDb: async () => db });
  const progress = {
    findByPlayerId: playerId => db.collection("progress").findOne({ playerId }),
    saveIfUnchanged: async (p, stamp) => {
      const { _id, ...data } = p;
      return (await db.collection("progress").updateOne({ playerId: p.playerId, updatedAt: stamp }, { $set: data })).matchedCount === 1;
    },
    updateFields: (playerId, fields) => db.collection("progress").updateOne({ playerId }, { $set: fields }),
    save: async p => { const { _id, ...data } = p; await db.collection("progress").updateOne({ playerId: p.playerId }, { $set: data }); }
  };
  const items = { findById: id => db.collection("items").findOne({ id }), findAll: () => db.collection("items").find().toArray() };
  const reward = { grantCurrency: x => currency.grantCurrencyAtomic({ ...x, playerId: x.discordId }) };
  const fresh = async id => {
    await db.collection("progress").insertOne({ playerId: id, seasonKey: rules.SEASON_KEY, activeCharacterSlot: 1,
      level: 50, equipment: {}, inventory: [], flags: {}, updatedAt: new Date().toISOString() });
    await db.collection("wallets").insertOne({ playerId: id, gold: 0, diamond: 0 });
  };
  let open = false;
  const base = require("./migrate-autumn-quests").definitions();
  const defs = rules.TITLES.map(t => questPatch(t, base.find(q => q.id === t.questId)));
  const rows = new Map();
  const repo = { listQuests: async () => defs,
    getPlayerProgress: async (id, period, cadence) => structuredClone(rows.get(`${id}:${period}:${cadence}`) || {}),
    savePlayerProgress: async (id, period, p, cadence) => rows.set(`${id}:${period}:${cadence}`, structuredClone(p)) };
  const create = () => new WeeklyQuestService(repo, { getProfile: async id => ({ progress: await progress.findByPlayerId(id) }) },
    { progressRepository: progress, itemRepository: items, rewardService: reward, isOpen: () => open });
  const qs = create(), title = key => rules.TITLES.find(t => t.key === key), claim = (id, key, service = qs) => service.claimReward(id, title(key).questId);
  try {
    await db.collection("items").insertMany([...titleItems(), ...Object.entries(require("../src/shared/enhanceConfig").ENHANCE_GEMS).map(([tier,id]) => ({id,name:tier+" 強化石",itemType:"consumable"}))]);
    await fresh("main");
    await qs.recordProgressBatch("main", { battle_win: 100 });
    assert.equal(rules.characterState(await progress.findByPlayerId("main")).wins, undefined);
    await assert.rejects(() => claim("main", "traveler"), /尚未開放/);
    open = true;
    await qs.recordProgressBatch("main", { battle_win: 99 }, { operationId: "kill99" });
    await assert.rejects(() => claim("main", "traveler"), /尚未完成/);
    await qs.recordProgressBatch("main", { battle_win: 1 }, { operationId: "kill100" });
    await qs.recordProgressBatch("main", { battle_win: 1 }, { operationId: "kill100" });
    assert.equal(rules.characterState(await progress.findByPlayerId("main")).wins, 100);
    const claims = await Promise.allSettled(Array.from({ length: 10 }, () => claim("main", "traveler")));
    assert.equal(claims.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await progress.findByPlayerId("main")).inventory.filter(i => i.itemId === title("traveler").itemId).length, 1);
    assert.equal((await qs.getPlayerProgress("main", "season")).find(q => q.quest.id === title("traveler").questId).claimed, true);
    await assert.rejects(() => claim("main", "maple"), /尚未完成/);
    await qs.recordProgressBatch("main", { battle_win: 2900 });
    const original = progress.saveIfUnchanged;
    progress.saveIfUnchanged = async () => { throw Error("crash-after-gold"); };
    await assert.rejects(() => claim("main", "veteran"), /crash-after-gold/);
    assert.equal((await db.collection("wallets").findOne({ playerId: "main" })).gold, 11000);
    progress.saveIfUnchanged = original;
    await claim("main", "veteran", create());
    assert.equal((await db.collection("wallets").findOne({ playerId: "main" })).gold, 11000);
    assert.equal((await progress.findByPlayerId("main")).inventory.find(i => i.itemId.startsWith("8fdf")).stackCount, 3);
    for (let day = 0; day < 15; day++) {
      const at = new Date(rules.COUNT_FROM + day * 86400000).toISOString();
      await qs.autumnTitles.record("main", { type: "checkin", at });
      await qs.autumnTitles.record("main", { type: "checkin", at });
    }
    assert.equal(rules.characterState(await progress.findByPlayerId("main")).days.length, 15);
    await claim("main", "attendance");
    for (let n = 0; n < 3; n++) {
      for (let repeat = 0; repeat < 3; repeat++) await qs.autumnTitles.record("main", { type: "enhance", tier: "A", level: 5, uuid: `gear-${n}` });
    }
    await qs.autumnTitles.record("main", { type: "enhance", tier: "S", level: 5, uuid: "s-gear" });
    assert.equal(rules.characterState(await progress.findByPlayerId("main")).enhancedUuids.length, 3);
    await claim("main", "forge"); await claim("main", "maple");
    const p = await progress.findByPlayerId("main"), maple = await items.findById(title("maple").itemId);
    const { ShopService } = require("../src/services/shop/shopService");
    const gearService = Object.create(ShopService.prototype);
    Object.assign(gearService, { progressRepository: progress, itemRepository: items });
    const mapleEntry = p.inventory.find(i => i.itemId === maple.id);
    await gearService.equipItem("main", mapleEntry.uuid);
    assert.equal((await progress.findByPlayerId("main")).equipment.title_eq.itemId, maple.id);
    await gearService.unequipItem("main", "title_eq");
    assert.ok((await progress.findByPlayerId("main")).inventory.some(i => i.itemId === maple.id));
    const rewards = require("../src/services/battle/battleRewardRules");
    const before = rewards.buildRewardModifiers(p);
    const equipped = { ...p, equipment: { title_eq: maple } }, after = rewards.buildRewardModifiers(equipped);
    assert.equal(after.expPct - before.expPct, 3); assert.equal(after.goldPct - before.goldPct, 2);
    assert.deepEqual(rules.idleBonuses(equipped), { expPct: 3, goldPct: 2 });
    assert.deepEqual(rules.idleBonuses(p), { expPct: 0, goldPct: 0 });
    assert.equal(rewards.collectRewardEffectRefs(equipped).filter(e => e.target === "party").length, 0);
    const apiQuest = (await qs.listDefinitions("season")).find(q => q.id === title("veteran").questId);
    assert.deepEqual(apiQuest.rewards.items.map(i => i.itemName), ["B 強化石", "楓紅百戰"]);
    await progress.updateFields("main", { activeCharacterSlot: 2 });
    assert.equal((await qs.getPlayerProgress("main", "season")).find(q => q.quest.id === title("traveler").questId).current, 0);
    await assert.rejects(() => qs.autumnTitles.record("main", { type: "battle", wins: 1, slot: 1 }), /人物已切換/);
    await qs.autumnTitles.record("main", { type: "battle", wins: 100, eligible: false });
    assert.equal(rules.characterState(await progress.findByPlayerId("main")).wins, undefined);
    await progress.updateFields("main", { activeCharacterSlot: 1 });
    await qs.recordProgressBatch("main", { party_floor_clear: 100 }, { operationId: "floors" });
    await claim("main", "companions");
    await qs.autumnTitles.record("main", { type: "challenge", floor: 50, difficulty: "normal", runId: "wrong" });
    await qs.autumnTitles.record("main", { type: "challenge", floor: 49, difficulty: "challenge", runId: "partial" });
    await assert.rejects(() => claim("main", "summit"), /尚未完成/);
    await qs.autumnTitles.record("main", { type: "challenge", floor: 50, difficulty: "challenge", runId: "completed" });
    await claim("main", "summit");
    const awarded = (await progress.findByPlayerId("main")).inventory;
    assert.equal(awarded.filter(i => i.equipSlot === "title_eq" && i.itemType === "equipment").length, 7);
    const gems = require("../src/shared/enhanceConfig").ENHANCE_GEMS;
    for (const [tier, qty] of Object.entries({ D: 2, C: 2, B: 8, A: 5 }))
      assert.equal(awarded.filter(i => i.itemId === gems[tier]).reduce((n,i) => n + Number(i.stackCount || 1), 0), qty);
    assert.equal((await db.collection("wallets").findOne({ playerId: "main" })).gold, 44000);
    await progress.updateFields("main", { seasonKey: "next-season" });
    await qs.autumnTitles.record("main", { type: "battle", wins: 100 });
    await assert.rejects(() => claim("main", "traveler"), /賽季已變更/);
    assert.equal(rules.view(defs[0], await progress.findByPlayerId("main")).current, 0);
    const reset = require("../src/services/admin/seasonResetPolicy").buildProgressResetUpdate(await progress.findByPlayerId("main"));
    assert.equal(reset.$set.inventory.filter(i => i.equipSlot === "title_eq").length, 7);
    // Actual tower settlement: failure retains floor wins; challenge title requires full completion.
    await fresh("tower");
    const { settleProgress } = require("../src/services/tower/partyTowerProgress");
    const member = { discordId: "tower", progressSnapshot: { activeCharacterSlot: 1 }, equipped: {} };
    const kill = { monsterId: "monster", gain: .25, metrics: { battle_win: 1, party_floor_clear: 1 }, titleEligible: true, periodKeys: {} };
    const sc = { questService: qs, progressRepository: progress };
    const room = { runId: "wipe-run", seasonKey: rules.SEASON_KEY, difficulty: "challenge", terminal: "wipe", clearedFloor: 23 };
    await settleProgress(sc, room, member, { progressKills: Array(23).fill(kill) }, Date.now());
    await settleProgress(sc, room, member, { progressKills: Array(23).fill(kill) }, Date.now());
    assert.equal(rules.characterState(await progress.findByPlayerId("tower")).floors, 23);
    assert.equal(rules.characterState(await progress.findByPlayerId("tower")).challengeRuns, undefined);
    await settleProgress(sc, { ...room, runId: "win-run", terminal: "win", clearedFloor: 50 }, member, { progressKills: Array(50).fill(kill) }, Date.now());
    assert.equal(rules.characterState(await progress.findByPlayerId("tower")).challengeRuns.length, 1);
    // Exercise the real checkin/enhancement hooks, not only counter helpers.
    const maintenance = require("../src/services/access/maintenanceStore");
    await maintenance.setState({ enabled: false, strict: false, activateAt: null, openAt: null });
    const realNow = Date.now, realRandom = Math.random;
    try {
      Date.now = () => rules.COUNT_FROM + 1000;
      await fresh("hooks");
      const checkins = db.collection("checkins");
      const checkinRepo = { findLastByDiscordId: id => checkins.findOne({ discordId: id }, { sort: { occurredAt: -1 } }),
        save: c => checkins.updateOne({ id: c.id }, { $set: c }, { upsert: true }) };
      const checkin = new (require("../src/services/checkin/checkinService").CheckinService)(
        { ensurePlayer: async () => {} }, checkinRepo, reward, progress);
      for (const at of [rules.COUNT_FROM - 1000, rules.COUNT_FROM + 1000, rules.COUNT_FROM + 86400000])
        await checkin.handleMessage({ discordId: "hooks", occurredAt: new Date(at).toISOString() });
      // First (pre-opening) checkin does not count; same Taiwan date remains one paid checkin.
      assert.equal(rules.characterState(await progress.findByPlayerId("hooks")).days.length, 1);
      const gear = { uuid: "enhance-hook", itemId: "a-gear", itemName: "A 裝", itemType: "equipment", tier: "A",
        enhanceLevel: 4, equipSlot: "weapon", equipStats: { str: 10 } };
      const gem = require("../src/shared/enhanceConfig").ENHANCE_GEMS.A;
      await progress.updateFields("hooks", { inventory: [gear, { uuid: "a-gems", itemId: gem, stackCount: 100 }] });
      await db.collection("wallets").updateOne({ playerId: "hooks" }, { $set: { gold: 1000000 } });
      const wallet = { findByPlayerId: playerId => db.collection("wallets").findOne({ playerId }) };
      const enhancer = new (require("../src/services/enhance/enhanceService").EnhanceService)(progress, items, wallet,
        reward);
      Math.random = () => 0;
      assert.equal((await enhancer.enhanceEquipment("hooks", gear.uuid)).success, true);
      assert.deepEqual(rules.characterState(await progress.findByPlayerId("hooks")).enhancedUuids, [gear.uuid]);
    } finally { Date.now = realNow; Math.random = realRandom; }
    // Actual kill payout and both idle settlement routes apply equipped title bonuses.
    await fresh("bonus");
    await progress.updateFields("bonus", { equipment: { title_eq: { itemId: maple.id } } });
    const goldGrants = [], expGrants = [];
    const rewardsSc = { progressRepository: progress, itemRepository: items,
      rewardService: { grantCurrency: async r => goldGrants.push(r.amount) },
      progressService: { grantExp: async r => { expGrants.push(r.amount); return { levelUps: 0, progress: { level: 50 } }; } },
      worldBossServiceFor: () => null };
    await require("../src/services/battle/grantKillCurrencyAndExp").grantKillCurrencyAndExp({
      state: { participants: ["bonus"], damageMap: { bonus: { damage: 100 } } }, discordId: "bonus", displayName: "bonus",
      zoneKey: "normal", monster: { name: "bonus-test", goldReward: 1000, expReward: 1000, calc: { maxHp: 100 } },
      sc: rewardsSc, totalDamage: 100, session: { monsterMaxHp: 100 }, rewardLines: [] });
    assert.deepEqual(goldGrants, [1020]);
    // Level 50 in normal applies the existing level penalty, then title EXP +3%.
    assert.deepEqual(expGrants, [103]);
    let idleState = { discordSession: { sessionId: "idle-test", zoneKey: "normal", startedAt: new Date(Date.now() - 3600000).toISOString(), avgGoldPerTick: 100, avgExpPerTick: 100 } };
    const idle = new (require("../src/services/idle/idleService").IdleService)({ ...rewardsSc,
      playerService: { ensurePlayer: async () => ({ progress: await progress.findByPlayerId("bonus") }) },
      idleRepository: { findPlayerState: async () => structuredClone(idleState), savePlayerState: async (_id, next) => { idleState = next; } } });
    idle._resolveMembership = async () => ({ isMember: false });
    const idleReward = (await idle.claimDiscordSession("bonus", "bonus")).reward;
    assert.deepEqual([idleReward.gold, idleReward.exp], [1224, 1236]);
    idleState = { activeSession: { zoneId: "test-zone", sessionId: "web-idle", startedAt: new Date(Date.now() - 3600000).toISOString() } };
    idle.getZoneById = async () => ({ id: "test-zone", minClaimMinutes: 0 });
    idle._computeClaimPreview = () => ({ effectiveMinutes: 10, rewardTier: { goldPerMinute: 100, expPerMinute: 100, drops: [] } });
    idle._rollAndGrantDrops = async () => [];
    const webIdle = await idle.claimSession("bonus", "bonus");
    assert.deepEqual([webIdle.summary.reward.gold, webIdle.summary.reward.exp], [1020, 1030]);
    // Exercise the production Mongo repository, including its BSON ObjectId and CAS filter.
    await require("../src/services/access/seasonStateStore").activate(rules.SEASON_KEY);
    const actualProgress = require("../src/adapters/mongo/createMongoRepositories").createMongoRepositories().progressRepository;
    await fresh("actual-mongo");
    const originalId = (await db.collection("progress").findOne({ playerId: "actual-mongo" }))._id;
    const actualTitles = new (require("../src/services/weeklyQuest/autumnTitleService").AutumnTitleService)({
      progressRepository: actualProgress, itemRepository: items, rewardService: reward, isOpen: () => true
    });
    await actualTitles.record("actual-mongo", { type: "battle", wins: 3000, id: "actual-mongo-wins" });
    await actualTitles.record("actual-mongo", { type: "battle", wins: 3000, id: "actual-mongo-wins" });
    const actualClaims = await Promise.allSettled(Array.from({ length: 5 }, () => actualTitles.claim("actual-mongo", defs.find(q => q.id === title("veteran").questId))));
    assert.equal(actualClaims.filter(r => r.status === "fulfilled").length, 1);
    const persisted = await db.collection("progress").findOne({ playerId: "actual-mongo" });
    assert.ok(persisted._id.equals(originalId));
    assert.equal(rules.characterState(persisted).wins, 3000);
    assert.equal(persisted.inventory.filter(i => i.itemId === title("veteran").itemId).length, 1);
    assert.equal((await db.collection("wallets").findOne({ playerId: "actual-mongo" })).gold, 10000);
    console.log("PASS production Mongo repository: ObjectId unchanged; progress persisted; five concurrent claims grant one title and one gold reward");
    console.log("PASS 7 seasonal quests/titles; closed-gate exclusion; independent slots; 10-way claim; crash/restart no duplicate gold/items; checkin/UUID dedup; real tower settlement; equipped-only EXP +3% gold +2%; existing B gems/gold retained; reset retention");
  } finally { await client.close(); await mongo.stop(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
