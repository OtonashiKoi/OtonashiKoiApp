const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  AttachmentBuilder,
  ChannelType,
  MessageFlags
} = require("discord.js");
const {
  openChest,
  getPanelData
} = require("../core/userService");
const { renderLoadoutCard } = require("./renderLoadoutCard");
const { createGameSession } = require("../web/server");
const config = require("../config");



const definitions = [
  new SlashCommandBuilder().setName("裝備啟動").setDescription("🎮 開啟角色裝備面板與操作功能")
].map((d) => d.toJSON());

function getRarityEmoji(rarity) {
  const rarityMap = {
    "common": "⚪",
    "uncommon": "🟢", 
    "rare": "🔵",
    "epic": "🟣",
    "legendary": "🟡"
  };
  return rarityMap[rarity] || "⚪";
}

async function createPanelResponse(panelData, userId, discordUser, notice = null) {
  // 生成圖片
  const avatarURL = discordUser.displayAvatarURL({ format: 'png', size: 256 });
  const imageBuffer = await renderLoadoutCard({
    name: panelData.user.name,
    level: panelData.user.level,
    power: panelData.power,
    bonus: panelData.bonus, // 直接使用 bonus 對象
    equipped: panelData.user.equipped || {},
    avatarURL: avatarURL
  });

  const attachment = new AttachmentBuilder(imageBuffer, { name: 'loadout.png' });
  
  const components = buildPanelComponents(userId);
  
  return {
    content: notice || "🎮 **冒險面板** - 點擊按鈕進行操作",
    files: [attachment],
    components
  };
}

function buildPanelComponents(ownerId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`panel|open|${ownerId}`)
      .setLabel("開寶箱")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`panel|refresh|${ownerId}`)
      .setLabel("重新載入")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  if (interaction.commandName === "裝備啟動") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // 私人回復，只有玩家能看到
    
    // 檢查頻道是否支援 threads
    if (!interaction.channel || !interaction.channel.threads) {
      await interaction.editReply({
        content: `❌ **無法在此頻道創建私人遊戲室！**\n\n💡 **說明**：\n- 請在支援討論串的文字頻道中使用此指令\n- 私訊無法使用此功能\n- 請到伺服器的一般頻道重試`
      });
      return;
    }
    
    // 檢查是否已經有該用戶的活躍遊戲線程
    const existingThreads = await interaction.channel.threads.fetch({ archived: { fetchAll: false } });
    const userActiveThread = existingThreads.threads.find(thread => 
      thread.name.includes(`${username} 的私人遊戲室`) && !thread.archived
    );
    
    if (userActiveThread) {
      await interaction.editReply({
        content: `❌ **你已經有一個活躍的遊戲室！**\n\n🎮 你的現有遊戲室：${userActiveThread}\n\n💡 **提示**：一個人最多只能開一個遊戲討論窗\n⏰ 等待60分鐘自動關閉或手動關閉後才能開新的`
      });
      return;
    }
    
    // 創建 Web 遊戲 Session
    const avatarURL = interaction.user.displayAvatarURL({ format: 'png', size: 256 });
    const sessionId = createGameSession(userId, username, avatarURL);
    const gameUrl = `http://localhost:${config.port}/game?session=${sessionId}`;
    
    // 創建私有遊戲線程（只有該玩家能看到）
    const thread = await interaction.channel.threads.create({
      name: `🔒 ${username} 的私人遊戲室`,
      autoArchiveDuration: 60, // 60分鐘無活動後自動關閉
      type: ChannelType.PrivateThread, // 設定為私有線程
      invitable: false, // 禁止邀請其他人
      reason: '開啟裝備遊戲面板'
    });

    // 將用戶加入線程
    await thread.members.add(userId);
    
    // 私人回復（只有玩家看得到）
    await interaction.editReply({
      content: `🎉 **遊戲已啟動！** \n\n🎮 **Discord 遊戲室**: ${thread}\n� **Web 豪華版**: [**點擊進入特效遊戲**](${gameUrl})\n\n🔥 **Web版特色**:\n✨ 豐富的動畫特效\n✨ 粒子背景效果  \n✨ 即時數據更新\n✨ 更流暢的操作體驗\n\n🔒 **完全私人**: 只有你能看到\n⏰ **自動關閉**: 4小時無活動後清理`
    });

    // 在線程中發送遊戲面板
    const panelData = await getPanelData(userId, username);
    const response = await createPanelResponse(panelData, userId, interaction.user, 
      `🎉 **歡迎來到你的私人遊戲室！**\n\n🔒 **完全私密**: 這個空間只有你能看到\n⚡ 沒有人能干擾你的遊戲體驗\n🎮 盡情享受你的冒險時光\n⏰ 60分鐘無活動將自動關閉`);
    
    await thread.send(response);
    return;
  }
}

async function handleButton(interaction) {
  if (!interaction.customId.startsWith("panel|")) return;

  const parts = interaction.customId.split("|");
  const action = parts[1];
  const ownerId = parts[2];

  if (interaction.user.id !== ownerId) {
    await interaction.reply({ 
      content: "❌ **這不是你的面板！**\n\n使用 `/裝備啟動` 開啟自己的專屬遊戲室", 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  await interaction.deferUpdate();

  let notice = "🔄 **面板已更新**";

  if (action === "open") {
    const out = await openChest(ownerId, interaction.user.username);
    if (!out.ok) {
      notice = "💰 **金幣不足！** 開箱需要 35 金幣，多參與互動賺燕幣吧！";
    } else if (out.upgraded) {
      const emoji = getRarityEmoji(out.item.rarity);
      notice = `🎉 **裝備升級成功！** ${emoji} **${out.item.name}** 已自動裝備並提升戰力！`;
    } else {
      const emoji = getRarityEmoji(out.item.rarity);
      notice = `📦 **開箱成功！** 獲得 ${emoji} **${out.item.name}**，但沒有超過現有裝備`;
    }
  }

  if (action === "refresh") {
    notice = "🔄 **面板重新載入完成！** 數據已更新到最新狀態";
  }

  const panelData = await getPanelData(ownerId, interaction.user.username);
  const response = await createPanelResponse(panelData, ownerId, interaction.user, notice);
  await interaction.editReply(response);
}

module.exports = {
  definitions,
  handleCommand,
  handleButton
};
