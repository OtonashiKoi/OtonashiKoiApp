"use strict";
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { COLOR_META, COLORS, BET_MIN, BET_MAX, PAYOUT_CAP, WHEEL_SLOTS } = require("../services/casino/wheelConfig");

// ── Button / Modal ID ─────────────────────────────────────────
const CASINO_IDS = {
  betYellow: "casino:bet:yellow",
  betGreen:  "casino:bet:green",
  betRed:    "casino:bet:red",
  betBlue:   "casino:bet:blue",
  betPurple: "casino:bet:purple",
  myRecord:  "casino:my-record",
  rules:     "casino:rules",
};
const CASINO_BUTTONS = Object.values(CASINO_IDS);
const CASINO_BET_MODAL_PREFIX = "casino:bet-modal:"; // casino:bet-modal:<color>

function isCasinoButton(customId) { return CASINO_BUTTONS.includes(customId); }
function isCasinoModal(customId) { return typeof customId === "string" && customId.startsWith(CASINO_BET_MODAL_PREFIX); }

function fmtGold(n) { return Number(n || 0).toLocaleString("zh-TW"); }

// 各顏色中獎機率 = 該色格數 / 總格數（依 WHEEL_SLOTS 動態計算）
const WHEEL_TOTAL = WHEEL_SLOTS.length;
const SLOT_COUNT_BY_COLOR = WHEEL_SLOTS.reduce((m, s) => { m[s.color] = (m[s.color] || 0) + 1; return m; }, {});
function fmtWinPct(color) {
  const pct = WHEEL_TOTAL ? (SLOT_COUNT_BY_COLOR[color] || 0) / WHEEL_TOTAL * 100 : 0;
  return (Number.isInteger(pct) ? String(pct) : pct.toFixed(1)) + "%";
}

// 把 recentResults 顯示成 emoji 序列
function fmtRecentResults(results) {
  if (!results?.length) return "—";
  return results.slice(-6).map((r) => COLOR_META[r.color]?.emoji || "⚪").join(" ");
}

// 建立面板 embed + 按鈕（state 從 casinoService.getCurrentRound + recentResults 帶入）
function createCasinoPanelMessage({ round = null, recentResults = [], lastResult = null, enabled = true } = {}) {
  const embed = new EmbedBuilder()
    .setTitle("🎰 命運轉盤")
    .setColor(0xf1c40f);

  const canBet = Boolean(enabled && round && round.status === "open" && Date.now() < round.lockedAt);

  if (!enabled) {
    embed.setDescription("⚠️ 賭場目前**已關閉**，請稍候管理員開啟。");
  } else if (!round) {
    embed.setDescription("⏳ 正在開新一輪…");
  } else {
    const statusEmoji = round.status === "open" ? "🟢" : (round.status === "locked" ? "🔒" : "⚙️");
    const statusLabel = round.status === "open" ? "下注中" : (round.status === "locked" ? "鎖盤" : "結算中");
    const tsLock = Math.floor(round.lockedAt / 1000);
    const tsEnd  = Math.floor(round.endAt / 1000);
    const totals = round.totals || {};
    const totalPot = COLORS.reduce((a, c) => a + (totals[c] || 0), 0);

    const lines = [];
    lines.push(`**第 #${round.roundId} 輪** ・ ${statusEmoji} ${statusLabel}`);
    if (round.status === "open") {
      lines.push(`鎖盤 <t:${tsLock}:R>　・　開獎 <t:${tsEnd}:R>`);
    } else {
      lines.push(`開獎 <t:${tsEnd}:R>　・　下一輪即將開始`);
    }
    lines.push("");
    for (const color of COLORS) {
      const meta = COLOR_META[color];
      const amt = totals[color] || 0;
      lines.push(`${meta.emoji} **${meta.label} ×${meta.mult}**・中獎 ${fmtWinPct(color)}　${fmtGold(amt)} 金幣`);
    }
    lines.push("");
    lines.push(`💰 本輪總彩池：**${fmtGold(totalPot)}** 金幣`);
    if (lastResult) {
      const meta = COLOR_META[lastResult.color] || { emoji: "⚪", label: lastResult.color, mult: lastResult.mult };
      lines.push(`📌 上一輪：${meta.emoji} ${meta.label} ×${meta.mult}`);
    }
    lines.push(`🕒 近 6 輪：${fmtRecentResults(recentResults)}`);
    embed.setDescription(lines.join("\n"));
  }

  embed.addFields(
    {
      name: "💸 下注額階級（押中後抽道具）",
      value: [
        "・**100–5,000**：機率 8%、僅 D 階",
        "・**5,001–30,000**：機率 12%、解鎖至 C 階",
        "・**30,001–100,000**：機率 15%、解鎖至 B 階",
        "・**100,001–500,000**：機率 20%、**A 階全解鎖**（裝備 / 卡片 / 強化石）",
      ].join("\n"),
    },
    {
      name: "📜 規則",
      value: `每 60 秒一輪。下注 ${fmtGold(BET_MIN)}–${fmtGold(BET_MAX)} 金幣，押中色拿回「下注 × 倍率」（單注最多 ${fmtGold(PAYOUT_CAP)}）並順便抽掉落池。\n**每輪限下一注，下好離手、不能更改或加注。**`,
    },
  );
  embed.setFooter({ text: "結算後會私訊通知中獎與獎勵明細。" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CASINO_IDS.betYellow).setLabel("🟡 押黃 ×2").setStyle(ButtonStyle.Primary).setDisabled(!canBet),
    new ButtonBuilder().setCustomId(CASINO_IDS.betGreen ).setLabel("🟢 押綠 ×3").setStyle(ButtonStyle.Success).setDisabled(!canBet),
    new ButtonBuilder().setCustomId(CASINO_IDS.betRed   ).setLabel("🔴 押紅 ×5").setStyle(ButtonStyle.Danger).setDisabled(!canBet),
    new ButtonBuilder().setCustomId(CASINO_IDS.betBlue  ).setLabel("🔵 押藍 ×10").setStyle(ButtonStyle.Primary).setDisabled(!canBet),
    new ButtonBuilder().setCustomId(CASINO_IDS.betPurple).setLabel("🟣 押紫 ×15").setStyle(ButtonStyle.Secondary).setDisabled(!canBet),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CASINO_IDS.myRecord).setLabel("📜 我的紀錄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CASINO_IDS.rules   ).setLabel("📖 詳細規則").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

module.exports = {
  CASINO_IDS,
  CASINO_BUTTONS,
  CASINO_BET_MODAL_PREFIX,
  isCasinoButton,
  isCasinoModal,
  createCasinoPanelMessage,
};
