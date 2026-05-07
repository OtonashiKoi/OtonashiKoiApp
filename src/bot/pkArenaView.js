"use strict";
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");

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

const ARENA_COUNT = 3;
const ARENA_LABELS = ["①", "②", "③"];
const BET_AMOUNT = 100; // 每次下注固定金額

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
  if (!slot || (!slot.challenger && !slot.defender)) {
    return `${ARENA_STATUS.empty} **擂台 ${tag}** ⸺ 空位，等待挑戰者`;
  }
  if (slot.challenger && !slot.defender) {
    return `${ARENA_STATUS.waiting} **擂台 ${tag}** ⸺ **${slot.challenger.name}** 正在等待對手…`;
  }
  if (slot.state === "fighting") {
    return `${ARENA_STATUS.fighting} **擂台 ${tag}** ⸺ **${slot.challenger.name}** ⚔️ **${slot.defender.name}** 戰鬥中！`;
  }
  // 下注倒數
  const remain = slot.betDeadline ? fmtCountdown(slot.betDeadline - Date.now()) : "—";
  return `${ARENA_STATUS.betting} **擂台 ${tag}** ⸺ **${slot.challenger.name}** ⚔️ **${slot.defender.name}**\n　　　　　　 ⏳ 下注倒數 ${remain}`;
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
  return `擂台 ${tag}　${challName} ${challBet}🪙 ／ ${defName} ${defBet}🪙`;
}

// ── 主面板 ───────────────────────────────────────────────────
function createPkArenaPanelMessage(arenaSlots = []) {
  const slots = Array.from({ length: ARENA_COUNT }, (_, i) => arenaSlots[i] ?? null);

  // ── Embed ─────────────────────────────────────────────────
  const slotLines = slots.map((s, i) => slotLine(s, i)).join("\n");
  const betLines  = slots.map((s, i) => betSummaryLine(s, i)).filter(Boolean);

  const embed = new EmbedBuilder()
    .setTitle("⚔️ PK 擂台場")
    .setColor(0xc0392b)
    .setDescription(
      [
        "選擇空擂台發起挑戰，或點入有人的擂台應戰。",
        "雙方就位後開放 **3 分鐘下注**，系統隨機決定先後攻，自動戰鬥 **15 回合**。",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        slotLines,
        "━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n")
    );

  if (betLines.length > 0) {
    embed.addFields({
      name: `💰 目前下注（每次 ${BET_AMOUNT} 🪙）`,
      value: betLines.join("\n"),
      inline: false,
    });
  }

  embed.setFooter({ text: "勝者通吃下注池 · 平局退還 · 無對手不退入場費" });

  // ── 第一列：擂台按鈕 ──────────────────────────────────────
  const joinRow = new ActionRowBuilder().addComponents(
    ...slots.map((slot, i) => {
      const isFighting = slot?.state === "fighting";
      const isBetting  = slot?.state === "betting";
      const hasBoth    = !!(slot?.challenger && slot?.defender);
      const hasOne     = !!(slot?.challenger && !slot?.defender);

      return new ButtonBuilder()
        .setCustomId(Object.values(PK_ARENA_IDS)[i]) // join:1 / join:2 / join:3
        .setLabel(
          isFighting ? `⚙️ 擂台 ${i + 1} 戰鬥中`
            : isBetting  ? `🔴 擂台 ${i + 1} 下注中`
              : hasBoth    ? `🔴 擂台 ${i + 1} 準備中`
                : hasOne     ? `🟡 擂台 ${i + 1} 應戰`
                  :              `🟢 擂台 ${i + 1} 挑戰`
        )
        .setStyle(
          isFighting || isBetting || hasBoth ? ButtonStyle.Danger
            : hasOne ? ButtonStyle.Primary
              :           ButtonStyle.Success
        )
        .setDisabled(!!(isFighting || isBetting || hasBoth));
    })
  );

  // ── 第二列：下注按鈕（只在下注階段且擂台有人才顯示） ──────
  const activeBettingSlots = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s?.state === "betting");

  const components = [joinRow];

  if (activeBettingSlots.length > 0) {
    // 每個正在下注的擂台產生一列按鈕（最多 3 擂台，各 2 個下注按鈕）
    for (const { s, i } of activeBettingSlots) {
      const challName = s.challenger?.name ?? `挑戰者`;
      const defName   = s.defender?.name ?? `應戰者`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pk:bet:${i + 1}:challenger`)
          .setLabel(`💰 押 ${challName} 贏 (${BET_AMOUNT}🪙)`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`pk:bet:${i + 1}:defender`)
          .setLabel(`💰 押 ${defName} 贏 (${BET_AMOUNT}🪙)`)
          .setStyle(ButtonStyle.Primary),
      );
      components.push(row);
    }
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
function createPkBattleReportMessage(slot, result, betPayouts = []) {
  const { winner, roundLogs, finalHpA, finalHpB, hpPctA, hpPctB } = result;
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

  // 戰鬥紀錄（最多顯示後 10 回合，避免超長）
  const logChunks = roundLogs.slice(-10).join("\n\n");
  if (logChunks.length > 0) {
    const trimmed = logChunks.length > 3800 ? logChunks.slice(-3800) : logChunks;
    embed.addFields({ name: "📜 戰鬥記錄（最後 10 回合）", value: trimmed });
  }

  if (betPayouts.length > 0) {
    embed.addFields({
      name: "💰 下注結算",
      value: betPayouts.join("\n"),
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
