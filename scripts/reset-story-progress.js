"use strict";
/**
 * 只清「劇情進度 + 新手教學(onboarding)」——把玩家打回「新玩家劇情狀態」以便反覆測試，
 * 不動等級/職業/裝備/背包/金幣。跟賽季重製無關，純測試工具。
 *
 * 清除內容：
 *   - progress.storyProgress（completed/battlesWon/grantedItems）→ 序章+各章回到未完成，
 *     下次登入 PrologueGate 會強制重播序章；區域閘門/🎁劇情發道具冪等也重置。
 *   - weeklyQuestProgress 內該玩家「onboarding」cadence 的進度 → 新手任務重來。
 *
 * 預設 dry-run（只印不寫）。加 APPLY=1 才真的寫入。
 *
 * 用法：
 *   PLAYER_ID=<discordId> node scripts/reset-story-progress.js              # dry-run 單一玩家
 *   APPLY=1 PLAYER_ID=<discordId> node scripts/reset-story-progress.js      # 真的清單一玩家
 *   node scripts/reset-story-progress.js                                    # dry-run 全部玩家
 *   APPLY=1 node scripts/reset-story-progress.js                            # 真的清全部玩家（危險）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.env.APPLY === "1";
const PLAYER_ID = process.env.PLAYER_ID || null;

async function main() {
  const db = await getMongoDb();
  const progressCol = db.collection("progress");
  const wqpCol = db.collection("weeklyQuestProgress");
  const wqCol = db.collection("weeklyQuests");

  // 找出所有 onboarding 任務 id（新手任務用），供計數/刪除比對
  const onboardIds = new Set(
    (await wqCol.find({ cadence: "onboarding" }).project({ id: 1, _id: 0 }).toArray()).map((q) => q.id)
  );

  const query = PLAYER_ID ? { playerId: PLAYER_ID } : {};
  const players = await progressCol.find(query).project({ playerId: 1, level: 1, storyProgress: 1 }).toArray();

  console.log(`模式：${APPLY ? "🔴 APPLY（會寫入）" : "🟢 DRY-RUN（只印不寫）"}`);
  console.log(`目標：${PLAYER_ID ? `單一玩家 ${PLAYER_ID}` : "全部玩家"}，共 ${players.length} 筆 progress\n`);

  let n = 0;
  for (const p of players) {
    const pid = p.playerId;
    const done = Object.keys(p.storyProgress?.completed || {});
    const won = Object.keys(p.storyProgress?.battlesWon || {});

    // 新手任務進度：找該玩家在 onboarding 任務上的 weeklyQuestProgress 筆數
    const wqpRows = await wqpCol.find({ discordId: pid }).project({ questId: 1, _id: 0 }).toArray();
    const onboardRows = wqpRows.filter((r) => onboardIds.has(r.questId));

    if (APPLY) {
      await progressCol.updateOne({ _id: p._id }, { $unset: { storyProgress: "" } });
      if (onboardIds.size) await wqpCol.deleteMany({ discordId: pid, questId: { $in: [...onboardIds] } });
    }

    console.log(
      `[${APPLY ? "DONE" : "DRY"}] ${pid}｜Lv${p.level}｜劇情已完成 ${done.length} 章(${done.join(",") || "無"})→0｜戰鬥勝 ${won.length}→0｜新手任務進度 ${onboardRows.length}→0`
    );
    n++;
  }

  console.log(`\n小結：處理 ${n} 名玩家。${APPLY ? "已寫入。" : "這是 dry-run，未寫入；確認無誤後加 APPLY=1。"}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
