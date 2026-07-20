"use strict";

const {
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require("discord.js");
const {
  PET_OPEN_ID,
  PET_BACK_ID,
  PET_FEED_ID,
  PET_FEED_TIER_PREFIX,
  PET_HATCH_ID,
  PET_ACTIVE_ID,
  PET_CLAIM_ID,
  PET_RENAME_ID,
  PET_DEX_ID,
  PET_RELEASE_ID,
  PET_RELEASE_CONFIRM_PREFIX,
  PET_SELECT_PREFIX,
  PET_RENAME_MODAL_ID,
  createPetDashboardMessage,
} = require("../petPanelView");

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

const PET_FEED_PAGE_PREFIX = "pet:feedpage:";
const FEED_PAGE_SIZE = 25;

function isPetButton(customId) {
  return (
    customId === PET_OPEN_ID ||
    customId === PET_BACK_ID ||
    customId === PET_FEED_ID ||
    customId === PET_HATCH_ID ||
    customId === PET_ACTIVE_ID ||
    customId === PET_CLAIM_ID ||
    customId === PET_RENAME_ID ||
    customId === PET_DEX_ID ||
    customId === PET_RELEASE_ID ||
    customId.startsWith(PET_FEED_TIER_PREFIX) ||
    customId.startsWith(PET_FEED_PAGE_PREFIX) ||
    customId.startsWith(PET_RELEASE_CONFIRM_PREFIX)
  );
}
function isPetSelect(customId) {
  return customId.startsWith(PET_SELECT_PREFIX);
}
function isPetModal(customId) {
  return customId === PET_RENAME_MODAL_ID;
}

const STAGE_LABEL = { egg: "🥚 蛋", grown: "🐾 已孵化" };
const EGG_EMOJI = { dragon: "🐉", slime: "🟢", wolf: "🐺" };
const EGG_NAME = { dragon: "神秘龍蛋", slime: "神秘史萊姆蛋", wolf: "神秘狼牙蛋" };
const eggEmoji = (p) => EGG_EMOJI[p?.eggType] || "🥚";
const eggName = (p) => EGG_NAME[p?.eggType] || "神秘寵物蛋";

// 寵物在選單/訊息的顯示名（蛋階段不揭曉種類）
function petDisplayName(p) {
  if (p.stage === "egg") return eggName(p);
  return p.nickname || p.speciesName || "未命名";
}

function petLine(p) {
  if (p.stage === "egg") {
    return `${eggEmoji(p)} ${eggName(p)}（孵化中 ${p.hatchPct}%｜${p.hatchProgress}/${p.hatchThreshold}）— 孵化後才揭曉品種`;
  }
  const name = p.nickname || p.speciesName || "未命名";
  const speed = p.gatherIntervalMin ? `每 ${p.gatherIntervalMin} 分採 1 個` : "";
  const gemPct = p.gemBias != null ? `石 ${Math.round(p.gemBias * 100)}%` : "";
  const quality = p.qualityUpChance ? `｜${Math.round(p.qualityUpChance * 100)}% 高一階` : "";
  const combat = p.combatBonus ? `｜⚔️ ${p.combatBonus}` : "";
  const trait = [speed, gemPct].filter(Boolean).join("、");
  return `${eggEmoji(p)} ${name}（${p.tier} 階）｜飽食 ${p.satiety}/${p.satietyMax}（撐 ${p.satietyHours}h）｜採集 ${p.gatherCount}/${p.gatherCap}（產 ≤${p.producesTier} 階）${combat}\n     └ ${trait}${quality}`;
}

// 重繪主面板到「同一個 ephemeral 訊息」（動作完成後呼叫，帶結果訊息）
async function refreshDashboard(interaction, status) {
  const sc = getServiceContext();
  const state = await sc.petService.getPetState(interaction.user.id);
  await interaction.editReply(createPetDashboardMessage(state, { status }));
}

// 子面板共用的「返回面板」按鈕列
function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PET_BACK_ID).setLabel("🔙 返回面板").setStyle(ButtonStyle.Secondary)
  );
}

// 餵食結果訊息行
function buildFeedStatus(r, tierLabel) {
  const lines = [tierLabel ? `🍖 餵了 **${r.fed}** 件 ${tierLabel} 階裝備` : "🍖 餵食完成！"];
  if (r.protectedCount > 0) lines.push(`🛡️ 已保護 **${r.protectedCount}** 件未餵（有 +值的請單件餵；卡片徽章不可餵）`);
  if (r.lockedCount > 0) lines.push(`🔒 已排除 **${r.lockedCount}** 件鎖定裝備，絕不會餵食。`);
  if (r.totalHatch > 0) lines.push(`孵化進度 +${r.totalHatch}`);
  if (r.totalSatiety > 0) lines.push(`飽食度 +${Math.round(r.totalSatiety)}`);
  if (r.hatched) {
    lines.push(`🎉 **孵化成功！開出了【${r.hatchedSpecies || "神秘寵物"}】（${r.pet?.tier || "?"} 階）！**`);
    if (r.pet?.combatBonus) lines.push(`⚔️ 這是**戰鬥夥伴**：出戰時 ${r.pet.combatBonus}`);
  }
  if (!r.hatched && r.pet?.stage === "grown" && (Number(r.pet.satiety) || 0) >= (Number(r.pet.satietyMax) || 100)) {
    lines.push(`✅ 已餵飽（滿飽食即可，餵多了不會浪費）`);
  }
  return lines;
}

function buildFeedMenu({ active, matchTier, items, page = 0 }) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / FEED_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(totalPages - 1, Number(page) || 0));
  const pageItems = items.slice(safePage * FEED_PAGE_SIZE, (safePage + 1) * FEED_PAGE_SIZE);

  const TIERS = ["D", "C", "B", "A"];
  const rank = { D: 0, C: 1, B: 2, A: 3 };
  const feedTier = active.feedTier || matchTier || "D";
  const styleByDiff = [ButtonStyle.Success, ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Secondary];
  const btns = TIERS.filter((t) => rank[t] <= rank[feedTier]).map((t) => {
    const diff = rank[feedTier] - rank[t];
    const pctMap = [100, 60, 30, 15];
    return new ButtonBuilder().setCustomId(`${PET_FEED_TIER_PREFIX}${t}`)
      .setLabel(`一鍵餵 ${t} 階素裝（${pctMap[diff]}%）`).setStyle(styleByDiff[diff] || ButtonStyle.Secondary);
  });
  const rows = [new ActionRowBuilder().addComponents(...btns)];

  if (pageItems.length > 0) {
    const options = pageItems.map((it) => {
      const plus = it.enhanceLevel > 0 ? ` +${it.enhanceLevel}` : "";
      const special = it.hasSpecial ? " ✨" : "";
      const label = `${it.itemName}${plus}${special}（${it.tier}階）`.slice(0, 100);
      const desc = `餵食效益 ${it.pct}%${it.hasSpecial ? "｜含特效" : ""}${it.enhanceLevel > 0 ? `｜已強化 +${it.enhanceLevel}` : ""}`.slice(0, 100);
      return new StringSelectMenuOptionBuilder().setLabel(label).setDescription(desc).setValue(`feed|${it.uuid}`);
    });
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${PET_SELECT_PREFIX}feed`)
      .setPlaceholder(totalPages > 1 ? `選擇單件餵食（第 ${safePage + 1}/${totalPages} 頁，共 ${total} 件）` : `選擇單件餵食（共 ${total} 件）`)
      .addOptions(options);
    rows.push(new ActionRowBuilder().addComponents(select));
  }

  if (totalPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PET_FEED_PAGE_PREFIX}${safePage - 1}`).setLabel("上一頁").setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
      new ButtonBuilder().setCustomId(`${PET_FEED_PAGE_PREFIX}${safePage + 1}`).setLabel("下一頁").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    ));
  }

  const feedNote = total > 0
    ? "👇 下方選單可挑**單件**餵食（含 +值 / ✨特效裝，會被消耗，請謹慎）。"
    : "（背包目前沒有可餵的裝備）";
  rows.push(backRow());

  return {
    content: [
      `🍖 **餵食** — 對象：${petLine(active)}`,
      "",
      `你的寵物對應階級為 **${matchTier}**，餵 ${matchTier} 階最划算（100%）；低階仍可餵但效益遞減。高於 ${matchTier} 階的裝備餵不進去。`,
      "🛡️ 一鍵只吃「素裝(+0)」；**有 +值 / 特效的需從選單單件餵、卡片徽章稱號不可餵**。",
      "",
      feedNote,
    ].join("\n"),
    embeds: [],
    components: rows,
  };
}

async function handlePetButton(interaction) {
  try {
    return await _handlePetButtonImpl(interaction);
  } catch (e) {
    console.error("[Pet] 按鈕處理失敗:", e?.message || e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "❌ 寵物操作失敗，請再試一次。", embeds: [], components: [] });
      } else {
        await interaction.reply({ content: "❌ 寵物操作失敗，請再試一次。", flags: MessageFlags.Ephemeral });
      }
    } catch (_) { /* 連回覆都失敗就放棄 */ }
  }
}

async function _handlePetButtonImpl(interaction) {
  const sc = getServiceContext();
  const discordId = interaction.user.id;

  // 外層採集站「進入我的寵物區」→ 開新的 ephemeral（不可動到公共面板）
  if (interaction.customId === PET_OPEN_ID) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = await sc.petService.getPetState(discordId);
    await interaction.editReply(createPetDashboardMessage(state));
    return;
  }

  // 返回主面板（子面板 → 主面板，原地編輯）
  if (interaction.customId === PET_BACK_ID) {
    await interaction.deferUpdate();
    await refreshDashboard(interaction);
    return;
  }

  // 改名走 Modal（不能先 defer）
  if (interaction.customId === PET_RENAME_ID) {
    const state = await sc.petService.getPetState(discordId);
    if (!state.active) {
      await interaction.reply({ content: "你目前沒有出戰中的寵物可改名。", flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder().setCustomId(PET_RENAME_MODAL_ID).setTitle("設定寵物暱稱");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("pet_nickname").setLabel("新暱稱（最多 20 字）")
        .setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true)
    ));
    await interaction.showModal(modal);
    return;
  }

  // 其餘動作一律「編輯同一個面板」，不再開新訊息
  await interaction.deferUpdate();

  // 批量餵食某階 → 餵完直接重繪主面板
  if (interaction.customId.startsWith(PET_FEED_TIER_PREFIX)) {
    const tier = interaction.customId.slice(PET_FEED_TIER_PREFIX.length);
    const state = await sc.petService.getPetState(discordId);
    if (!state.active) { await refreshDashboard(interaction, "你目前沒有出戰中的寵物。先孵一隻並出戰。"); return; }
    try {
      const r = await sc.petService.feedPet(discordId, state.active.uuid, { tier });
      await refreshDashboard(interaction, buildFeedStatus(r, tier));
    } catch (e) {
      await refreshDashboard(interaction, `❌ ${e.message || "餵食失敗"}`);
    }
    return;
  }

  if (interaction.customId.startsWith(PET_FEED_PAGE_PREFIX)) {
    const page = Number(interaction.customId.slice(PET_FEED_PAGE_PREFIX.length)) || 0;
    const { active, matchTier, items } = await sc.petService.listFeedableItems(discordId);
    if (!active) { await refreshDashboard(interaction, "你目前沒有出戰中的寵物。先孵一隻並出戰。"); return; }
    await interaction.editReply(buildFeedMenu({ active, matchTier, items, page }));
    return;
  }

  if (interaction.customId === PET_FEED_ID) {
    const { active, matchTier, items } = await sc.petService.listFeedableItems(discordId);
    if (!active) { await interaction.editReply("你目前沒有出戰中的寵物。先孵一隻並出戰。"); return; }
    await interaction.editReply(buildFeedMenu({ active, matchTier, items, page: 0 }));
    return;
  }

  if (interaction.customId === PET_CLAIM_ID) {
    try {
      const r = await sc.petService.claimGathering(discordId);
      if (r.granted.length === 0) { await refreshDashboard(interaction, "🎁 目前沒有可領取的採集物。"); return; }
      // 顯示實際獲得的道具名稱（同名合併計數）
      const summary = {};
      for (const g of r.granted) {
        const name = g.itemName || `${g.tier}${g.kind === "gem" ? "寶石" : "裝備"}`;
        summary[name] = (summary[name] || 0) + 1;
      }
      const detail = Object.entries(summary).map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join("、");
      await refreshDashboard(interaction, `🎁 領取 **${r.granted.length}** 個採集物：${detail}`);
    } catch (e) {
      await refreshDashboard(interaction, `❌ ${e.message || "領取失敗"}`);
    }
    return;
  }

  if (interaction.customId === PET_HATCH_ID) {
    // 列出背包的蛋
    const progress = await sc.progressRepository.findByPlayerId(discordId);
    const eggs = (progress?.inventory || []).filter((x) => x && x.itemType === "pet_egg");
    if (eggs.length === 0) { await refreshDashboard(interaction, "🥚 背包沒有寵物蛋。去龍族之領打怪有機會掉落。"); return; }
    const options = eggs.slice(0, 25).map((e) => new StringSelectMenuOptionBuilder()
      .setLabel(`${e.itemName}${e.stackCount > 1 ? ` ×${e.stackCount}` : ""}`)
      .setValue(`hatch|${e.uuid}`));
    const select = new StringSelectMenuBuilder().setCustomId(`${PET_SELECT_PREFIX}hatch`)
      .setPlaceholder("選擇要孵化的蛋").addOptions(options);
    await interaction.editReply({ content: "🥚 **孵蛋** — 選擇要孵化的蛋（孵化後會自動設為出戰）：", embeds: [], components: [new ActionRowBuilder().addComponents(select), backRow()] });
    return;
  }

  if (interaction.customId === PET_ACTIVE_ID) {
    const state = await sc.petService.getPetState(discordId);
    if (state.pets.length === 0) { await refreshDashboard(interaction, "你還沒有寵物。先孵一顆蛋。"); return; }
    const options = state.pets.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder()
      .setLabel(`${petDisplayName(p)} (${STAGE_LABEL[p.stage]}${p.stage === "grown" ? " " + p.tier + " 階" : ""})`)
      .setValue(`active|${p.uuid}`)
      .setDefault(p.uuid === state.activePetUuid));
    const select = new StringSelectMenuBuilder().setCustomId(`${PET_SELECT_PREFIX}active`)
      .setPlaceholder("選擇出戰寵物").addOptions(options);
    await interaction.editReply({ content: "🐾 **出戰/更換** — 選擇要出戰（採集）的寵物：", embeds: [], components: [new ActionRowBuilder().addComponents(select), backRow()] });
    return;
  }

  if (interaction.customId === PET_DEX_ID) {
    const state = await sc.petService.getPetState(discordId);
    const embed = new EmbedBuilder().setTitle("📋 我的寵物圖鑑").setColor(0x9d174d);
    if (state.pets.length === 0) embed.setDescription("（尚無寵物，打怪掉蛋：史萊姆家族→史萊姆蛋、龍族之領→龍蛋、地獄火焰→狼牙蛋）");
    else embed.setDescription(state.pets.map((p) => (p.uuid === state.activePetUuid ? "⭐ " : "・") + petLine(p)).join("\n"));
    await interaction.editReply({ content: "", embeds: [embed], components: [backRow()] });
    return;
  }

  // 放生確認：實際移除
  if (interaction.customId.startsWith(PET_RELEASE_CONFIRM_PREFIX)) {
    const uuid = interaction.customId.slice(PET_RELEASE_CONFIRM_PREFIX.length);
    try {
      const r = await sc.petService.releasePet(discordId, uuid);
      const name = petDisplayName(r.released);
      await refreshDashboard(interaction, `🕊️ 已放生「**${name}**」。牠回到龍族之領自由了（無任何回饋）。`);
    } catch (e) {
      await refreshDashboard(interaction, `❌ ${e.message || "放生失敗"}`);
    }
    return;
  }

  // 放生：列出寵物供選擇 → 選了之後跳確認
  if (interaction.customId === PET_RELEASE_ID) {
    const state = await sc.petService.getPetState(discordId);
    if (state.pets.length === 0) { await refreshDashboard(interaction, "你還沒有寵物。"); return; }
    const options = state.pets.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder()
      .setLabel(`${petDisplayName(p)} (${STAGE_LABEL[p.stage]}${p.stage === "grown" ? " " + p.tier + " 階" : ""})`)
      .setValue(`release|${p.uuid}`));
    const select = new StringSelectMenuBuilder().setCustomId(`${PET_SELECT_PREFIX}release`)
      .setPlaceholder("選擇要放生的寵物").addOptions(options);
    await interaction.editReply({
      content: "🕊️ **放生** — ⚠️ 放生會永久移除寵物，且**沒有任何回饋**。請選擇對象：",
      embeds: [],
      components: [new ActionRowBuilder().addComponents(select), backRow()],
    });
    return;
  }
}

async function handlePetSelect(interaction) {
  try {
    return await _handlePetSelectImpl(interaction);
  } catch (e) {
    console.error("[Pet] 選單處理失敗:", e?.message || e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "❌ 寵物操作失敗，請再試一次。", embeds: [], components: [] });
      } else {
        await interaction.reply({ content: "❌ 寵物操作失敗，請再試一次。", flags: MessageFlags.Ephemeral });
      }
    } catch (_) { /* 連回覆都失敗就放棄 */ }
  }
}

async function _handlePetSelectImpl(interaction) {
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  await interaction.deferUpdate();
  const value = interaction.values?.[0] || "";
  const [action, uuid] = value.split("|");
  try {
    if (action === "feed") {
      const state = await sc.petService.getPetState(discordId);
      if (!state.active) { await refreshDashboard(interaction, "你目前沒有出戰中的寵物。"); return; }
      const r = await sc.petService.feedPet(discordId, state.active.uuid, { inventoryUuid: uuid });
      await refreshDashboard(interaction, buildFeedStatus(r, null));
    } else if (action === "hatch") {
      const r = await sc.petService.hatchEggFromInventory(discordId, uuid);
      const lines = [`🥚 已開始孵化${eggName(r.pet)}，並設為**出戰中**！`];
      if (r.benchedPet) {
        const benchedName = petDisplayName(r.benchedPet);
        lines.push(`🔁 原本出戰的「**${benchedName}**」已被換下、暫停採集（可用【🐾 出戰/更換】切回）。`);
      }
      lines.push("餵裝備累積孵化進度（約 20 件 D 裝），孵化瞬間才揭曉品種。");
      await refreshDashboard(interaction, lines);
    } else if (action === "active") {
      const r = await sc.petService.setActivePet(discordId, uuid);
      await refreshDashboard(interaction, `🐾 已設為出戰：**${petDisplayName(r.pet)}**`);
    } else if (action === "release") {
      // 選好後跳「確認放生」按鈕（二次確認避免誤點）
      const state = await sc.petService.getPetState(discordId);
      const target = state.pets.find((p) => p.uuid === uuid);
      const name = target ? petDisplayName(target) : "該寵物";
      const confirmBtn = new ButtonBuilder()
        .setCustomId(`${PET_RELEASE_CONFIRM_PREFIX}${uuid}`)
        .setLabel(`確定放生「${name}」`).setStyle(ButtonStyle.Danger);
      await interaction.editReply({
        content: `⚠️ 確定要放生「**${name}**」嗎？此操作**無法復原、沒有回饋**。`,
        embeds: [],
        components: [new ActionRowBuilder().addComponents(confirmBtn), backRow()],
      });
    } else {
      await refreshDashboard(interaction, "未知選項。");
    }
  } catch (e) {
    await interaction.editReply(`❌ ${e.message || "操作失敗"}`);
  }
}

async function handlePetModal(interaction) {
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  const nickname = interaction.fields.getTextInputValue("pet_nickname").trim();
  // 改名 Modal 由面板按鈕觸發 → 可回編原本的面板訊息
  const fromMessage = typeof interaction.isFromMessage === "function" && interaction.isFromMessage();
  if (fromMessage) {
    await interaction.deferUpdate();
    try {
      const state = await sc.petService.getPetState(discordId);
      if (!state.active) { await refreshDashboard(interaction, "沒有出戰中的寵物。"); return; }
      const r = await sc.petService.renamePet(discordId, state.active.uuid, nickname);
      await refreshDashboard(interaction, `✏️ 暱稱已更新為「**${r.pet.nickname}**」`);
    } catch (e) {
      await refreshDashboard(interaction, `❌ ${e.message || "改名失敗"}`);
    }
    return;
  }
  // 後備：非面板來源 → 一般 ephemeral 回覆
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const state = await sc.petService.getPetState(discordId);
    if (!state.active) { await interaction.editReply("沒有出戰中的寵物。"); return; }
    const r = await sc.petService.renamePet(discordId, state.active.uuid, nickname);
    await interaction.editReply(`✏️ 暱稱已更新為「**${r.pet.nickname}**」`);
  } catch (e) {
    await interaction.editReply(`❌ ${e.message || "改名失敗"}`);
  }
}

module.exports = {
  isPetButton,
  isPetSelect,
  isPetModal,
  handlePetButton,
  handlePetSelect,
  handlePetModal,
};
