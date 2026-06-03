"use strict";
/**
 * 把古龍王(B) 世界王正確生成進 dragon_king_lair 區域狀態(含三部位 HP)。
 * 原因:玩家擊殺大史王後古龍王(B)已解鎖,但該區從未初始化 boss 狀態(monsterState 不存在)，
 * 導致面板顯示異常、沒有三部位可攻擊。此腳本比照 elite(大史王) 的狀態結構生成。
 * 三部位切法與 createWorldBossPartHpTemplate 一致:head 30% / body 40% / legs 餘。
 * 雙寫 monsters 內嵌(monsterState:<zone>) + legacy monsterState，與 saveState 相同。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZONE = "dragon_king_lair";

(async () => {
  const db = await getMongoDb();
  const boss = await db.collection("monsters").findOne({ zone: ZONE, isBoss: true, enabled: true });
  if (!boss) { console.error("找不到 dragon_king_lair 的 boss"); process.exit(1); }

  const maxHp = Math.max(1, Math.round(Number(boss.maxHp) || 1));
  // 古龍王 4 部位:頭 30% / 軀幹 30% / 龍翼 20% / 下盤 20%(與 createWorldBossPartHpTemplate 一致)
  const head = Math.max(1, Math.round(maxHp * 0.3));
  const body = Math.max(1, Math.round(maxHp * 0.3));
  const wings = Math.max(1, Math.round(maxHp * 0.2));
  const legs = Math.max(1, maxHp - head - body - wings);
  const parts = { head, body, wings, legs };
  const now = new Date().toISOString();

  const state = {
    activeMonsterSeq: boss.seq,
    currentHp: maxHp,
    worldBossPartsHp: { ...parts },
    worldBossPartsMaxHp: { ...parts },
    participants: [],
    damageMap: {},
    killCount: {},
    activeEvent: null,
    activeTransition: null,
    activeHealerAura: null,
    battleStartedAt: null,
    killClaimedSeq: null,
    killClaimedAt: null,
    lastHitAt: now,
    updatedAt: now,
  };

  // 雙寫(與 monsterRepository.saveState 相同)
  await db.collection("monsters").updateOne(
    { _id: `monsterState:${ZONE}` },
    { $set: { value: state, updatedAt: now } },
    { upsert: true }
  );
  await db.collection("monsterState").updateOne(
    { _id: ZONE },
    { $set: { value: state, updatedAt: now } },
    { upsert: true }
  );

  console.log(`已生成 ${boss.name} 到 ${ZONE}:seq=${boss.seq} maxHp=${maxHp}`);
  console.log(`  四部位 → 頭 ${head} / 軀幹 ${body} / 龍翼 ${wings} / 下盤 ${legs}(合計 ${head + body + wings + legs})`);
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
