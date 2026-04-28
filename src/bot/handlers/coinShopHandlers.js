const { MessageFlags, AttachmentBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const {
  SHOP_OPEN_ID,
  SHOP_CANCEL_ID,
  SHOP_SELECT_ID,
  SHOP_CAT_PREFIX,
  shopQuantityModalId,
  shopQuantityConfirmId,
  createShopMainMessage,
  createConfirmMessage,
  createQuantityModal,
  createConsumableConfirmMessage
} = require("../coinShopView");

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

/** 取得即時玩家等級與身分組 ID（ephemeral cache 可能為空，補 fetch）*/
async function fetchMemberTier(interaction) {
  let roleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
  if (roleIds.length === 0 && interaction.guild) {
    try {
      const m = await interaction.guild.members.fetch(interaction.user.id);
      roleIds = m.roles.cache.map((r) => r.id);
    } catch (_) {}
  }
  const tier = await getServiceContext().playerTierService.resolveHighestTier(roleIds).catch(() => null);
  return { tier, roleIds };
}

async function handleShopOpen(interaction, category = "all") {
  const serviceContext = getServiceContext();
  const [items, progress, { tier: realTier, roleIds }] = await Promise.all([
    serviceContext.shopService.listItems(),
    serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null),
    fetchMemberTier(interaction)
  ]);
  if (progress && realTier != null) progress.playerTier = realTier;
  const msg = createShopMainMessage(items, progress, category);
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  // 3分鐘無操作自動刪除
  setTimeout(() => interaction.deleteReply().catch(() => {}), 3 * 60 * 1000);
  // 非同步將等級同步回 DB
  serviceContext.shopService.updatePlayerTier(interaction.user.id, roleIds);
}

async function handleShopCat(interaction, category) {
  const serviceContext = getServiceContext();
  const [items, progress, { tier: realTier }] = await Promise.all([
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

  // 消耗品：顯示數量輸入 Modal
  if (item.itemType === "consumable") {
    const modal = createQuantityModal(item);
    await interaction.showModal(modal);
    return;
  }

  // 非消耗品：顯示購買確認
  const updateData = await buildConfirmUpdate(item);
  await interaction.update(updateData);
}

async function handleShopConfirm(interaction, itemId, quantity = 1) {
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
      memberRoleIds,
      quantity
    );
    const quantityText = quantity > 1 ? `**${quantity}** 個` : "";
    await interaction.update({
      content: `✅ 成功購買 ${quantityText}**${item.name}**！已加入你的背包。`,
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

/**
 * 處理消耗品數量 Modal 提交
 */
async function handleQuantityModalSubmit(interaction) {
  const modalId = interaction.customId;
  const itemId = modalId.replace("shop_quantity_modal:", "");
  const quantityStr = interaction.fields.getTextInputValue("quantity_input").trim();

  // 驗證數量
  let quantity = parseInt(quantityStr, 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    await interaction.reply({
      content: "❌ 數量必須是 1 到 999 之間的整數。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // 獲取商品並顯示確認訊息
  const serviceContext = getServiceContext();
  try {
    const item = await serviceContext.shopService.getItemById(itemId);
    if (!item.enabled || item.stock === 0) {
      await interaction.reply({
        content: "❌ 此商品目前無法購買。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // 檢查庫存
    if (item.stock > 0 && quantity > item.stock) {
      await interaction.reply({
        content: `❌ 庫存不足。目前庫存只有 **${item.stock}** 個。`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const msg = createConsumableConfirmMessage(item, quantity);
    // 儲存數量到 customData 以便後續確認時使用
    msg.components[0].components[0].setCustomId(`shop_quantity_confirm:${itemId}:${quantity}`);
    await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  } catch (err) {
    await interaction.reply({
      content: `❌ 錯誤：${err.message}`,
      flags: MessageFlags.Ephemeral
    });
  }
}

/**
 * 處理消耗品數量確認購買
 */
async function handleQuantityConfirm(interaction, customId) {
  const parts = customId.replace("shop_quantity_confirm:", "").split(":");
  if (parts.length < 2) {
    await interaction.update({
      content: "❌ 無效的購買請求。",
      components: [], embeds: [], attachments: []
    });
    return;
  }

  const itemId = parts[0];
  const quantity = parseInt(parts[1], 10);

  if (!Number.isInteger(quantity) || quantity < 1) {
    await interaction.update({
      content: "❌ 無效的數量。",
      components: [], embeds: [], attachments: []
    });
    return;
  }

  // 直接執行購買
  await handleShopConfirm(interaction, itemId, quantity);
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
  if (id.startsWith("shop_quantity_confirm:")) { await handleQuantityConfirm(interaction, id); return; }
  if (id === SHOP_CANCEL_ID) { await handleShopCancel(interaction); return; }
}

function isCoinShopButton(customId) {
  return (
    customId === SHOP_OPEN_ID ||
    customId === SHOP_CANCEL_ID ||
    customId.startsWith(SHOP_CAT_PREFIX) ||
    customId.startsWith("shop_buy:") ||
    customId.startsWith("shop_confirm:") ||
    customId.startsWith("shop_quantity_confirm:")
  );
}

function isCoinShopSelect(customId) {
  return customId === SHOP_SELECT_ID;
}

function isCoinShopModal(customId) {
  return customId.startsWith("shop_quantity_modal:");
}

module.exports = { handleCoinShopButton, isCoinShopButton, handleShopSelect, isCoinShopSelect, handleQuantityModalSubmit, isCoinShopModal };

