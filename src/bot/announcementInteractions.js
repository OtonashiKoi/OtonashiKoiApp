"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");

const PREFIX = "announcement:";
const HUTAO_ZONE = "event_boss_hutao_preview";
const HUTAO_URL = `https://otonashikoi.org/battle?tab=event&zone=${HUTAO_ZONE}`;

function jobNoticeComponents(itemId) {
  if (!require("../shared/jobAdvancement").getT2Branch(itemId)) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}job:${itemId}`).setLabel("查看職業資料").setStyle(ButtonStyle.Secondary)
  )];
}

function hutaoNoticeComponents(monsterName) {
  if (monsterName !== "北風雀神・胡桃") return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}boss:hutao`).setLabel("查看胡桃說明").setStyle(ButtonStyle.Primary)
  )];
}

function isAnnouncementButton(customId) {
  return String(customId || "").startsWith(PREFIX);
}

async function handleAnnouncementButton(interaction) {
  const { serviceContext } = require("./runtimeContext");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (interaction.customId === `${PREFIX}boss:hutao`) {
      const svc = serviceContext.worldBossServiceFor?.(HUTAO_ZONE);
      const info = await svc?.getConfigWithStatus(interaction.user.id);
      if (!info) return interaction.editReply("目前無法取得胡桃戰況，請稍後再試。");
      const { WINDS } = require("../shared/hutaoEvent");
      const status = info.status || {};
      const cooldown = Math.max(0, Math.ceil(Number(status.cooldownRemainingMs || 0) / 60000));
      const availability = status.canChallenge ? "目前可挑戰" : status.lockedReason || (cooldown ? `重生冷卻：約 ${cooldown} 分鐘` : "目前無法挑戰");
      const embed = new EmbedBuilder()
        .setTitle("北風雀神・胡桃｜戰鬥說明")
        .setColor(0x7ce0ff)
        .setDescription([
          `**戰況：${availability}**`,
          "持續共鬥；擊殺後依目前設定重生。倒地者需由存活隊友使用復活藥，若全隊倒地則重置為滿血後可重新挑戰。",
          "**場風輪轉**",
          ...WINDS.map((wind) => `${wind.glyph} ${wind.name}：${wind.description}`),
          "⛓️ 胡桃命中時有 12% 機率施放四風連擊，四段各為 45% 攻擊力。",
          "🧪 出戰前可在背包装備區設定戰鬥藥水；進場會依目前規則檢查資格與入場費。",
          `擊殺後重生冷卻：${info.config.respawnCooldownMinutes} 分鐘。`
        ].join("\n"));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("前往胡桃戰鬥").setStyle(ButtonStyle.Link).setURL(HUTAO_URL)
      );
      return interaction.editReply({ embeds: [embed], components: [row] });
    }
    if (interaction.customId.startsWith(`${PREFIX}job:`)) {
      const itemId = interaction.customId.slice(`${PREFIX}job:`.length);
      const branch = require("../shared/jobAdvancement").getT2Branch(itemId);
      if (!branch) return interaction.editReply("找不到這個二轉職業。");
      const item = await serviceContext.itemRepository.findById(itemId);
      if (!item || item.enabled === false || item.disabled === true) return interaction.editReply("這個職業的徽章資料目前未開放。");
      const { buildItemEffectLines } = require("../shared/itemEffectLines");
      const lines = [item.description, ...buildItemEffectLines(item)].filter(Boolean);
      const embed = new EmbedBuilder()
        .setTitle(`${branch.name}｜職業資料`)
        .setColor(0xffd166)
        .setDescription((lines.join("\n") || "目前沒有額外職業說明。").slice(0, 4000));
      if (/^https:\/\//.test(item.imageThumbnailUrl || item.imageUrl || "")) embed.setThumbnail(item.imageThumbnailUrl || item.imageUrl);
      return interaction.editReply({ embeds: [embed] });
    }
    return interaction.editReply("找不到這個公告操作。");
  } catch (error) {
    console.error("[AnnouncementInteractions]", error);
    return interaction.editReply("讀取公告資料失敗，請稍後再試。");
  }
}

module.exports = { jobNoticeComponents, hutaoNoticeComponents, isAnnouncementButton, handleAnnouncementButton };
