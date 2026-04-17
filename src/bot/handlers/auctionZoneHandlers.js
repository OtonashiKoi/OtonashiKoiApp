"use strict";

const {
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

const ENHANCE_GEM_IDS = new Set([
  '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  '556db9e1-b084-4b22-bab5-a66c2b586184',
  '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  'a6ae293d-52fc-4af5-8770-891ddf842e35'
]);

function getSC() { return require("../runtimeContext").serviceContext; }

// ─── customId 前綴 ────────────────────────────────────
const PFX = {
  open:         "auction:open",
  filter:       "auction:filter:",
  buy:          "auction:buy:",
  buyConfirm:   "auction:buy_confirm:",
  myList:       "auction:my_list",
  reclaim:      "auction:reclaim:",
  sell:         "auction:sell",
  sellItem:     "auction:sell_item:",     // 選好物品後
  sellCurrency: "auction:sell_currency:", // 選好貨幣後
  sellModal:    "auction:sell_modal:",    // 填寫價格 Modal
  sellConfirm:  "auction:sell_confirm:",  // 確認上架
};

function isAuctionButton(customId) {
  return customId.startsWith("auction:");
}

// ─── 金額格式 ─────────────────────────────────────────
function fmtPrice(price, currency) {
  return currency === "gold"
    ? `${price.toLocaleString()} 💰`
    : `${price.toLocaleString()} 💎`;
}

function fmtRemaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "已到期";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtItem(item) {
  const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
  const stack = item.isGem && item.stackCount ? ` ×${item.stackCount}` : "";
  return `${item.itemName}${enh}${stack}`;
}

// ─── 拍賣列表面板 ────────────────────────────────────
async function buildAuctionPanel(filter = {}) {
  const sc = getSC();
  const auctions = await sc.auctionService.getActiveListings(filter);

  // 先讓到期的自動標記
  await sc.auctionService.processExpired();

  // 篩選按鈕列
  const filterRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PFX.filter}all`).setLabel("全部").setStyle(filter.all ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PFX.filter}equipment`).setLabel("⚔️ 裝備").setStyle(filter.itemType === "equipment" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PFX.filter}gem`).setLabel("💎 寶石").setStyle(filter.itemType === "gem" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PFX.filter}gold`).setLabel("💰 金幣").setStyle(filter.currency === "gold" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PFX.filter}diamond`).setLabel("💎 鑽石").setStyle(filter.currency === "diamond" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  const sortRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PFX.filter}price_asc`).setLabel("價格↑").setStyle(filter.sort === "price_asc" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PFX.filter}price_desc`).setLabel("價格↓").setStyle(filter.sort === "price_desc" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PFX.filter}time_asc`).setLabel("快到期").setStyle(filter.sort === "time_asc" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PFX.myList).setLabel("📦 我的上架").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PFX.sell).setLabel("🏷️ 上架商品").setStyle(ButtonStyle.Success),
  );

  if (!auctions.length) {
    return {
      content: `🏪 **拍賣場**\n\n目前沒有上架中的商品。`,
      components: [filterRow, sortRow],
    };
  }

  const lines = auctions.slice(0, 8).map((a, i) => {
    const item = fmtItem(a.item);
    const price = fmtPrice(a.price, a.currency);
    const remain = fmtRemaining(a.expiresAt);
    return `\`${i + 1}.\` **${item}** ─ ${price}　剩 ${remain}`;
  });

  // 購買按鈕（最多 5 件/列）
  const buyRows = [];
  const slice = auctions.slice(0, 8);
  for (let i = 0; i < slice.length; i += 4) {
    const chunk = slice.slice(i, i + 4);
    buyRows.push(new ActionRowBuilder().addComponents(
      chunk.map((a, j) =>
        new ButtonBuilder()
          .setCustomId(`${PFX.buy}${a.id}`)
          .setLabel(`購買 ${i + j + 1}`)
          .setStyle(ButtonStyle.Primary)
      )
    ));
  }

  return {
    content: `🏪 **拍賣場** （共 ${auctions.length} 件）\n\n${lines.join("\n")}`,
    components: [filterRow, sortRow, ...buyRows],
  };
}

// ─── 主按鈕入口 ──────────────────────────────────────
async function handleAuctionButton(interaction) {
  const id = interaction.customId;

  // 開啟拍賣場
  if (id === PFX.open) {
    await interaction.deferUpdate();
    const panel = await buildAuctionPanel();
    await interaction.editReply({ ...panel, flags: MessageFlags.Ephemeral });
    return;
  }

  // 篩選
  if (id.startsWith(PFX.filter)) {
    await interaction.deferUpdate();
    const key = id.slice(PFX.filter.length);
    const filter = {};
    if (key === "equipment") filter.itemType = "equipment";
    else if (key === "gem") filter.itemType = "gem";
    else if (key === "gold") filter.currency = "gold";
    else if (key === "diamond") filter.currency = "diamond";
    else if (key === "price_asc") filter.sort = "price_asc";
    else if (key === "price_desc") filter.sort = "price_desc";
    else if (key === "time_asc") filter.sort = "time_asc";
    const panel = await buildAuctionPanel(filter);
    await interaction.editReply(panel);
    return;
  }

  // 點購買 → 顯示確認視窗
  if (id.startsWith(PFX.buy)) {
    const auctionId = id.slice(PFX.buy.length);
    await interaction.deferUpdate();
    const sc = getSC();
    const auction = await sc.auctionService.getActiveListings();
    const a = auction.find(x => x.id === auctionId);
    if (!a) {
      await interaction.editReply({ content: "❌ 找不到該商品，可能已售出或到期。", components: [] });
      return;
    }
    const item = fmtItem(a.item);
    const price = fmtPrice(a.price, a.currency);
    const remain = fmtRemaining(a.expiresAt);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PFX.buyConfirm}${auctionId}`).setLabel("確認購買").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(PFX.open).setLabel("取消").setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      content: `🛒 **確認購買**\n\n商品：**${item}**\n價格：${price}\n剩餘時間：${remain}\n\n確定要購買嗎？`,
      components: [row],
    });
    return;
  }

  // 確認購買
  if (id.startsWith(PFX.buyConfirm)) {
    const auctionId = id.slice(PFX.buyConfirm.length);
    await interaction.deferUpdate();
    const sc = getSC();
    try {
      const result = await sc.auctionService.buyItem(interaction.user.id, auctionId);
      const panel = await buildAuctionPanel();
      await interaction.editReply({
        ...panel,
        content: `✅ 成功購買 **${result.itemName}**！物品已進入背包。\n\n${panel.content}`,
      });
      // 通知賣家
      try {
        const { getBotClient } = require("../runtimeContext");
        const client = getBotClient();
        if (client?.isReady()) {
          const sellerUser = await client.users.fetch(result.auction.sellerId).catch(() => null);
          if (sellerUser) {
            const priceStr = fmtPrice(result.auction.price, result.auction.currency);
            await sellerUser.send(`💰 **拍賣成交通知**\n你的 **${result.itemName}** 已售出，獲得 ${priceStr}！`).catch(() => {});
          }
        }
      } catch (_) {}
    } catch (err) {
      await interaction.editReply({ content: `❌ 購買失敗：${err.message}`, components: [] });
    }
    return;
  }

  // 我的上架
  if (id === PFX.myList) {
    await interaction.deferUpdate();
    const sc = getSC();
    const listings = await sc.auctionService.getMyListings(interaction.user.id);
    if (!listings.length) {
      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(PFX.open).setLabel("← 返回拍賣場").setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({ content: "📦 你目前沒有上架中或待領回的商品。", components: [backRow] });
      return;
    }
    const lines = listings.map((a, i) => {
      const item = fmtItem(a.item);
      const price = fmtPrice(a.price, a.currency);
      const statusLabel = a.status === "active" ? `剩 ${fmtRemaining(a.expiresAt)}` : "⏰ 待領回";
      return `\`${i + 1}.\` **${item}** ─ ${price}　${statusLabel}`;
    });
    // 領回按鈕（只顯示 expired 的）
    const expiredListings = listings.filter(a => a.status === "expired");
    const reclaimBtns = expiredListings.slice(0, 4).map(a =>
      new ButtonBuilder()
        .setCustomId(`${PFX.reclaim}${a.id}`)
        .setLabel(`領回 ${fmtItem(a.item)}`)
        .setStyle(ButtonStyle.Success)
    );
    const backBtn = new ButtonBuilder().setCustomId(PFX.open).setLabel("← 返回").setStyle(ButtonStyle.Secondary);
    const rows = [];
    if (reclaimBtns.length > 0) {
      rows.push(new ActionRowBuilder().addComponents(...reclaimBtns, backBtn));
    } else {
      rows.push(new ActionRowBuilder().addComponents(backBtn));
    }
    await interaction.editReply({ content: `📦 **我的上架**\n\n${lines.join("\n")}`, components: rows });
    return;
  }

  // 領回
  if (id.startsWith(PFX.reclaim)) {
    const auctionId = id.slice(PFX.reclaim.length);
    await interaction.deferUpdate();
    const sc = getSC();
    try {
      const result = await sc.auctionService.reclaimItem(interaction.user.id, auctionId);
      const listings = await sc.auctionService.getMyListings(interaction.user.id);
      const remaining = listings.filter(a => a.status === "expired");
      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(PFX.open).setLabel("← 返回拍賣場").setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({
        content: `✅ 已領回 **${result.itemName}**！物品已退回背包。${remaining.length > 0 ? `\n\n還有 ${remaining.length} 件待領回。` : ""}`,
        components: [backRow],
      });
    } catch (err) {
      await interaction.editReply({ content: `❌ 領回失敗：${err.message}`, components: [] });
    }
    return;
  }

  // ─── 上架流程 ───────────────────────────────────────

  // Step 1: 點「上架商品」→ 顯示背包中可上架的物品（Select Menu）
  if (id === PFX.sell) {
    await interaction.deferUpdate();
    const sc = getSC();

    // 會員資格檢查
    const memberRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];
    const eligible = await sc.auctionService.checkSellerEligibility(memberRoleIds);
    if (!eligible) {
      await interaction.editReply({ content: "❌ 只有 Tier C 以上的會員才能上架商品。", components: [] });
      return;
    }

    // 是否已有上架
    const activeCount = await sc.auctionService.getActiveListingCount(interaction.user.id);
    if (activeCount >= 1) {
      await interaction.editReply({ content: "❌ 你目前已有上架中的商品，最多同時上架 1 件。", components: [] });
      return;
    }

    const progress = await sc.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];

    // 可上架的物品：裝備 + 強化寶石
    const sellable = inventory.filter(item =>
      item.itemType === "equipment" || ENHANCE_GEM_IDS.has(item.itemId)
    );

    if (!sellable.length) {
      await interaction.editReply({ content: "❌ 背包中沒有可上架的裝備或強化寶石。", components: [] });
      return;
    }

    const options = sellable.slice(0, 25).map(item => {
      const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
      const stack = item.stackCount ? ` ×${item.stackCount}` : "";
      const stats = item.equipStats ? ` [${Object.entries(item.equipStats).map(([k, v]) => `${k}+${v}`).join(",")}]` : "";
      return {
        label: `${item.itemName}${enh}${stack}`.slice(0, 100),
        description: stats.slice(0, 100) || "強化寶石",
        value: item.uuid,
      };
    });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PFX.sellItem}select`)
        .setPlaceholder("選擇要上架的物品")
        .addOptions(options)
    );
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(PFX.open).setLabel("← 取消").setStyle(ButtonStyle.Secondary)
    );
    await interaction.editReply({ content: "🏷️ **上架商品**\n\n請選擇要上架的物品：", components: [row, backRow] });
    return;
  }

  // Step 3: 選完貨幣 → 彈出 Modal 填寫價格 + 時間（Button 互動直接 showModal）
  if (id.startsWith(PFX.sellCurrency)) {
    const parts = id.slice(PFX.sellCurrency.length).split(":");
    const itemUuid = parts[0];
    const currency = parts[1]; // "gold" | "diamond"

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${PFX.sellModal}${itemUuid}:${currency}`)
        .setTitle("設定價格與上架時間")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("price_input")
              .setLabel(currency === "gold" ? "金幣定價（5,000 ～ 10,000,000）" : "鑽石定價（1 ～ 200,000）")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder(currency === "gold" ? "例：50000" : "例：1000")
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("hours_input")
              .setLabel("上架時間（小時）：1、6、12、24")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("例：24")
              .setRequired(true)
          )
        )
    );
    return;
  }
}

// ─── Select Menu 入口 ────────────────────────────────
async function handleAuctionSelect(interaction) {
  const id = interaction.customId;

  // Step 2: 選完物品 → 選擇貨幣
  if (id === `${PFX.sellItem}select`) {
    await interaction.deferUpdate();
    const itemUuid = interaction.values[0];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PFX.sellCurrency}${itemUuid}:gold`).setLabel("💰 金幣").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PFX.sellCurrency}${itemUuid}:diamond`).setLabel("💎 鑽石").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(PFX.open).setLabel("← 取消").setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ content: "💱 **選擇定價貨幣**\n\n你想用哪種貨幣標價？", components: [row] });
    return;
  }
}

// ─── Modal 提交 ──────────────────────────────────────
async function handleAuctionModal(interaction) {
  const id = interaction.customId;

  if (id.startsWith(PFX.sellModal)) {
    const parts = id.slice(PFX.sellModal.length).split(":");
    const itemUuid = parts[0];
    const currency = parts[1];

    const priceRaw = interaction.fields.getTextInputValue("price_input").trim().replace(/,/g, "");
    const hoursRaw = interaction.fields.getTextInputValue("hours_input").trim();
    const price = parseInt(priceRaw, 10);
    const hours = parseInt(hoursRaw, 10);

    if (!Number.isFinite(price) || !Number.isFinite(hours)) {
      await interaction.reply({ content: "❌ 請輸入有效的數字。", flags: MessageFlags.Ephemeral });
      return true;
    }

    // 取得物品資訊用來顯示確認視窗
    const sc = getSC();
    const progress = await sc.progressRepository.findByPlayerId(interaction.user.id);
    const item = (progress?.inventory || []).find(i => i.uuid === itemUuid);
    if (!item) {
      await interaction.reply({ content: "❌ 找不到該物品。", flags: MessageFlags.Ephemeral });
      return true;
    }

    const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
    const stack = item.stackCount ? ` ×${item.stackCount}` : "";
    const itemLabel = `${item.itemName}${enh}${stack}`;
    const priceLabel = currency === "gold" ? `${price.toLocaleString()} 💰` : `${price.toLocaleString()} 💎`;

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PFX.sellConfirm}${itemUuid}:${currency}:${price}:${hours}`)
        .setLabel("確認上架")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(PFX.open)
        .setLabel("取消")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: `📋 **確認上架**\n\n商品：**${itemLabel}**\n定價：${priceLabel}\n時間：${hours} 小時\n\n**上架後不可撤回**，確定要上架嗎？`,
      components: [confirmRow],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }
  return false;
}

// ─── 確認上架按鈕 ─────────────────────────────────────
async function handleAuctionSellConfirm(interaction) {
  const id = interaction.customId;

  if (id.startsWith(PFX.sellConfirm)) {
    await interaction.deferUpdate();
    const parts = id.slice(PFX.sellConfirm.length).split(":");
    const itemUuid = parts[0];
    const currency = parts[1];
    const price = parseInt(parts[2], 10);
    const hours = parseInt(parts[3], 10);

    const sc = getSC();
    try {
      const auction = await sc.auctionService.listItem({
        sellerId: interaction.user.id,
        itemUuid,
        currency,
        price,
        hours,
      });
      const enh = auction.item.enhanceLevel > 0 ? ` +${auction.item.enhanceLevel}` : "";
      await interaction.editReply({
        content: `✅ **上架成功！**\n\n商品：**${auction.item.itemName}${enh}**\n定價：${fmtPrice(price, currency)}\n到期：${new Date(auction.expiresAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`,
        components: [],
      });
      // 刷新拍賣場面板（公開頻道）
      await refreshAuctionChannel();
    } catch (err) {
      await interaction.editReply({ content: `❌ 上架失敗：${err.message}`, components: [] });
    }
    return true;
  }
  return false;
}

// ─── 刷新拍賣場頻道公開面板 ──────────────────────────
async function refreshAuctionChannel() {
  try {
    const sc = getSC();
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;

    const config = await sc.auctionService.getChannelConfig();
    if (!config?.channelId) return;

    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!channel) return;

    // 找到最近一條 bot 的面板訊息
    const messages = await channel.messages.fetch({ limit: 20 });
    const panelMsg = messages.find(m => m.author.id === client.user.id && m.components?.length > 0);

    const panel = await buildPublicAuctionPanel();

    if (panelMsg) {
      await panelMsg.edit(panel).catch(() => {});
    }
  } catch (_) {}
}

// ─── 公開頻道面板（顯示商品列表，但互動用 ephemeral） ──
async function buildPublicAuctionPanel() {
  const sc = getSC();
  await sc.auctionService.processExpired();
  const auctions = await sc.auctionService.getActiveListings();

  const openBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PFX.open).setLabel("🏪 開啟拍賣場").setStyle(ButtonStyle.Primary),
  );

  if (!auctions.length) {
    return { content: `🏪 **拍賣場**\n\n目前沒有上架中的商品。\n\n點下方按鈕開啟拍賣場面板。`, components: [openBtn] };
  }

  const lines = auctions.slice(0, 10).map((a, i) => {
    const item = fmtItem(a.item);
    const price = fmtPrice(a.price, a.currency);
    const remain = fmtRemaining(a.expiresAt);
    return `\`${i + 1}.\` **${item}** ─ ${price}　剩 ${remain}`;
  });

  const more = auctions.length > 10 ? `\n\n...及其他 ${auctions.length - 10} 件` : "";

  return {
    content: `🏪 **拍賣場** （共 ${auctions.length} 件上架中）\n\n${lines.join("\n")}${more}\n\n點下方按鈕開啟拍賣場面板。`,
    components: [openBtn],
  };
}

// ─── 發布面板（管理員指令用）─────────────────────────
async function publishAuctionPanel(interaction) {
  const sc = getSC();
  const panel = await buildPublicAuctionPanel();
  const msg = await interaction.channel.send(panel);

  // 儲存頻道 ID
  await sc.auctionService.saveChannelConfig({ channelId: interaction.channelId, messageId: msg.id });

  await interaction.reply({ content: `✅ 拍賣場面板已發布在此頻道！`, flags: MessageFlags.Ephemeral });
}

module.exports = {
  isAuctionButton,
  handleAuctionButton,
  handleAuctionSelect,
  handleAuctionModal,
  handleAuctionSellConfirm,
  publishAuctionPanel,
  refreshAuctionChannel,
  PFX,
};
