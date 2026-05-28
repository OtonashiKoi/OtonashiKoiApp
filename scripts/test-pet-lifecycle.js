"use strict";
/**
 * 寵物生命週期測試（純 service 層，用真實 DB 但操作測試帳號）
 * 驗證：蛋孵化 → 餵食(飽食先滿再轉exp) → 升級 → 採集累積/cap/階級 → 飢餓掉等 → 出戰/改名
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");

const TEST_PLAYER_ID = "pet-test-" + Date.now();

function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); process.exitCode = 1; }
}

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const pet = sc.petService;

  // ── 準備：建立測試玩家 progress，塞一些裝備 + 一顆蛋 ──
  const eggItem = await db.collection("items").findOne({ itemType: "pet_egg", name: "火苗龍蛋" });
  if (!eggItem) { console.error("找不到火苗龍蛋，請先跑 create-pet-eggs-and-species.js"); process.exit(1); }

  // 撈各階裝備各幾件當飼料
  const dGear = await db.collection("items").find({ itemType: "equipment", tier: "D" }).limit(1).toArray();
  const aGear = await db.collection("items").find({ itemType: "equipment", tier: "A" }).limit(1).toArray();

  const mkInv = (item, n) => Array.from({ length: n }, () => ({
    uuid: require("crypto").randomUUID(),
    itemId: item.id, itemName: item.name, itemType: "equipment",
    tier: item.tier, equipSlot: item.equipSlot, enhanceLevel: 0,
  }));

  const inventory = [
    { uuid: "egg-1", itemId: eggItem.id, itemName: eggItem.name, itemType: "pet_egg", petId: eggItem.petId, stackCount: 1 },
    ...mkInv(dGear[0], 30),  // 30 件 D（孵化要 800/40=20 件）
    ...mkInv(aGear[0], 5),   // 5 件 A
  ];

  await db.collection("progress").updateOne(
    { playerId: TEST_PLAYER_ID },
    { $set: { playerId: TEST_PLAYER_ID, level: 40, exp: 0, job: "Novice", attributes: {}, equipment: {}, inventory, pets: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() } },
    { upsert: true }
  );

  console.log(`\n測試玩家：${TEST_PLAYER_ID}`);
  console.log("═".repeat(70));

  try {
    // ── 1. 從蛋孵起 ──
    console.log("\n[1] 從 inventory 孵蛋");
    const hatch = await pet.hatchEggFromInventory(TEST_PLAYER_ID, "egg-1");
    assert(hatch.pet.stage === "egg", "蛋實例建立 (stage=egg)");
    const petUuid = hatch.pet.uuid;

    // ── 2. 餵 D 裝孵化（20 件 D × 40 = 800 = 門檻）──
    console.log("\n[2] 批量餵 D 裝孵化");
    const feed1 = await pet.feedPet(TEST_PLAYER_ID, petUuid, { tier: "D" });
    assert(feed1.hatched === true, `餵 30 件 D 後孵化 (hatchExp 累積 ${feed1.totalHatch})`);
    assert(feed1.pet.stage === "grown", "孵化後 stage=grown");
    assert(feed1.pet.level === 1, "孵化後 Lv.1");

    // ── 3. 餵食：飽食先滿、滿後才轉成長 exp ──
    console.log("\n[3] 驗證飽食度優先、滿後轉 exp");
    let st = await pet.getPetState(TEST_PLAYER_ID);
    let p = st.active;
    console.log(`    孵化後飽食=${p.satiety}/${p.satietyMax}（孵化給滿）`);
    // 補一些 A 裝（孵化後 inventory 還有 5 件 A）
    const feedA = await pet.feedPet(TEST_PLAYER_ID, petUuid, { tier: "A" });
    console.log(`    餵 5 件 A：補飽食 ${feedA.totalSatiety}、轉成長 exp ${feedA.totalGrowth}`);
    assert(feedA.totalGrowth > 0 || feedA.pet.satiety === p.satietyMax, "飽食滿時 A 裝轉成長 exp（或維持滿）");

    // ── 4. 採集：手動推進時間驗證累積 ──
    console.log("\n[4] 採集累積（模擬 lastSettleAt 往前 3 小時）");
    // 直接改 DB 的 lastSettleAt 模擬時間流逝
    const prog = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
    const targetPet = prog.pets.find((x) => x.uuid === petUuid);
    targetPet.lastSettleAt = Date.now() - 3 * 3600_000; // 3 小時前
    targetPet.lastSatietyAt = Date.now();                // 飽食剛補，不衰減
    targetPet.satiety = 100;
    await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: prog.pets } });

    st = await pet.getPetState(TEST_PLAYER_ID);
    p = st.active;
    console.log(`    3 小時 → 累積 ${p.gatherCount} 個（預期 9 = 3hr×3/hr）`);
    assert(p.gatherCount === 9, "3 小時累積 9 個");
    assert(p.producesTier === "D", "Lv.1 寵物採集階級 = D（依寵物等級非玩家等級）");

    // 額外驗證：把寵物拉到 Lv.40 → 採集階級 = B
    const progT = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
    progT.pets.find((x) => x.uuid === petUuid).level = 40;
    await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: progT.pets } });
    st = await pet.getPetState(TEST_PLAYER_ID);
    assert(st.active.producesTier === "B", "Lv.40 寵物採集階級 = B");

    // ── 5. 採集 cap 驗證（推 10 小時應 cap 在 18）──
    console.log("\n[5] 採集 cap（模擬 10 小時）");
    const prog2 = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
    const tp2 = prog2.pets.find((x) => x.uuid === petUuid);
    tp2.lastSettleAt = Date.now() - 10 * 3600_000;
    tp2.lastSatietyAt = Date.now();
    tp2.satiety = 100;
    tp2.accruedItems = [];
    await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: prog2.pets } });
    st = await pet.getPetState(TEST_PLAYER_ID);
    assert(st.active.gatherCount === 18, `10 小時 cap 在 18（實際 ${st.active.gatherCount}）`);

    // ── 6. 領取採集 → 道具進 inventory ──
    console.log("\n[6] 領取採集");
    const claim = await pet.claimGathering(TEST_PLAYER_ID);
    console.log(`    領取 ${claim.granted.length} 個：${claim.granted.slice(0,3).map(g=>`${g.tier}${g.kind==="gem"?"寶石":"裝備"}`).join("、")}...`);
    assert(claim.granted.length === 18, "領取 18 個道具");
    assert(claim.pet.gatherCount === 0, "領取後累積歸零");
    const gemCount = claim.granted.filter(g => g.kind === "gem").length;
    console.log(`    強化石 ${gemCount} / 裝備 ${18 - gemCount}（預期 ~70% 寶石）`);

    // ── 7. 飢餓掉等（模擬餓 15 小時：超過 12h grace + 餓 3h）──
    console.log("\n[7] 飢餓掉等（模擬餓 24 小時）");
    const prog3 = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
    const tp3 = prog3.pets.find((x) => x.uuid === petUuid);
    tp3.level = 10;
    tp3.satiety = 0;
    tp3.lastSatietyAt = Date.now() - 24 * 3600_000;  // 24 小時沒餵
    await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: prog3.pets } });
    st = await pet.getPetState(TEST_PLAYER_ID);
    console.log(`    餓 24 小時後：Lv.${st.active.level}（原 10，應掉等）`);
    assert(st.active.level < 10, "餓肚子後掉等");

    // ── 8. 改名 + 出戰 ──
    console.log("\n[8] 改名 + 出戰");
    const rn = await pet.renamePet(TEST_PLAYER_ID, petUuid, "小火球");
    assert(rn.pet.nickname === "小火球", "改名成功");
    const sa = await pet.setActivePet(TEST_PLAYER_ID, petUuid);
    assert(sa.activePetUuid === petUuid, "設定出戰成功");

    // ── 9. 放生（無回饋、移除寵物、清空出戰指標）──
    console.log("\n[9] 放生");
    const rel = await pet.releasePet(TEST_PLAYER_ID, petUuid);
    assert(rel.released.uuid === petUuid, "放生回傳被移除的寵物");
    const after = await pet.getPetState(TEST_PLAYER_ID);
    assert(after.pets.length === 0, "放生後寵物清單為空");
    assert(after.activePetUuid === null, "放生出戰寵物後 activePetUuid 清空");

  } finally {
    // 清掉測試玩家
    await db.collection("progress").deleteOne({ playerId: TEST_PLAYER_ID });
    console.log("\n（已清除測試玩家）");
  }

  console.log("═".repeat(70));
  console.log(process.exitCode ? "❌ 有測試失敗" : "✅ 全部通過");
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1); });
