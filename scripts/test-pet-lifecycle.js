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
  const eggItem = await db.collection("items").findOne({ itemType: "pet_egg", name: "神秘龍蛋" });
  if (!eggItem) { console.error("找不到神秘龍蛋，請先跑 redesign-pet-eggs-unified.js"); process.exit(1); }

  // 撈各階裝備各幾件當飼料
  const dGear = await db.collection("items").find({ itemType: "equipment", tier: "D" }).limit(1).toArray();
  const bGear = await db.collection("items").find({ itemType: "equipment", tier: "B" }).limit(1).toArray();
  const aGearArr = await db.collection("items").find({ itemType: "equipment", tier: "A" }).limit(1).toArray();
  const aGear0 = aGearArr[0];

  const mkInv = (item, n) => Array.from({ length: n }, () => ({
    uuid: require("crypto").randomUUID(),
    itemId: item.id, itemName: item.name, itemType: "equipment",
    tier: item.tier, equipSlot: item.equipSlot, enhanceLevel: 0,
  }));

  const inventory = [
    { uuid: "egg-1", itemId: eggItem.id, itemName: eggItem.name, itemType: "pet_egg", petId: null, stackCount: 1 },
    ...mkInv(dGear[0], 30),  // 30 件 D（孵化：蛋對應 D，餵 D 全額 40，800/40=20 件）
    ...mkInv(bGear[0], 10),  // 10 件 B（Lv.40 寵物對應 B，測等級對應餵食）
  ];

  await db.collection("progress").updateOne(
    { playerId: TEST_PLAYER_ID },
    { $set: { playerId: TEST_PLAYER_ID, level: 40, exp: 0, job: "Novice", attributes: {}, equipment: {}, inventory, pets: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() } },
    { upsert: true }
  );

  console.log(`\n測試玩家：${TEST_PLAYER_ID}`);
  console.log("═".repeat(70));

  try {
    // ── 1. 從神秘蛋孵起 ──
    console.log("\n[1] 從 inventory 孵神秘蛋");
    const hatch = await pet.hatchEggFromInventory(TEST_PLAYER_ID, "egg-1");
    assert(hatch.pet.stage === "egg", "蛋實例建立 (stage=egg)");
    assert(hatch.pet.speciesName === null, "蛋階段不揭曉種類 (speciesName=null)");
    const petUuid = hatch.pet.uuid;

    // ── 2. 餵 D 裝孵化 → 隨機開獎決定種類 ──
    console.log("\n[2] 批量餵 D 裝孵化（隨機開獎）");
    const feed1 = await pet.feedPet(TEST_PLAYER_ID, petUuid, { tier: "D" });
    assert(feed1.hatched === true, `餵 30 件 D 後孵化 (hatchExp 累積 ${feed1.totalHatch})`);
    assert(feed1.pet.stage === "grown", "孵化後 stage=grown");
    assert(feed1.pet.level === 1, "孵化後 Lv.1");
    assert(!!feed1.hatchedSpecies, `孵化開出種類：${feed1.hatchedSpecies}`);
    assert(!!feed1.pet.speciesName, `孵化後揭曉品種 (speciesName=${feed1.pet.speciesName})`);
    assert(feed1.pet.gatherIntervalMin > 0, `gatherMod 已套用（採集間隔 ${feed1.pet.gatherIntervalMin} 分）`);

    // 開獎分布抽樣（孵 200 顆看是否 5 種都出得來、約略平均）
    console.log("\n[2b] 開獎分布抽樣（孵 200 次）");
    const dist = {};
    for (let i = 0; i < 200; i++) {
      const sp = await pet._rollSpecies();
      dist[sp.name] = (dist[sp.name] || 0) + 1;
    }
    console.log("    " + Object.entries(dist).map(([k, v]) => `${k}:${v}`).join("  "));
    assert(Object.keys(dist).length === 5, "5 種龍都能開出");

    // ── 2c. 各龍採集差異（同樣 3 小時，比較產出數量/品質）──
    console.log("\n[2c] 各龍採集差異（同樣 3 小時，固定 Lv.20）");
    const speciesDefs = await db.collection("pets").find({}).toArray();
    for (const sp of speciesDefs.sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
      const prog0 = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
      const tp0 = prog0.pets.find((x) => x.uuid === petUuid);
      tp0.level = 20; tp0.satiety = 100; tp0.accruedItems = [];
      tp0.gatherMod = sp.gather; tp0.speciesName = sp.name;
      tp0.lastSettleAt = Date.now() - 3 * 3600_000; tp0.lastSatietyAt = Date.now();
      await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: prog0.pets } });
      const s0 = await pet.getPetState(TEST_PLAYER_ID);
      const ac = s0.active.gatherCount;
      // 統計品質（高一階）需直接看 accruedItems
      const prog1 = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
      const items = prog1.pets.find((x) => x.uuid === petUuid).accruedItems;
      const gemN = items.filter((i) => i.kind === "gem").length;
      const upN = items.filter((i) => i.tier === "C").length; // Lv.20 基礎 C，高一階=B... 修正：Lv.20→C，up→B
      const baseTier = "C", upTier = "B";
      const upCount = items.filter((i) => i.tier === upTier).length;
      console.log(`    ${sp.name.padEnd(4)} 間隔×${sp.gather.intervalMult} → 3hr 採 ${ac} 個｜石 ${gemN}/${items.length}｜高一階(${upTier}) ${upCount}`);
    }
    assert(true, "各龍採集差異已輸出（速度/產出偏好/高一階）");

    // ── 3. 等級對應餵食：把寵物拉到 Lv.40（對應 B），餵 B 全額、餵 D 折扣、餵 A 拒絕 ──
    console.log("\n[3] 等級對應餵食（Lv.40 寵物對應 B 階）");
    {
      const prog = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
      const tp = prog.pets.find((x) => x.uuid === petUuid);
      tp.level = 40; tp.satiety = 0; // 飽食歸零，先看補飽食
      // 補飼料（前面孵化已吃光），各階各 10 件
      const crypto = require("crypto");
      const mk = (item, n) => Array.from({ length: n }, () => ({ uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name, itemType: "equipment", tier: item.tier, equipSlot: item.equipSlot, enhanceLevel: 0 }));
      prog.inventory.push(...mk(bGear[0], 10), ...mk(dGear[0], 10), ...mk(aGear0, 3));
      await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: prog.pets, inventory: prog.inventory } });
    }
    let st = await pet.getPetState(TEST_PLAYER_ID);
    assert(st.active.feedTier === "B", `Lv.40 對應餵食階級 = B（實際 ${st.active.feedTier}）`);
    // 餵 B（對應，全額 40/30）
    const feedB = await pet.feedPet(TEST_PLAYER_ID, petUuid, { tier: "B" });
    console.log(`    餵 10 件 B：補飽食 ${feedB.totalSatiety}、成長 exp ${feedB.totalGrowth}（B=對應階級，每件 40exp/30飽食）`);
    assert(feedB.totalSatiety > 0, "B 裝先補飽食度");
    assert(feedB.totalGrowth > 0, "飽食滿後 B 裝轉成長 exp");
    // 餵 D（低 2 階，30% 折扣）
    const feedD = await pet.feedPet(TEST_PLAYER_ID, petUuid, { tier: "D" });
    const perD = feedD.fed ? Math.round((feedD.totalGrowth + feedD.totalSatiety) / feedD.fed) : 0;
    console.log(`    餵 D（低 2 階）：每件效益約 ${perD}（應為對應階的 30%）`);
    assert(feedD.fed > 0, "低階 D 裝仍可餵（折扣後）");
    // 餵 A（高於對應 B）→ 應拒絕（先固定回 Lv.40，避免前面餵 B 升級到對應 A）
    {
      const prog = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
      prog.pets.find((x) => x.uuid === petUuid).level = 40;
      await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: prog.pets } });
    }
    let aRejected = false;
    try { await pet.feedPet(TEST_PLAYER_ID, petUuid, { tier: "A" }); }
    catch (e) { aRejected = true; }
    assert(aRejected, "高階 A 裝餵 Lv.40(對應B) 寵物被拒絕");

    // ── 3b. 餵食保護：強化裝 / 特效裝 / 卡片不被一鍵餵到 ──
    console.log("\n[3b] 一鍵餵食保護（強化/特效/卡片）");
    {
      const crypto = require("crypto");
      const prog = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
      // 清掉 B 裝避免干擾，放入：2 件純 B（可餵）+ 1 件 +5 B（強化保護）+ 1 件帶特效 B + 1 張 B 卡
      prog.inventory = prog.inventory.filter((x) => !(x.itemType === "equipment" && x.tier === "B"));
      const plain = (n) => Array.from({ length: n }, () => ({ uuid: crypto.randomUUID(), itemId: bGear[0].id, itemName: bGear[0].name, itemType: "equipment", tier: "B", equipSlot: bGear[0].equipSlot, enhanceLevel: 0 }));
      prog.inventory.push(...plain(2));
      prog.inventory.push({ uuid: "enh-1", itemId: bGear[0].id, itemName: bGear[0].name + "+5", itemType: "equipment", tier: "B", equipSlot: bGear[0].equipSlot, enhanceLevel: 5 });
      prog.inventory.push({ uuid: "fx-1", itemId: "fx", itemName: "特效B戒", itemType: "equipment", tier: "B", equipSlot: "accessory_l", enhanceLevel: 0, passiveEffects: [{ key: "crit_rate_up", params: { value: 6 } }] });
      prog.inventory.push({ uuid: "card-1", itemId: "card", itemName: "某B卡", itemType: "equipment", tier: "B", equipSlot: "special", monsterCardOf: "x" });
      prog.pets.find((x) => x.uuid === petUuid).level = 40;
      prog.pets.find((x) => x.uuid === petUuid).satiety = 0;
      await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { inventory: prog.inventory, pets: prog.pets } });
    }
    // 一鍵：素的特效戒(+0)也會被吃，只有 +值/卡片受保護
    const feedProtect = await pet.feedPet(TEST_PLAYER_ID, petUuid, { tier: "B" });
    console.log(`    一鍵餵 B：實餵 ${feedProtect.fed} 件、保護 ${feedProtect.protectedCount} 件`);
    assert(feedProtect.fed === 3, "一鍵餵到 3 件素裝（2純 + 1素特效戒）");
    assert(feedProtect.protectedCount === 2, "有+值/卡片共 2 件一鍵被保護");
    // 確認被保護的（+5強化、卡片）還在背包
    const after3b = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
    const stillThere = ["enh-1", "card-1"].every((u) => after3b.inventory.some((x) => x.uuid === u));
    assert(stillThere, "強化裝(+5)/卡片一鍵後仍保留在背包");
    assert(!after3b.inventory.some((x) => x.uuid === "fx-1"), "素的特效戒(+0)一鍵被吃掉");

    // ── 3c. 強化裝可「單件」餵；卡片單件仍拒絕 ──
    console.log("\n[3c] 單件餵食：強化裝可餵、卡片拒絕");
    const feedEnh = await pet.feedPet(TEST_PLAYER_ID, petUuid, { inventoryUuid: "enh-1" });
    assert(feedEnh.fed === 1, "強化裝(+5)可單件手動餵");
    let cardRejected = false;
    try { await pet.feedPet(TEST_PLAYER_ID, petUuid, { inventoryUuid: "card-1" }); }
    catch (e) { cardRejected = true; }
    assert(cardRejected, "卡片單件餵仍被拒絕");

    // ── 4. 採集：手動推進時間驗證累積（固定標準 modifier 求確定性）──
    console.log("\n[4] 採集累積（模擬 3 小時，固定標準採集速度）");
    // 直接改 DB 的 lastSettleAt 模擬時間流逝
    const prog = await db.collection("progress").findOne({ playerId: TEST_PLAYER_ID });
    const targetPet = prog.pets.find((x) => x.uuid === petUuid);
    targetPet.level = 1;                                  // 重置 Lv.1（前面測試動過）
    targetPet.accruedItems = [];                          // 清空累積
    targetPet.gatherMod = { intervalMult: 1.0, gemBias: 0.7, qualityUpChance: 0 }; // 標準速度
    targetPet.lastSettleAt = Date.now() - 3 * 3600_000; // 3 小時前
    targetPet.lastSatietyAt = Date.now();                // 飽食剛補，不衰減
    targetPet.satiety = 100;
    await db.collection("progress").updateOne({ playerId: TEST_PLAYER_ID }, { $set: { pets: prog.pets } });

    st = await pet.getPetState(TEST_PLAYER_ID);
    const p = st.active;
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
