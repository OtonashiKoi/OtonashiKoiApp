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
} = require("../petPanelView");

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

function isPetButton(customId) {
  return (
    customId === PET_FEED_ID ||
    customId === PET_HATCH_ID ||
    customId === PET_ACTIVE_ID ||
    customId === PET_CLAIM_ID ||
    customId === PET_RENAME_ID ||
    customId === PET_DEX_ID ||
    customId === PET_RELEASE_ID ||
    customId.startsWith(PET_FEED_TIER_PREFIX) ||
    customId.startsWith(PET_RELEASE_CONFIRM_PREFIX)
  );
}
function isPetSelect(customId) {
  return customId.startsWith(PET_SELECT_PREFIX);
}
function isPetModal(customId) {
  return customId === PET_RENAME_MODAL_ID;
}

const STAGE_LABEL = { egg: "🥚 蛋", grown: "🐉 已孵化" };

// 寵物在選單/訊息的顯示名（蛋階段不揭曉種類）
function petDisplayName(p) {
  if (p.stage === "egg") return "神秘龍蛋";
  return p.nickname || p.speciesName || "未命名";
}

function petLine(p) {
  if (p.stage === "egg") {
    return `🥚 神秘龍蛋（孵化中 ${p.hatchPct}%｜${p.hatchProgress}/${p.hatchThreshold}）— 孵化後才揭曉品種`;
  }
  const name = p.nickname || p.speciesName || "未命名";
  const speed = p.gatherIntervalMin ? `每 ${p.gatherIntervalMin} 分採 1 個` : "";
  const gemPct = p.gemBias != null ? `石 ${Math.round(p.gemBias * 100)}%` : "";
  const quality = p.qualityUpChance ? `｜${Math.round(p.qualityUpChance * 100)}% 高一階` : "";
  const trait = [speed, gemPct].filter(Boolean).join("、");
  return `🐉 ${name}（${p.speciesName || "?"}）Lv.${p.level}（exp ${p.growthExp}/${p.expToNext}）｜飽食 ${p.satiety}/${p.satietyMax}｜採集 ${p.gatherCount}/${p.gatherCap}（產 ${p.producesTier} 階）\n     └ ${trait}${quality}`;
}

async function handlePetButton(interaction) {
  const sc = getServiceContext();
  const discordId = interaction.user.id;

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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // 批量餵食某階
  if (interaction.customId.startsWith(PET_FEED_TIER_PREFIX)) {
    const tier = interaction.customId.slice(PET_FEED_TIER_PREFIX.length);
    const state = await sc.petService.getPetState(discordId);
    if (!state.active) { await interaction.editReply("你目前沒有出戰中的寵物。先孵一隻並出戰。"); return; }
    try {
      const r = await sc.petService.feedPet(discordId, state.active.uuid, { tier });
      const lines = [`🍖 餵了 **${r.fed}** 件 ${tier} 階裝備`];
      if (r.totalHatch > 0) lines.push(`孵化進度 +${r.totalHatch}`);
      if (r.totalSatiety > 0) lines.push(`飽食度 +${Math.round(r.totalSatiety)}`);
      if (r.totalGrowth > 0) lines.push(`成長 exp +${r.totalGrowth}`);
      if (r.hatched) lines.push(`🎉 **孵化成功！開出了【${r.hatchedSpecies || "神秘龍"}】！**`);
      if (r.leveledTo) lines.push(`⬆️ 升到 **Lv.${r.leveledTo}**`);
      lines.push("", petLine(r.pet));
      await interaction.editReply(lines.join("\n"));
    } catch (e) {
      await interaction.editReply(`❌ ${e.message || "餵食失敗"}`);
    }
    return;
  }

  if (interaction.customId === PET_FEED_ID) {
    const state = await sc.petService.getPetState(discordId);
    if (!state.active) { await interaction.editReply("你目前沒有出戰中的寵物。先孵一隻並出戰。"); return; }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PET_FEED_TIER_PREFIX}D`).setLabel("餵所有 D 階").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PET_FEED_TIER_PREFIX}C`).setLabel("餵所有 C 階").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PET_FEED_TIER_PREFIX}B`).setLabel("餵所有 B 階").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PET_FEED_TIER_PREFIX}A`).setLabel("餵所有 A 階").setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      content: `對象：${petLine(state.active)}\n\n選擇要批量餵食的裝備階級（D 飼料最划算）：`,
      components: [row],
    });
    return;
  }

  if (interaction.customId === PET_CLAIM_ID) {
    try {
      const r = await sc.petService.claimGathering(discordId);
      if (r.granted.length === 0) { await interaction.editReply("目前沒有可領取的採集物。"); return; }
      const summary = {};
      for (const g of r.granted) {
        const k = `${g.tier}${g.kind === "gem" ? "寶石" : "裝備"}`;
        summary[k] = (summary[k] || 0) + 1;
      }
      const lines = Object.entries(summary).map(([k, n]) => `・${k} ×${n}`);
      await interaction.editReply(`🎁 領取 **${r.granted.length}** 個採集物：\n${lines.join("\n")}`);
    } catch (e) {
      await interaction.editReply(`❌ ${e.message || "領取失敗"}`);
    }
    return;
  }

  if (interaction.customId === PET_HATCH_ID) {
    // 列出背包的蛋
    const progress = await sc.progressRepository.findByPlayerId(discordId);
    const eggs = (progress?.inventory || []).filter((x) => x && x.itemType === "pet_egg");
    if (eggs.length === 0) { await interaction.editReply("背包沒有寵物蛋。去龍族之領打怪有機會掉落。"); return; }
    const options = eggs.slice(0, 25).map((e) => new StringSelectMenuOptionBuilder()
      .setLabel(`${e.itemName}${e.stackCount > 1 ? ` ×${e.stackCount}` : ""}`)
      .setValue(`hatch|${e.uuid}`));
    const select = new StringSelectMenuBuilder().setCustomId(`${PET_SELECT_PREFIX}hatch`)
      .setPlaceholder("選擇要孵化的蛋").addOptions(options);
    await interaction.editReply({ content: "選擇要從哪顆蛋開始孵化：", components: [new ActionRowBuilder().addComponents(select)] });
    return;
  }

  if (interaction.customId === PET_ACTIVE_ID) {
    const state = await sc.petService.getPetState(discordId);
    if (state.pets.length === 0) { await interaction.editReply("你還沒有寵物。先孵一顆蛋。"); return; }
    const options = state.pets.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder()
      .setLabel(`${petDisplayName(p)} (${STAGE_LABEL[p.stage]} Lv.${p.level})`)
      .setValue(`active|${p.uuid}`)
      .setDefault(p.uuid === state.activePetUuid));
    const select = new StringSelectMenuBuilder().setCustomId(`${PET_SELECT_PREFIX}active`)
      .setPlaceholder("選擇出戰寵物").addOptions(options);
    await interaction.editReply({ content: "選擇要出戰（採集）的寵物：", components: [new ActionRowBuilder().addComponents(select)] });
    return;
  }

  if (interaction.customId === PET_DEX_ID) {
    const state = await sc.petService.getPetState(discordId);
    const embed = new EmbedBuilder().setTitle("🐾 我的寵物").setColor(0x9d174d);
    if (state.pets.length === 0) embed.setDescription("（尚無寵物，去龍族之領打蛋）");
    else embed.setDescription(state.pets.map((p) => (p.uuid === state.activePetUuid ? "⭐ " : "・") + petLine(p)).join("\n"));
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 放生確認：實際移除
  if (interaction.customId.startsWith(PET_RELEASE_CONFIRM_PREFIX)) {
    const uuid = interaction.customId.slice(PET_RELEASE_CONFIRM_PREFIX.length);
    try {
      const r = await sc.petService.releasePet(discordId, uuid);
      const name = petDisplayName(r.released);
      await interaction.editReply({ content: `🕊️ 已放生「**${name}**」。牠回到龍族之領自由了（無任何回饋）。`, components: [] });
    } catch (e) {
      await interaction.editReply({ content: `❌ ${e.message || "放生失敗"}`, components: [] });
    }
    return;
  }

  // 放生：列出寵物供選擇 → 選了之後跳確認
  if (interaction.customId === PET_RELEASE_ID) {
    const state = await sc.petService.getPetState(discordId);
    if (state.pets.length === 0) { await interaction.editReply("你還沒有寵物。"); return; }
    const options = state.pets.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder()
      .setLabel(`${petDisplayName(p)} (${STAGE_LABEL[p.stage]} Lv.${p.level})`)
      .setValue(`release|${p.uuid}`));
    const select = new StringSelectMenuBuilder().setCustomId(`${PET_SELECT_PREFIX}release`)
      .setPlaceholder("選擇要放生的寵物").addOptions(options);
    await interaction.editReply({
      content: "⚠️ **放生會永久移除寵物，且沒有任何回饋**。請選擇要放生的對象：",
      components: [new ActionRowBuilder().addComponents(select)],
    });
    return;
  }
}

async function handlePetSelect(interaction) {
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const value = interaction.values?.[0] || "";
  const [action, uuid] = value.split("|");
  try {
    if (action === "hatch") {
      const r = await sc.petService.hatchEggFromInventory(discordId, uuid);
      await interaction.editReply(`🥚 開始孵化神秘龍蛋！\n${petLine(r.pet)}\n\n餵裝備累積孵化進度（約 20 件 D 裝），**孵化瞬間才會揭曉是哪種龍**。`);
    } else if (action === "active") {
      const r = await sc.petService.setActivePet(discordId, uuid);
      await interaction.editReply(`🐾 已設為出戰寵物：\n${petLine(r.pet)}`);
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
        components: [new ActionRowBuilder().addComponents(confirmBtn)],
      });
    } else {
      await interaction.editReply("未知選項。");
    }
  } catch (e) {
    await interaction.editReply(`❌ ${e.message || "操作失敗"}`);
  }
}

async function handlePetModal(interaction) {
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const nickname = interaction.fields.getTextInputValue("pet_nickname").trim();
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
