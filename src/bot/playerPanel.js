const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const { BUTTON_IDS, createPlayerPanelMessage } = require("./playerPanelView");
const { expToNextLevel, MAX_LEVEL } = require("../shared/progression");
const { createCode } = require("./bindingStore");
const { renderEquipmentCard, LEFT_SLOTS: EQ_LEFT_SLOTS, RIGHT_SLOTS: EQ_RIGHT_SLOTS, COL3_SLOTS: EQ_COL3_SLOTS, SLOT_LABELS: EQ_SLOT_LABELS } = require("./equipmentCardRenderer");
const { calcPlayerStats } = require("../shared/combatStats");

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
  const cs = calcPlayerStats(attrs, equipped);
  const calcHp    = cs.maxHp;
  const calcAtk   = cs.atk;
  const calcDef   = cs.def;
  const calcCrit  = Math.round(cs.crit  * 10) / 10;
  const calcCombo = Math.round(cs.combo * 10) / 10;

  // ── 裝備屬性加成 ──
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in bonus) bonus[k] += (v || 0);
    }
  }
  const fmt = (base, key) => bonus[key] > 0 ? `${base} (+${bonus[key]})` : `${base}`;

  // ── 武器特效說明 ──
  const wt = cs.weaponType;
  const specialEffects = [];
  if (wt === "dagger")   specialEffects.push("🗡️ 匕首：連擊率 +20%");
  if (wt === "axe_2h")   specialEffects.push("🪓 雙手斧：攻擊倍率 ×4");
  if (wt === "staff_1h") specialEffects.push("🪄 法杖：絕對命中、怪物攻擊 ×2");
  if (wt === "staff_2h") specialEffects.push("🪄 雙手法杖：絕對命中、怪物攻擊 ×2、倍率 ×5");
  if (cs.attackCount === 2) specialEffects.push("⚔️ 雙持：每回合攻擊兩次");
  const effectLine = specialEffects.length ? "\n" + specialEffects.join("\n") : "";

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
    `剩餘點數 (Status Pt): ${p.statusPoints || 0}\n` +
    `==============\n` +
    `【戰鬥能力】\n` +
    `❤️ HP: ${calcHp}　⚔️ ATK: ${calcAtk}　🛡️ DEF: ${calcDef}\n` +
    `🎯 CRIT: ${calcCrit}%　⚡ 連擊: ${calcCombo}%` +
    effectLine + "\n" +
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

const EQ_SPECIAL_SLOTS = new Set(EQ_COL3_SLOTS);
const EQ_STANDARD_SLOTS = new Set([...EQ_LEFT_SLOTS, ...EQ_RIGHT_SLOTS]);

function filterByTab(inventory, tab) {
  if (tab === "equip")   return inventory.filter(e => e.itemType === "equipment" && EQ_STANDARD_SLOTS.has(e.equipSlot));
  if (tab === "special") return inventory.filter(e => e.itemType === "equipment" && EQ_SPECIAL_SLOTS.has(e.equipSlot));
  return inventory.filter(e => e.itemType !== "equipment");
}

function buildTabRow(activeTab) {
  const defs = [
    { tab: "item",    label: "🎮 道具" },
    { tab: "equip",   label: "⚔️ 裝備" },
    { tab: "special", label: "✨ 特殊" },
  ];
  return new ActionRowBuilder().addComponents(
    defs.map(d => new ButtonBuilder()
      .setCustomId(`backpack_tab:${d.tab}`)
      .setLabel(d.label)
      .setStyle(d.tab === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
}

function buildBackpackMessage(inventory, tab = "item", prefixMsg) {
  const filtered = filterByTab(inventory, tab);
  const header = prefixMsg ? prefixMsg + "\n\n" : "";
  const tabRow = buildTabRow(tab);
  const tabLabel = tab === "equip" ? "裝備" : tab === "special" ? "特殊" : "道具";
  if (!filtered.length) {
    return { content: header + `🎒 **背包 — ${tabLabel}**\n\n此分類目前為空。`, components: [tabRow] };
  }
  const lines = filtered.slice(0, 4).map((e, i) => {
    const slot = e.equipSlot ? ` (${EQ_SLOT_LABELS[e.equipSlot] || e.equipSlot})` : "";
    return `${i + 1}. **${e.itemName}**${slot}　${e.source === "monster_drop" ? `掉落自 ${e.sourceRef || "怪物"}` : `購於 ${(e.purchasedAt || "").slice(0, 10)}`}`;
  });
  if (filtered.length > 4) lines.push(`…還有 ${filtered.length - 4} 個`);
  const rows = filtered.slice(0, 4).map((e, i) => buildInventoryRow(e, i));
  rows.push(tabRow);
  return { content: header + `🎒 **背包 — ${tabLabel}**\n\n${lines.join("\n")}`, components: rows };
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
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 60_000);
}

async function handleEquipmentView(interaction) {
  const serviceContext = getServiceContext();
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

  await interaction.editReply(payload);
  setTimeout(() => interaction.deleteReply().catch(() => {}), 120_000);
}

async function handleEquipAction(interaction, action, value) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    let result;
    if (action === "equip") {
      result = await serviceContext.shopService.equipItem(interaction.user.id, value);
      await interaction.editReply({ content: `\u2705 已裝備 **${result.itemName}**！`, components: [] });
    } else {
      result = await serviceContext.shopService.unequipItem(interaction.user.id, value);
      await interaction.editReply({ content: `\u2705 已卸下 **${result.itemName}**，已放回背包。`, components: [] });
    }
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  } catch (err) {
    await interaction.editReply({ content: `\u274c 操作失敗\uff1a${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
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
      content: `🖼️ **${entry.itemName}**\n${entry.source === "monster_drop" ? `掉落自 ${entry.sourceRef || "怪物"}` : `購於 ${(entry.purchasedAt || "").slice(0, 10)}`}\n\n你可以右鍵點擊圖片 → 另存圖片。`,
      files: [attachment]
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 60_000);
  } catch (err) {
    await interaction.editReply({ content: `❌ 無法載入圖片：${err.message}` });
  }
}

async function handleBackpackTab(interaction, tab) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, tab);
  await interaction.editReply(msg);
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
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    // 判斷原本在哪個 tab（根據被操作的道具欄位）
    const tab = "item";
    const msg = buildBackpackMessage(inventory, tab, `✅ 已${verb} **${result.itemName}**。${extra}`);
    await interaction.editReply(msg);
    if (!inventory.length) {
      setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    }
  } catch (err) {
    await interaction.editReply({ content: `❌ 操作失敗：${err.message}`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

async function handleWeeklyQuests(interaction) {
  const serviceContext = getServiceContext();
  const discordId = interaction.user.id;
  const { WeeklyQuestService, currentWeekLabel } = require("../services/weeklyQuest/weeklyQuestService");
  const wqs = serviceContext.weeklyQuestService || new WeeklyQuestService();

  try {
    const progressList = await wqs.getPlayerProgress(discordId);
    const wl = currentWeekLabel();

    if (!progressList.length) {
      await replyAndAutoDelete(interaction, `📋 **每週任務**（${wl}）\n\n本週尚無任務，請稍後再試。`);
      return;
    }

    const lines = progressList.map(({ quest, current, claimed, done }) => {
      const bar = buildProgressBar(current, quest.target, 8);
      const status = claimed ? "✅ 已領取" : done ? "🔔 可領取" : "🔲 進行中";
      const rewards = [];
      if (quest.rewardGold)    rewards.push(`${quest.rewardGold} 🪙`);
      if (quest.rewardDiamond) rewards.push(`${quest.rewardDiamond} 💎`);
      if (quest.rewardItemId)  rewards.push("＋道具");
      const rewardStr = rewards.length ? ` ｜ 獎勵：${rewards.join(" ")}` : "";
      return (
        `**${quest.title}** ${status}\n` +
        `${bar} ${current}／${quest.target}${rewardStr}`
      );
    });

    const content =
      `📋 **每週任務**（${wl}）\n\n` +
      lines.join("\n\n") +
      `\n\n> 前往網頁版「更多→每週任務」可以領取完成的獎勵。`;

    await replyAndAutoDelete(interaction, content);
  } catch (err) {
    await replyAndAutoDelete(interaction, `❌ 讀取每週任務失敗：${err.message}`);
  }
}

function buildProgressBar(current, target, width = 10) {
  const filled = Math.round((Math.min(current, target) / Math.max(target, 1)) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

async function handleButton(interaction) {
  const id = interaction.customId;

  // 背包動作
  if (id.startsWith("backpack_tab:")) {
    await handleBackpackTab(interaction, id.slice("backpack_tab:".length));
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
    await interaction.editReply({ content: `❌ 背包沒有可裝備在 **${EQ_SLOT_LABELS[slot]}** 的道具，且此槽位是空的。`, components: [], files: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
    return;
  }

  const picker = new StringSelectMenuBuilder()
    .setCustomId(`eq_pick:${slot}`)
    .setPlaceholder(`${EQ_SLOT_LABELS[slot]} — 選擇動作…`)
    .addOptions(options);

  await interaction.editReply({
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
      await interaction.editReply({ content: `✅ 已卸下 **${result.itemName}**，放回背包。`, components: [], files: [] });
    } else {
      const uuid = value.slice("equip:".length);
      result = await serviceContext.shopService.equipItem(interaction.user.id, uuid);
      await interaction.editReply({ content: `✅ 已裝備 **${result.itemName}**！`, components: [], files: [] });
    }
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  } catch (err) {
    await interaction.editReply({ content: `❌ 操作失敗：${err.message}`, components: [], files: [] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
  }
}

module.exports = {
  createPlayerPanelMessage,
  handleButton,
  handleEquipmentSelect
};