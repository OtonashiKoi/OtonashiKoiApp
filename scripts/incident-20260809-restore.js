"use strict";
/**
 * 2026-08-09 開服事故還原：依交易紀錄回復 20:00~20:31:39 的玩家進度。
 *
 * 事故：mongorestore --nsTo 未生效 + --drop，把清檔前的 progress 蓋回正式站（20:31:39）。
 * 前置：已用 KEEP_LEDGER=1 APPLY=1 reset-players-season.js 重新清檔（保留任務進度/打卡）。
 *
 * 還原內容（LEGIT 窗口 = 開服 12:00:00Z ～ 誤還原 12:31:39Z）：
 *   ・金幣：窗口內交易逐筆淨額（monster:kill-reward / quest:reward / enhance:cost / …）→ 直接入帳
 *   ・商店購買：source=shop:purchase 的 sourceRef → 重新發道具（金幣已在淨額扣過）
 *   ・經驗：任務經驗**精確**（weeklyQuestProgress 領取紀錄 × 任務定義 rewardExp）
 *           打怪經驗**估算**（kill 次數 × 新手/一般區平均 expReward——交易只記金幣不記經驗，
 *           開服 30 分鐘玩家只可能在前兩區）→ 換算等級（progression 曲線）
 *   ・鑽石：錢包未被事故波及，維持現值（含窗口內 donation:reward）
 *
 * 用法：node scripts/incident-20260809-restore.js          # dry-run
 *       APPLY=1 node scripts/incident-20260809-restore.js  # 實際寫入
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.env.APPLY === "1";
const OPEN = "2026-08-09T12:00:00.000Z";
const CLOBBER = "2026-08-09T12:31:39.000Z";

(async () => {
  const db = await getMongoDb();
  const progression = require("../src/shared/progression");

  // 打怪經驗估算基準：新手村外草叢＋起始草原的平均 expReward
  const earlyMons = await db.collection("monsters")
    .find({ zone: { $in: ["beginner", "normal"] }, enabled: { $ne: false }, isBoss: { $ne: true } })
    .toArray();
  const avgKillExp = Math.round(earlyMons.reduce((s, m) => s + (Number(m.expReward) || 0), 0) / Math.max(1, earlyMons.length));
  console.log(`打怪經驗估算基準：前兩區 ${earlyMons.length} 隻怪平均 ${avgKillExp} EXP/場\n`);

  // 任務定義（算任務經驗用）
  const questDefs = await db.collection("weeklyQuests").find({}).toArray();
  const defById = {}; questDefs.forEach((q) => { defById[q.id] = q; });

  const legit = await db.collection("transactions")
    .find({ createdAt: { $gte: OPEN, $lt: CLOBBER } }).toArray();
  const byPlayer = {};
  for (const t of legit) {
    const p = byPlayer[t.playerId] = byPlayer[t.playerId] || { goldNet: 0, kills: 0, shopRefs: [], diamonds: 0 };
    if (t.currencyType === "gold") p.goldNet += (t.direction === "debit" ? -1 : 1) * (Number(t.amount) || 0);
    if (t.currencyType === "diamond") p.diamonds += (t.direction === "debit" ? -1 : 1) * (Number(t.amount) || 0);
    if (t.source === "monster:kill-reward") p.kills += 1;
    if (t.source === "shop:purchase" && t.sourceRef) p.shopRefs.push(String(t.sourceRef));
  }

  // 任務經驗：窗口內領取的任務（claimed 且該任務有 rewardExp）
  const wqp = await db.collection("weeklyQuestProgress").find({}).toArray();
  for (const row of wqp) {
    const pid = row.discordId || row.playerId;
    if (!pid || !byPlayer[pid]) continue;
    const period = row.progress || row.quests || row; // 結構容錯：{questId:{claimed,claimedAt}}
    for (const [qid, st] of Object.entries(period)) {
      if (!st || typeof st !== "object" || !st.claimed) continue;
      const at = st.claimedAt || st.updatedAt || null;
      if (at && (at < OPEN || at >= CLOBBER)) continue; // 只算窗口內領的
      const def = defById[qid];
      if (def && Number(def.rewardExp) > 0) {
        byPlayer[pid].questExp = (byPlayer[pid].questExp || 0) + Number(def.rewardExp);
      }
    }
  }

  const items = db.collection("items");
  const players = db.collection("players");
  console.log(`受影響玩家 ${Object.keys(byPlayer).length} 名\n`);
  console.log("玩家".padEnd(18) + "金幣淨額".padStart(9) + "任務EXP".padStart(8) + "打怪EXP(估)".padStart(11) + "  → 等級" + "  商店回補");
  console.log("-".repeat(80));

  for (const [pid, v] of Object.entries(byPlayer)) {
    const pl = await players.findOne({ discordId: pid }, { projection: { name: 1, nickname: 1 } });
    const name = String(pl?.nickname || pl?.name || pid).slice(0, 14);
    const battleExp = v.kills * avgKillExp;
    const totalExp = (v.questExp || 0) + battleExp;
    // EXP → 等級（用 progression 累計表）
    let lv = 1, rest = totalExp;
    while (lv < 50) {
      const need = progression.expToNextLevel(lv);
      if (rest < need) break;
      rest -= need; lv += 1;
    }
    console.log(name.padEnd(18) + String(v.goldNet).padStart(9) + String(v.questExp || 0).padStart(8)
      + String(battleExp).padStart(11) + `   Lv${lv}+${rest}` + (v.shopRefs.length ? `  ${v.shopRefs.length} 件` : ""));

    if (!APPLY) continue;

    // 金幣：直接設定（清檔後為 0，淨額即最終值；負值保底 0）
    await db.collection("wallets").updateOne(
      { playerId: pid },
      { $set: { gold: Math.max(0, v.goldNet), updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    await db.collection("transactions").insertOne({
      playerId: pid, currencyType: "gold", amount: Math.max(0, v.goldNet), direction: "credit",
      source: "admin:incident-restore", sourceRef: "incident-20260809",
      operator: "incident-restore-script", createdAt: new Date().toISOString(),
      note: "2026-08-09 開服事故：依 20:00~20:31 交易紀錄回復",
    });
    // 經驗與等級
    await db.collection("progress").updateOne(
      { playerId: pid },
      { $set: { level: lv, exp: rest, updatedAt: new Date().toISOString() } }
    );
    // 商店購買的道具重發
    for (const ref of v.shopRefs) {
      const it = await items.findOne({ id: ref });
      if (!it) { console.log(`   ⚠️ 商店道具找不到: ${ref}`); continue; }
      await db.collection("progress").updateOne(
        { playerId: pid },
        { $push: { inventory: { uuid: require("node:crypto").randomUUID(), itemId: it.id, itemName: it.name, itemType: it.itemType, equipSlot: it.equipSlot || null, tier: it.tier || null, obtainedAt: new Date().toISOString(), _incidentRestore: true } } }
      );
    }
  }

  console.log(`\n${APPLY ? "✅ 已寫入" : "🟡 DRY-RUN（加 APPLY=1 執行）"}`);
  console.log("備註：打怪 EXP 為估算（交易不記經驗）；裝備掉落物無紀錄可還原，建議另發補償包。");
  process.exit(0);
})().catch((e) => { console.error("❌", e); process.exit(1); });
