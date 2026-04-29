"use strict";

const {
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

const ENHANCE_GEM_IDS = new Set([
  '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  '556db9e1-b084-4b22-bab5-a66c2b586184',
  '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  'a6ae293d-52fc-4af5-8770-891ddf842e35'
]);
const FORBIDDEN_EQUIP_SLOTS = new Set(["job_eq", "title_eq"]);
const FORBIDDEN_ITEM_TYPES = new Set(["job_badge", "title"]);

function getSC() { return require("../runtimeContext").serviceContext; }

// ─── customId 前綴 ────────────────────────────────────
const PFX = {
  open:         "auction:open",
  filter:       "auction:filter:",
  nav:          "auction:nav:",           // 換頁：auction:nav:{page}:{type}:{currency}:{sort}
  buy:          "auction:buy:",
  buyConfirm:   "auction:buy_confirm:",
  myList:       "auction:my_list",
  reclaim:      "auction:reclaim:",
  cancel:       "auction:cancel:",
  sell:         "auction:sell",
  sellTab:      "auction:sell_tab:",
  sellSubTab:   "auction:sell_subtab:",
  sellItem:     "auction:sell_item:",     // 選好物品後
  sellCurrency: "auction:sell_currency:", // 選好貨幣後
  sellModal:    "auction:sell_modal:",    // 填寫價格 Modal
  sellConfirm:  "auction:sell_confirm:",  // 確認上架
  sellPage:     "auction:sell_page:",     // 上架物品翻頁
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
  const unix = Math.floor(new Date(expiresAt).getTime() / 1000);
  return `<t:${unix}:R>`;
}

function fmtItem(item) {
  const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
  const stack = item.isGem && item.stackCount ? ` ×${item.stackCount}` : "";
  return `${item.itemName}${enh}${stack}`;
}

function isSellableItem(item) {
  if (!item) return false;
  if (FORBIDDEN_ITEM_TYPES.has(item.itemType) || FORBIDDEN_EQUIP_SLOTS.has(item.equipSlot)) return false;
  return item.itemType === "equipment" || ENHANCE_GEM_IDS.has(item.itemId);
}

// ─── 拍賣列表面板 ────────────────────────────────────
const PAGE_SIZE = 8; // 每頁最多 8 件（2 排購買按鈕 × 4，留第 5 排給換頁）
const SELL_PAGE_SIZE = 4;
const SELL_MAIN_TABS = [
  { tab: "all", label: "📦 全部" },
  { tab: "weapon", label: "⚔️ 武器" },
  { tab: "armor", label: "🛡️ 防裝" },
  { tab: "gem", label: "💎 強化石" },
];
const SELL_WEAPON_SUBTABS = [
  { subTab: "all", label: "📦 全部" },
  { subTab: "melee1", label: "🗡️ 單手" },
  { subTab: "melee2", label: "🪓 雙手" },
  { subTab: "ranged", label: "🏹 遠程" },
  { subTab: "magic", label: "🪄 法系" },
];
const SELL_ARMOR_SUBTABS = [
  { subTab: "all", label: "📦 全部" },
  { subTab: "head", label: "🪖 頭部" },
  { subTab: "core", label: "🥋 核心" },
  { subTab: "shield", label: "🛡️ 盾牌" },
  { subTab: "accessory", label: "💍 飾品" },
];
const SELL_ARMOR_SLOTS = new Set(["shield", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_l", "accessory_r"]);
const SELL_WEAPON_SLOTS = new Set(["weapon"]);

function buildSellItemLabel(item) {
  const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
  const stack = item.stackCount ? ` ×${item.stackCount}` : "";
  return `${item.itemName}${enh}${stack}`.slice(0, 80);
}

function sellWeaponFamily(entry) {
  const wt = String(entry?.weaponType || "").toLowerCase();
  if (!wt) return "all";
  if (wt.startsWith("staff")) return "magic";
  if (wt.endsWith("_1h")) return "melee1";
  if (wt.endsWith("_2h")) return "melee2";
  if (wt === "bow") return "ranged";
  return "all";
}

function matchSellWeaponSubTab(entry, subTab = "all") {
  if (subTab === "all") return true;
  return sellWeaponFamily(entry) === subTab;
}

function matchSellArmorSubTab(entry, subTab = "all") {
  if (subTab === "all") return true;
  const slot = String(entry?.equipSlot || "");
  if (subTab === "head") return ["head_top", "head_mid", "head_low"].includes(slot);
  if (subTab === "core") return ["armor", "garment", "shoes"].includes(slot);
  if (subTab === "shield") return slot === "shield";
  if (subTab === "accessory") return ["accessory_l", "accessory_r"].includes(slot);
  return false;
}

function filterSellByTab(inventory, tab = "all", subTab = "all") {
  const sellable = inventory.filter(isSellableItem);
  if (tab === "weapon") {
    return sellable.filter((entry) => SELL_WEAPON_SLOTS.has(entry.equipSlot) && matchSellWeaponSubTab(entry, subTab));
  }
  if (tab === "armor") {
    return sellable.filter((entry) => SELL_ARMOR_SLOTS.has(entry.equipSlot) && matchSellArmorSubTab(entry, subTab));
  }
  if (tab === "gem") {
    return sellable.filter((entry) => ENHANCE_GEM_IDS.has(entry.itemId));
  }
  return sellable;
}

function buildSellMainTabRow(activeTab = "all") {
  return new ActionRowBuilder().addComponents(
    SELL_MAIN_TABS.map((d) => new ButtonBuilder()
      .setCustomId(`${PFX.sellTab}${d.tab}:all:0`)
      .setLabel(d.label)
      .setStyle(d.tab === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
}

function buildSellSubTabRows(tab = "all", activeSubTab = "all", page = 0) {
  const defs = tab === "weapon" ? SELL_WEAPON_SUBTABS : tab === "armor" ? SELL_ARMOR_SUBTABS : [];
  if (!defs.length) return [];
  const rows = [];
  for (let i = 0; i < defs.length; i += 5) {
    const rowDefs = defs.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        rowDefs.map((d) => new ButtonBuilder()
          .setCustomId(`${PFX.sellSubTab}${tab}:${d.subTab}:${page}`)
          .setLabel(d.label)
          .setStyle(d.subTab === activeSubTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
        )
      )
    );
  }
  return rows;
}

async function buildAuctionPanel(filter = {}) {
  const sc = getSC();
  const auctions = await sc.auctionService.getActiveListings(filter);

  // 先讓到期的自動標記
  await sc.auctionService.processExpired();

  const page = Math.max(0, filter.page || 0);
  const totalPages = Math.max(1, Math.ceil(auctions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = auctions.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // 編碼換頁按鈕需要的 filter 狀態
  const t = filter.itemType || "_";
  const c = filter.currency || "_";
  const s = filter.sort || "_";

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

  const lines = pageItems.map((a, i) => {
    const item = fmtItem(a.item);
    const price = fmtPrice(a.price, a.currency);
    const remain = fmtRemaining(a.expiresAt);
    const globalIdx = safePage * PAGE_SIZE + i + 1;
    return `\`${globalIdx}.\` **${item}** ─ ${price}　剩 ${remain}`;
  });

  // 購買按鈕（每排 4 個，最多 2 排）
  const buyRows = [];
  for (let i = 0; i < pageItems.length; i += 4) {
    const chunk = pageItems.slice(i, i + 4);
    buyRows.push(new ActionRowBuilder().addComponents(
      chunk.map((a, j) => {
        const globalIdx = safePage * PAGE_SIZE + i + j + 1;
        return new ButtonBuilder()
          .setCustomId(`${PFX.buy}${a.id}`)
          .setLabel(`購買 ${globalIdx}`)
          .setStyle(ButtonStyle.Primary);
      })
    ));
  }

  const components = [filterRow, sortRow, ...buyRows];

  // 換頁列（超過 1 頁才顯示）
  if (totalPages > 1) {
    const pageInfo = `${safePage + 1} / ${totalPages} 頁`;
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PFX.nav}${safePage - 1}:${t}:${c}:${s}`)
        .setLabel("◀ 上一頁")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`${PFX.nav}${safePage}:${t}:${c}:${s}:noop`)
        .setLabel(pageInfo)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`${PFX.nav}${safePage + 1}:${t}:${c}:${s}`)
        .setLabel("下一頁 ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1),
    );
    components.push(navRow);
  }

  const pageNote = totalPages > 1 ? `　（第 ${safePage + 1} / ${totalPages} 頁）` : "";
  return {
    content: `🏪 **拍賣場** （共 ${auctions.length} 件）${pageNote}\n\n${lines.join("\n")}`,
    components,
  };
}

async function buildSellPanel(interaction, opts = {}) {
  const sc = getSC();
  const { tab = "all", subTab = "all", page = 0 } = opts;
  const memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) || [];
  const eligible = await sc.auctionService.checkSellerEligibility(memberRoleIds);
  if (!eligible) {
    return { content: "❌ 只有 Tier C 以上的會員才能上架商品。", components: [] };
  }

  const activeCount = await sc.auctionService.getActiveListingCount(interaction.user.id);
  if (activeCount >= 3) {
    return { content: "❌ 你目前已有上架中的商品，最多同時上架 3 件。", components: [] };
  }

  const progress = await sc.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const tabItems = filterSellByTab(inventory, tab, subTab);
  if (!tabItems.length) {
    const emptyLabel =
      tab === "weapon" ? "武器" :
      tab === "armor" ? "防裝" :
      tab === "gem" ? "強化石" : "可上架";
    return {
      content: `❌ 背包中沒有${emptyLabel}可上架（職業徽章/稱號不可上架）。`,
      components: [buildSellMainTabRow(tab)],
    };
  }

  const totalPages = Math.max(1, Math.ceil(tabItems.length / SELL_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = tabItems.slice(safePage * SELL_PAGE_SIZE, (safePage + 1) * SELL_PAGE_SIZE);

  const rows = [
    buildSellMainTabRow(tab),
    ...buildSellSubTabRows(tab, subTab, safePage),
    new ActionRowBuilder().addComponents(
      pageItems.map((item) => new ButtonBuilder()
        .setCustomId(`${PFX.sellItem}${item.uuid}`)
        .setLabel(buildSellItemLabel(item))
        .setStyle(ButtonStyle.Primary)
      )
    ),
  ];

  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PFX.sellPage}${tab}:${subTab}:${safePage - 1}`)
          .setLabel("◀ 上一頁")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`${PFX.sellPage}${tab}:${subTab}:${safePage}`)
          .setLabel(`${safePage + 1}/${totalPages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${PFX.sellPage}${tab}:${subTab}:${safePage + 1}`)
          .setLabel("下一頁 ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1),
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(PFX.open).setLabel("← 取消").setStyle(ButtonStyle.Secondary)
    )
  );

  const tabLabel =
    tab === "weapon" ? `武器${subTab === "all" ? "" : ` / ${SELL_WEAPON_SUBTABS.find((d) => d.subTab === subTab)?.label || subTab}`}` :
    tab === "armor" ? `防裝${subTab === "all" ? "" : ` / ${SELL_ARMOR_SUBTABS.find((d) => d.subTab === subTab)?.label || subTab}`}` :
    tab === "gem" ? "強化石" : "全部";
  const lines = pageItems.map((item, idx) => `${safePage * SELL_PAGE_SIZE + idx + 1}. **${buildSellItemLabel(item)}**`);

  return {
    content: `🏷️ **上架商品**\n\n分類：**${tabLabel}**\n請選擇要上架的物品：\n${lines.join("\n")}`,
    components: rows
  };
}

// ─── 主按鈕入口 ──────────────────────────────────────
async function handleAuctionButton(interaction) {
  const id = interaction.customId;

  // 開啟拍賣場
  if (id === PFX.open) {
    const panel = await buildAuctionPanel();
    await interaction.reply({ ...panel, flags: MessageFlags.Ephemeral });
    return;
  }

  // 篩選（切換篩選條件時重設回第 1 頁）
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
    // page 不傳 → 預設 0
    const panel = await buildAuctionPanel(filter);
    await interaction.editReply(panel);
    return;
  }

  // 換頁（保留篩選條件）
  if (id.startsWith(PFX.nav)) {
    const raw = id.slice(PFX.nav.length);
    const parts = raw.split(":");
    // noop button（頁碼顯示用，已 disabled，理論上不會觸發）
    if (parts[4] === "noop") { await interaction.deferUpdate(); return; }
    await interaction.deferUpdate();
    const page = parseInt(parts[0], 10);
    const filter = { page: isNaN(page) ? 0 : page };
    if (parts[1] && parts[1] !== "_") filter.itemType = parts[1];
    if (parts[2] && parts[2] !== "_") filter.currency = parts[2];
    if (parts[3] && parts[3] !== "_") filter.sort = parts[3];
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
      // 同步刷新公開拍賣場面板，避免外層列表殘留已售商品
      await refreshAuctionChannel();
      // 通知買家（DM）
      try {
        const { getBotClient } = require("../runtimeContext");
        const client = getBotClient();
        let sellerText = `${result.auction.sellerId}`;
        if (client?.isReady()) {
          const sellerUser = await client.users.fetch(result.auction.sellerId).catch(() => null);
          if (sellerUser) sellerText = `${sellerUser.username} (${sellerUser.id})`;
        }
        const priceStr = fmtPrice(result.auction.price, result.auction.currency);
        await interaction.user.send(
          `🛒 **購買成功通知**\n` +
          `商品：**${result.itemName}**\n` +
          `價格：${priceStr}\n` +
          `賣家：${sellerText}\n` +
          `買家：${interaction.user.username} (${interaction.user.id})\n` +
          `狀態：已入背包`
        ).catch(() => {});
      } catch (_) {}
      // 通知賣家
      try {
        const { getBotClient } = require("../runtimeContext");
        const client = getBotClient();
        if (client?.isReady()) {
          const sellerUser = await client.users.fetch(result.auction.sellerId).catch(() => null);
          if (sellerUser) {
            const priceStr = fmtPrice(result.auction.price, result.auction.currency);
            await sellerUser.send(
              `💰 **拍賣成交通知**\n` +
              `商品：**${result.itemName}**\n` +
              `價格：${priceStr}\n` +
              `賣家：${sellerUser.username} (${sellerUser.id})\n` +
              `買家：${interaction.user.username} (${interaction.user.id})\n` +
              `狀態：已售出，款項已入帳`
            ).catch(() => {});
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
    const reclaimBtns = expiredListings.slice(0, 3).map(a =>
      new ButtonBuilder()
        .setCustomId(`${PFX.reclaim}${a.id}`)
        .setLabel(`領回 ${fmtItem(a.item)}`)
        .setStyle(ButtonStyle.Success)
    );
    const activeListings = listings.filter(a => a.status === "active");
    const cancelBtns = activeListings.slice(0, 3).map(a =>
      new ButtonBuilder()
        .setCustomId(`${PFX.cancel}${a.id}`)
        .setLabel(`下架 ${fmtItem(a.item)}`)
        .setStyle(ButtonStyle.Danger)
    );
    const backBtn = new ButtonBuilder().setCustomId(PFX.open).setLabel("← 返回").setStyle(ButtonStyle.Secondary);
    const rows = [];
    const actionBtns = [...reclaimBtns, ...cancelBtns];
    if (actionBtns.length > 0) rows.push(new ActionRowBuilder().addComponents(...actionBtns.slice(0, 5)));
    rows.push(new ActionRowBuilder().addComponents(backBtn));
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

  // 下架（賣家主動下架 active 商品）
  if (id.startsWith(PFX.cancel)) {
    const auctionId = id.slice(PFX.cancel.length);
    await interaction.deferUpdate();
    const sc = getSC();
    try {
      const result = await sc.auctionService.cancelListing(interaction.user.id, auctionId);
      await refreshAuctionChannel();
      const listings = await sc.auctionService.getMyListings(interaction.user.id);
      const remainActive = listings.filter(a => a.status === "active").length;
      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(PFX.myList).setLabel("📦 返回我的上架").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(PFX.open).setLabel("← 返回拍賣場").setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({
        content: `✅ 已下架 **${result.itemName}**，物品已退回背包。${remainActive > 0 ? `\n目前仍有 ${remainActive} 件上架中。` : ""}`,
        components: [backRow],
      });
    } catch (err) {
      await interaction.editReply({ content: `❌ 下架失敗：${err.message}`, components: [] });
    }
    return;
  }

  // ─── 上架流程 ───────────────────────────────────────

  // Step 1: 點「上架商品」→ 顯示背包中可上架的物品（按鈕分頁）
  if (id === PFX.sell) {
    await interaction.deferUpdate();
    const panel = await buildSellPanel(interaction, { tab: "all", subTab: "all", page: 0 });
    await interaction.editReply(panel);
    return;
  }

  if (id.startsWith(PFX.sellTab)) {
    await interaction.deferUpdate();
    const raw = id.slice(PFX.sellTab.length);
    const parts = raw.split(":");
    const tab = parts[0] || "all";
    const page = parseInt(parts[2] || "0", 10);
    const panel = await buildSellPanel(interaction, {
      tab,
      subTab: "all",
      page: Number.isFinite(page) ? page : 0,
    });
    await interaction.editReply(panel);
    return;
  }

  if (id.startsWith(PFX.sellSubTab)) {
    await interaction.deferUpdate();
    const raw = id.slice(PFX.sellSubTab.length);
    const parts = raw.split(":");
    const tab = parts[0] || "all";
    const subTab = parts[1] || "all";
    const page = parseInt(parts[2] || "0", 10);
    const panel = await buildSellPanel(interaction, {
      tab,
      subTab,
      page: Number.isFinite(page) ? page : 0,
    });
    await interaction.editReply(panel);
    return;
  }

  if (id.startsWith(PFX.sellPage)) {
    await interaction.deferUpdate();
    const raw = id.slice(PFX.sellPage.length);
    const parts = raw.split(":");
    const tab = parts[0] || "all";
    const subTab = parts[1] || "all";
    const page = parseInt(parts[2] || "0", 10);
    const panel = await buildSellPanel(interaction, {
      tab,
      subTab,
      page: Number.isFinite(page) ? page : 0,
    });
    await interaction.editReply(panel);
    return;
  }

  if (id.startsWith(PFX.sellItem)) {
    await interaction.deferUpdate();
    const itemUuid = id.slice(PFX.sellItem.length);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PFX.sellCurrency}${itemUuid}:gold`).setLabel("💰 金幣").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PFX.sellCurrency}${itemUuid}:diamond`).setLabel("💎 鑽石").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(PFX.open).setLabel("← 取消").setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ content: "💱 **選擇定價貨幣**\n\n你想用哪種貨幣標價？", components: [row] });
    return;
  }

  // Step 3: 選完貨幣 → 彈出 Modal 填寫價格 + 時間（Button 互動直接 showModal）
  if (id.startsWith(PFX.sellCurrency)) {
    const parts = id.slice(PFX.sellCurrency.length).split(":");
    const itemUuid = parts[0];
    const currency = parts[1]; // "gold" | "diamond"
    const sc = getSC();
    const progress = await sc.progressRepository.findByPlayerId(interaction.user.id);
    const item = (progress?.inventory || []).find(i => i.uuid === itemUuid);
    if (!item || !isSellableItem(item)) {
      await interaction.reply({ content: "❌ 此物品無法上架。", flags: MessageFlags.Ephemeral });
      return;
    }
    const isGem = ENHANCE_GEM_IDS.has(item.itemId);
    const maxQty = Math.max(1, item.stackCount || 1);

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
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("quantity_input")
              .setLabel(isGem ? `上架數量（1～${maxQty}）` : "上架數量（裝備固定為 1）")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("例：1")
              .setValue("1")
              .setRequired(true)
          )
        )
    );
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
    const quantityRaw = interaction.fields.getTextInputValue("quantity_input").trim();
    const price = parseInt(priceRaw, 10);
    const hours = parseInt(hoursRaw, 10);
    const quantity = parseInt(quantityRaw, 10);

    if (!Number.isFinite(price) || !Number.isFinite(hours) || !Number.isFinite(quantity) || quantity <= 0) {
      await interaction.reply({ content: "❌ 請輸入有效的數字（數量需為正整數）。", flags: MessageFlags.Ephemeral });
      return true;
    }

    // 取得物品資訊用來顯示確認視窗
    const sc = getSC();
    const progress = await sc.progressRepository.findByPlayerId(interaction.user.id);
    const item = (progress?.inventory || []).find(i => i.uuid === itemUuid);
    if (!item || !isSellableItem(item)) {
      await interaction.reply({ content: "❌ 找不到該物品。", flags: MessageFlags.Ephemeral });
      return true;
    }
    const isGem = ENHANCE_GEM_IDS.has(item.itemId);
    if (!isGem && quantity !== 1) {
      await interaction.reply({ content: "❌ 裝備每次只能上架 1 件。", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (isGem) {
      const curStack = Math.max(1, item.stackCount || 1);
      if (quantity > curStack) {
        await interaction.reply({ content: `❌ 強化石數量不足，目前只有 ${curStack} 顆。`, flags: MessageFlags.Ephemeral });
        return true;
      }
    }

    const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
    const stack = isGem ? ` ×${quantity}` : "";
    const itemLabel = `${item.itemName}${enh}${stack}`;
    const priceLabel = currency === "gold" ? `${price.toLocaleString()} 💰` : `${price.toLocaleString()} 💎`;

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PFX.sellConfirm}${itemUuid}:${currency}:${price}:${hours}:${quantity}`)
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
    const quantity = parseInt(parts[4] || "1", 10);

    const sc = getSC();
    try {
      const auction = await sc.auctionService.listItem({
        sellerId: interaction.user.id,
        itemUuid,
        currency,
        price,
        hours,
        quantity,
      });
      const enh = auction.item.enhanceLevel > 0 ? ` +${auction.item.enhanceLevel}` : "";
      const stack = auction.item.isGem && auction.item.stackCount ? ` ×${auction.item.stackCount}` : "";
      await interaction.editReply({
        content: `✅ **上架成功！**\n\n商品：**${auction.item.itemName}${enh}${stack}**\n定價：${fmtPrice(price, currency)}\n到期：${new Date(auction.expiresAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`,
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

    const panel = await buildPublicAuctionPanel();
    let panelMsg = null;

    if (config.messageId) {
      panelMsg = await channel.messages.fetch(config.messageId).catch(() => null);
    }

    if (!panelMsg) {
      const messages = await channel.messages.fetch({ limit: 50 });
      panelMsg = messages.find((m) =>
        m.author.id === client.user.id
        && Array.isArray(m.components)
        && m.components.some((row) =>
          Array.isArray(row?.components)
          && row.components.some((c) => c?.customId === PFX.open)
        )
      );
    }

    if (panelMsg) {
      await panelMsg.edit(panel).catch(() => {});
      await sc.auctionService.saveChannelConfig({ channelId: channel.id, messageId: panelMsg.id });
      return;
    }

    const created = await channel.send(panel);
    await sc.auctionService.saveChannelConfig({ channelId: channel.id, messageId: created.id });
  } catch (_) {}
}

// ─── 公開頻道面板（顯示商品列表，但互動用 ephemeral） ──
async function buildPublicAuctionPanel() {
  const sc = getSC();
  await sc.auctionService.processExpired();
  const auctions = await sc.auctionService.getActiveListings();
  const settings = await sc.auctionService.getSettings();
  const sellerTiers = Array.isArray(settings?.sellerTiers) && settings.sellerTiers.length > 0
    ? settings.sellerTiers
    : ["C", "B", "A", "S", "SS"];
  const sellerRuleText = `僅限會員（Tier ${sellerTiers.join(" / ")}）可上架`;
  const auctionRulesText = [
    "📜 規則：",
    `• ${sellerRuleText}`,
    "• 每位玩家同時最多上架 3 件",
    "• 上架後不可主動撤回，商品到期可領回"
  ].join("\n");

  const openBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PFX.open).setLabel("🏪 開啟拍賣場").setStyle(ButtonStyle.Primary),
  );

  if (!auctions.length) {
    return { content: `🏪 **拍賣場**\n\n目前沒有上架中的商品。\n\n${auctionRulesText}\n\n點下方按鈕開啟拍賣場面板。`, components: [openBtn] };
  }

  const lines = auctions.slice(0, 10).map((a, i) => {
    const item = fmtItem(a.item);
    const price = fmtPrice(a.price, a.currency);
    const remain = fmtRemaining(a.expiresAt);
    return `\`${i + 1}.\` **${item}** ─ ${price}　剩 ${remain}`;
  });

  const more = auctions.length > 10 ? `\n\n...及其他 ${auctions.length - 10} 件` : "";

  return {
    content: `🏪 **拍賣場** （共 ${auctions.length} 件上架中）\n\n${lines.join("\n")}${more}\n\n${auctionRulesText}\n\n點下方按鈕開啟拍賣場面板。`,
    components: [openBtn],
  };
}

// ─── 發布面板（管理員指令用）─────────────────────────
async function publishAuctionPanel(interaction) {
  const sc = getSC();
  await sc.auctionService.saveChannelConfig({ channelId: interaction.channelId });
  await refreshAuctionChannel();

  await interaction.reply({ content: `✅ 拍賣場面板已發布在此頻道！`, flags: MessageFlags.Ephemeral });
}

module.exports = {
  isAuctionButton,
  handleAuctionButton,
  handleAuctionModal,
  handleAuctionSellConfirm,
  publishAuctionPanel,
  refreshAuctionChannel,
  PFX,
};
