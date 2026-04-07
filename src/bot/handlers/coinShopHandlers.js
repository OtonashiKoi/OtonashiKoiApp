const { MessageFlags, AttachmentBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const {
  SHOP_OPEN_ID,
  SHOP_CANCEL_ID,
  SHOP_SELECT_ID,
  SHOP_CAT_PREFIX,
  createShopMainMessage,
  createConfirmMessage
} = require("../coinShopView");

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

/** 取得即時玩家等級（ephemeral cache 可能為空，補 fetch） */
async function fetchMemberTier(interaction) {
  let roleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
  if (roleIds.length === 0 && interaction.guild) {
    try {
      const m = await interaction.guild.members.fetch(interaction.user.id);
      roleIds = m.roles.cache.map((r) => r.id);
    } catch (_) {}
  }
  return getServiceContext().playerTierService.resolveHighestTier(roleIds).catch(() => null);
}

async function handleShopOpen(interaction, category = "all") {
  const serviceContext = getServiceContext();
  const [items, progress, realTier] = await Promise.all([
    serviceContext.shopService.listItems(),
    serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null),
    fetchMemberTier(interaction)
  ]);
  if (progress && realTier != null) progress.playerTier = realTier;
  const msg = createShopMainMessage(items, progress, category);
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  // 3分鐘無操作自動刪除
  setTimeout(() => interaction.deleteReply().catch(() => {}), 3 * 60 * 1000);
  // 非同步同步 DB 快取
  const memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
  serviceContext.shopService.updatePlayerTier(interaction.user.id, memberRoleIds);
}

async function handleShopCat(interaction, category) {
  const serviceContext = getServiceContext();
  const [items, progress, realTier] = await Promise.all([
    serviceContext.shopService.listItems(),
    serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null),
    fetchMemberTier(interaction)
  ]);
  if (progress && realTier != null) progress.playerTier = realTier;
  const msg = createShopMainMessage(items, progress, category);
  await interaction.update({ ...msg, embeds: [], attachments: [] });
}

/** 組成確認購買的 update payload（有縮圖時附帶） */
async function buildConfirmUpdate(item) {
  const displayUrl = item.imageThumbnailUrl || item.imageUrl;
  if (displayUrl) {
    try {
      const imagePath = path.resolve(__dirname, "../../web/public", displayUrl.replace(/^\//, ""));
      if (fs.existsSync(imagePath)) {
        const fileName = path.basename(imagePath);
        const attachment = new AttachmentBuilder(imagePath, { name: fileName });
        const msg = createConfirmMessage(item, fileName);
        return { ...msg, files: [attachment], attachments: [] };
      }
    } catch { /* fallthrough */ }
  }
  return { ...createConfirmMessage(item), embeds: [], attachments: [] };
}

async function handleShopBuy(interaction, itemId) {
  const serviceContext = getServiceContext();
  let item;
  try {
    item = await serviceContext.shopService.getItemById(itemId);
  } catch {
    await interaction.update({ content: "❌ 找不到此商品。", components: [], embeds: [], attachments: [] });
    return;
  }
  if (!item.enabled || item.stock === 0) {
    await interaction.update({ content: "❌ 此商品目前無法購買。", components: [], embeds: [], attachments: [] });
    return;
  }
  const updateData = await buildConfirmUpdate(item);
  await interaction.update(updateData);
}

async function handleShopConfirm(interaction, itemId) {
  const serviceContext = getServiceContext();
  try {
    // 取得成員身分組 ID 清單（ephemeral 互動 cache 可能為空，補 fetch）
    let memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
    if (memberRoleIds.length === 0 && interaction.guild) {
      try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        memberRoleIds = member.roles.cache.map((r) => r.id);
      } catch (_) {}
    }
    const { item } = await serviceContext.shopService.purchase(
      interaction.user.id,
      interaction.user.displayName || interaction.user.username,
      itemId,
      memberRoleIds
    );
    await interaction.update({
      content: `✅ 成功購買 **${item.name}**！已加入你的背包。`,
      components: [], embeds: [], attachments: []
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
  } catch (err) {
    await interaction.update({
      content: `❌ 購買失敗：${err.message}`,
      components: [], embeds: [], attachments: []
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function handleShopSelect(interaction) {
  const itemId = interaction.values[0];
  await handleShopBuy(interaction, itemId);
}

async function handleShopCancel(interaction) {
  // 回到商品列表（全部分類）
  const serviceContext = getServiceContext();
  const [items, progress, realTier] = await Promise.all([
    serviceContext.shopService.listItems(),
    serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null),
    fetchMemberTier(interaction)
  ]);
  if (progress && realTier != null) progress.playerTier = realTier;
  const msg = createShopMainMessage(items, progress, "all");
  await interaction.update({ ...msg, embeds: [], attachments: [] });
}

async function handleCoinShopButton(interaction) {
  const id = interaction.customId;
  if (id === SHOP_OPEN_ID) { await handleShopOpen(interaction); return; }
  if (id.startsWith(SHOP_CAT_PREFIX)) { await handleShopCat(interaction, id.slice(SHOP_CAT_PREFIX.length)); return; }
  if (id.startsWith("shop_buy:")) { await handleShopBuy(interaction, id.slice("shop_buy:".length)); return; }
  if (id.startsWith("shop_confirm:")) { await handleShopConfirm(interaction, id.slice("shop_confirm:".length)); return; }
  if (id === SHOP_CANCEL_ID) { await handleShopCancel(interaction); return; }
}

function isCoinShopButton(customId) {
  return (
    customId === SHOP_OPEN_ID ||
    customId === SHOP_CANCEL_ID ||
    customId.startsWith(SHOP_CAT_PREFIX) ||
    customId.startsWith("shop_buy:") ||
    customId.startsWith("shop_confirm:")
  );
}

function isCoinShopSelect(customId) {
  return customId === SHOP_SELECT_ID;
}

module.exports = { handleCoinShopButton, isCoinShopButton, handleShopSelect, isCoinShopSelect };

