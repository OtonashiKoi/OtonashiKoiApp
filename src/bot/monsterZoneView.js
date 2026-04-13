const path = require("path");
const fs = require("fs");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require("discord.js");

const BUTTON_IDS = {
  enterBattle: "monster-zone:enter-battle"
};

function createMonsterZonePanelMessage(monster, currentHp, participantCount = 0, damageMap = {}, options = {}) {
  const activeEvent = options.activeEvent || null;
  if (activeEvent) {
    return createEventPanelMessage(activeEvent);
  }

  const maxHp = monster?.calc?.maxHp ?? 0;
  const hp = currentHp != null ? currentHp : maxHp;
  const hpBar = maxHp > 0 ? buildHpBar(hp, maxHp) : "";

  const monsterName = monster?.name ?? "尚未設定怪物";
  const entryFee = monster?.entryFee ?? 0;
  const expReward = monster?.expReward ?? 0;
  const goldReward = monster?.goldReward ?? 0;

  const entryFeePool = Math.round(participantCount * entryFee * 1.15);
  const effectivePool = Math.max(goldReward, entryFeePool);
  const bonusNote = entryFeePool > goldReward && participantCount > 0 ? ` 額外+${entryFeePool - goldReward}` : "";

  const damageEntries = Object.values(damageMap).sort((a, b) => b.damage - a.damage);
  const damageSection = damageEntries.length > 0
    ? "傷害排行榜\n" + damageEntries.map((v) => `${v.name} - ${v.damage}`).join("\n")
    : "";

  const desc = [
    `目前怪物：**${monsterName}**`,
    maxHp > 0 ? `HP ${hp} / ${maxHp}  ${hpBar}` : "",
    "",
    entryFee > 0 ? `入場費：${entryFee} 金幣` : "",
    expReward > 0 || effectivePool > 0 ? `擊殺獎勵：EXP +${expReward}  金幣 +${effectivePool}${bonusNote}` : "",
    participantCount > 0 ? `參戰人數：${participantCount} 人` : "",
    damageSection,
    "",
    "點擊下方按鈕即可進入戰鬥"
  ].filter(Boolean).join("\n");

  const embed = new EmbedBuilder().setTitle("怪物區域").setDescription(desc).setColor(0xe74c3c);
  const files = [];

  if (monster?.imageThumbnailUrl || monster?.imageUrl) {
    const relUrl = monster.imageThumbnailUrl || monster.imageUrl;
    const imagePath = path.resolve(__dirname, "../web/public", relUrl.replace(/^\//, ""));
    if (fs.existsSync(imagePath)) {
      const fileName = path.basename(imagePath);
      files.push(new AttachmentBuilder(imagePath, { name: fileName }));
      embed.setThumbnail(`attachment://${fileName}`);
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_IDS.enterBattle).setLabel("進入戰鬥").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row], files };
}

function createEventPanelMessage(activeEvent) {
  const endAtMs = Date.parse(activeEvent.endsAt || "");
  const remaining = Number.isFinite(endAtMs) ? Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000)) : null;
  const remainLine = remaining == null ? "" : `剩餘時間：約 ${remaining} 秒`;
  const desc = [
    `事件：**${activeEvent.name || "怪物過場事件"}**`,
    activeEvent.message || "事件進行中，請稍候…",
    remainLine,
    "",
    "事件結束後會自動切換到下一隻怪物。"
  ].filter(Boolean).join("\n");

  const embed = new EmbedBuilder().setTitle("事件進行中").setDescription(desc).setColor(0xf59e0b);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_IDS.enterBattle).setLabel("事件進行中").setStyle(ButtonStyle.Secondary).setDisabled(true)
  );

  return { embeds: [embed], components: [row], files: [] };
}

function buildHpBar(hp, maxHp, length = 10) {
  const filled = Math.round((hp / maxHp) * length);
  return "█".repeat(Math.max(0, filled)) + "?".repeat(Math.max(0, length - filled));
}

module.exports = { createMonsterZonePanelMessage, BUTTON_IDS };

