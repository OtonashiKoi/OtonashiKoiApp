const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const path = require("path");
const fs = require("fs");
const { BUTTON_IDS, createPlayerPanelMessage } = require("./playerPanelView");
const { expToNextLevel, MAX_LEVEL } = require("../shared/progression");
const { createCode } = require("./bindingStore");
const { renderEquipmentCard, LEFT_SLOTS: EQ_LEFT_SLOTS, RIGHT_SLOTS: EQ_RIGHT_SLOTS, COL3_SLOTS: EQ_COL3_SLOTS, SLOT_LABELS: EQ_SLOT_LABELS } = require("./equipmentCardRenderer");
const { calcPlayerStats } = require("../shared/combatStats");
const { EFFECT_NAME_ZH } = require("../shared/effectDisplayNames");
const { isEffectConditionMet } = require("../shared/effectEngine");

const AUTO_DELETE_MS = 60_000;
const ACTIVE_REPLY_BY_USER = new Map();

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

/** editReply wrapper：忽略 10008 Unknown Message（互動已過期或訊息被刪）*/
async function safeEditReply(interaction, payload) {
  try {
    return await interaction.editReply(payload);
  } catch (err) {
    if (err?.code === 10008) return; // Unknown Message — 忽略
    throw err;
  }
}

/** 回覆 ephemeral 訊息，並在 AUTO_DELETE_MS 後自動刪除 */
async function clearActiveReply(interaction) {
  const userId = interaction?.user?.id;
  if (!userId) return;
  const previous = ACTIVE_REPLY_BY_USER.get(userId);
  if (!previous) return;
  if (previous.timeoutId) clearTimeout(previous.timeoutId);
  try {
    await previous.webhook.deleteMessage(previous.messageId);
  } catch (_) {}
  ACTIVE_REPLY_BY_USER.delete(userId);
}

async function rememberActiveReply(interaction, ttlMs = AUTO_DELETE_MS) {
  const userId = interaction?.user?.id;
  if (!userId) return;
  try {
    const msg = await interaction.fetchReply();
    const timeoutId = setTimeout(() => {
      interaction.webhook.deleteMessage(msg.id).catch(() => {});
      const cur = ACTIVE_REPLY_BY_USER.get(userId);
      if (cur?.messageId === msg.id) ACTIVE_REPLY_BY_USER.delete(userId);
    }, ttlMs);
    ACTIVE_REPLY_BY_USER.set(userId, {
      webhook: interaction.webhook,
      messageId: msg.id,
      timeoutId
    });
  } catch (_) {}
}

async function replyAndAutoDelete(interaction, content) {
  await clearActiveReply(interaction);
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  await rememberActiveReply(interaction, AUTO_DELETE_MS);
}

async function replyPlayerBlocked(interaction) {
  await replyAndAutoDelete(interaction, "❌ 你目前不在可用玩家白名單中。");
}


async function handleProfile(interaction) {
  const serviceContext = getServiceContext();
  const memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) ?? [];
  // getProfile 與 updatePlayerTier 互不相依，並行執行
  const [result] = await Promise.all([
    serviceContext.playerService.getProfile(interaction.user.id, interaction.user.username),
    serviceContext.shopService.updatePlayerTier(interaction.user.id, memberRoleIds)
  ]);
  // 重新讀取 progress 以拿到更新後的等級
  const freshProgress = await serviceContext.progressRepository
    ? await serviceContext.progressRepository.findByPlayerId(interaction.user.id)
    : null;
  const p = freshProgress || result.progress;
  const attrs = p.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const tierLine = p.playerTier ? `\n玄家等級：**${p.playerTier}級**` : "";
  const isMaxLevel = p.level >= MAX_LEVEL;
  const expNeeded = isMaxLevel ? 0 : expToNextLevel(p.level);
  const expLine = isMaxLevel
    ? `等級：Base ${p.level} ⭐ 已達最高等級${tierLine}`
    : `等級：Base ${p.level} (EXP: ${p.exp} / ${expNeeded}，還差 ${expNeeded - p.exp})${tierLine}`;

  // ── 計算戰鬥能力（使用 shared/combatStats 確保與戰鬥邏輯一致）──
  const equipped = p.equipment || {};
  const cs = calcPlayerStats(attrs, equipped, p.activeEffects || [], p.inventory || []);
  const calcHp    = cs.maxHp;
  const calcAtk   = cs.atk;
  const calcDef   = cs.def;
  const calcCrit  = Math.round(cs.crit  * 10) / 10;
  const calcCombo = Math.round(cs.combo * 10) / 10;
  const calcDodge = Math.round((cs.dodge || 0) * 10) / 10;

  // ── 裝備屬性加成 ──
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in bonus) bonus[k] += (v || 0);
    }
  }
  const fmt = (base, key) => bonus[key] > 0 ? `${base} (+${bonus[key]})` : `${base}`;

  // ── 武器特效說明（由 combatStats 推斷，並結合已裝備武器描述） ──
  const wt = cs.weaponType;
  const specialEffects = [];
  if (wt === "dagger") specialEffects.push("🗡️ 匕首：連擊率 +20%");
  if (wt === "axe_2h") specialEffects.push("🪓 雙手斧：攻擊倍率 ×4");
  if (wt === "staff_1h") specialEffects.push("🪄 法杖：無視怪物 50% DEF、怪物攻擊 ×2");
  if (wt === "staff_2h") specialEffects.push("🪄 雙手法杖：無視怪物 50% DEF、怪物攻擊 ×2、倍率 ↑");
  if (cs.isDualWield) specialEffects.push("⚔️ 雙持：可觸發副手追擊");

  // 使用 combatStats 提供的欄位顯示進一步特效
  if (cs.stunChance && cs.stunChance > 0) specialEffects.push(`💥 擊暈機率 ${cs.stunChance}%`);
  if (cs.armorBreakChance && cs.armorBreakChance > 0) specialEffects.push(`🛠️ 破防機率 ${cs.armorBreakChance}%`);
  if (cs.bypassMonsterDefPct > 0) specialEffects.push(`🪄 無視怪物 ${cs.bypassMonsterDefPct}% DEF`);
  if (cs.monsterAttackCount && cs.monsterAttackCount > 1) specialEffects.push(`⚠️ 觸發時怪物攻擊 ×${cs.monsterAttackCount}`);

  // 若為弓類，嘗試計算武器帶來的額外閃避（從總閃避扣掉屬性基底）
  try {
    const agiTotal = (attrs.agi || 1) + (bonus.agi || 0);
    const baseDodge = Math.min(50, agiTotal * 0.5);
    const weaponDodge = Math.round(Math.max(0, (cs.dodge || 0) - baseDodge));
    if (weaponDodge > 0) specialEffects.push(`🏹 閃避 +${weaponDodge}%`);
  } catch (e) {}

  // 顯示裝備特效（優先顯示已裝備武器的說明，否則使用推斷的武器特效）
  let effectLineParts = [...specialEffects];
    try {
      const weaponItem = equipped.weapon || null;
      if (weaponItem && weaponItem.weaponEffectDescription) {
        // 放在最前面並換行顯示
        effectLineParts.unshift(`🔸 裝備特效：${weaponItem.weaponEffectDescription}`);
      }
    } catch (e) { /* ignore */ }
  const effectLine = effectLineParts.length ? "\n" + effectLineParts.join("\n") : "";

  // ── 職業特別顯示 ──
  const jobEq = equipped.job_eq || null;
  let jobSpecialLine = "職業特性：無（未裝備職業裝）";
  if (jobEq) {
    const context = { equipped, inventory: p.inventory || [] };
    const allJobEffects = [
      ...(Array.isArray(jobEq.passiveEffects) ? jobEq.passiveEffects : []),
      ...(Array.isArray(jobEq.procEffects) ? jobEq.procEffects : []),
      ...(Array.isArray(jobEq.combatEffects) ? jobEq.combatEffects : [])
    ];
    const activeJobEffects = allJobEffects.filter((effect) => isEffectConditionMet(effect, context));
    const toLabel = (effect) => {
      const effectName = EFFECT_NAME_ZH[effect.key] || effect.definitionName || effect.key;
      const value = Number(effect?.params?.value);
      const valueText = Number.isFinite(value) ? `(${value})` : "";
      return `${effectName}${valueText}`;
    };
    if (activeJobEffects.length > 0) {
      jobSpecialLine = `職業特性：${jobEq.itemName}\n` +
        `啟用中：${activeJobEffects.map(toLabel).join("、")}`;
    } else {
      jobSpecialLine = `職業特性：${jobEq.itemName}\n目前無符合條件的啟用效果`;
    }
  }

  // ── 裝備清單（只列有裝備的格子）──
  const SLOT_ICONS = {
    weapon: "⚔️", shield: "🛡️", armor: "🥋", head_top: "🪖", head_mid: "🎭",
    head_low: "😷", garment: "🧣", shoes: "👟", accessory_l: "💍", accessory_r: "💍",
    title_eq: "🏅", job_eq: "📖", special_1: "✨", special_2: "✨", special_3: "✨"
  };
  const ALL_SLOTS = [...EQ_LEFT_SLOTS, ...EQ_RIGHT_SLOTS, ...EQ_COL3_SLOTS];
  const standardParts = ALL_SLOTS
    .filter(s => !EQ_COL3_SLOTS.includes(s) && equipped[s])
    .map(s => `${SLOT_ICONS[s] || "▪️"}${equipped[s].itemName}`);
  const specialParts = EQ_COL3_SLOTS
    .filter(s => equipped[s])
    .map(s => `[${EQ_SLOT_LABELS[s]}] ${equipped[s].itemName}`);
  const equipLine = standardParts.length || specialParts.length
    ? [...standardParts, ...specialParts].join("　")
    : "（尚未裝備）";

  await replyAndAutoDelete(interaction,
    `🧧 **${result.player.displayName} 的冒險者履歷**\n` +
    `職業：${p.job || "Novice"} (Job ${p.jobLevel || 1})\n` +
    expLine + "\n" +
    `==============\n` +
    `【基本素質】\n` +
    `STR: ${fmt(attrs.str,"str")} | AGI: ${fmt(attrs.agi,"agi")} | VIT: ${fmt(attrs.vit,"vit")}\n` +
    `INT: ${fmt(attrs.int,"int")} | DEX: ${fmt(attrs.dex,"dex")} | LUK: ${fmt(attrs.luk,"luk")}\n` +
    `==============\n` +
    `【戰鬥能力】\n` +
    `❤️ HP: ${calcHp}　⚔️ ATK: ${calcAtk}　🛡️ DEF: ${calcDef}\n` +
    `🎯 CRIT: ${calcCrit}%　⚡ 連擊: ${calcCombo}%　🟢 迴避: ${calcDodge}%` +
    effectLine + "\n" +
    `${jobSpecialLine}\n` +
    equipLine + "\n" +
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

const TIER_SELL_PRICE = { D: 10, C: 50, B: 100, A: 150 };

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
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel("丟棄")
        .setStyle(ButtonStyle.Danger)
    );
  } else {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel(`${prefix} 丟棄`)
        .setStyle(ButtonStyle.Danger)
    );
  }
  // 有 tier 的道具顯示販售按鈕
  const sellPrice = e.tier ? TIER_SELL_PRICE[e.tier] : null;
  if (sellPrice != null) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell:${e.uuid}`)
        .setLabel(`售 ${sellPrice}💰`)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (e.imageUrl) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_view:${e.uuid}`)
        .setLabel("🖼️")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return new ActionRowBuilder().addComponents(btns);
}

const EQ_SPECIAL_SLOTS = new Set(EQ_COL3_SLOTS);
const EQ_STANDARD_SLOTS = new Set([...EQ_LEFT_SLOTS, ...EQ_RIGHT_SLOTS]);
const EQ_WEAPON_LIKE_SLOTS = new Set(["weapon", "shield"]);
const EQ_SORT_ORDER = ["weapon","shield","head_top","head_mid","head_low","armor","garment","shoes","accessory_l","accessory_r","special_1","special_2","special_3"];
const EQ_SORT_ORDER_MAP = EQ_SORT_ORDER.reduce((acc, slot, idx) => ({ ...acc, [slot]: idx }), {});

function normalizeName(name) {
  return String(name || "").replace(/\s*\+\d+$/, "").trim();
}

function isWeaponLikeSlot(slot) {
  return EQ_WEAPON_LIKE_SLOTS.has(slot);
}

function sortBackpackItems(items, tab) {
  const arr = [...items];
  return arr.sort((a, b) => {
    if (tab === "item") {
      return String(a.itemName || "").localeCompare(String(b.itemName || ""), "zh-Hant");
    }

    const aSlot = a.equipSlot || "";
    const bSlot = b.equipSlot || "";
    const aOrd = EQ_SORT_ORDER_MAP[aSlot] ?? 999;
    const bOrd = EQ_SORT_ORDER_MAP[bSlot] ?? 999;
    if (aOrd !== bOrd) return aOrd - bOrd;

    const an = normalizeName(a.itemName);
    const bn = normalizeName(b.itemName);
    if (an !== bn) return an.localeCompare(bn, "zh-Hant");

    const aEnh = Number(a.enhanceLevel || 0);
    const bEnh = Number(b.enhanceLevel || 0);
    if (aEnh !== bEnh) return bEnh - aEnh;

    return String(a.uuid || "").localeCompare(String(b.uuid || ""));
  });
}

function canonicalStatsKey(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  const keys = Object.keys(s).sort();
  return keys.map((k) => `${k}:${s[k]}`).join("|");
}

function formatEquipStats(stats) {
  const statOrder = ["str", "agi", "vit", "int", "dex", "luk"];
  const s = stats && typeof stats === "object" ? stats : null;
  if (!s) return "";
  const sorted = Object.entries(s)
    .filter(([, value]) => typeof value === "number" && value !== 0 && !Number.isNaN(value))
    .sort((a, b) => {
      const ai = statOrder.indexOf(String(a[0]).toLowerCase());
      const bi = statOrder.indexOf(String(b[0]).toLowerCase());
      if (ai !== -1 && bi !== -1 && ai !== bi) return ai - bi;
      if (ai !== -1 && bi === -1) return -1;
      if (ai === -1 && bi !== -1) return 1;
      return String(a[0]).localeCompare(String(b[0]), "en");
    });
  return sorted.map(([k, v]) => `${String(k).toUpperCase()}${v > 0 ? "+" : ""}${v}`).join(" ");
}

function groupEquipmentItems(items, tab) {
  const list = sortBackpackItems(items, tab);
  const groups = new Map();

  for (const entry of list) {
    const slot = entry.equipSlot || "";
    const enh = Number(entry.enhanceLevel || 0);
    const tier = entry.tier || "";
    const statsKey = canonicalStatsKey(entry.equipStats);
    const key = `${normalizeName(entry.itemName)}|${slot}|${tier}|${enh}|${statsKey}`;

    if (!groups.has(key)) {
      const sellPrice = tier ? TIER_SELL_PRICE[tier] : null;
      groups.set(key, {
        key,
        repUuid: entry.uuid,
        itemName: entry.itemName,
        equipSlot: slot,
        tier,
        enhanceLevel: enh,
        equipStats: entry.equipStats || null,
        sellPrice,
        imageUrl: entry.imageUrl || "",
        count: 0,
      });
    }
    const g = groups.get(key);
    g.count += 1;
    if (!g.imageUrl && entry.imageUrl) g.imageUrl = entry.imageUrl;
  }

  return [...groups.values()];
}

function buildEquipmentGroupRow(group, idx, opts = {}) {
  const { tab = "item", page = 0, showImage = true, showEquip = true } = opts;
  const prefix = ["①","②","③","④","⑤"][idx] ?? `${idx + 1}.`;
  const btns = [];

  if (showEquip) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_equip:${group.repUuid}:${tab}:${page}`)
        .setLabel(`${prefix} 裝備`)
        .setStyle(ButtonStyle.Success)
    );
  }

  if (group.sellPrice != null) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell:${group.repUuid}:${tab}:${page}`)
        .setLabel(`售 (${group.sellPrice}💰/件)`)
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell:${group.repUuid}:${tab}:${page}`)
        .setLabel("不可販售")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
  }

  if (showImage && group.imageUrl) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_view:${group.repUuid}`)
        .setLabel("🖼️")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return new ActionRowBuilder().addComponents(btns);
}

function filterByTab(inventory, tab) {
  if (tab === "equip") {
    return inventory.filter(e => e.itemType === "equipment" && EQ_STANDARD_SLOTS.has(e.equipSlot));
  }
  if (tab === "weapon") {
    return inventory.filter(e =>
      e.itemType === "equipment" &&
      EQ_STANDARD_SLOTS.has(e.equipSlot) &&
      isWeaponLikeSlot(e.equipSlot)
    );
  }
  if (tab === "armor") {
    return inventory.filter(e =>
      e.itemType === "equipment" &&
      EQ_STANDARD_SLOTS.has(e.equipSlot) &&
      !isWeaponLikeSlot(e.equipSlot)
    );
  }
  if (tab === "special") return inventory.filter(e => e.itemType === "equipment" && EQ_SPECIAL_SLOTS.has(e.equipSlot));
  if (tab === "badge") return inventory.filter(e => e.itemType === "job_badge");
  return inventory.filter(e => e.itemType !== "equipment" && e.itemType !== "job_badge");
}

const PAGE_SIZE = 3;

function buildTabRow(activeTab) {
  const defs = [
    { tab: "item",    label: "🎮 道具" },
    { tab: "weapon",  label: "⚔️ 武器" },
    { tab: "armor",   label: "🛡️ 防裝" },
    { tab: "special", label: "✨ 特殊" },
    { tab: "badge",   label: "📖 職業" },
  ];
  return new ActionRowBuilder().addComponents(
    defs.map(d => new ButtonBuilder()
      .setCustomId(`backpack_tab:${d.tab}:0`)
      .setLabel(d.label)
      .setStyle(d.tab === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
}

function buildPageRow(tab, page, totalPages) {
  const btns = [];
  btns.push(new ButtonBuilder()
    .setCustomId(`backpack_prev:${tab}:${page - 1}`)
    .setLabel("◀ 上一頁")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0)
  );
  btns.push(new ButtonBuilder()
    .setCustomId(`backpack_page_input:${tab}:${page}:${totalPages}`)
    .setLabel(`${page + 1} / ${totalPages}`)
    .setStyle(ButtonStyle.Primary)
  );
  btns.push(new ButtonBuilder()
    .setCustomId(`backpack_next:${tab}:${page + 1}`)
    .setLabel("下一頁 ▶")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1)
  );
  return new ActionRowBuilder().addComponents(btns);
}

function buildBackpackMessage(inventory, tab = "item", prefixMsg, page = 0) {
  const rawFiltered = filterByTab(inventory, tab);
  const isEquipTab = tab === "equip" || tab === "weapon" || tab === "armor" || tab === "special" || tab === "badge";
  const filtered = isEquipTab ? groupEquipmentItems(rawFiltered, tab) : sortBackpackItems(rawFiltered, tab);
  const header = prefixMsg ? prefixMsg + "\n\n" : "";
  const tabLabel =
    tab === "weapon" ? "武器" :
    tab === "armor"  ? "防裝" :
    tab === "equip"  ? "裝備" :
    tab === "special"? "特殊" :
    tab === "badge"  ? "職業" : "道具";
  const tabRow = buildTabRow(tab, page);

  if (!filtered.length) {
    return { content: header + `🎒 **背包 — ${tabLabel}**\n\n此分類目前為空。`, components: [tabRow] };
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const offset = safePage * PAGE_SIZE;

  const lines = [];
  if (tab === "weapon" && pageItems.length) lines.push("【武器】");
  if (tab === "armor" && pageItems.length) lines.push("【防裝】");

  pageItems.forEach((e, i) => {
    if (tab === "equip" && i > 0) {
      const prev = pageItems[i - 1];
      const prevIsWeapon = isWeaponLikeSlot(prev.equipSlot);
      const curIsWeapon = isWeaponLikeSlot(e.equipSlot);
      if (prevIsWeapon !== curIsWeapon) lines.push(curIsWeapon ? "【武器】" : "【防具】");
    }

    if (isEquipTab) {
      const baseName = normalizeName(e.itemName);
      const enhLv = Number(e.enhanceLevel || 0);
      const enh = enhLv > 0 ? ` +${enhLv}` : "";
      const slotLabel = e.equipSlot ? (EQ_SLOT_LABELS[e.equipSlot] || e.equipSlot) : "";
      const slot = slotLabel ? `（${slotLabel}）` : "";
      const statStr = formatEquipStats(e.equipStats);
      const statsPart = statStr ? `｜${statStr}` : "";
      const overMax = enhLv > 3 ? " ⚠️超過上限(+3)" : "";
      const price = e.sellPrice != null ? `售 ${e.sellPrice}💰/件` : "不可販售";
      lines.push(`${offset + i + 1}. **${baseName}**${enh}${slot}${statsPart}｜${price}${overMax} ×${e.count}`);
      return;
    }

    const slot = e.equipSlot ? ` (${EQ_SLOT_LABELS[e.equipSlot] || e.equipSlot})` : "";
    lines.push(`${offset + i + 1}. **${e.itemName}**${slot}　${e.source === "monster_drop" ? `掉落自 ${e.sourceRef || "怪物"}` : `購於 ${(e.purchasedAt || "").slice(0, 10)}`}`);
  });

  const rows = isEquipTab
    ? pageItems.map((g, i) => buildEquipmentGroupRow(g, i, {
      tab,
      page: safePage,
      showImage: !(tab === "weapon" || tab === "armor"),
      showEquip: true,
    }))
    : pageItems.map((e, i) => buildInventoryRow(e, i));
  rows.push(tabRow);
  if (totalPages > 1) rows.push(buildPageRow(tab, safePage, totalPages));

  return { content: header + `🎒 **背包 — ${tabLabel}**（第 ${safePage + 1}/${totalPages} 頁，共 ${filtered.length} 項）\n\n${lines.join("\n")}`, components: rows };
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
  const msg = buildBackpackMessage(inventory, "item");
  await clearActiveReply(interaction);
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  await rememberActiveReply(interaction, 60_000);
}

async function handleEquipmentView(interaction) {
  const serviceContext = getServiceContext();
  await clearActiveReply(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [progress, player, wallet] = await Promise.all([
    serviceContext.progressRepository.findByPlayerId(interaction.user.id),
    serviceContext.playerRepository.findByDiscordId(interaction.user.id),
    serviceContext.walletRepository.findByPlayerId(interaction.user.id),
  ]);
  const equipped  = progress?.equipment || {};

  // 生成裝備欄圖片
  const avatarUrl = interaction.user.displayAvatarURL({ extension: "png", forceStatic: true });
  const publicDir = path.resolve(__dirname, "../web/public");
  let imgBuffer = null;
  try {
    imgBuffer = await renderEquipmentCard({ equipped, avatarUrl, publicDir, progress, player, wallet });
  } catch { /* 圖片失敗退回文字 */ }

  // ── 5 列 × 3 按鈕：[左槽] [右槽] [第三欄] ──────────────
  const rows = EQ_LEFT_SLOTS.map((leftSlot, i) => {
    const rightSlot = EQ_RIGHT_SLOTS[i];
    const col3Slot  = EQ_COL3_SLOTS[i];
    const makeSlotBtn = (slot) => {
      const item = equipped[slot];
      const label = item ? item.itemName.slice(0, 20) : EQ_SLOT_LABELS[slot];
      return new ButtonBuilder()
        .setCustomId(`eq_btn:${slot}`)
        .setLabel(label)
        .setStyle(item ? ButtonStyle.Success : ButtonStyle.Secondary);
    };
    return new ActionRowBuilder().addComponents(
      makeSlotBtn(leftSlot), makeSlotBtn(rightSlot), makeSlotBtn(col3Slot)
    );
  });

  const payload = { components: rows, flags: MessageFlags.Ephemeral };
  if (imgBuffer) {
    const attachment = new AttachmentBuilder(imgBuffer, { name: "equipment.png" });
    payload.files = [attachment];
    payload.content = "";
  } else {
    // 圖片失敗退回純文字
    const SLOT_ORDER = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r"];
    const lines = SLOT_ORDER.map(s => {
      const item = equipped[s];
      return `　${EQ_SLOT_LABELS[s]}：${item ? `**${item.itemName}**` : "空"}`;
    });
    payload.content = `⚔️ **裝備欄**\n\n${lines.join("\n")}`;
  }

  await safeEditReply(interaction, payload);
  await rememberActiveReply(interaction, 120_000);
}

async function handleEquipAction(interaction, action, value) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    let result;
    if (action === "equip") {
      result = await serviceContext.shopService.equipItem(interaction.user.id, value);
      await safeEditReply(interaction, { content: `\u2705 已裝備 **${result.itemName}**！`, components: [] });
    } else {
      result = await serviceContext.shopService.unequipItem(interaction.user.id, value);
      await safeEditReply(interaction, { content: `\u2705 已卸下 **${result.itemName}**，已放回背包。`, components: [] });
    }
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  } catch (err) {
    await safeEditReply(interaction, { content: `\u274c 操作失敗\uff1a${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function handleBackpackView(interaction, uuid) {
  const serviceContext = getServiceContext();
  await clearActiveReply(interaction);
  // 先 defer，給後續 I/O 最多 15 分鐘
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const entry = (progress?.inventory || []).find((e) => e.uuid === uuid);
  if (!entry || !entry.imageUrl) {
    await safeEditReply(interaction, { content: "此道具沒有圖片。" });
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
    await safeEditReply(interaction, {
      content: `🖼️ **${entry.itemName}**\n${entry.source === "monster_drop" ? `掉落自 ${entry.sourceRef || "怪物"}` : `購於 ${(entry.purchasedAt || "").slice(0, 10)}`}\n\n你可以右鍵點擊圖片 → 另存圖片。`,
      files: [attachment]
    });
    await rememberActiveReply(interaction, 60_000);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 無法載入圖片：${err.message}` });
  }
}

async function handleBackpackTab(interaction, tab, page = 0) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, tab, undefined, page);
  await safeEditReply(interaction, msg);
}

async function handleBackpackEquip(interaction, uuid, tab = "item", page = 0) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.equipItem(interaction.user.id, uuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(inventory, tab, `✅ 已裝備 **${result.itemName}**！`, page);
    await safeEditReply(interaction, msg);
  } catch (err) {
    try {
      const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
      const inventory = progress?.inventory || [];
      const msg = buildBackpackMessage(inventory, tab, `❌ 裝備失敗：${err.message}`, page);
      await safeEditReply(interaction, msg);
    } catch (_) {
      await safeEditReply(interaction, { content: `❌ 裝備失敗：${err.message}`, components: [] });
    }
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function handleBackpackAction(interaction, action, uuid) {
  const serviceContext = getServiceContext();

  // reroll_attributes 需要確認
  if (action === "use") {
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const entry = (progress?.inventory || []).find(e => e.uuid === uuid);
    if (entry?.itemEffect?.type === "reroll_attributes") {
      await interaction.deferUpdate();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reroll_confirm:${uuid}`)
          .setLabel("確認重製屬性")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`reroll_cancel`)
          .setLabel("取消")
          .setStyle(ButtonStyle.Secondary)
      );
      await safeEditReply(interaction, {
        content: `⚠️ 確定要使用 **${entry.itemName}** 嗎？\n你目前所有的升等屬性點將會**完全重新隨機分配**，此操作不可逆！`,
        components: [row]
      });
      return;
    }
  }

  await interaction.deferUpdate();
  try {
    const isUse = action === "use";
    const result = isUse
      ? await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username)
      : await serviceContext.shopService.discardItem(interaction.user.id, uuid);
    const verb = isUse ? "使用" : "丟棄";
    const extra = isUse && result.effectDesc ? `\n${result.effectDesc}` : "";
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    // 判斷原本在哪個 tab（根據被操作的道具欄位）
    const tab = "item";
    const msg = buildBackpackMessage(inventory, tab, `✅ 已${verb} **${result.itemName}**。${extra}`);
    await safeEditReply(interaction, msg);
    if (!inventory.length) {
      setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 操作失敗：${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

/** 販售道具 */
async function handleBackpackSell(interaction, uuid, tab = "item", page = 0) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.sellItem(interaction.user.id, uuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(inventory, tab, `✅ 已販售 **${result.itemName}**，獲得 💰 ${result.price} 金幣。`, page);
    await safeEditReply(interaction, msg);
    if (!inventory.length) {
      setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 販售失敗：${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

/** 屬性重製確認 */
async function handleRerollConfirm(interaction, uuid) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(inventory, "item", `✅ 已使用 **${result.itemName}**。\n${result.effectDesc}`);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 使用失敗：${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

const ENHANCE_SLOT_ORDER = ["weapon","shield","head_top","head_mid","head_low","armor","garment","shoes","accessory_l","accessory_r"];

function buildEnhanceEntryPayload(progress, notice = "") {
  const equipped = progress?.equipment || {};
  const inv = progress?.inventory || [];

  const overMax = ENHANCE_SLOT_ORDER
    .map((slot) => equipped[slot])
    .filter((entry) => entry && Number(entry.enhanceLevel || 0) > 3);

  const overMaxLine = overMax.length
    ? `\n\n⚠️ 偵測到超過強化上限（+3）的裝備：\n${overMax.slice(0, 5).map((entry) => `・${entry.itemName}（+${entry.enhanceLevel}）`).join("\n")}${overMax.length > 5 ? `\n…共 ${overMax.length} 件` : ""}`
    : "";

  const enhanceable = ENHANCE_SLOT_ORDER
    .map((slot) => equipped[slot])
    .filter((entry) => entry && ((entry.tier) || (entry.equipStats && Object.keys(entry.equipStats).length > 0)) && (entry.enhanceLevel ?? 0) < 3);

  if (!enhanceable.length) {
    return {
      content: (notice ? `${notice}\n\n` : "") + "⚗️ 目前裝備槽上沒有可強化的裝備（需有 tier 或裝備屬性，且未達 +3 上限）。",
      components: [],
    };
  }

  const opts = enhanceable.slice(0, 25).map((entry) => {
    const slot = EQ_SLOT_LABELS[entry.equipSlot] || entry.equipSlot;
    const baseName = normalizeName(entry.itemName);
    const maxMaterialLevel = Math.min(2, Math.max(0, Number(entry.enhanceLevel || 0)));
    const matUnits = inv
      .filter((mat) => {
        if (!mat || mat.itemType !== "equipment") return false;
        if (mat.uuid === entry.uuid) return false;
        if (Number(mat.enhanceLevel || 0) > maxMaterialLevel) return false;
        if (entry.itemId && mat.itemId) return mat.itemId === entry.itemId;
        return normalizeName(mat.itemName) === baseName;
      })
      .reduce((sum, mat) => sum + Math.pow(2, Math.max(0, Number(mat.enhanceLevel || 0))), 0);
    return {
      label: `${entry.itemName}（+${entry.enhanceLevel ?? 0}）`,
      description: `${slot}　材料：等價 ${matUnits} 把可用`,
      value: entry.uuid,
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("enhance_pick_target")
    .setPlaceholder("選擇要強化的裝備")
    .addOptions(opts);

  return {
    content: (notice ? `${notice}\n\n` : "") + "⚗️ **裝備強化**\n選擇裝備槽上的裝備作為強化目標：" + overMaxLine,
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/** 強化入口：列出裝備槽上可強化目標 */
async function handleEnhanceEntry(interaction) {
  const serviceContext = getServiceContext();
  if (!interaction.deferred && !interaction.replied) {
    await clearActiveReply(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  await safeEditReply(interaction, buildEnhanceEntryPayload(progress));
  await rememberActiveReply(interaction, 120_000);
}

/** 強化步驟2：選定目標後，顯示自動強化需求 */
async function handleEnhanceSelect(interaction, targetUuid) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inv = progress?.inventory || [];

  let target = null;
  for (const entry of Object.values(progress?.equipment || {})) {
    if (entry?.uuid === targetUuid) { target = entry; break; }
  }
  if (!target) {
    await safeEditReply(interaction, { content: "❌ 找不到目標裝備，請確認裝備仍在裝備槽上。", components: [] });
    return;
  }

  const curLevel = target.enhanceLevel ?? 0;
  if (curLevel >= 3) {
    await safeEditReply(interaction, { content: `❌ **${target.itemName}** 已達強化上限（+3）。`, components: [] });
    return;
  }

  const required = Math.pow(2, curLevel);
  const baseName = normalizeName(target.itemName);
  const maxMaterialLevel = Math.min(2, Math.max(0, Number(curLevel || 0)));
  const availableUnits = inv
    .filter((entry) => {
      if (!entry || entry.itemType !== "equipment") return false;
      if (entry.uuid === targetUuid) return false;
      if (Number(entry.enhanceLevel || 0) > maxMaterialLevel) return false;
      if (target.itemId && entry.itemId) return entry.itemId === target.itemId;
      return normalizeName(entry.itemName) === baseName;
    })
    .reduce((sum, entry) => sum + Math.pow(2, Math.max(0, Number(entry.enhanceLevel || 0))), 0);

  if (availableUnits < required) {
    await safeEditReply(interaction, {
      content: `⚗️ **${baseName}**（目前 +${curLevel}）→ 強化至 **+${curLevel + 1}**\n需要等價 **${required}** 把同裝備作為材料（+1=2、+2=4；+3 不可當材料）。\n背包可用：等價 **${availableUnits}** 把（材料不足）`,
      components: [],
    });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`enhance_auto:${targetUuid}`)
      .setLabel(`強化至 +${curLevel + 1}（需等價 ${required} 把）`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("enhance_back")
      .setLabel("返回")
      .setStyle(ButtonStyle.Secondary)
  );

  await safeEditReply(interaction, {
    content: `⚗️ **${baseName}**（目前 +${curLevel}）→ 強化至 **+${curLevel + 1}**\n需要等價 **${required}** 把同裝備作為材料（+1=2、+2=4；+3 不可當材料）。\n背包可用：等價 **${availableUnits}** 把\n\n選擇「強化」後會自動扣除材料，不需要手動替換。`,
    components: [row],
  });
}

/** 強化步驟3：手動指定材料（保留相容） */
async function handleEnhanceConfirm(interaction, targetUuid, materialUuid) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.enhanceItem(interaction.user.id, targetUuid, materialUuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const consumed = result.materialsConsumed
      ? `（需求等價 ${result.materialsConsumed} 把，實際消耗 ${result.materialsConsumedItems || "?"} 件，等價總和 ${result.materialsConsumedUnits || "?"}）`
      : "";
    const statLabel = String(result.statBoosted || "").toUpperCase();
    const from = result.oldStatValue ?? "?";
    const to = result.newStatValue ?? "?";
    const notice = `✅ 強化成功！**${result.itemName}**（${statLabel} ${from} → ${to}）${consumed}`;
    await safeEditReply(interaction, buildEnhanceEntryPayload(progress, notice));

    if ((result.enhanceLevel || 0) >= 3) {
      _announceEnhance(interaction, result).catch(() => {});
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 強化失敗：${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function handleEnhanceAuto(interaction, targetUuid) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.enhanceItemAuto(interaction.user.id, targetUuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const consumed = result.materialsConsumed
      ? `（需求等價 ${result.materialsConsumed} 把，實際消耗 ${result.materialsConsumedItems || "?"} 件，等價總和 ${result.materialsConsumedUnits || "?"}）`
      : "";
    const statLabel = String(result.statBoosted || "").toUpperCase();
    const from = result.oldStatValue ?? "?";
    const to = result.newStatValue ?? "?";
    const notice = `✅ 強化成功！**${result.itemName}**（${statLabel} ${from} → ${to}）${consumed}`;
    await safeEditReply(interaction, buildEnhanceEntryPayload(progress, notice));

    if ((result.enhanceLevel || 0) >= 3) {
      _announceEnhance(interaction, result).catch(() => {});
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 強化失敗：${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function _announceEnhance(interaction, result) {
  try {
    const { getBotClient } = require("./runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;
    const sc = getServiceContext();
    const layout = await sc.channelLayoutRepository.get();
    const bindings = layout?.discord?.bindings || [];
    const binding = bindings.find(b => b.featureKey === "town_chat") ||
                    bindings.find(b => b.featureKey === "monster_zone");
    if (!binding?.channelId) return;
    const channel = await client.channels.fetch(binding.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const displayName = interaction.member?.displayName || interaction.user.username;
    const discordId = interaction.user.id;
    const statLabel = result.statBoosted.toUpperCase();
    await channel.send(
      `⚗️ **${displayName}** (<@${discordId}>) 強化成功！\n` +
      `✨ **${result.itemName}** ${statLabel} 提升至 **${result.newStatValue}**！`
    );
  } catch (_) { /* suppressed */ }
}

function buildWeeklyQuestsMessage(progressList, wl) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

  const lines = [];
  const claimButtons = [];

  for (const { quest, current, claimed, done } of progressList) {
    const bar = buildProgressBar(current, quest.target, 8);
    const status = claimed ? "✅ 已領取" : done ? "🔔 可領取" : "🔲 進行中";
    const rewards = [];
    if (quest.rewardGold)    rewards.push(`${quest.rewardGold} 🪙`);
    if (quest.rewardDiamond) rewards.push(`${quest.rewardDiamond} 💎`);
    if (quest.rewardItemId)  rewards.push("＋道具");
    const rewardStr = rewards.length ? ` ｜ 獎勵：${rewards.join(" ")}` : "";
    lines.push(`**${quest.title}** ${status}\n${bar} ${current}／${quest.target}${rewardStr}`);

    if (done && !claimed) {
      claimButtons.push(
        new ButtonBuilder()
          .setCustomId(`wq_claim:${quest.id}`)
          .setLabel(`🎁 領取「${quest.title.slice(0, 20)}」`)
          .setStyle(ButtonStyle.Success)
      );
    }
  }

  const content = `📋 **每週任務**（${wl}）\n\n` + lines.join("\n\n");

  // Discord 每個 ActionRow 最多 5 個按鈕，最多 5 行
  const components = [];
  for (let i = 0; i < claimButtons.length && i < 5; i += 5) {
    components.push(new ActionRowBuilder().addComponents(claimButtons.slice(i, i + 5)));
  }

  return { content, components };
}

async function handleWeeklyQuests(interaction) {
  const serviceContext = getServiceContext();
  const discordId = interaction.user.id;
  const { currentWeekLabel } = require("../services/weeklyQuest/weeklyQuestService");
  const wqs = serviceContext.weeklyQuestService;

  try {
    await clearActiveReply(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const progressList = await wqs.getPlayerProgress(discordId);
    const wl = currentWeekLabel();

    if (!progressList.length) {
      await safeEditReply(interaction, { content: `📋 **每週任務**（${wl}）\n\n本週尚無任務，請稍後再試。` });
      await rememberActiveReply(interaction, 60_000);
      return;
    }

    await safeEditReply(interaction, buildWeeklyQuestsMessage(progressList, wl));
    await rememberActiveReply(interaction, 120_000);
  } catch (err) {
    if (interaction.deferred || interaction.replied) {
      await safeEditReply(interaction, { content: `❌ 讀取每週任務失敗：${err.message}` });
    } else {
      await interaction.reply({ content: `❌ 讀取每週任務失敗：${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleWeeklyQuestClaim(interaction, questId) {
  const serviceContext = getServiceContext();
  const discordId = interaction.user.id;
  const { currentWeekLabel } = require("../services/weeklyQuest/weeklyQuestService");
  const wqs = serviceContext.weeklyQuestService;

  try {
    await interaction.deferUpdate();

    // 取得玩家 displayName
    const player = await serviceContext.playerRepository.findByDiscordId(discordId);
    const displayName = player?.displayName || interaction.user.username;

    const reward = await wqs.claimReward(discordId, questId);

    // 發放金幣 / 鑽石
    if (reward.gold > 0) {
      await serviceContext.rewardService.grantCurrency({
        discordId, displayName,
        currencyType: "gold",
        amount: reward.gold,
        source: "weekly_quest_reward",
        operator: "weekly_quest"
      });
    }
    if (reward.diamond > 0) {
      await serviceContext.rewardService.grantCurrency({
        discordId, displayName,
        currencyType: "diamond",
        amount: reward.diamond,
        source: "weekly_quest_reward",
        operator: "weekly_quest"
      });
    }
    // 發放道具
    if (reward.rewardItemId) {
      try {
        const item = await serviceContext.itemRepository.findById(reward.rewardItemId);
        if (item) {
          const prog = await serviceContext.progressRepository.findByPlayerId(discordId);
          if (prog) {
            if (!Array.isArray(prog.inventory)) prog.inventory = [];
            prog.inventory.push({
              uuid: crypto.randomUUID(),
              itemId: item.id,
              itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              itemType: item.itemType || "consumable",
              imageUrl: item.imageUrl || null,
              imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null,
              equipStats: item.equipStats || null,
              weaponType: item.weaponType || null,
              isTwoHanded: item.isTwoHanded || false,
              tier: item.tier || null,
              source: "weekly_quest",
              obtainedAt: new Date().toISOString()
            });
            prog.updatedAt = new Date().toISOString();
            await serviceContext.progressRepository.save(prog);
          }
          reward.rewardItemName = item.name;
        }
      } catch (_) {}
    }

    // 組成獎勵描述
    const rewardParts = [];
    if (reward.gold > 0)          rewardParts.push(`${reward.gold} 🪙`);
    if (reward.diamond > 0)       rewardParts.push(`${reward.diamond} 💎`);
    if (reward.rewardItemName)    rewardParts.push(`「${reward.rewardItemName}」`);
    const rewardDesc = rewardParts.length ? rewardParts.join(" ＋ ") : "（無金幣 / 鑽石）";

    // 重新讀取進度並更新訊息
    const wl = currentWeekLabel();
    const progressList = await wqs.getPlayerProgress(discordId);
    const { content, components } = buildWeeklyQuestsMessage(progressList, wl);
    await safeEditReply(interaction, { content: `✅ 已領取「${reward.questTitle}」獎勵：${rewardDesc}\n\n` + content.replace(/^📋 \*\*每週任務\*\*（[^）]+）\n\n/, "📋 **每週任務**（" + wl + "）\n\n"), components });
  } catch (err) {
    const msg = err.message || "領取失敗";
    await interaction.followUp({ content: `❌ ${msg}`, flags: MessageFlags.Ephemeral });
  }
}

function buildProgressBar(current, target, width = 10) {
  const filled = Math.round((Math.min(current, target) / Math.max(target, 1)) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

async function handleButton(interaction) {
  const id = interaction.customId;

  // 每週任務領取
  if (id.startsWith("wq_claim:")) {
    await handleWeeklyQuestClaim(interaction, id.slice("wq_claim:".length));
    return;
  }

  // 背包動作
  if (id.startsWith("backpack_tab:")) {
    const parts = id.slice("backpack_tab:".length).split(":");
    const tab = parts[0];
    const page = parseInt(parts[1] ?? "0", 10) || 0;
    await handleBackpackTab(interaction, tab, page);
    return;
  }
  if (id.startsWith("backpack_prev:") || id.startsWith("backpack_next:")) {
    const parts = id.split(":");
    const tab = parts[1];
    const page = parseInt(parts[2] ?? "0", 10) || 0;
    await handleBackpackTab(interaction, tab, page);
    return;
  }
  if (id.startsWith("backpack_page_input:")) {
    const parts = id.split(":");
    const tab = parts[1] || "item";
    const currentPage = parseInt(parts[2] ?? "0", 10) || 0;
    const totalPages = Math.max(1, parseInt(parts[3] ?? "1", 10) || 1);
    const modal = new ModalBuilder()
      .setCustomId(`backpack_page_modal:${tab}:${totalPages}`)
      .setTitle("跳轉背包頁數");
    const input = new TextInputBuilder()
      .setCustomId("target_page")
      .setLabel(`請輸入頁數（1 ~ ${totalPages}）`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder(String(Math.min(totalPages, currentPage + 1)));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }
  if (id.startsWith("backpack_equip:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const page = parseInt(parts[3] ?? "0", 10) || 0;
    await handleBackpackEquip(interaction, uuid, tab, page);
    return;
  }
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
  if (id.startsWith("backpack_sell:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const page = parseInt(parts[3] ?? "0", 10) || 0;
    await handleBackpackSell(interaction, uuid, tab, page);
    return;
  }
  if (id === "enhance_back") {
    await interaction.deferUpdate();
    await handleEnhanceEntry(interaction);
    return;
  }
  if (id.startsWith("enhance_auto:")) {
    await handleEnhanceAuto(interaction, id.slice("enhance_auto:".length));
    return;
  }
  if (id === BUTTON_IDS.enhance) {
    await handleEnhanceEntry(interaction);
    return;
  }
  if (id.startsWith("reroll_confirm:")) {
    await handleRerollConfirm(interaction, id.slice("reroll_confirm:".length));
    return;
  }
  if (id === "reroll_cancel") {
    await interaction.deferUpdate();
    const progress = await getServiceContext().progressRepository.findByPlayerId(interaction.user.id);
    const msg = buildBackpackMessage(progress?.inventory || [], "item");
    await safeEditReply(interaction, msg);
    return;
  }

  // 裝備欄格按鈕
  if (id.startsWith("eq_btn:")) {
    await handleEquipSlotButton(interaction, id.slice("eq_btn:".length));
    return;
  }

  // 裝備動作（舊版相容）
  if (id.startsWith("equip_equip:") || id.startsWith("equip_unequip:")) {
    const action = id.startsWith("equip_equip:") ? "equip" : "unequip";
    const value = id.slice(id.indexOf(":") + 1);
    await handleEquipAction(interaction, action, value);
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

  if (id === BUTTON_IDS.equipment) {
    await handleEquipmentView(interaction);
    return;
  }

  if (id === BUTTON_IDS.weeklyQuests) {
    await handleWeeklyQuests(interaction);
    return;
  }

  if (id === BUTTON_IDS.bindStream) {
    await handleBind(interaction);
    return;
  }
}

async function handleEquipSlotButton(interaction, slot) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const equipped = progress?.equipment || {};
  const inventory = (progress?.inventory || []).filter(e => e.itemType === "equipment" && e.equipSlot === slot);

  const options = [];
  if (equipped[slot]) {
    const item = equipped[slot];
    options.push({
      label: `↩️ 卸下`.slice(0, 25),
      description: item.itemName.slice(0, 50),
      value: `unequip:${slot}`
    });
  }
  inventory.slice(0, 24).forEach(e => {
    const stats = e.equipStats || {};
    const statStr = Object.entries(stats).filter(([,v])=>v).map(([k,v])=>`${k.toUpperCase()}${v>0?"+":""}${v}`).join(" ");
    options.push({
      label: e.itemName.slice(0, 25),
      description: (statStr || "點此裝備").slice(0, 50),
      value: `equip:${e.uuid}`
    });
  });

  if (options.length === 0) {
    await safeEditReply(interaction, { content: `❌ 背包沒有可裝備在 **${EQ_SLOT_LABELS[slot]}** 的道具，且此槽位是空的。`, components: [], files: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    return;
  }

  const picker = new StringSelectMenuBuilder()
    .setCustomId(`eq_pick:${slot}`)
    .setPlaceholder(`${EQ_SLOT_LABELS[slot]} — 選擇動作…`)
    .addOptions(options);

  await safeEditReply(interaction, {
    content: `⚔️ **${EQ_SLOT_LABELS[slot]}** — 選擇裝備或卸下：`,
    components: [new ActionRowBuilder().addComponents(picker)],
    files: []
  });
}

async function handleEquipmentSelect(interaction) {
  const serviceContext = getServiceContext();
  const customId = interaction.customId;
  if (!customId.startsWith("eq_pick:")) return;

  await interaction.deferUpdate();
  const slot = customId.slice("eq_pick:".length);
  const value = interaction.values[0];
  try {
    let result;
    if (value.startsWith("unequip:")) {
      result = await serviceContext.shopService.unequipItem(interaction.user.id, slot);
      await safeEditReply(interaction, { content: `✅ 已卸下 **${result.itemName}**，放回背包。`, components: [], files: [] });
    } else {
      const uuid = value.slice("equip:".length);
      result = await serviceContext.shopService.equipItem(interaction.user.id, uuid);
      await safeEditReply(interaction, { content: `✅ 已裝備 **${result.itemName}**！`, components: [], files: [] });
    }
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 操作失敗：${err.message}`, components: [], files: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function handleModal(interaction) {
  if (!interaction.customId.startsWith("backpack_page_modal:")) return false;

  const [, tab = "item", totalRaw = "1"] = interaction.customId.split(":");
  const totalPages = Math.max(1, parseInt(totalRaw, 10) || 1);
  const raw = interaction.fields.getTextInputValue("target_page").trim();
  const parsedPage = parseInt(raw, 10);
  const targetPage = Number.isFinite(parsedPage)
    ? Math.min(totalPages, Math.max(1, parsedPage)) - 1
    : 0;

  const serviceContext = getServiceContext();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, tab, undefined, targetPage);

  await clearActiveReply(interaction);
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  await rememberActiveReply(interaction, 120_000);
  return true;
}

module.exports = {
  createPlayerPanelMessage,
  handleButton,
  handleEquipmentSelect,
  handleWeeklyQuests,
  handleWeeklyQuestClaim,
  handleEnhanceEntry,
  handleEnhanceSelect,
  handleEnhanceConfirm,
  handleModal,
};
