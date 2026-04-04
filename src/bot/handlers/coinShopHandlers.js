const { MessageFlags, AttachmentBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const {
  SHOP_OPEN_ID,
  SHOP_CANCEL_ID,
  SHOP_SELECT_ID,
  createShopMainMessage,
  createConfirmMessage
} = require("../coinShopView");

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

async function handleShopOpen(interaction) {
  const serviceContext = getServiceContext();
  const [items, progress] = await Promise.all([
    serviceContext.shopService.listItems(),
    serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null)
  ]);
  const msg = createShopMainMessage(items, progress);
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  // 3分鐘無操作自動刪除
  setTimeout(() => interaction.deleteReply().catch(() => {}), 3 * 60 * 1000);
  // 順帶更新玩家最高等級（非同步，不影響回應速度）
  const memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
  serviceContext.shopService.updatePlayerTier(interaction.user.id, memberRoleIds);
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
    // 取得成員身分組 ID 清單
    const memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
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
  // 回到商品列表
  const serviceContext = getServiceContext();
  const [items, progress] = await Promise.all([
    serviceContext.shopService.listItems(),
    serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null)
  ]);
  const msg = createShopMainMessage(items, progress);
  await interaction.update({ ...msg, embeds: [], attachments: [] });
}

async function handleCoinShopButton(interaction) {
  const id = interaction.customId;
  if (id === SHOP_OPEN_ID) { await handleShopOpen(interaction); return; }
  if (id.startsWith("shop_buy:")) { await handleShopBuy(interaction, id.slice("shop_buy:".length)); return; }
  if (id.startsWith("shop_confirm:")) { await handleShopConfirm(interaction, id.slice("shop_confirm:".length)); return; }
  if (id === SHOP_CANCEL_ID) { await handleShopCancel(interaction); return; }
}

function isCoinShopButton(customId) {
  return (
    customId === SHOP_OPEN_ID ||
    customId === SHOP_CANCEL_ID ||
    customId.startsWith("shop_buy:") ||
    customId.startsWith("shop_confirm:")
  );
}

function isCoinShopSelect(customId) {
  return customId === SHOP_SELECT_ID;
}

module.exports = { handleCoinShopButton, isCoinShopButton, handleShopSelect, isCoinShopSelect };

