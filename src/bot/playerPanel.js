const { MessageFlags } = require("discord.js");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../shared/sources");
const { BUTTON_IDS, createPlayerPanelMessage } = require("./playerPanelView");

function getServiceContext() {
  return require("./runtimeContext").serviceContext;
}

function formatTransactions(rows) {
  if (rows.length === 0) {
    return "目前沒有交易紀錄。";
  }

  return rows
    .map((row) => {
      const sign = row.direction === "debit" ? "-" : "+";
      return `${row.currencyType} ${sign}${Math.abs(row.amount)} | ${row.source} | ${row.balanceAfter}`;
    })
    .join("\n");
}

async function replyPlayerBlocked(interaction) {
  await interaction.reply({
    content: "❌ 你目前不在可用玩家白名單中。",
    flags: MessageFlags.Ephemeral
  });
}

async function handleCreate(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.playerService.ensurePlayer(
    interaction.user.id,
    interaction.user.username
  );

  await interaction.reply({
    content:
      `✅ 玩家初始化完成\n` +
      `玩家：${result.player.displayName}\n` +
      `金幣：${result.wallet.gold}\n` +
      `鑽石：${result.wallet.diamond}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleProfile(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.playerService.getProfile(
    interaction.user.id,
    interaction.user.username
  );

  await interaction.reply({
    content:
      `🧾 玩家資料\n` +
      `玩家：${result.player.displayName}\n` +
      `狀態：${result.player.status}\n` +
      `等級：${result.progress.level}\n` +
      `經驗：${result.progress.exp}\n` +
      `金幣：${result.wallet.gold}\n` +
      `鑽石：${result.wallet.diamond}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleWallet(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.walletService.getWalletByDiscordId(
    interaction.user.id,
    interaction.user.username
  );

  await interaction.reply({
    content:
      `💰 ${result.player.displayName} 的錢包\n` +
      `金幣：${result.wallet.gold}\n` +
      `鑽石：${result.wallet.diamond}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleTransactions(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.transactionService.listRecentByDiscordId(
    interaction.user.id,
    interaction.user.username,
    8
  );

  await interaction.reply({
    content: `📘 最近交易\n${formatTransactions(result.transactions)}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleReward(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.rewardService.grantCurrency({
    discordId: interaction.user.id,
    displayName: interaction.user.username,
    currencyType: "gold",
    amount: 100,
    source: CURRENCY_SOURCES.DISCORD_TEST_REWARD,
    operator: interaction.user.id
  });

  await interaction.reply({
    content:
      `🎁 已發送測試獎勵\n` +
      `玩家：${result.player.displayName}\n` +
      `金幣：${result.wallet.gold}\n` +
      `來源：${result.transaction.source}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleExp(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.progressService.grantExp({
    discordId: interaction.user.id,
    displayName: interaction.user.username,
    amount: 120,
    source: EXP_SOURCES.DISCORD_TEST_EXP
  });

  await interaction.reply({
    content:
      `⭐ 已發送測試經驗\n` +
      `玩家：${result.player.displayName}\n` +
      `等級：${result.progress.level}\n` +
      `經驗：${result.progress.exp}\n` +
      `升級次數：${result.levelUps}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleButton(interaction) {
  if (!Object.values(BUTTON_IDS).includes(interaction.customId)) {
    return;
  }

  const serviceContext = getServiceContext();
  const allowed = await serviceContext.accessControlService.isDiscordPlayerAllowed(interaction);
  if (!allowed) {
    await replyPlayerBlocked(interaction);
    return;
  }

  if (interaction.customId === BUTTON_IDS.create) {
    await handleCreate(interaction);
    return;
  }

  if (interaction.customId === BUTTON_IDS.profile) {
    await handleProfile(interaction);
    return;
  }

  if (interaction.customId === BUTTON_IDS.wallet) {
    await handleWallet(interaction);
    return;
  }

  if (interaction.customId === BUTTON_IDS.transactions) {
    await handleTransactions(interaction);
    return;
  }

  if (interaction.customId === BUTTON_IDS.reward) {
    await handleReward(interaction);
    return;
  }

  if (interaction.customId === BUTTON_IDS.exp) {
    await handleExp(interaction);
  }
}

module.exports = {
  createPlayerPanelMessage,
  handleButton
};