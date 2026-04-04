const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const { BUTTON_IDS, createPlayerPanelMessage } = require("./playerPanelView");
const { createCode } = require("./bindingStore");

const AUTO_DELETE_MS = 60_000;

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

/** 回覆 ephemeral 訊息，並在 AUTO_DELETE_MS 後自動刪除 */
async function replyAndAutoDelete(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  setTimeout(() => interaction.deleteReply().catch(() => {}), AUTO_DELETE_MS);
}

async function replyPlayerBlocked(interaction) {
  await replyAndAutoDelete(interaction, "❌ 你目前不在可用玩家白名單中。");
}


async function handleProfile(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.playerService.getProfile(
    interaction.user.id,
    interaction.user.username
  );
  // 順帶更新等級（同步，確保展示的是最新等級）
  const memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
  await serviceContext.shopService.updatePlayerTier(interaction.user.id, memberRoleIds);
  // 重新讀取 progress 以拿到更新後的等級
  const freshProgress = await serviceContext.progressRepository
    ? await serviceContext.progressRepository.findByPlayerId(interaction.user.id)
    : null;
  const p = freshProgress || result.progress;
  const attrs = p.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const tierLine = p.playerTier ? `\n玄家等級：**${p.playerTier}級**` : "";
  
  await replyAndAutoDelete(interaction,
    `🧧 **${result.player.displayName} 的冒險者履歷**\n` +
    `職業：${p.job || "Novice"} (Job ${p.jobLevel || 1})\n` +
    `等級：Base ${p.level} (EXP: ${p.exp})${tierLine}\n` +
    `==============\n` +
    `【基本素質】\n` +
    `STR: ${attrs.str} | AGI: ${attrs.agi} | VIT: ${attrs.vit}\n` +
    `INT: ${attrs.int} | DEX: ${attrs.dex} | LUK: ${attrs.luk}\n` +
    `剩餘點數 (Status Pt): ${p.statusPoints || 0}\n` +
    `==============\n` +
    `【資產】\n` +
    `💰 金幣: ${result.wallet.gold}\n` +
    `💎 鑽石: ${result.wallet.diamond}`
  );
}

async function handleWallet(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.walletService.getWalletByDiscordId(
    interaction.user.id,
    interaction.user.username
  );

  await replyAndAutoDelete(interaction,
    `💰 ${result.player.displayName} 的錢包\n` +
    `金幣：${result.wallet.gold}\n` +
    `鑽石：${result.wallet.diamond}`
  );
}

async function handleTransactions(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.transactionService.listRecentByDiscordId(
    interaction.user.id,
    interaction.user.username,
    8
  );

  await replyAndAutoDelete(interaction, `📘 最近交易\n${formatTransactions(result.transactions)}`);
}

async function handleCheckinStatus(interaction) {
  const serviceContext = getServiceContext();
  const checkins = await serviceContext.checkinService.listRecentByDiscordId(
    interaction.user.id,
    7
  );

  const today = new Date().toISOString().slice(0, 10);
  const todayCheckin = checkins.find((c) => (c.occurredAt || "").slice(0, 10) === today);

  const statusLine = todayCheckin
    ? `✅ 今日已打卡！（${new Date(todayCheckin.occurredAt).toLocaleTimeString("zh-TW")} 獲得 ${todayCheckin.rewardDetail?.amount ?? 0} 金幣）`
    : `❌ 今日尚未打卡，在直播輸入 **!打卡** 可獲得 100 金幣！`;

  const historyLines = checkins.length
    ? checkins.map((c) => `${(c.occurredAt || "").slice(0, 10)}  +${c.rewardDetail?.amount ?? 0} 金幣`).join("\n")
    : "尚無打卡紀錄";

  await replyAndAutoDelete(interaction,
    `📅 **打卡狀態**\n${statusLine}\n\n` +
    `🗓️ **最近 7 天紀錄**\n${historyLines}`
  );
}

/** 根據 itemType 產生背包 ActionRow，idx 為顯示編號（0-based） */
function buildInventoryRow(e, idx) {
  const itemType = e.itemType || "consumable";
  const prefix = ["①","②","③","④","⑤"][idx] ?? `${idx+1}.`;
  const btns = [];
  if (itemType === "consumable") {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_use:${e.uuid}`)
        .setLabel(`${prefix} 使用`)
        .setStyle(ButtonStyle.Success)
    );
  } else {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel(`${prefix} 丟棄`)
        .setStyle(ButtonStyle.Danger)
    );
  }
  if (itemType === "consumable") {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel("丟棄")
        .setStyle(ButtonStyle.Danger)
    );
  }
  if (e.imageUrl) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_view:${e.uuid}`)
        .setLabel("🖼️ 查看圖片")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return new ActionRowBuilder().addComponents(btns);
}

/** 組成背包訊息（可附帶前置訊息行） */
function buildBackpackMessage(inventory, prefixMsg) {
  const header = prefixMsg ? prefixMsg + "\n\n" : "";
  if (!inventory.length) {
    return { content: header + "🎒 **背包**\n\n背包是空的，去商店購物吧！", components: [] };
  }
  const lines = inventory.map((e, i) => {
    const tag = e.itemType === "collectible" ? " 🖼️" : e.itemType === "equipment" ? " ⚔️" : "";
    return `${i + 1}. **${e.itemName}**${tag}　購於 ${(e.purchasedAt || "").slice(0, 10)}`;
  }).join("\n");
  const rows = inventory.slice(0, 5).map((e, i) => buildInventoryRow(e, i));
  return { content: header + `🎒 **背包**\n\n${lines}`, components: rows };
}

async function handleBind(interaction) {
  const serviceContext = getServiceContext();
  const player = await serviceContext.playerRepository.findByDiscordId(interaction.user.id);

  const externalIds = player?.externalIds || {};
  const streamAliases = player?.streamAliases || [];

  const boundLines = [];
  for (const [platform, uid] of Object.entries(externalIds)) {
    boundLines.push(`• ${platform}：\`${uid}\``);
  }
  for (const alias of streamAliases) {
    boundLines.push(`• 顯示名稱：\`${alias}\``);
  }

  if (boundLines.length > 0) {
    const code = createCode(interaction.user.id);
    await replyAndAutoDelete(interaction,
      `🔗 **直播帳號綁定狀態**\n\n` +
      `✅ 已綁定以下帳號：\n${boundLines.join("\n")}\n\n` +
      `如需重新綁定，請在直播聊天輸入以下指令：\n` +
      `**!綁定 ${code}**（10 分鐘內有效）`
    );
    return;
  }

  const code = createCode(interaction.user.id);
  await replyAndAutoDelete(interaction,
    `🔗 **直播帳號綁定**\n\n` +
    `你的綁定碼是：\`\`\`${code}\`\`\`\n` +
    `請在 **10 分鐘內**到直播聊天室（YT / Twitch）輸入：\n` +
    `**!綁定 ${code}**\n\n` +
    `綁定後，打卡就會自動識別你的直播帳號。`
  );
}

async function handleBackpack(interaction) {
  const serviceContext = getServiceContext();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory);
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 60_000);
}

async function handleBackpackView(interaction, uuid) {
  const serviceContext = getServiceContext();
  // 先 defer，給後續 I/O 最多 15 分鐘
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const entry = (progress?.inventory || []).find((e) => e.uuid === uuid);
  if (!entry || !entry.imageUrl) {
    await interaction.editReply({ content: "此道具沒有圖片。" });
    return;
  }
  try {
    const imagePath = path.resolve(__dirname, "../web/public", entry.imageUrl.replace(/^\//, ""));
    if (!fs.existsSync(imagePath)) {
      await interaction.reply({ content: "❌ 圖片檔案不存在。", flags: MessageFlags.Ephemeral });
      return;
    }
    const fileName = path.basename(imagePath);
    const attachment = new AttachmentBuilder(imagePath, { name: fileName });
    await interaction.editReply({
      content: `🖼️ **${entry.itemName}**\n購於 ${(entry.purchasedAt || "").slice(0, 10)}\n\n你可以右鍵點擊圖片 → 另存圖片。`,
      files: [attachment]
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ 無法載入圖片：${err.message}` });
  }
}

async function handleBackpackAction(interaction, action, uuid) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const isUse = action === "use";
    const result = isUse
      ? await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username)
      : await serviceContext.shopService.discardItem(interaction.user.id, uuid);
    const verb = isUse ? "使用" : "丟棄";
    const extra = isUse && result.effectDesc ? `\n${result.effectDesc}` : "";
    // 重新讀取背包，更新訊息
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(inventory, `✅ 已${verb} **${result.itemName}**。${extra}`);
    await interaction.editReply(msg);
    if (!inventory.length) {
      setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    }
  } catch (err) {
    await interaction.editReply({ content: `❌ 操作失敗：${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function handleButton(interaction) {
  const id = interaction.customId;

  // 背包動作
  if (id.startsWith("backpack_view:")) {
    await handleBackpackView(interaction, id.slice("backpack_view:".length));
    return;
  }
  if (id.startsWith("backpack_use:") || id.startsWith("backpack_discard:")) {
    const action = id.startsWith("backpack_use:") ? "use" : "discard";
    const uuid = id.slice(id.indexOf(":") + 1);
    await handleBackpackAction(interaction, action, uuid);
    return;
  }

  if (!Object.values(BUTTON_IDS).includes(id)) {
    return;
  }

  const serviceContext = getServiceContext();
  const allowed = await serviceContext.accessControlService.isDiscordPlayerAllowed(interaction);
  if (!allowed) {
    await replyPlayerBlocked(interaction);
    return;
  }

  if (id === BUTTON_IDS.profile) {
    await handleProfile(interaction);
    return;
  }

  if (id === BUTTON_IDS.transactions) {
    await handleTransactions(interaction);
    return;
  }

  if (id === BUTTON_IDS.checkinStatus) {
    await handleCheckinStatus(interaction);
    return;
  }

  if (id === BUTTON_IDS.backpack) {
    await handleBackpack(interaction);
    return;
  }

  if (id === BUTTON_IDS.bindStream) {
    await handleBind(interaction);
    return;
  }
}

module.exports = {
  createPlayerPanelMessage,
  handleButton
};