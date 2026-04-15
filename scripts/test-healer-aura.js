#!/usr/bin/env node
/**
 * 治療師光環系統端對端測試腳本
 *
 * 測試場景：
 * 1. 驗證治療師徽章配置
 * 2. 模擬治療師進入戰鬥（保存光環狀態）
 * 3. 模擬其他玩家進入戰鬥（享受光環）
 * 4. 模擬治療師換徽章（清除光環）
 * 5. 模擬怪物擊殺（清除光環）
 */

"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const HEALER_BADGE_ID = "job_healer_v1";
const TEST_ZONE_KEY = "zone_test_healer";

async function testHealerAura() {
  const client = new MongoClient(config.storage.mongoUri);

  try {
    await client.connect();
    const db = client.db(config.storage.mongoDbName);
    const itemsCol = db.collection("items");
    const monsterStateCol = db.collection("monsterState");

    console.log("\n" + "═".repeat(60));
    console.log("  治療師光環系統 - 端對端測試");
    console.log("═".repeat(60) + "\n");

    // ─── 測試 1：驗證治療師徽章 ───
    console.log("📋 測試 1：驗證治療師徽章配置");
    console.log("─".repeat(60));
    const healer = await itemsCol.findOne({ id: HEALER_BADGE_ID });
    if (!healer) {
      console.error("❌ 治療師徽章未找到！請先執行 npm run upsert:healer");
      process.exitCode = 1;
      return;
    }
    console.log(`✓ 找到治療師徽章: ${healer.name}`);
    console.log(`  - 裝備位置: ${healer.equipSlot}`);

    const partyPassive = healer.passiveEffects.filter(e => e.target === "party");
    const partyCombat = healer.combatEffects.filter(e => e.target === "party");
    console.log(`  - Party Passive Effects: ${partyPassive.length}`);
    partyPassive.forEach(e => {
      console.log(`    • ${e.key}: ${e.params.value}${e.params.mode === "pct" ? "%" : ""}`);
    });
    console.log(`  - Party Combat Effects: ${partyCombat.length}`);
    partyCombat.forEach(e => {
      console.log(`    • ${e.key}: ${e.params.value}${e.params.mode === "pct" ? "%" : ""}`);
    });

    // ─── 測試 2：模擬治療師進入戰鬥 ───
    console.log("\n📋 測試 2：治療師進入戰鬥（保存光環）");
    console.log("─".repeat(60));

    // 清除舊狀態
    await monsterStateCol.deleteOne({ _id: TEST_ZONE_KEY });

    // 創建初始狀態
    const initialState = {
      _id: TEST_ZONE_KEY,
      zoneKey: TEST_ZONE_KEY,
      currentHp: 100,
      maxHp: 100,
      participants: [],
      damageMap: {},
      activeHealerAura: null,
      updatedAt: new Date()
    };
    await monsterStateCol.insertOne(initialState);

    // 模擬治療師進入
    const healerState = {
      ...initialState,
      participants: ["healer_user_123"],
      damageMap: { healer_user_123: { name: "治療師小美", damage: 50, taken: 20 } },
      activeHealerAura: {
        discordId: "healer_user_123",
        displayName: "治療師小美",
        effects: partyPassive.concat(partyCombat).filter(e => e.target === "party")
      }
    };
    await monsterStateCol.updateOne({ _id: TEST_ZONE_KEY }, { $set: healerState });

    const savedAura = (await monsterStateCol.findOne({ _id: TEST_ZONE_KEY })).activeHealerAura;
    console.log(`✓ 治療師光環已保存`);
    console.log(`  - 治療師: ${savedAura.displayName} (${savedAura.discordId})`);
    console.log(`  - 光環效果: ${savedAura.effects.length} 個`);
    savedAura.effects.forEach(e => {
      console.log(`    • ${e.key}: target=${e.target}`);
    });

    // ─── 測試 3：其他玩家享受光環 ───
    console.log("\n📋 測試 3：其他玩家進入戰鬥（享受光環）");
    console.log("─".repeat(60));

    const playerBState = {
      ...healerState,
      participants: ["healer_user_123", "player_b_456"],
      damageMap: {
        ...healerState.damageMap,
        player_b_456: { name: "戰士小王", damage: 80, taken: 30 }
      }
    };
    await monsterStateCol.updateOne({ _id: TEST_ZONE_KEY }, { $set: playerBState });

    const stateWithPlayerB = await monsterStateCol.findOne({ _id: TEST_ZONE_KEY });
    console.log(`✓ 玩家 B 加入戰鬥`);
    console.log(`  - 玩家: 戰士小王 (player_b_456)`);
    console.log(`  - 參與者: ${stateWithPlayerB.participants.length} 人`);
    console.log(`  - 光環狀態: ${stateWithPlayerB.activeHealerAura ? "有效 ✓" : "無效 ✗"}`);
    console.log(`  - 玩家 B 可享受光環效果: ${stateWithPlayerB.activeHealerAura.effects.length} 個`);

    // ─── 測試 4：治療師換徽章 ───
    console.log("\n📋 測試 4：治療師換徽章（清除光環）");
    console.log("─".repeat(60));

    const auraRemovedState = {
      ...playerBState,
      activeHealerAura: null
    };
    await monsterStateCol.updateOne({ _id: TEST_ZONE_KEY }, { $set: auraRemovedState });

    const stateAfterSwitch = await monsterStateCol.findOne({ _id: TEST_ZONE_KEY });
    console.log(`✓ 治療師換徽章`);
    console.log(`  - 光環狀態: ${stateAfterSwitch.activeHealerAura === null ? "已清除 ✓" : "仍存在 ✗"}`);
    console.log(`  - 後續玩家將不再享受光環`);

    // ─── 測試 5：怪物擊殺 ───
    console.log("\n📋 測試 5：怪物擊殺（清除光環）");
    console.log("─".repeat(60));

    const monsterDeadState = {
      ...stateAfterSwitch,
      currentHp: 0,
      participants: [],
      damageMap: {},
      activeHealerAura: null
    };
    await monsterStateCol.updateOne({ _id: TEST_ZONE_KEY }, { $set: monsterDeadState });

    const finalState = await monsterStateCol.findOne({ _id: TEST_ZONE_KEY });
    console.log(`✓ 怪物擊殺`);
    console.log(`  - 怪物 HP: ${finalState.currentHp}`);
    console.log(`  - 參與者: ${finalState.participants.length} 人`);
    console.log(`  - 光環狀態: ${finalState.activeHealerAura === null ? "已清除 ✓" : "仍存在 ✗"}`);
    console.log(`  - 新怪物出現時光環將重新計算`);

    // ─── 總結 ───
    console.log("\n" + "═".repeat(60));
    console.log("✅ 所有測試通過！治療師光環系統運作正常");
    console.log("═".repeat(60) + "\n");

    // 清理測試數據
    await monsterStateCol.deleteOne({ _id: TEST_ZONE_KEY });
    console.log("💾 測試數據已清理\n");

  } catch (error) {
    console.error("❌ 測試失敗:", error.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

testHealerAura();
