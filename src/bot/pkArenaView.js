"use strict";
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require("discord.js");
const { ARENA_COUNT, getPkArenaBracketByIndex, getBossBoostPct, getDropBoostPct, PK_RATING_DEFAULT } = require("../shared/pkArenaConfig");

// ── Button ID 常數 ───────────────────────────────────────────
const PK_ARENA_IDS = {
  join1:    "pk:join:1",
  join2:    "pk:join:2",
  join3:    "pk:join:3",
  bet1win:  "pk:bet:1:win",   // 下注擂台1 — 挑戰者贏
  bet2win:  "pk:bet:2:win",
  bet3win:  "pk:bet:3:win",
  bet1lose: "pk:bet:1:lose",  // 下注擂台1 — 挑戰者輸
  bet2lose: "pk:bet:2:lose",
  bet3lose: "pk:bet:3:lose",
  refresh:  "pk:refresh",
};

const PK_JOIN_IDS = [
  "pk:join:1",
  "pk:join:2",
  "pk:join:3",
  "pk:join:4",
  "pk:join:5",
  "pk:join:6",
  "pk:join:7",
];

const ARENA_LABELS = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];
const BET_AMOUNT = 500; // 每次下注固定金額
const PK_BET_SELECT_ID = "pk:bet_select";

// ── 狀態 Emoji ────────────────────────────────────────────────
const ARENA_STATUS = {
  empty:   "🟢",
  waiting: "🟡",
  betting: "🔴",
  fighting:"⚙️",
};

// ── 倒數格式 ─────────────────────────────────────────────────
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

// ── 擂台狀態列 ───────────────────────────────────────────────
function slotLine(slot, index) {
  const tag = ARENA_LABELS[index];
  const bracket = getPkArenaBracketByIndex(index);
  if (!slot || (!slot.challenger && !slot.defender)) {
    return `${ARENA_STATUS.empty} **${tag} ${bracket.label}** ⸺ 空位`;
  }
  if (slot.challenger && !slot.defender) {
    return `${ARENA_STATUS.waiting} **${tag} ${bracket.label}** ⸺ **${slot.challenger.name}** 等對手`;
  }
  if (slot.state === "fighting") {
    return `${ARENA_STATUS.fighting} **${tag} ${bracket.label}** ⸺ **${slot.challenger.name}** ⚔️ **${slot.defender.name}**`;
  }
  // 下注倒數
  const remain = slot.betDeadlineAt ? fmtCountdown(slot.betDeadlineAt - Date.now()) : "—";
  return `${ARENA_STATUS.betting} **${tag} ${bracket.label}** ⸺ **${slot.challenger.name}** ⚔️ **${slot.defender.name}**\n　　　　　　 ⏳ ${remain}`;
}

// ── 下注摘要（某擂台） ───────────────────────────────────────
function betSummaryLine(slot, index) {
  if (!slot?.bets || Object.keys(slot.bets).length === 0) return null;
  const tag = ARENA_LABELS[index];
  const challBet = Object.values(slot.bets)
    .filter((b) => b.side === "challenger")
    .reduce((s, b) => s + b.amount, 0);
  const defBet   = Object.values(slot.bets)
    .filter((b) => b.side === "defender")
    .reduce((s, b) => s + b.amount, 0);
  const challName = slot.challenger?.name ?? "挑戰者";
  const defName   = slot.defender?.name ?? "應戰者";
  return `${tag}　${challName} ${challBet}🪙／${defName} ${defBet}🪙`;
}

// ── 排行榜列 ─────────────────────────────────────────────────
const RANK_MEDALS = ["🥇", "🥈", "🥉"];

function buildRankingField(ranking = []) {
  if (!ranking || ranking.length === 0) return null;
  const lines = ranking.map((row, i) => {
    const medal = RANK_MEDALS[i] || `${i + 1}.`;
    const name = row.displayName || row.playerId || "???";
    const rating = Math.round(Number(row.pkRating) || PK_RATING_DEFAULT);
    const wins = Number(row.pkWins) || 0;
    const losses = Number(row.pkLosses) || 0;
    const boostPct = getBossBoostPct(rating);
    const dropPct  = getDropBoostPct(rating);
    const boostStr = boostPct > 0 ? ` ⚔️+${boostPct}%` : "";
    const dropStr  = dropPct  > 0 ? ` 🎁+${dropPct}%` : "";
    return `${medal} **${name}** ${rating}分 (${wins}勝${losses}敗)${boostStr}${dropStr}`;
  });
  return lines.join("\n");
}

// ── 主面板 ───────────────────────────────────────────────────
function createPkArenaPanelMessage(arenaSlots = [], ranking = []) {
  const slots = Array.from({ length: ARENA_COUNT }, (_, i) => arenaSlots[i] ?? null);

  // ── Embed ─────────────────────────────────────────────────
  const slotLines = slots.map((s, i) => slotLine(s, i)).join("\n");
  const betLines  = slots.map((s, i) => betSummaryLine(s, i)).filter(Boolean);

  const embed = new EmbedBuilder()
    .setTitle("⚔️ PK 擂台場")
    .setColor(0xc0392b)
    .setDescription(
      [
        "選空台挑戰，或進有人台應戰。",
        `就位後開放 **1 分鐘下注**，每次 **${BET_AMOUNT} 🪙**，隨機先後攻，自動 **15 回合**。`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        slotLines,
        "━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n")
    );

  if (betLines.length > 0) {
    embed.addFields({
      name: `💰 下注（每次 ${BET_AMOUNT} 🪙）`,
      value: betLines.join("\n"),
      inline: false,
    });
  }

  const rankingText = buildRankingField(ranking);
  if (rankingText) {
    embed.addFields({
      name: "🏆 Rating 排行榜 TOP 10（Lv.30+）",
      value: rankingText,
      inline: false,
    });
  }

  embed.setFooter({ text: "Elo Rating・勝者吃池・平局退・無對手不退場 | Rating≥1400:+3%・≥1600:+5%・≥1800:+7% BOSS傷害" });

  // ── 第一列：擂台按鈕 ──────────────────────────────────────
  const joinButtons = slots.map((slot, i) => {
      const isFighting = slot?.state === "fighting";
      const isBetting  = slot?.state === "betting";
      const hasBoth    = !!(slot?.challenger && slot?.defender);
      const hasOne     = !!(slot?.challenger && !slot?.defender);
      const bracket = getPkArenaBracketByIndex(i);

      return new ButtonBuilder()
        .setCustomId(PK_JOIN_IDS[i])
        .setLabel(
          isFighting ? `⚙️ 擂台 ${i + 1} ${bracket.label}`
            : isBetting  ? `🔴 擂台 ${i + 1} ${bracket.label}`
              : hasBoth    ? `🔴 擂台 ${i + 1} ${bracket.label}`
                : hasOne     ? `🟡 擂台 ${i + 1} ${bracket.label}`
                  :              `🟢 擂台 ${i + 1} ${bracket.label}`
        )
        .setStyle(
          isFighting || isBetting || hasBoth ? ButtonStyle.Danger
            : hasOne ? ButtonStyle.Primary
              :           ButtonStyle.Success
        )
        .setDisabled(!!(isFighting || isBetting || hasBoth));
    });

  const joinRows = [];
  for (let i = 0; i < joinButtons.length; i += 5) {
    joinRows.push(new ActionRowBuilder().addComponents(joinButtons.slice(i, i + 5)));
  }

  // ── 第二列：下注選單（只在下注階段且擂台有人才顯示） ──────
  const activeBettingSlots = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s?.state === "betting");

  const components = [...joinRows];

  if (activeBettingSlots.length > 0) {
    const options = [];
    for (const { s, i } of activeBettingSlots) {
      const challName = s.challenger?.name ?? `挑戰者`;
      const defName   = s.defender?.name ?? `應戰者`;
      const challId   = s.challenger?.discordId || "";
      const defId     = s.defender?.discordId || "";
      options.push({
        label: `擂台 ${i + 1}｜押 ${challName} 贏`,
        value: `pkbet:${i}:${challId}:${encodeURIComponent(challName)}:challenger`,
        description: `下注 ${BET_AMOUNT}🪙`,
      });
      options.push({
        label: `擂台 ${i + 1}｜押 ${defName} 贏`,
        value: `pkbet:${i}:${defId}:${encodeURIComponent(defName)}:defender`,
        description: `下注 ${BET_AMOUNT}🪙`,
      });
    }
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(PK_BET_SELECT_ID)
          .setPlaceholder("💰 選擇要下注的擂台與對象")
          .addOptions(options.slice(0, 25))
      )
    );
  }

  // 重新整理按鈕固定在最後一列（Discord 最多 5 列）
  if (components.length < 5) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(PK_ARENA_IDS.refresh)
          .setLabel("🔄 重新整理")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return { embeds: [embed], components };
}

// ── 戰報 Embed ────────────────────────────────────────────────
function createPkBattleReportMessage(slot, result, betPayouts = [], battleRewards = [], options = {}) {
  const { winner, roundLogs, finalHpA, finalHpB, hpPctA, hpPctB } = result;
  const includeRoundLogs = options.includeRoundLogs !== false;
  const challName = slot.challenger.name;
  const defName   = slot.defender.name;
  const challMaxHp = slot.challenger.stats.maxHp;
  const defMaxHp   = slot.defender.stats.maxHp;

  const isFirst = slot.firstAttacker === "challenger";
  const firstLabel  = isFirst ? challName : defName;

  // 勝者判定
  let resultLine;
  if (winner === "A") {
    // A = 先攻方
    const winName  = isFirst ? challName : defName;
    resultLine = `🏆 **${winName}** 獲勝！`;
  } else if (winner === "B") {
    const winName  = isFirst ? defName : challName;
    resultLine = `🏆 **${winName}** 獲勝！`;
  } else {
    resultLine = "🤝 **平局！**";
  }

  const challHp = isFirst ? finalHpA : finalHpB;
  const defHp   = isFirst ? finalHpB : finalHpA;
  const challPct = isFirst ? hpPctA : hpPctB;
  const defPct   = isFirst ? hpPctB : hpPctA;

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ 擂台戰報`)
    .setColor(winner ? 0xf39c12 : 0x95a5a6)
    .setDescription(
      [
        `**${challName}** ⚔️ **${defName}**`,
        `先攻：${firstLabel}`,
        "",
        resultLine,
        "",
        `${challName}：${challHp} / ${challMaxHp} HP（${challPct}%）`,
        `${defName}：${defHp} / ${defMaxHp} HP（${defPct}%）`,
      ].join("\n")
    );

  // 戰鬥紀錄（只在需要時附上）
  if (includeRoundLogs) {
    const logChunks = roundLogs.slice(-10).join("\n\n");
    if (logChunks.length > 0) {
      const trimmed = logChunks.length > 3800 ? logChunks.slice(-3800) : logChunks;
      embed.addFields({ name: "📜 戰鬥記錄（最後 10 回合）", value: trimmed });
    }
  }

  if (betPayouts.length > 0) {
    embed.addFields({
      name: "💰 下注結算",
      value: betPayouts.join("\n"),
      inline: false,
    });
  }

  if (battleRewards.length > 0) {
    embed.addFields({
      name: "🎁 戰鬥獎勵",
      value: battleRewards.join("\n"),
      inline: false,
    });
  }

  return { embeds: [embed] };
}

module.exports = {
  PK_ARENA_IDS,
  BET_AMOUNT,
  ARENA_COUNT,
  createPkArenaPanelMessage,
  createPkBattleReportMessage,
};
