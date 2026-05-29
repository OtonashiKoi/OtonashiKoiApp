"use strict";
const {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, MessageFlags,
} = require("discord.js");
const { serviceContext, getBotClient } = require("../runtimeContext");
const {
  CASINO_IDS, CASINO_BET_MODAL_PREFIX, isCasinoButton, isCasinoModal,
  createCasinoPanelMessage,
} = require("../casinoView");
const { COLOR_META, BET_MIN, BET_MAX } = require("../../services/casino/wheelConfig");

let panelChannelId = null;
let panelMessageId = null;
let panelEnabled = true;
let panelRefreshTimer = null;
let panelDirty = false;
let unsubscribe = null;

function setPanelEnabled(flag) {
  panelEnabled = Boolean(flag);
  panelDirty = true;
}

async function ensureCasinoStarted() {
  try { await serviceContext.casinoService.start(); }
  catch (err) { console.warn("[casino] start failed:", err?.message); }
}

async function getPanelChannel() {
  const layout = await serviceContext.channelLayoutRepository.get().catch(() => null);
  const b = (layout?.discord?.bindings || []).find((x) => x.featureKey === "casino_wheel" && x.channelId);
  if (!b) return null;
  panelChannelId = b.channelId;
  panelMessageId = b.panelMessageId || panelMessageId;
  panelEnabled = b.enabled !== false;
  return b;
}

async function refreshPanelNow() {
  const client = getBotClient();
  if (!client?.isReady?.()) return;
  const binding = await getPanelChannel();
  if (!binding?.channelId || !binding?.panelMessageId) return;

  const round = await serviceContext.casinoService.getCurrentRound();
  const state = await serviceContext.casinoRepository.getState();
  const recent = state?.recentResults || [];
  const lastResult = recent.length ? recent[recent.length - 1] : null;
  const view = createCasinoPanelMessage({
    round, recentResults: recent, lastResult, enabled: panelEnabled,
  });

  const channel = await client.channels.fetch(binding.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const msg = await channel.messages.fetch(binding.panelMessageId).catch(() => null);
  if (!msg) return;
  await msg.edit(view).catch((err) => {
    if (err?.code !== 10008) console.warn("[casino] panel edit failed:", err?.message);
  });
  panelDirty = false;
}

function startPanelRefreshLoop() {
  if (panelRefreshTimer) return;
  // 每 5 秒檢查一次：若有 dirty 或時間到關鍵節點則刷新
  let lastForcedRefresh = 0;
  panelRefreshTimer = setInterval(async () => {
    try {
      const round = await serviceContext.casinoService.getCurrentRound();
      const now = Date.now();
      const shouldForce = round && (
        (round.lockedAt - now < 5000 && round.lockedAt - now > 0)
        || (now - lastForcedRefresh > 15000) // 至少每 15 秒刷一次 timestamp
      );
      if (panelDirty || shouldForce) {
        lastForcedRefresh = now;
        await refreshPanelNow();
      }
    } catch (err) {
      console.warn("[casino] panel refresh tick failed:", err?.message);
    }
  }, 5000);
}

function attachServiceListeners() {
  if (unsubscribe) return;
  unsubscribe = serviceContext.casinoService.subscribe((event) => {
    if (["round:open", "round:lock", "round:settled", "bet:placed"].includes(event)) {
      panelDirty = true;
    }
  });
}

// ── 公開 API ──────────────────────────────────────────────────
async function initCasinoPanel() {
  await ensureCasinoStarted();
  attachServiceListeners();
  startPanelRefreshLoop();
  // 拉一次當前綁定狀態
  await getPanelChannel().catch(() => {});
  panelDirty = true;
}

async function publishCasinoPanel(channelId, { cleanChannel = false, includePinned = true } = {}) {
  const client = getBotClient();
  if (!client?.isReady?.()) throw new Error("Discord bot is not ready");
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) throw new Error("target channel is not text-based");

  // 清頻道（如果指定）
  if (cleanChannel) {
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      for (const msg of messages.values()) {
        if (!includePinned && msg.pinned) continue;
        if (msg.deletable) await msg.delete().catch(() => {});
      }
    } catch (_) {}
  }

  // 刪舊面板
  const layout = await serviceContext.channelLayoutRepository.get().catch(() => null);
  const bindings = Array.isArray(layout?.discord?.bindings) ? layout.discord.bindings : [];
  const existing = bindings.find((b) => b.featureKey === "casino_wheel");
  if (existing?.panelMessageId) {
    await channel.messages.fetch(existing.panelMessageId)
      .then((m) => m.delete()).catch(() => {});
  }

  await ensureCasinoStarted();
  const round = await serviceContext.casinoService.getCurrentRound();
  const state = await serviceContext.casinoRepository.getState();
  const view = createCasinoPanelMessage({
    round,
    recentResults: state?.recentResults || [],
    lastResult: null,
    enabled: existing ? existing.enabled !== false : true,
  });
  const message = await channel.send(view);

  const updated = bindings.some((b) => b.featureKey === "casino_wheel")
    ? bindings.map((b) => b.featureKey === "casino_wheel"
        ? { ...b, channelId: String(channelId), panelMessageId: message.id }
        : b)
    : [
        ...bindings,
        {
          featureKey: "casino_wheel",
          channelId: String(channelId),
          enabled: true,
          note: "",
          panelMessageId: message.id,
          visibleTo: { player: true, admin: true },
        },
      ];
  await serviceContext.channelLayoutRepository.save({ discord: { ...(layout?.discord || {}), bindings: updated } });
  panelChannelId = String(channelId);
  panelMessageId = message.id;
  panelEnabled = true;
  return { channelId: String(channelId), messageId: message.id };
}

// ── Button handler ───────────────────────────────────────────
async function handleCasinoButton(interaction) {
  const id = interaction.customId;
  if (id === CASINO_IDS.myRecord) return handleMyRecord(interaction);
  if (id === CASINO_IDS.rules)    return handleRules(interaction);

  // 押注：開 Modal
  const color = id.split(":").pop();
  if (!COLOR_META[color]) {
    await interaction.reply({ content: "❌ 無效的下注選項。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!panelEnabled) {
    await interaction.reply({ content: "⚠️ 賭場目前已關閉。", flags: MessageFlags.Ephemeral });
    return;
  }

  const round = await serviceContext.casinoService.getCurrentRound();
  if (!round || round.status !== "open" || Date.now() >= round.lockedAt) {
    await interaction.reply({ content: "🔒 本輪已鎖盤，請等下一輪。", flags: MessageFlags.Ephemeral });
    return;
  }

  // 抓玩家錢包顯示在 Modal 提示
  let goldHint = "";
  try {
    const wallet = await serviceContext.walletRepository.findByPlayerId(interaction.user.id);
    if (wallet) goldHint = `（你目前 ${Number(wallet.gold || 0).toLocaleString("zh-TW")} 金幣）`;
  } catch (_) {}

  const meta = COLOR_META[color];
  const modal = new ModalBuilder()
    .setCustomId(`${CASINO_BET_MODAL_PREFIX}${color}`)
    .setTitle(`押注 ${meta.emoji} ${meta.label} ×${meta.mult}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`金額（${BET_MIN}–${BET_MAX}）${goldHint}`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("輸入下注金幣")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(8),
      ),
    );
  await interaction.showModal(modal);
}

// ── Modal handler ────────────────────────────────────────────
async function handleCasinoModal(interaction) {
  const color = interaction.customId.slice(CASINO_BET_MODAL_PREFIX.length);
  if (!COLOR_META[color]) {
    await interaction.reply({ content: "❌ 無效的下注選項。", flags: MessageFlags.Ephemeral });
    return;
  }
  const raw = interaction.fields.getTextInputValue("amount").trim();
  const amount = Math.floor(Number(raw.replace(/[, ]/g, "")));
  if (!Number.isFinite(amount) || amount < BET_MIN) {
    await interaction.reply({ content: `❌ 金額需為 ≥ ${BET_MIN} 的整數。`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (amount > BET_MAX) {
    await interaction.reply({ content: `❌ 單注上限 ${BET_MAX} 金幣。`, flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const r = await serviceContext.casinoService.placeBet({
      discordId: interaction.user.id,
      displayName: interaction.user.username,
      color,
      amount,
    });
    const meta = COLOR_META[color];
    await interaction.reply({
      content: `✅ 已押 **${amount.toLocaleString("zh-TW")}** 金幣到 ${meta.emoji} ${meta.label} ×${meta.mult}（第 #${r.roundId} 輪）\n結算後會私訊通知結果。`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({ content: `❌ ${err?.message || "下注失敗"}`, flags: MessageFlags.Ephemeral });
  }
}

// ── 我的紀錄 ─────────────────────────────────────────────────
async function handleMyRecord(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const stats = await serviceContext.casinoRepository.getPlayerStats(interaction.user.id, since)
    .catch(() => ({ totalBet: 0, totalPay: 0, wins: 0, count: 0 }));
  const net = (stats.totalPay || 0) - (stats.totalBet || 0);
  const round = await serviceContext.casinoService.getCurrentRound();
  const myBets = round ? await serviceContext.casinoRepository.listBetsByRoundAndPlayer(round.roundId, interaction.user.id).catch(() => []) : [];

  const embed = new EmbedBuilder()
    .setTitle("📜 我的賭場紀錄（近 7 天）")
    .setColor(0xf1c40f)
    .addFields(
      { name: "下注次數", value: String(stats.count || 0), inline: true },
      { name: "中獎次數", value: String(stats.wins || 0), inline: true },
      { name: "勝率", value: stats.count ? `${((stats.wins / stats.count) * 100).toFixed(1)}%` : "—", inline: true },
      { name: "總下注", value: `${Number(stats.totalBet || 0).toLocaleString("zh-TW")} 金幣`, inline: true },
      { name: "總贏回", value: `${Number(stats.totalPay || 0).toLocaleString("zh-TW")} 金幣`, inline: true },
      { name: "淨損益", value: `${net >= 0 ? "+" : ""}${net.toLocaleString("zh-TW")} 金幣`, inline: true },
    );
  if (myBets.length) {
    embed.addFields({
      name: `本輪你的下注（#${round.roundId}）`,
      value: myBets.map((b) => `${COLOR_META[b.color]?.emoji || "⚪"} ${b.color} ${b.amount.toLocaleString("zh-TW")}`).join("\n"),
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleRules(interaction) {
  const lines = [
    "🎰 **命運轉盤 詳細規則**",
    "",
    "**輪盤格子（20 格）**",
    "🟡 黃 ×2 — 9 格（45%）",
    "🟢 綠 ×3 — 6 格（30%）",
    "🔴 紅 ×5 — 3 格（15%）",
    "🔵 藍 ×10 — 1 格（5%）",
    "🟣 紫 ×15 — 1 格（5%）",
    "",
    "**回合節奏**：每 60 秒一輪，結算前 5 秒鎖盤。",
    "",
    "**押注**：100–50,000 金幣，單注賠付上限 500,000。",
    "**押中後額外抽道具**（依下注額解鎖）：",
    "・100–999：8%，僅 D 階",
    "・1,000–4,999：12%，至 C 階",
    "・5,000–9,999：15%，至 B 階",
    "・≥ 10,000：20%，**A 階全解鎖**（裝備 / 卡片 / 強化石）",
    "",
    "**掉落池內容**：強化石、裝備、怪物卡（不含 Boss 卡）。",
    "**通知**：結算後系統會私訊每位下注玩家，A 階獎勵與紫色開出會在廣播頻道公告。",
  ];
  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}

module.exports = {
  isCasinoButton,
  isCasinoModal,
  handleCasinoButton,
  handleCasinoModal,
  initCasinoPanel,
  publishCasinoPanel,
  setPanelEnabled,
};
