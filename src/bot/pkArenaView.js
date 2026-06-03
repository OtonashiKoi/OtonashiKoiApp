"use strict";
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");
const { ARENA_COUNT, getPkArenaBracketByIndex, getBossBoostPct, getDropBoostPct, PK_RATING_DEFAULT, calcPkBetOdds, formatPkBetOdds } = require("../shared/pkArenaConfig");

// ── Button ID 常數 ───────────────────────────────────────────
const PK_ARENA_IDS = {
  joinQueue: "pk:join-queue",
  leaveQueue: "pk:leave-queue",
  myRecord: "pk:my-record",
};

const ARENA_LABELS = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];
const BET_AMOUNTS = [10000, 20000, 30000];
const BET_AMOUNT = BET_AMOUNTS[0]; // 舊互動 fallback：最低下注額
const PK_BET_SELECT_ID = "pk:bet_select";

function formatGold(amount) {
  const value = Math.max(0, Number(amount) || 0);
  if (value >= 10000 && value % 10000 === 0) return `${value / 10000}萬`;
  return value.toLocaleString("zh-TW");
}

function getParticipantRating(participant) {
  return Math.round(Number(participant?.rating ?? PK_RATING_DEFAULT));
}

function getSlotBetOdds(slot, side) {
  const challRating = getParticipantRating(slot?.challenger);
  const defRating = getParticipantRating(slot?.defender);
  return side === "challenger"
    ? calcPkBetOdds(challRating, defRating)
    : calcPkBetOdds(defRating, challRating);
}

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
    return `${ARENA_STATUS.empty} **${tag} ${bracket.label}** ⸺ 等待配對`;
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
  const challOdds = formatPkBetOdds(getSlotBetOdds(slot, "challenger"));
  const defOdds = formatPkBetOdds(getSlotBetOdds(slot, "defender"));
  return `${tag}　${challName} ${challOdds} ${challBet}🪙／${defName} ${defOdds} ${defBet}🪙`;
}

// ── 排行榜列 ─────────────────────────────────────────────────
const RANK_MEDALS = ["🥇", "🥈", "🥉"];

function buildRankingField(ranking = []) {
  if (!ranking || ranking.length === 0) return null;
  const lines = ranking.map((row, i) => {
    const medal = RANK_MEDALS[i] || `${i + 1}.`;
    const name = row.displayName || row.playerId || "???";
    const jobName = row.jobName ? `｜${row.jobName}` : "";
    const rating = Math.round(Number(row.pkRating) || 0);
    const wins = Number(row.pkWins) || 0;
    const losses = Number(row.pkLosses) || 0;
    const boostPct = getBossBoostPct(rating);
    const dropPct  = getDropBoostPct(rating);
    const boostStr = boostPct > 0 ? ` ⚔️+${boostPct}%` : "";
    const dropStr  = dropPct  > 0 ? ` 🎁+${dropPct}%` : "";
    return `${medal} **${name}**${jobName} ${rating}分 (${wins}勝${losses}敗)${boostStr}${dropStr}`;
  });
  return lines.join("\n");
}

// ── 主面板 ───────────────────────────────────────────────────
function createPkArenaPanelMessage(arenaSlots = [], ranking = [], queue = []) {
  const slots = Array.from({ length: ARENA_COUNT }, (_, i) => arenaSlots[i] ?? null);

  // ── Embed ─────────────────────────────────────────────────
  const activeSlots = slots.filter((s) => s?.challenger || s?.defender);
  const slotLines = activeSlots.length > 0
    ? slots.map((s, i) => slotLine(s, i)).join("\n")
    : "目前沒有進行中的配對。";
  const betLines  = slots.map((s, i) => betSummaryLine(s, i)).filter(Boolean);
  const queueCount = Array.isArray(queue) ? queue.length : 0;

  const embed = new EmbedBuilder()
    .setTitle("⚔️ PK 擂台場")
    .setColor(0xc0392b)
    .setDescription(
      [
        "按下排隊後會自動隨機配對。",
        `配對成功後開放 **1 分鐘下注**，下注可選 **${BET_AMOUNTS.map((amount) => `${formatGold(amount)} 🪙`).join(" / ")}**，依 Rating 賠率派彩，隨機先後攻，自動 **15 回合**。`,
        `排隊中可玩其他內容，配對成功後會鎖定 PK 狀態。現在排隊：**${queueCount} 人**。`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        slotLines,
        "━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n")
    );

  if (betLines.length > 0) {
    embed.addFields({
      name: `💰 下注（${BET_AMOUNTS.map((amount) => formatGold(amount)).join(" / ")} 🪙）`,
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

  embed.setFooter({ text: "Elo Rating・賠率下注・平局退・無對手不退場 | Rating≥1400:+3%・≥1600:+5%・≥1800:+7% BOSS傷害" });

  // ── 第二列：下注選單（只在下注階段且擂台有人才顯示） ──────
  const activeBettingSlots = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s?.state === "betting");

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(PK_ARENA_IDS.joinQueue)
        .setLabel("⚔️ 加入排隊")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(PK_ARENA_IDS.leaveQueue)
        .setLabel("🚪 離開排隊")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(PK_ARENA_IDS.myRecord)
        .setLabel("📊 我的成績")
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  if (activeBettingSlots.length > 0) {
    const optionsByAmount = BET_AMOUNTS.map((amount) => ({ amount, options: [] }));
    for (const { s, i } of activeBettingSlots) {
      const challName = s.challenger?.name ?? `挑戰者`;
      const defName   = s.defender?.name ?? `應戰者`;
      const challId   = s.challenger?.discordId || "";
      const defId     = s.defender?.discordId || "";
      const challOdds = getSlotBetOdds(s, "challenger");
      const defOdds = getSlotBetOdds(s, "defender");
      for (const group of optionsByAmount) {
        group.options.push({
          label: `擂台 ${i + 1}｜押 ${challName} 贏`,
          value: `pkbet:${i + 1}:${challId}:challenger`,
          description: `${formatGold(group.amount)}｜賠率 ${formatPkBetOdds(challOdds)}｜返還 ${formatGold(Math.floor(group.amount * challOdds))}🪙`,
        });
        group.options.push({
          label: `擂台 ${i + 1}｜押 ${defName} 贏`,
          value: `pkbet:${i + 1}:${defId}:defender`,
          description: `${formatGold(group.amount)}｜賠率 ${formatPkBetOdds(defOdds)}｜返還 ${formatGold(Math.floor(group.amount * defOdds))}🪙`,
        });
      }
    }
    for (const group of optionsByAmount) {
      if (group.options.length === 0) continue;
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${PK_BET_SELECT_ID}:${group.amount}`)
            .setPlaceholder(`💰 ${formatGold(group.amount)}下注：選擇擂台與對象`)
            .addOptions(group.options.slice(0, 25))
        )
      );
    }
  }

  return { embeds: [embed], components };
}

// ── 戰報 Embed ────────────────────────────────────────────────
function createPkBattleReportMessage(slot, result, betPayouts = [], battleRewards = [], options = {}) {
  const { winner, roundLogs, finalHpA, finalHpB, hpPctA, hpPctB } = result;
  const includeRoundLogs = options.includeRoundLogs !== false;
  const ratingLines = Array.isArray(options.ratingLines) ? options.ratingLines : [];
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

  if (ratingLines.length > 0) {
    embed.addFields({
      name: "📈 Rating 變動",
      value: ratingLines.join("\n"),
      inline: false,
    });
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
  BET_AMOUNTS,
  formatGold,
  getSlotBetOdds,
  ARENA_COUNT,
  createPkArenaPanelMessage,
  createPkBattleReportMessage,
};
