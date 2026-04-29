const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

const SHOP_OPEN_ID = "shop_open";
const SHOP_CANCEL_ID = "shop_cancel";
const SHOP_CAT_PREFIX = "shop_cat:";
const SHOP_ITEM_PREFIX = "shop_item:";
const SHOP_PAGE_PREFIX = "shop_page:";
const TAIPEI_TIME_ZONE = "Asia/Taipei";

const CAT_LABELS = {
  all:         "📦 全部",
  consumable:  "🧪 消耗品",
  equipment:   "⚔️ 裝備",
  collectible: "🖼️ 圖片",
  special:     "✨ 特殊",
};

function shopBuyId(itemId) { return `shop_buy:${itemId}`; }
function shopConfirmId(itemId) { return `shop_confirm:${itemId}`; }
function shopQuantityModalId(itemId) { return `shop_quantity_modal:${itemId}`; }
function shopQuantityConfirmId(itemId) { return `shop_quantity_confirm:${itemId}`; }
function shopPageId(category, page) { return `${SHOP_PAGE_PREFIX}${category}:${page}`; }

function getTaipeiYearMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  return `${year}-${month}`;
}

// 等級由低到高
const TIER_ORDER = ["E", "D", "C", "B", "A", "S", "SS"];

/** 玩家等級是否符合商品要求（空陣列 = 全員可買；等級必須完全符合 allowedTiers 之一） */
function canBuyTier(playerTier, allowedTiers) {
  if (!allowedTiers || allowedTiers.length === 0) return true;
  if (!playerTier) return false;
  return allowedTiers.includes(playerTier);
}

function createCoinShopPanelMessage() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SHOP_OPEN_ID)
      .setLabel("🛒 逛商店")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    content: [
      "🏪 **金幣商店**",
      "使用金幣或鑽石兌換各種道具與特權！",
      "點下方按鈕瀏覽商品。"
    ].join("\n"),
    components: [row]
  };
}

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function formatShopItemBadge(item, inventory, monthlyCount, ym, claimedSet) {
  const badges = [];
  if (item.stock === 0) badges.push("❌售完");
  else if (item.stock > 0) badges.push(`📦${item.stock}`);
  if (item.maxPerMonth > 0) {
    const used = (monthlyCount[item.id] || {})[ym] || 0;
    if (used >= item.maxPerMonth) badges.push("⛔上限");
    else if (used > 0) badges.push(`🔄${used}/${item.maxPerMonth}`);
  }
  if (item.claimLimit === "once_per_player" && claimedSet.has(item.id)) {
    badges.push("🎫已領");
  } else if (item.claimLimit === "once_per_player") {
    badges.push("🎫1次");
  }
  const owned = inventory.filter((e) => e.itemId === item.id).length;
  if (owned > 0) badges.push(`✅×${owned}`);
  return badges.length ? `  ${badges.join("  ")}` : "";
}

function buildShopItemLabel(item, playerTier, inventory, monthlyCount, ym, claimedSet) {
  const badges = formatShopItemBadge(item, inventory, monthlyCount, ym, claimedSet);
  const price = item.price === 0 ? "免費" : `${item.price} ${item.currency === "diamond" ? "💎 鑽石" : "💰 金幣"}`;
  const tierOk = canBuyTier(playerTier, item.allowedTiers);
  const base = `${item.currency === "diamond" ? "💎" : "💰"} ${item.name}`.slice(0, 60);
  const prefix = !tierOk || item.stock === 0 ? "🔒 " : "";
  return `${prefix}${base}｜${price}${badges}`.slice(0, 80);
}

/**
 * 商店主畫面：文字清單 + 分類按鈕 + 分頁按鈕卡片
 */
function createShopMainMessage(items, progress, activeCategory = "all", claimedItemIds = [], page = 0) {
  const playerTier = progress?.playerTier || null;
  const ym = getTaipeiYearMonth();
  const inventory = progress?.inventory || [];
  const monthlyCount = progress?.shopMonthlyCount || {};
  const claimedSet = new Set(claimedItemIds || []);

  if (!items.length) {
    return { content: "🏪 目前商店沒有可購買的商品，請稍後再來！", components: [] };
  }

  // 分類篩選
  const catFiltered = activeCategory === "all"
    ? items
    : items.filter((i) => i.itemType === activeCategory);

  if (!catFiltered.length) {
    // 此分類無商品，仍顯示分類按鈕讓玩家切換
    const catRow = new ActionRowBuilder().addComponents(
      Object.entries(CAT_LABELS).map(([key, label]) =>
        new ButtonBuilder()
          .setCustomId(`${SHOP_CAT_PREFIX}${key}`)
          .setLabel(label)
          .setStyle(key === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );
    return {
      content: `🏪 **商店商品列表**\n\n此分類目前沒有商品。`,
      components: [catRow, new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SHOP_CANCEL_ID).setLabel("❌ 關閉商店").setStyle(ButtonStyle.Secondary)
      )]
    };
  }

  const gold    = catFiltered.filter((i) => !i.isSale && i.currency === "gold"    && canBuyTier(playerTier, i.allowedTiers));
  const diamond = catFiltered.filter((i) => !i.isSale && i.currency === "diamond" && canBuyTier(playerTier, i.allowedTiers));
  const sale    = catFiltered.filter((i) => i.isSale                               && canBuyTier(playerTier, i.allowedTiers));
  const ordered = [...gold, ...diamond, ...sale];
  const buyable = ordered;
  const pageSize = 4;
  const totalPages = Math.max(1, Math.ceil(buyable.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = buyable.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const components = [];

  // 分類篩選按鈕列
  const catRow = new ActionRowBuilder().addComponents(
    Object.entries(CAT_LABELS).map(([key, label]) =>
      new ButtonBuilder()
        .setCustomId(`${SHOP_CAT_PREFIX}${key}`)
        .setLabel(label)
        .setStyle(key === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
  components.push(catRow);

  if (pageItems.length > 0) {
    const itemRows = chunkArray(pageItems, 2);
    for (const rowItems of itemRows) {
      const row = new ActionRowBuilder().addComponents(
        rowItems.map((item) => {
          const canBuy = canBuyTier(playerTier, item.allowedTiers) && item.stock !== 0 && !(item.claimLimit === "once_per_player" && claimedSet.has(item.id));
          return new ButtonBuilder()
            .setCustomId(shopBuyId(item.id))
            .setLabel(buildShopItemLabel(item, playerTier, inventory, monthlyCount, ym, claimedSet))
            .setStyle(canBuy ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!canBuy);
        })
      );
      components.push(row);
    }
  }

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(shopPageId(activeCategory, safePage - 1))
          .setLabel("◀ 上一頁")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage <= 0),
        new ButtonBuilder()
          .setCustomId(shopPageId(activeCategory, safePage))
          .setLabel(`${safePage + 1}/${totalPages}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(shopPageId(activeCategory, safePage + 1))
          .setLabel("下一頁 ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(SHOP_CANCEL_ID)
        .setLabel("❌ 關閉商店")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const lines = pageItems.length
    ? pageItems.map((item, index) => {
        const price = item.price === 0 ? "免費" : `${item.price} ${item.currency === "diamond" ? "💎 鑽石" : "💰 金幣"}`;
        const badges = formatShopItemBadge(item, inventory, monthlyCount, ym, claimedSet);
        return `${safePage * pageSize + index + 1}. **${item.name}** — ${price}${badges}`;
      })
    : ["此頁沒有商品。"];

  const title = CAT_LABELS[activeCategory] || "📦 全部";
  const pageLine = buyable.length > 0
    ? `第 ${safePage + 1} / ${totalPages} 頁，共 ${buyable.length} 項可購買商品`
    : "目前沒有可購買商品。";

  return {
    content: `🏪 **商店商品列表 ${title}**\n${pageLine}\n\n${lines.join("\n")}`,
    components
  };
}

function createConfirmMessage(item, attachmentName) {
  const currencyLabel = item.currency === "diamond" ? "💎 鑽石" : "💰 金幣";
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(shopConfirmId(item.id))
      .setLabel("✅ 確認購買")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(SHOP_CANCEL_ID)
      .setLabel("❌ 取消")
      .setStyle(ButtonStyle.Secondary)
  );

  if (attachmentName) {
    const embed = new EmbedBuilder()
      .setTitle(item.name)
      .setDescription(`${item.description}\n\n消耗：**${item.price} ${currencyLabel}**`)
      .setThumbnail(`attachment://${attachmentName}`)
      .setColor(item.currency === "diamond" ? 0x22c55e : 0xf59e0b);
    return { embeds: [embed], components: [row] };
  }

  return {
    content: `🛒 確定要購買 **${item.name}** 嗎？\n消耗：**${item.price} ${currencyLabel}**\n\n${item.description}`,
    components: [row]
  };
}

/**
 * 創建消耗品數量輸入的 Modal
 */
function createQuantityModal(item) {
  const modal = new ModalBuilder()
    .setCustomId(shopQuantityModalId(item.id))
    .setTitle(`購買 ${item.name}`);

  const quantityInput = new TextInputBuilder()
    .setCustomId("quantity_input")
    .setLabel("購買數量")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("輸入要購買的數量（1-999）")
    .setMinLength(1)
    .setMaxLength(3)
    .setValue("1");

  modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));
  return modal;
}

/**
 * 創建消耗品購買確認訊息（顯示數量與總價）
 */
function createConsumableConfirmMessage(item, quantity) {
  const currencyLabel = item.currency === "diamond" ? "💎 鑽石" : "💰 金幣";
  const totalPrice = item.price * quantity;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(shopQuantityConfirmId(item.id))
      .setLabel("✅ 確認購買")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(SHOP_CANCEL_ID)
      .setLabel("❌ 取消")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: `🛒 確定要購買 **${item.name}** 嗎？\n單價：**${item.price}** ${currencyLabel}\n數量：**${quantity}**\n總額：**${totalPrice}** ${currencyLabel}\n\n${item.description}`,
    components: [row]
  };
}

module.exports = {
  SHOP_OPEN_ID,
  SHOP_CANCEL_ID,
  SHOP_CAT_PREFIX,
  shopBuyId,
  shopConfirmId,
  shopQuantityModalId,
  shopQuantityConfirmId,
  shopPageId,
  createCoinShopPanelMessage,
  createShopMainMessage,
  createConfirmMessage,
  createQuantityModal,
  createConsumableConfirmMessage
};
