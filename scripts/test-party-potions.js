"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const { fixture, setup } = require("./test-party-tower-v2");
const { createPartyTowerRooms } = require("../src/services/tower/partyTowerRoomsV2");
const ids = Object.keys(require("../src/bot/handlers/towerHandlers").TOWER_POTION_IDS);
const potions = require("../src/services/tower/partyTowerPotions");
const checks = [];
const clone = structuredClone;
async function check(name, fn) { try { await fn(); checks.push({ name, ok: true }); } catch(e) { checks.push({ name, ok: false, error: e.stack }); } finally {
  require("../src/shared/battlePresence").setTowerPresence(Array.from({ length: 7 }, (_, i) => `party-test-${i + 1}`), false);
} }
function withInventory(f) {
  f.players.get("party-test-1").inventory = [
    { uuid: "heal-stack", itemId: ids[0], stackCount: 20 }, { uuid: "revive-stack", itemId: ids[3], stackCount: 5 },
    { uuid: "big-stack", itemId: ids[2], stackCount: 5 }, { uuid: "keep", itemId: "other", stackCount: 7 },
  ];
}
const fakeFight = async (session) => {
  session.members[0].currentHp = session.members[0].maxHp - 500;
  session.members[1].currentHp = 0;
  return { survived: true, monsterKilled: true, memberLogs: [], monsterHpFinal: 0, memberDamage: [] };
};
async function readyRun(f) {
  const s = await setup(f, "normal", 3);
  await s.setPotions("party-test-1", { [ids[0]]: 8, [ids[3]]: 2 });
  await s.setReady("party-test-1"); await s.startRoom("party-test-1");
  await s.tick();
  const raw = await f.sc.partyTowerRepository.findForPlayer("party-test-1"); raw.nextAt = 1e12; await f.sc.partyTowerRepository.save(raw, raw.version);
  assert.equal((await s.getState("party-test-1")).status, "climbing");
  return s;
}
function req(r, operationId = "operation-0001") { return { runId: r.runId, operationId }; }
async function main() {
  await check("任何樓層都不自動回血或復活，保留原HP", () => {
    const team = [{ currentHp: 100, maxHp: 1000 }, { currentHp: 0, maxHp: 1000 }, { currentHp: 1000, maxHp: 1000 }];
    const before = clone(team);
    for (let floor = 1; floor <= 50; floor++) {
      assert.deepEqual(potions.systemRecovery(team, floor), []);
      assert.deepEqual(team, before);
    }
  });
  await check("房間5／10／20／30樓均不補血，倒地HP跨樓保留", async () => {
    const f = fixture(); f.opts.fightFloor = fakeFight;
    const s = await setup(f, "normal", 3); await s.startRoom("party-test-1");
    for (const floor of [5, 10, 20, 30]) {
      const raw = [...f.rooms.values()][0];
      raw.clearedFloor = floor - 1; raw.lastFloorResult = null; raw.nextAt = 0;
      await s.tick(); const r = await s.getState("party-test-1");
      assert.equal(r.lastFloorResult.floor, floor);
      assert.deepEqual(r.lastFloorResult.systemRecovery, []);
      assert.equal(r.members[0].hp, r.members[0].maxHp - 500);
      assert.equal(r.members[1].hp, 0);
    }
    await s.disband("party-test-1");
  });
  await check("總10瓶／復活2瓶、非整數／不在背包拒絕，保存計畫取消準備", async () => {
    const f = fixture(); withInventory(f); const s = await setup(f);
    await assert.rejects(s.setPotions("party-test-1", { [ids[0]]: 11 }), /10瓶/);
    await assert.rejects(s.setPotions("party-test-1", { [ids[3]]: 3 }), /2瓶/);
    await assert.rejects(s.setPotions("party-test-1", { [ids[0]]: 1.2 }), /不正確/);
    await assert.rejects(s.setPotions("party-test-1", { [ids[1]]: 1 }), /不足/);
    await s.setPotions("party-test-1", { [ids[0]]: 8, [ids[3]]: 2 });
    assert.equal((await s.getState("party-test-1")).members[0].ready, false);
    assert.equal(f.players.get("party-test-1").inventory[0].stackCount, 20); await s.disband("party-test-1");
  });
  await check("每怪整備可用實際背包藥、回復80HP、同時重送只扣1瓶", async () => {
    const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight; const s = await readyRun(f); const r = await s.getState("party-test-1");
    await Promise.all([s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r)), s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r))]);
    const after = await s.getState("party-test-1"); assert.equal(after.members[0].hp, r.members[0].hp + 80); assert.equal(after.potionPouch[0].remaining, 7);
    assert.equal(f.players.get("party-test-1").inventory[0].stackCount, 19); assert.equal(f.players.get("party-test-1").inventory.find(e => e.uuid === "keep").stackCount, 7);
    assert.equal(f.players.get("party-test-1").partyPotionReceipts.length, 1); await s.disband("party-test-1");
  });
  await check("復活需藥且由存活隊友使用、按現有30%效果復活並重置策略確認", async () => {
    const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight; const s = await readyRun(f); const r = await s.getState("party-test-1");
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-2", req(r)), /復活藥/);
    await assert.rejects(s.usePartyItem("party-test-2", ids[3], "party-test-2", req(r)), /倒地者不能/);
    await s.usePartyItem("party-test-1", ids[3], "party-test-2", req(r));
    const revived = await s.getState("party-test-2"); assert.equal(revived.members[1].hp, Math.round(revived.members[1].maxHp * .3));
    assert.equal(revived.strategyControls.confirmed, false); assert.equal(f.players.get("party-test-1").inventory[1].stackCount, 4);
    await s.disband("party-test-1");
  });
  await check("戰鬥runId、結束後、滿血／不適用目標及途中加帶拒絕，不扣藥", async () => {
    const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight; const s = await readyRun(f); const r = await s.getState("party-test-1");
    await assert.rejects(s.setPotions("party-test-1", {}), /途中不能/);
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", { ...req(r), runId: "stale" }), /副本/);
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-3", req(r)), /已滿/);
    await assert.rejects(s.usePartyItem("party-test-1", ids[3], "party-test-1", req(r)), /尚未倒地/);
    [...f.rooms.values()][0].status = "ended"; await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r)), /副本/);
    assert.equal(f.players.get("party-test-1").inventory[0].stackCount, 20); await s.disband("party-test-1");
  });
  await check("用完不能補帶、購買新UUID藥水不能冒充帶入藥水", async () => {
    const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight; const s = await readyRun(f); const r = await s.getState("party-test-1");
    f.players.get("party-test-1").inventory = [{ uuid: "new-stack", itemId: ids[0], stackCount: 20 }];
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r)), /途中不能/); await s.disband("party-test-1");
  });
  await check("八瓶回血及兩瓶復活額度用完即拒絕；非法識別碼／外隊目標不扣藥", async () => {
    const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight; const s = await readyRun(f); const r = await s.getState("party-test-1");
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", { ...req(r), operationId: 12345678 }), /識別碼/);
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "outside", req(r)), /不存在/);
    for (let i = 0; i < 8; i++) {
      f.advance(10000);
      [...f.rooms.values()][0].members[0].currentHp = 100;
      await s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r, `heal-operation-${i}`));
    }
    f.advance(10000);
    [...f.rooms.values()][0].members[0].currentHp = 100;
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r, "heal-operation-more")), /途中不能/);
    for (let i = 0; i < 2; i++) {
      f.advance(10000);
      [...f.rooms.values()][0].members[1].currentHp = 0;
      await s.usePartyItem("party-test-1", ids[3], "party-test-2", req(r, `revive-operation-${i}`));
    }
    f.advance(10000);
    [...f.rooms.values()][0].members[1].currentHp = 0;
    await assert.rejects(s.usePartyItem("party-test-1", ids[3], "party-test-2", req(r, "revive-operation-more")), /途中不能/);
    assert.equal(f.players.get("party-test-1").inventory[0].stackCount, 12);
    assert.equal(f.players.get("party-test-1").inventory[1].stackCount, 3);
    assert.equal((await s.getState("party-test-1")).potionPouch.reduce((sum, e) => sum + e.remaining, 0), 0); await s.disband("party-test-1");
  });
  for (const afterConsume of [false, true]) await check(`重啟恢復持久化用藥意圖（${afterConsume ? "已扣藥" : "未扣藥"}），不重扣或漏加HP`, async () => {
    const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight; let s = await readyRun(f); const r = await s.getState("party-test-1");
    const save = f.sc.partyTowerRepository.save, progressSave = f.sc.progressRepository.saveIfUnchanged;
    if (afterConsume) f.sc.partyTowerRepository.save = async (room, version) => { if (!room.pendingPotion && room.potionReceipts?.length) throw Error("simulated room write outage"); return save(room, version); };
    else f.sc.progressRepository.saveIfUnchanged = async () => { throw Error("simulated inventory outage"); };
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r)), /outage/);
    assert.ok([...f.rooms.values()][0].pendingPotion);
    f.sc.partyTowerRepository.save = save; f.sc.progressRepository.saveIfUnchanged = progressSave;
    s.close(); s = createPartyTowerRooms(f.sc, f.opts); await s.tick();
    const after = await s.getState("party-test-1"); assert.equal(after.members[0].hp, r.members[0].hp + 80); assert.equal(after.potionPouch[0].remaining, 7);
    assert.equal(f.players.get("party-test-1").inventory[0].stackCount, 19); assert.equal(f.players.get("party-test-1").partyPotionReceipts.length, 1); await s.disband("party-test-1");
  });
  await check("用藥者10秒冷卻、目標10秒互斥；同時兩人给同一人只扣一瓶，重啟保留鎖", async () => {
    const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight;
    f.players.get("party-test-3").inventory = [{ uuid: "third-heal", itemId: ids[0], stackCount: 10 }];
    let s = await setup(f, "normal", 3);
    await s.setPotions("party-test-1", { [ids[0]]: 8 }); await s.setPotions("party-test-3", { [ids[0]]: 8 });
    for (const id of ["party-test-1", "party-test-2", "party-test-3"]) await s.setReady(id);
    await s.startRoom("party-test-1"); await s.tick(); const r = await s.getState("party-test-1");
    const both = await Promise.allSettled([s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r, "first-operation")), s.usePartyItem("party-test-3", ids[0], "party-test-1", req(r, "second-operation"))]);
    assert.equal(both.filter(v => v.status === "fulfilled").length, 1);
    assert.match(both.find(v => v.status === "rejected").reason.message, /目標剛接受/);
    assert.equal(f.players.get("party-test-3").inventory[0].stackCount, 10);
    await s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r, "first-operation")); // receipt replay ignores cooldown, never adds HP twice
    await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r, "other-operation")), /冷卻/);
    s.close(); s = createPartyTowerRooms(f.sc, f.opts); f.advance(9999);
    await assert.rejects(s.usePartyItem("party-test-3", ids[0], "party-test-1", req(r, "third-operation")), /目標剛接受/);
    f.advance(1); await s.usePartyItem("party-test-3", ids[0], "party-test-1", req(r, "third-operation"));
    assert.equal(f.players.get("party-test-1").inventory[0].stackCount, 19); assert.equal(f.players.get("party-test-3").inventory[0].stackCount, 9);
    await s.disband("party-test-1");
  });
  if (process.argv.includes("--mongo")) await check("隔離Mongo實際扣藥CAS、防重及重啟恢復，不改正式玩家", async () => {
    require("dotenv").config({ quiet: true });
    const { MongoClient } = require("mongodb"); const client = await MongoClient.connect(process.env.MONGODB_URI);
    const database = `party_potions_verification_${Date.now()}`, db = client.db(database);
    try {
      const f = fixture(); withInventory(f); f.opts.fightFloor = fakeFight;
      const season = require("../src/services/access/seasonStateStore"); await season.ensureLoaded();
      await db.collection("progress").insertMany([...f.players.values()].map(p => ({ ...p, seasonKey: season.getActiveKey() })));
      await db.collection("partyTowerRooms").createIndex({ activePlayers: 1 }, { unique: true, partialFilterExpression: { active: true } });
      f.sc.partyTowerRepository = require("../src/adapters/mongo/createPartyTowerRepository").createPartyTowerRepository({ collection: async name => db.collection(name) });
      f.sc.progressRepository = { findByPlayerId: id => db.collection("progress").findOne({ playerId: id }),
        saveIfUnchanged: async (p, old) => { const next = { ...p }; delete next._id; return (await db.collection("progress").updateOne({ playerId: p.playerId, updatedAt: old }, { $set: next })).matchedCount === 1; } };
      // Stop after recovery; settlement is tested separately by the existing room suite.
      let s = await readyRun(f); const r = await s.getState("party-test-1");
      const save = f.sc.partyTowerRepository.save;
      f.sc.partyTowerRepository.save = async (room, version) => { if (!room.pendingPotion && room.potionReceipts?.length) throw Error("room outage"); return save(room, version); };
      await assert.rejects(s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r)), /outage/);
      f.sc.partyTowerRepository.save = save; s.close(); s = createPartyTowerRooms(f.sc, f.opts); await s.tick();
      await s.usePartyItem("party-test-1", ids[0], "party-test-1", req(r));
      const p = await f.sc.progressRepository.findByPlayerId("party-test-1");
      assert.equal(p.inventory[0].stackCount, 19); assert.equal(p.partyPotionReceipts.length, 1);
      assert.equal((await s.getState("party-test-1")).members[0].hp, r.members[0].hp + 80); s.close();
      checks.push({ name: "隔離Mongo證據資料庫保留", ok: true, database });
    } finally { await client.close(); }
  });
  const output = process.argv.find(x => x.startsWith("--output="))?.slice(9);
  const report = { generatedAt: new Date().toISOString(), source: "current service and persistent potion journal; isolated player fixtures", checks };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
  checks.forEach(c => console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.error ? ": " + c.error : ""}`));
  process.exit(checks.some(c => !c.ok) ? 1 : 0);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
