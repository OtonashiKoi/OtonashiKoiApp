const path = require("path");
const fs = require("fs");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require("discord.js");

const BUTTON_IDS = {
  enterBattle: "monster-zone:enter-battle"
};

/**
 * @param {object|null} monster  - 上場怪物物件 (含 calc)
 * @param {number|null} currentHp - 當前血量 (null 表示滿血)
 * @param {number} participantCount - 本場已參戰人數
 */
function createMonsterZonePanelMessage(monster, currentHp, participantCount = 0) {
  const maxHp = monster?.calc?.maxHp ?? 0;
  const hp = currentHp != null ? currentHp : maxHp;
  const hpBar = maxHp > 0 ? buildHpBar(hp, maxHp) : "";

  const monsterName = monster?.name ?? "（尚無上場怪物）";
  const entryFee = monster?.entryFee ?? 0;
  const expReward = monster?.expReward ?? 0;
  const goldReward = monster?.goldReward ?? 0;

  const desc = [
    `目前上場：**${monsterName}**`,
    maxHp > 0 ? `❤️ ${hp} / ${maxHp}  ${hpBar}` : "",
    "",
    entryFee > 0 ? `入場費：${entryFee} 🪙` : "",
    expReward > 0 || goldReward > 0 ? `擊殺獎勵：EXP +${expReward}　金幣 +${goldReward}` : "",
    participantCount > 0 ? `⚔️ 目前參戰人數：${participantCount} 人` : "",
    "",
    "點擊下方按鈕出戰，進入回合制戰鬥！"
  ].filter((l) => l !== "").join("\n");

  const embed = new EmbedBuilder()
    .setTitle("⚔️ 放怪區")
    .setDescription(desc)
    .setColor(0xe74c3c);

  const files = [];

  // 嘗試附加怪物圖片（thumbnail）
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
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.enterBattle)
      .setLabel("⚔️ 出戰")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row], files };
}

function buildHpBar(hp, maxHp, length = 10) {
  const filled = Math.round((hp / maxHp) * length);
  return "🟥".repeat(Math.max(0, filled)) + "⬛".repeat(Math.max(0, length - filled));
}

module.exports = { createMonsterZonePanelMessage, BUTTON_IDS };
