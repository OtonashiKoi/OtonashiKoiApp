"use strict";

const { MessageFlags } = require("discord.js");
const { serviceContext } = require("../runtimeContext");
const { calcPlayerStats } = require("../../shared/combatStats");
const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const { runPkCombat } = require("../../shared/pkCombat");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const {
  BET_AMOUNT,
  ARENA_COUNT,
  createPkArenaPanelMessage,
  createPkBattleReportMessage,
} = require("../pkArenaView");

// ── 擂台狀態（記憶體，每台一個 slot） ───────────────────────
// slot: { challenger, defender, state, bets, betDeadline, firstAttacker, panelRef }
// challenger/defender: { discordId, name, stats }
// state: "empty" | "waiting" | "betting" | "fighting"
const arenaSlots = Array.from({ length: ARENA_COUNT }, () => null);

// 主面板的 Message 引用（供更新用）
let panelMessage = null;

// ── 工具 ─────────────────────────────────────────────────────

function getArenaIndex(customId) {
  const m = customId.match(/^pk:join:(\d+)$/);
  return m ? parseInt(m[1], 10) - 1 : -1;
}

function getBetInfo(customId) {
  // pk:bet:<arenaIndex1based>:<side>
  const m = customId.match(/^pk:bet:(\d+):(challenger|defender)$/);
  if (!m) return null;
  return { arenaIdx: parseInt(m[1], 10) - 1, side: m[2] };
}

async function refreshPanel() {
  if (!panelMessage) return;
  try {
    await panelMessage.edit(createPkArenaPanelMessage(arenaSlots));
  } catch (_) {}
}

async function loadPlayerData(discordId) {
  const sc = serviceContext;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) return null;
  const attrs    = progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const equipped = await mergeEquippedFromLibrary(progress.equipment || {}, sc.itemRepository);
  const inventory     = Array.isArray(progress.inventory) ? progress.inventory : [];
  const activeEffects = Array.isArray(progress.activeEffects) ? progress.activeEffects : [];
  const pStats   = calcPlayerStats(attrs, equipped, activeEffects, inventory);
  return { stats: pStats, equipped, inventory, activeEffects };
}

function getDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
}

// ── 入場 ─────────────────────────────────────────────────────
async function handleJoin(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sc   = serviceContext;
  const discordId = interaction.user.id;
  const name  = getDisplayName(interaction);
  const idx   = getArenaIndex(interaction.customId);

  if (idx < 0 || idx >= ARENA_COUNT) {
    await interaction.editReply({ content: "❌ 無效的擂台。" });
    return;
  }

  const slot = arenaSlots[idx];

  // 已有兩人或戰鬥中
  if (slot && (slot.state === "fighting" || slot.state === "betting" || (slot.challenger && slot.defender))) {
    await interaction.editReply({ content: "❌ 此擂台已滿員，請選其他擂台。" });
    return;
  }

  // 同一玩家不能重複加入同一擂台
  if (slot?.challenger?.discordId === discordId) {
    await interaction.editReply({ content: "⚠️ 你已在此擂台等待對手，請稍候。" });
    return;
  }

  // 確認玩家已存在
  const player = await sc.playerRepository.findByDiscordId(discordId).catch(() => null);
  if (!player) {
    await interaction.editReply({ content: "❌ 找不到你的玩家資料，請先建立角色。" });
    return;
  }

  // 讀取戰鬥數值（含完整裝備、庫存、activeEffects）
  const pData = await loadPlayerData(discordId);
  if (!pData) {
    await interaction.editReply({ content: "❌ 無法讀取你的戰鬥數值，請稍後再試。" });
    return;
  }

  const participant = { discordId, name, stats: pData.stats, opts: { equipped: pData.equipped, inventory: pData.inventory, activeEffects: pData.activeEffects } };

  if (!slot || !slot.challenger) {
    // 第一人進場 → 挑戰者
    arenaSlots[idx] = {
      state: "waiting",
      challenger: participant,
      defender:   null,
      bets:       {},
      betDeadline: null,
      firstAttacker: null,
    };
    await interaction.editReply({ content: `✅ 你已進入**擂台 ${idx + 1}**，等待對手應戰中…` });
  } else {
    // 第二人進場 → 應戰者，開始下注倒數
    const challName = slot.challenger.name;
    arenaSlots[idx] = {
      ...slot,
      state:       "betting",
      defender:    participant,
      betDeadline: Date.now() + 3 * 60 * 1000, // 3 分鐘
      firstAttacker: Math.random() < 0.5 ? "challenger" : "defender",
    };
    await interaction.editReply({
      content: `✅ 你已應戰 **${challName}** 於**擂台 ${idx + 1}**！\n⏳ 下注倒數 **3 分鐘**開始，其他玩家可押注誰會贏。`
    });

    // 3 分鐘後自動開打
    setTimeout(() => startBattle(interaction, idx), 3 * 60 * 1000);
  }

  await refreshPanel();
}

// ── 下注 ─────────────────────────────────────────────────────
async function handleBet(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sc        = serviceContext;
  const discordId = interaction.user.id;
  const betInfo   = getBetInfo(interaction.customId);

  if (!betInfo) {
    await interaction.editReply({ content: "❌ 無效的下注請求。" });
    return;
  }

  const { arenaIdx, side } = betInfo;
  const slot = arenaSlots[arenaIdx];

  if (!slot || slot.state !== "betting") {
    await interaction.editReply({ content: "❌ 此擂台目前不在下注階段。" });
    return;
  }

  // 參賽者不能下注自己的場
  if (slot.challenger?.discordId === discordId || slot.defender?.discordId === discordId) {
    await interaction.editReply({ content: "❌ 參賽者不能對自己的場次下注。" });
    return;
  }

  // 同一玩家同一擂台只能下注一次
  if (slot.bets[discordId]) {
    await interaction.editReply({ content: "⚠️ 你已對此場下注，每場只能押一次。" });
    return;
  }

  // 扣金幣
  const wallet = await sc.walletRepository.findByPlayerId(discordId).catch(() => null);
  if (!wallet || (wallet.gold ?? 0) < BET_AMOUNT) {
    await interaction.editReply({ content: `❌ 金幣不足，下注需要 **${BET_AMOUNT}** 🪙。` });
    return;
  }

  try {
    await sc.rewardService.grantCurrency({
      discordId,
      displayName: getDisplayName(interaction),
      currencyType: "gold",
      amount: -BET_AMOUNT,
      source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE,
      operator: "pk:bet",
    });
  } catch (_) {
    await interaction.editReply({ content: "❌ 扣款失敗，請稍後再試。" });
    return;
  }

  slot.bets[discordId] = { side, amount: BET_AMOUNT, name: getDisplayName(interaction) };

  const target = side === "challenger" ? slot.challenger.name : slot.defender.name;
  await interaction.editReply({ content: `✅ 已押注 **${BET_AMOUNT}** 🪙 → **${target}** 獲勝！` });

  await refreshPanel();
}

// ── 開戰 ─────────────────────────────────────────────────────
async function startBattle(interaction, idx) {
  const slot = arenaSlots[idx];
  if (!slot || slot.state !== "betting") return;

  arenaSlots[idx] = { ...slot, state: "fighting" };
  await refreshPanel();

  const sc = serviceContext;

  // 先攻方決定
  const challFirst = slot.firstAttacker === "challenger";
  const aName   = challFirst ? slot.challenger.name   : slot.defender.name;
  const bName   = challFirst ? slot.defender.name     : slot.challenger.name;
  const aStats  = challFirst ? slot.challenger.stats  : slot.defender.stats;
  const bStats  = challFirst ? slot.defender.stats    : slot.challenger.stats;
  const aOpts   = challFirst ? slot.challenger.opts   : slot.defender.opts;
  const bOpts   = challFirst ? slot.defender.opts     : slot.challenger.opts;

  const result = runPkCombat(aStats, aOpts, aName, bStats, bOpts, bName, 15);

  // ── 下注結算 ─────────────────────────────────────────────
  const betPayouts = [];
  const winningSide =
    result.winner === "A"
      ? (challFirst ? "challenger" : "defender")
      : result.winner === "B"
        ? (challFirst ? "defender" : "challenger")
        : null; // 平局

  const winnerPot = Object.values(slot.bets).reduce((s, b) => s + b.amount, 0);
  const winnerBetters = Object.entries(slot.bets).filter(([, b]) => b.side === winningSide);

  for (const [bid, bet] of Object.entries(slot.bets)) {
    if (!winningSide) {
      // 平局退還
      await sc.rewardService.grantCurrency({
        discordId: bid, displayName: bet.name,
        currencyType: "gold", amount: BET_AMOUNT,
        source: CURRENCY_SOURCES.QUEST_REWARD, operator: "pk:bet_refund",
      }).catch(() => {});
      betPayouts.push(`↩️ **${bet.name}** 退還 ${BET_AMOUNT} 🪙（平局）`);
    } else if (bet.side === winningSide) {
      // 均分彩池
      const share = winnerBetters.length > 0 ? Math.floor(winnerPot / winnerBetters.length) : 0;
      if (share > 0) {
        await sc.rewardService.grantCurrency({
          discordId: bid, displayName: bet.name,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.QUEST_REWARD, operator: "pk:bet_win",
        }).catch(() => {});
        betPayouts.push(`🏆 **${bet.name}** 獲得 ${share} 🪙`);
      }
    } else {
      betPayouts.push(`💸 **${bet.name}** 下注失敗，損失 ${bet.amount} 🪙`);
    }
  }

  // ── 發布戰報 ─────────────────────────────────────────────
  const reportMsg = createPkBattleReportMessage(slot, result, betPayouts);
  try {
    if (panelMessage?.channel) {
      await panelMessage.channel.send(reportMsg);
    }
  } catch (_) {}

  // 清空擂台
  arenaSlots[idx] = null;
  await refreshPanel();
}

// ── 重整面板 ─────────────────────────────────────────────────
async function handleRefresh(interaction) {
  await interaction.update(createPkArenaPanelMessage(arenaSlots));
}

// ── 發布面板（指令用） ────────────────────────────────────────
async function publishPkArenaPanel(interaction) {
  const msg = createPkArenaPanelMessage(arenaSlots);
  await interaction.reply(msg);
  panelMessage = await interaction.fetchReply();
}

// ── 路由判斷 ─────────────────────────────────────────────────
function isPkArenaButton(customId) {
  return typeof customId === "string" && customId.startsWith("pk:");
}

async function handlePkArenaButton(interaction) {
  if (interaction.customId === "pk:refresh") {
    await handleRefresh(interaction);
    return;
  }
  if (interaction.customId.startsWith("pk:join:")) {
    await handleJoin(interaction);
    return;
  }
  if (interaction.customId.startsWith("pk:bet:")) {
    await handleBet(interaction);
    return;
  }
}

module.exports = {
  isPkArenaButton,
  handlePkArenaButton,
  publishPkArenaPanel,
};
