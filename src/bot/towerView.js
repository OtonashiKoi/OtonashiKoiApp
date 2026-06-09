"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const {
  TOWER_MAX_MEMBERS, TOWER_TOTAL_FLOORS, MAX_ROUNDS_PER_MEMBER,
  getTowerFloorBuff, getCumulativePartyBonus, getTowerFloorBossName,
} = require("../shared/towerConfig");

// ── Button ID ─────────────────────────────────────────────────
const TOWER_IDS = {
  openLobby:  "tower:open_lobby",  // 面板大廳：開啟組隊
  join:       "tower:join",        // Thread：加入
  leave:      "tower:leave",       // Thread：離開
  start:      "tower:start",       // Thread：開始（隊長）
  disband:    "tower:disband",     // Thread：解散（隊長）
  refresh:    "tower:refresh",     // Thread：重整
  fightNext:  "tower:fight_next",  // Thread：攻略下一層（隊長）
  ranking:    "tower:ranking",     // 任意：排行榜
  useItem:    "tower:use_item",    // Thread：使用道具（隊長）
};

function buildTowerActionPreview(members = []) {
  const actors = members
    .filter((m) => m && (m.currentHp == null || m.currentHp > 0))
    .map((m, index) => ({
      type: "member",
      name: m.name,
      agi: Number(m.stats?.agi || 0),
      dex: Number(m.stats?.dex || 0),
      speed: 100 + Math.max(0, Number(m.stats?.agi || 0)),
      gauge: 0,
      index,
    }));

  const preview = [];
  for (let i = 0; i < 10 && actors.length > 0; i++) {
    const nextNeed = Math.min(...actors.map((a) => (1000 - a.gauge) / Math.max(1, a.speed)));
    for (const actor of actors) actor.gauge += actor.speed * nextNeed;
    const ready = actors
      .filter((a) => a.gauge >= 999.999)
      .sort((a, b) => (b.gauge - a.gauge) || (b.agi - a.agi) || (b.dex - a.dex) || (a.index - b.index));
    const actor = ready[0];
    actor.gauge -= 1000;
    preview.push({ ...actor });
  }
  return preview;
}

function formatTowerActionOrder(members = []) {
  const order = buildTowerActionPreview(members);
  if (order.length === 0) return "（尚無行動軸資料）";
  const memberOrder = order
    .map((actor, index) => `${index + 1}. **${actor.name}** AGI ${actor.agi}`)
    .join("\n");
  return `👾 怪物在前方，依速度條排軸圍攻\n${memberOrder}`;
}

function formatActorName(actor) {
  if (actor?.type === "monster") return `👾${actor.name || "怪物"}`;
  return actor?.name || "???";
}

function formatTowerRecordProgress(record = {}) {
  const floor = Number(record.bestProgressFloor || 0);
  const damage = Number(record.bestProgressDamage || 0);
  const maxHp = Number(record.bestProgressMaxHp || 0);
  if (floor <= 0 || damage <= 0 || maxHp <= 0) return "";

  const pct = Number(record.bestProgressDamagePct || ((damage / maxHp) * 100));
  const monster = record.bestProgressMonsterName ? ` ${record.bestProgressMonsterName}` : "";
  return `｜第 ${floor} 層${monster} 傷害 ${damage.toLocaleString()}（${pct.toFixed(2)}%）`;
}

// ── 面板大廳常駐面板 ──────────────────────────────────────────
function createTowerHallMessage(topRanking = []) {
  const MEDALS = ["🥇", "🥈", "🥉"];
  const rankLines = topRanking.length > 0
    ? topRanking.slice(0, 5).map((r, i) => {
      const medal  = MEDALS[i] || `${i + 1}.`;
      const floor  = r.towerRecord?.bestFloor ?? r.towerRecord?.lastFloor ?? 0;
      const progress = formatTowerRecordProgress(r.towerRecord);
      const party  = r.towerRecord?.bestParty || r.towerRecord?.lastParty || [];
      const names  = party.length > 0
        ? party.map((p) => p.name).join("・")
        : (r.displayName || r.playerId || "???");
      return `${medal} **${floor} 層**${progress} — ${names}`;
    })
    : ["（尚無挑戰紀錄）"];

  const embed = new EmbedBuilder()
    .setTitle("🗼 組隊攻塔")
    .setColor(0x5865f2)
    .setDescription(
      [
        `**最多 6 人組隊，挑戰 ${TOWER_TOTAL_FLOORS} 層爬塔！**`,
        "按下開啟組隊後，論壇會自動建立你的隊伍貼文。",
        "其他冒險者進入貼文加入，隊長按開始後鎖定成員裝備。",
        "",
        "**── 樓層分段 ──**",
        "🌿 **1–10 層** 初啟之境",
        "🔥 **11–20 層** 試煉深淵",
        "⚡ **21–30 層** 混沌邊境",
        "💀 **31–40 層** 滅世熔爐",
        "🐲 **41–50 層** 龍族之領（50 層 龍王）",
        "👑 **51 層** 大史王　**52 層** 古龍王",
        "",
        "**── 最高紀錄 ──**",
        ...rankLines,
      ].join("\n")
    )
    .setFooter({ text: "開始後裝備快照鎖定 · 個人最高紀錄永久保留" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.openLobby)
      .setLabel("⚔️ 開啟組隊")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.ranking)
      .setLabel("🏆 排行榜")
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

// ── Thread：大廳等待面板 ──────────────────────────────────────
function createTowerThreadLobbyMessage(session) {
  const { members, leaderId, roomId } = session;
  const slotsLeft = TOWER_MAX_MEMBERS - members.length;

  const memberLines = members.map((m) => {
    const crown = m.discordId === leaderId ? "👑 " : "";
    return `${crown}**${m.name}** Lv.${m.level}`;
  });
  const actionOrder = formatTowerActionOrder(members);

  const embed = new EmbedBuilder()
    .setTitle(`🗼 組隊攻塔 ― 等待中 [${roomId}]`)
    .setColor(0x57f287)
    .setDescription(
      [
        `人數：**${members.length} / ${TOWER_MAX_MEMBERS}**（${slotsLeft > 0 ? `還缺 ${slotsLeft} 人` : "已滿員"}）`,
        "",
        "**── 隊伍成員 ──**",
        memberLines.length > 0 ? memberLines.join("\n") : "（等待中）",
        "",
        "**── 行動軸（依 AGI）──**",
        actionOrder,
        "",
        "隊長按 **▶ 開始攻塔** 即鎖定全員裝備出發！",
        "> ⏳ 逾 10 分鐘無人開始自動解散",
      ].join("\n")
    )
    .setFooter({ text: `共 ${TOWER_TOTAL_FLOORS} 層 · 50 龍王 · 51 大史王 · 52 古龍王` });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.join)
      .setLabel("➕ 加入")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.leave)
      .setLabel("➖ 離開")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.refresh)
      .setLabel("🔄 重整")
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.start)
      .setLabel("▶ 開始攻塔")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(members.length < 1),
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.disband)
      .setLabel("💨 解散")
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

// ── 成員資訊列（職業 + 等級 + 特性 + HP）────────────────────
function buildMemberBlock(m, showHp = true) {
  const job     = m.job || { name: "冒險者", emoji: "🧑", traits: [] };
  const crown   = m.isLeader ? "👑 " : "";
  const dead    = showHp && m.currentHp <= 0 ? " 💀" : "";
  const hpPart  = showHp
    ? `\n　${buildHpBar(m.currentHp, m.maxHp, 7)} ${m.currentHp}/${m.maxHp}`
    : "";
  const traits  = job.traits.length > 0 ? `\n　特性：${job.traits.join("・")}` : "";
  return `${crown}${job.emoji} **${m.name}**${dead} ${job.name} Lv.${m.level}${traits}${hpPart}`;
}

function formatTowerStatRanking(rows = [], unit = "") {
  if (!Array.isArray(rows) || rows.length === 0) return "無";
  return rows
    .slice(0, 6)
    .map((row, index) => `${index + 1}. ${row.name} ${row.value}${unit}`)
    .join("　");
}

function summarizeTowerActionLog(logText) {
  if (typeof logText !== "string") return "";
  const lines = logText
    .split("\n")
    .filter((line) => line && !line.startsWith("**【"));
  const important = lines.filter((line) => /中毒|淬毒|燒傷|流血|冰凍|擊暈|麻痺|詛咒|閃電|震盪/.test(line));
  return [...new Set([...important.slice(-3), ...lines.slice(-2)])]
    .slice(-4)
    .join("\n　");
}

function formatTowerMemberStatusLine(member) {
  const job = member?.job || {};
  const jobLabel = `${job.emoji ? `${job.emoji} ` : ""}${job.name || "冒險者"}`;
  const hp = Math.max(0, Math.round(Number(member?.currentHp || 0)));
  const maxHp = Math.max(1, Math.round(Number(member?.maxHp || member?.stats?.maxHp || 1)));
  return `• **${member?.name || "???"}**｜${jobLabel}｜HP ${hp.toLocaleString()} / ${maxHp.toLocaleString()}`;
}

function appendTowerFloorSummary(lines, summary) {
  if (!summary) return;
  const mvp = Array.isArray(summary.mvpDamage) ? summary.mvpDamage : [];
  const taken = Array.isArray(summary.damageTaken) ? summary.damageTaken : [];
  const healing = Array.isArray(summary.healing) ? summary.healing : [];
  const auras = Array.isArray(summary.auras) ? summary.auras : [];

  lines.push("");
  lines.push("**── 本層統計 ──**");
  lines.push(`🏆 MVP 輸出：${formatTowerStatRanking(mvp, "傷害")}`);
  lines.push(`🛡️ 承傷排行：${formatTowerStatRanking(taken, "傷害")}`);
  lines.push(`💚 治療量：${formatTowerStatRanking(healing, "HP")}`);
  lines.push(`✨ 光環生效：${auras.length ? auras.slice(0, 8).join("；") : "無"}`);
}

// ── Thread：等待隊長操作的戰況面板 ───────────────────────────
function createTowerThreadBattleMessage(session) {
  const { members, currentFloor, clearedFloor, roomId, state, lastFloorResult } = session;

  const nextFloor  = clearedFloor + 1;
  const dispFloor  = Math.min(nextFloor, TOWER_TOTAL_FLOORS);
  const buff       = getTowerFloorBuff(dispFloor);
  const bonus      = getCumulativePartyBonus(nextFloor);
  const nextBossName = getTowerFloorBossName(nextFloor);     // 龍王/大史王/古龍王...（非王關為 null）
  const isBossNext = nextFloor >= 50;                        // 50/51/52 為龍王與雙世界王（高潮王關）
  const alreadyDone = clearedFloor >= TOWER_TOTAL_FLOORS;
  const isFighting  = state === "fighting";

  // 成員欄（含職業特性 + HP）
  const memberLines = members.map((m) =>
    buildMemberBlock({ ...m, isLeader: m.discordId === session.leaderId }, true)
  );

  // 本層戰報區（上一層打完後顯示）
  const battleSection = [];
  if (lastFloorResult) {
    const { floor, monsterName, scaledHp, memberLogs = [], actionOrder = [], totalRounds, monsterKilled, survived, monsterHpFinal, summary } = lastFloorResult;
    battleSection.push("", `**── 第 ${floor} 層：${monsterName}（HP ${scaledHp}）──**`);
    if (actionOrder.length > 0) {
      battleSection.push(`行動軸：${actionOrder.map(formatActorName).join(" → ")}`);
    }
    appendTowerFloorSummary(battleSection, summary);
    battleSection.push("", "**── 行動摘要 ──**");
    for (const action of memberLogs.slice(0, 8)) {
      const hpText = action.type === "monster"
        ? "全隊承受攻擊"
        : `怪物剩 ${Math.max(0, action.monsterHpAfter || 0)} HP`;
      battleSection.push(`• **${formatActorName(action)}** 行動（AGI ${action.agi ?? "?"}）｜${hpText}`);
      const lastLog = Array.isArray(action.logs) ? action.logs.at(-1) : null;
      if (typeof lastLog === "string") {
        const summary = summarizeTowerActionLog(lastLog);
        if (summary) battleSection.push(`　${summary}`);
      }
    }
    if (memberLogs.length > 8) {
      battleSection.push(`　…其餘 ${memberLogs.length - 8} 次行動略，完整戰報保留在系統紀錄。`);
    }
    if (monsterKilled && survived)       battleSection.push(`✅ **${monsterName}** 討伐！共 ${totalRounds} 回合，第 ${floor} 層通關！`);
    else if (!monsterKilled)             battleSection.push(`❌ 行動格耗盡（${totalRounds} 格）仍未擊敗，${monsterName} 剩 ${monsterHpFinal} HP`);
    else                                 battleSection.push(`💀 全員陣亡`);
  }

  const titleText = alreadyDone
    ? "🎉 全層通關！"
    : isFighting
      ? `${buff.emoji} 攻略中 ― 第 ${currentFloor} 層…`
      : lastFloorResult
        ? `${buff.emoji} 第 ${lastFloorResult.floor} 層結果 ― 準備攻略第 ${nextFloor} 層`
        : `🗼 攻塔準備中 ― 第 1 層`;

  const descLines = [
    `房間：\`${roomId}\`　已通關：**${clearedFloor} / ${TOWER_TOTAL_FLOORS}** 層`,
    !alreadyDone
      ? `下一層：${isBossNext ? `👑 ${nextBossName || "終焉之王"}` : `${buff.emoji} **${buff.label}**`}　ATK +${bonus.atkPct}%・MaxHP +${bonus.hpPct}%`
      : "",
    "",
    "**── 隊伍成員 ──**",
    ...memberLines,
    "",
    "**── 目前行動軸（依 AGI）──**",
    formatTowerActionOrder(members),
    ...battleSection,
    "",
    buildFloorProgress(clearedFloor, currentFloor || nextFloor),
  ].filter((l) => l !== null);

  // 4000 字元保護
  const desc = descLines.join("\n").slice(0, 4000);

  const actionLimit = MAX_ROUNDS_PER_MEMBER * (session.members.length + 1);
  const embed = new EmbedBuilder()
    .setTitle(titleText)
    .setColor(alreadyDone ? 0xf1c40f : buff.color)
    .setDescription(desc)
    .setFooter({ text: `裝備已鎖定快照 · 每層最多 ${actionLimit} 個行動格（每人約 ${MAX_ROUNDS_PER_MEMBER} 格），超時視為失敗` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.fightNext)
      .setLabel(isBossNext ? `👑 挑戰${nextBossName || "終焉之王"}！` : `⚔️ 攻略第 ${nextFloor} 層`)
      .setStyle(isBossNext ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setDisabled(isFighting || alreadyDone),
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.useItem)
      .setLabel("🧪 使用道具")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isFighting || alreadyDone),
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.refresh)
      .setLabel("🔄 重整")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isFighting),
  );

  return { embeds: [embed], components: [row] };
}

// ── Thread：結算面板 ──────────────────────────────────────────
function createTowerThreadResultMessage(session, reward) {
  const { members, clearedFloor, failReason, lastFloorResult } = session;
  const isFull = clearedFloor >= TOWER_TOTAL_FLOORS;
  let monsterHpLine = null;
  if (!isFull && lastFloorResult && !lastFloorResult.monsterKilled && Number(lastFloorResult.scaledHp || 0) > 0) {
    const remaining = Math.max(0, Math.round(Number(lastFloorResult.monsterHpFinal || 0)));
    const maxHp = Math.max(1, Math.round(Number(lastFloorResult.scaledHp || 1)));
    const pct = Math.round((remaining / maxHp) * 100);
    monsterHpLine = `🩸 怪物剩餘 HP：**${remaining.toLocaleString()} / ${maxHp.toLocaleString()}**（${pct}%）`;
  }

  const memberLines = members.map((m) => {
    const best   = m.towerRecord?.bestFloor || 0;
    const newRec = clearedFloor > (m.towerRecord?.prevBest || 0) ? " 🆕個人紀錄" : "";
    return `• **${m.name}**${newRec}　個人最高：${best} 層`;
  });
  const memberStatusLines = members.map(formatTowerMemberStatusLine);

  const rewardLines = [
    reward.gold > 0 ? `💰 金幣 +${reward.gold}` : null,
    reward.exp  > 0 ? `✨ EXP +${reward.exp}` : null,
    reward.bonusMsg || null,
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setTitle(isFull ? "🎉 完全通關！終焉魔王討伐成功！" : `🗼 攻塔結束 ― 第 ${clearedFloor} 層`)
    .setColor(isFull ? 0xf1c40f : 0x95a5a6)
    .setDescription(
      [
        isFull
          ? `🏆 恭喜全隊通過所有 ${TOWER_TOTAL_FLOORS} 層！`
          : `最高通關層：**第 ${clearedFloor} 層**${failReason ? `\n❌ ${failReason}` : ""}`,
        monsterHpLine,
        "",
        "**── 成員成績 ──**",
        ...memberLines,
        "",
        "**── 結束狀態 ──**",
        ...memberStatusLines,
        "",
        rewardLines.length > 0 ? "**── 本次獎勵（每位） ──**" : "",
        ...rewardLines,
      ].filter((l) => l !== "").join("\n")
    )
    .setFooter({ text: `個人最高紀錄已更新 · 感謝挑戰！ · 每層行動格上限 = 每人 ${MAX_ROUNDS_PER_MEMBER} 格 × (隊員數+1)` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.ranking)
      .setLabel("🏆 查看排行榜")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(TOWER_IDS.disband)
      .setLabel("💨 解散隊伍")
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

// ── 單層戰報訊息（發到 Thread，所有人可看） ───────────────────
function createTowerFloorReportMessage(floor, monster, scaledHp, fightResult, members) {
  const { rounds, monsterKilled, survived, monsterHpFinal } = fightResult;
  const buff    = getTowerFloorBuff(floor);
  const isBoss  = floor >= 50;

  // 每大回合格式化
  const roundLines = [];
  for (const round of rounds) {
    roundLines.push(`**【回合 ${round.roundNum}】**`);
    for (const atk of round.attacks) {
      const critTag = atk.isCrit ? " ⚡暴擊" : "";
      roundLines.push(`　${atk.name}${critTag} → **-${atk.dmg}**　怪物剩 ${atk.monsterHpAfter} HP`);
    }
    if (round.counterDmg > 0) {
      roundLines.push(`　${monster.name} 反擊 → 各成員 **-${round.counterDmg}**`);
      // 顯示各成員反擊後 HP
      const hpLines = members
        .filter((m) => round.hpAfter[m.discordId] !== undefined)
        .map((m) => `${m.name} ${round.hpAfter[m.discordId]}HP`)
        .join("　");
      if (hpLines) roundLines.push(`　　↳ ${hpLines}`);
    }
  }

  // 結果行
  let resultLine;
  if (monsterKilled && survived) {
    resultLine = `✅ **${monster.name}** 討伐成功！第 ${floor} 層通關！`;
  } else if (!monsterKilled) {
    resultLine = `⏱️ 超過回合上限，**${monster.name}** 仍剩 ${monsterHpFinal} HP，攻塔終止。`;
  } else {
    resultLine = `💀 **${monster.name}** 倒下，但全員陣亡。`;
  }

  // 戰後成員 HP 快照
  const hpSnapshot = members.map((m) => {
    const bar  = buildHpBar(m.currentHp, m.maxHp, 6);
    const dead = m.currentHp <= 0 ? " 💀" : "";
    return `${m.name}${dead} ${bar} ${m.currentHp}/${m.maxHp}`;
  });

  // Discord embed 有 4096 字元上限，分段避免爆字數
  const bodyLines = [
    ...roundLines,
    "",
    resultLine,
    "",
    "**── 戰後狀態 ──**",
    ...hpSnapshot,
  ];

  const embed = new EmbedBuilder()
    .setTitle(`${isBoss ? "👑" : buff.emoji} 第 ${floor} 層戰報 ― ${monster.name}（HP:${scaledHp}）`)
    .setColor(monsterKilled && survived ? buff.color : 0x95a5a6)
    .setDescription(bodyLines.join("\n").slice(0, 4000))
    .setFooter({ text: `第 ${floor} / ${TOWER_TOTAL_FLOORS} 層` });

  return { embeds: [embed] };
}

// ── 排行榜 ────────────────────────────────────────────────────
function createTowerRankingMessage(rankList = []) {
  const MEDALS = ["🥇", "🥈", "🥉"];
  const lines = rankList.length > 0
    ? rankList.map((r, i) => {
      const medal = MEDALS[i] || `${i + 1}.`;
      const floor = r.towerRecord?.bestFloor || 0;
      const runs  = r.towerRecord?.totalRuns || 0;
      const date  = r.towerRecord?.bestAt
        ? new Date(r.towerRecord.bestAt).toLocaleDateString("zh-TW")
        : "—";
      const progress = formatTowerRecordProgress(r.towerRecord);
      const party = r.towerRecord?.bestParty || [];
      const names = party.length > 0
        ? party.map((p) => p.name).join("・")
        : (r.displayName || r.playerId || "???");
      return `${medal} **${floor} 層**${progress} ― ${names}（${runs} 次 · ${date}）`;
    })
    : ["（尚無紀錄）"];

  const embed = new EmbedBuilder()
    .setTitle("🗼 爬塔隊伍最高層排行榜")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "依最高通關層排列；同層依下一層怪物傷害排序 · TOP 10" });

  return { embeds: [embed], components: [] };
}

// ── 工具 ──────────────────────────────────────────────────────
function buildHpBar(cur, max, len = 8) {
  if (!max || max <= 0) return "░".repeat(len);
  const filled = Math.max(0, Math.min(len, Math.round((cur / max) * len)));
  const pct    = Math.round((cur / max) * 100);
  const color  = pct > 60 ? "🟩" : pct > 30 ? "🟧" : "🟥";
  return `${color}[${"█".repeat(filled)}${"░".repeat(len - filled)}]`;
}

function buildFloorProgress(cleared, current) {
  const segs   = [[1, 10, "🌿"], [11, 20, "🔥"], [21, 30, "⚡"], [31, 40, "💀"], [41, 50, "🐲"], [51, 52, "👑"]];
  const labels = ["初境", "深淵", "混沌", "熔爐", "龍領", "雙王"];
  return "進度：" + segs.map(([lo, hi, em], i) => {
    if (cleared >= hi) return `${em}${labels[i]}✅`;
    if (current >= lo) return `${em}${labels[i]}⚔️`;
    return `${em}${labels[i]}🔒`;
  }).join(" → ");
}

module.exports = {
  TOWER_IDS,
  createTowerHallMessage,
  createTowerThreadLobbyMessage,
  createTowerThreadBattleMessage,
  createTowerThreadResultMessage,
  createTowerFloorReportMessage,
  createTowerRankingMessage,
};
