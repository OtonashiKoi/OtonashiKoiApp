const {
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder
} = require("discord.js");
const {
  IDLE_ZONE_START_ID,
  IDLE_ZONE_CLAIM_ID,
  IDLE_ZONE_CANCEL_ID,
  IDLE_ZONE_SELECT_ID,
  IDLE_ZONE_STATUS_ID,
  IDLE_ZONE_REFRESH_ID
} = require("../idleZoneView");

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

function formatDuration(minutes) {
  const mins = Math.max(0, Math.floor(Number(minutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} 分鐘`;
  if (m <= 0) return `${h} 小時`;
  return `${h} 小時 ${m} 分鐘`;
}

function formatLevelRange(minLevel, maxLevel) {
  if (maxLevel === null || maxLevel === undefined) return `Lv.${minLevel}+`;
  return `Lv.${minLevel}~${maxLevel}`;
}

function formatRelativeTime(iso) {
  const ts = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(ts) || ts <= 0) return iso;
  return `<t:${ts}:R>`;
}

function formatTaipeiDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || "");
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute} (TW)`;
}

function buildSessionControlRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(IDLE_ZONE_CLAIM_ID)
        .setLabel("🎁 領取獎勵")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(IDLE_ZONE_CANCEL_ID)
        .setLabel("⛔ 取消掛機")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(IDLE_ZONE_REFRESH_ID)
        .setLabel("🔄 刷新時間")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function resolveMemberRoleIds(interaction) {
  let roleIds = interaction.member?.roles?.cache?.map((r) => r.id) || [];
  if (roleIds.length > 0) return roleIds;
  if (!interaction.guild) return [];
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    roleIds = member?.roles?.cache?.map((r) => r.id) || [];
  } catch (_) {}
  return roleIds;
}

function buildStatusPayload(status, headline = "") {
  const session = status?.discordSession || null;
  const summary = status?.sessionSummary || null;
  const content = buildStatusText(status, headline);
  const payload = { content };
  if (session && summary) {
    payload.components = buildSessionControlRows();
  } else {
    payload.components = [];
  }
  return payload;
}

async function ensurePlayerAllowed(interaction) {
  const serviceContext = getServiceContext();
  const allowed = await serviceContext.accessControlService.isDiscordPlayerAllowed(interaction);
  if (!allowed) {
    await interaction.reply({
      content: "❌ 你目前不在可用玩家白名單中。",
      flags: MessageFlags.Ephemeral
    });
    return false;
  }
  return true;
}

async function resolveIdleStickerUrl(interaction) {
  try {
    if (!interaction.guild) return null;
    const stickers = await interaction.guild.stickers.fetch();
    const target = stickers.find((s) => String(s?.name || "").includes("音無醬砍人"));
    return target?.url || null;
  } catch (_) {
    return null;
  }
}

function buildStatusText(status, title = "") {
  const lines = [];
  if (title) lines.push(title);

  const session = status?.discordSession || null;
  const summary = status?.sessionSummary || null;
  if (!session || !summary) {
    lines.push("目前沒有進行中的掛機。");
    const firstAvailable = (status?.zones || []).find((z) => z.available);
    if (firstAvailable) {
      lines.push(`可進入：${firstAvailable.emoji} **${firstAvailable.label}**（${formatLevelRange(firstAvailable.minLevel, firstAvailable.maxLevel)}）`);
      lines.push(`每 5 分鐘：平均 **${Math.round(firstAvailable.avgGold)} 金幣**、**${Math.round(firstAvailable.avgExp)} EXP**`);
    } else {
      lines.push("目前沒有可進入的掛機區域。");
    }
    return lines.join("\n");
  }

  lines.push(`正在掛機：${session.zoneLabel}`);
  lines.push(`開始時間：${formatTaipeiDateTime(session.startedAt)}`);
  lines.push(`累積時間：${formatDuration(summary.elapsedMinutes)}（上限 12 小時）`);
  lines.push(`有效結算：${formatDuration(summary.effectiveMinutes)}（滿 5 分鐘後連續累積）`);
  lines.push(`目前可領：**${summary.totalGold} 金幣**、**${summary.totalExp} EXP**`);
  const startedAtMs = new Date(session.startedAt).getTime();
  const capAtIso = new Date(startedAtMs + 12 * 60 * 60 * 1000).toISOString();
  lines.push(`收益封頂時間：${formatRelativeTime(capAtIso)}`);
  if (summary.dailyLimitMinutes != null) {
    lines.push(`非會員每日上限：${formatDuration(summary.dailyLimitMinutes)}（今日已領 ${formatDuration(summary.dailyClaimedMinutesAfter || 0)}，剩餘 ${formatDuration(summary.dailyRemainingMinutes || 0)}）`);
  } else {
    lines.push("會員狀態：今日領取不限時數。");
  }
  if (summary.effectiveMinutes < 5) {
    const nextTickIso = new Date(startedAtMs + 5 * 60 * 1000).toISOString();
    lines.push(`未滿 5 分鐘暫無獎勵，達標時間：${formatRelativeTime(nextTickIso)}。`);
  } else {
    lines.push("已達標，獎勵正在依時間連續累積。");
  }
  return lines.join("\n");
}

function buildZoneSelectMessage(status) {
  const zones = (status?.zones || []).filter((z) => z.available);
  const lines = [
    `📊 目前等級：**Lv.${status.level}**`,
    "請選擇要掛機的怪物區（依怪物區等級限制開放）：",
    "規則：只獲得金幣與 EXP；前 5 分鐘無獎勵；達標後依時間連續累積（最多 12 小時）；非會員每日最多領 6 小時；會員不限時數。"
  ];

  if (!zones.length) {
    const blocked = (status?.zones || [])
      .map((z) => `- ${z.emoji} ${z.label}：${z.lockedReason || "未開放"}`)
      .join("\n");
    return { content: `${lines.join("\n")}\n\n❌ 目前無可用區域\n${blocked}`, components: [] };
  }

  const options = zones.slice(0, 25).map((z) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${z.emoji} ${z.label}（${formatLevelRange(z.minLevel, z.maxLevel)}）`.slice(0, 100))
      .setDescription(`每5分 ${Math.round(z.avgGold)}金 / ${Math.round(z.avgExp)}EXP，怪物 ${z.monsterCount} 隻`.slice(0, 100))
      .setValue(z.zoneKey)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(IDLE_ZONE_SELECT_ID)
    .setPlaceholder("選擇掛機區域")
    .addOptions(options);

  return {
    content: lines.join("\n"),
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

async function handleIdleStart(interaction) {
  const serviceContext = getServiceContext();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

  try {
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds });
    if (status.discordSession) {
      const stickerUrl = await resolveIdleStickerUrl(interaction);
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("⏳ 正在掛機")
        .setDescription(buildStatusText(status));
      if (stickerUrl) embed.setImage(stickerUrl);
      await interaction.editReply({ content: "你已經在掛機中。", embeds: [embed], components: buildSessionControlRows() });
      return;
    }

    const pickPayload = buildZoneSelectMessage(status);
    await interaction.editReply(pickPayload);
  } catch (error) {
    await interaction.editReply(`❌ 開始掛機失敗：${error.message}`);
  }
}

async function handleIdleZoneSelect(interaction) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const zoneKey = String(interaction.values?.[0] || "").trim();

  try {
    const session = await serviceContext.idleService.startDiscordSession(discordId, displayName, zoneKey);
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds });
    const stickerUrl = await resolveIdleStickerUrl(interaction);
    const embed = new EmbedBuilder()
      .setColor(0x16a34a)
      .setTitle("✅ 已開始掛機")
      .setDescription(buildStatusText(status, `區域：**${session.zoneLabel}**`));
    if (stickerUrl) embed.setImage(stickerUrl);
    await interaction.editReply({ content: "掛機已啟動。", embeds: [embed], components: buildSessionControlRows() });
  } catch (error) {
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName).catch(() => null);
    const extra = status ? `\n\n${buildStatusText(status, "目前狀態：")}` : "";
    await interaction.editReply({ content: `❌ 無法啟動掛機：${error.message}${extra}`, components: [] });
  }
}

async function handleIdleClaim(interaction) {
  const serviceContext = getServiceContext();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

  try {
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const summary = await serviceContext.idleService.claimDiscordSession(discordId, displayName, "manual_claim", { memberRoleIds });
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds }).catch(() => null);
    const extra = status ? `\n\n${buildStatusText(status, "目前狀態：")}` : "";
    await interaction.editReply(
      `🎁 已結算掛機\n區域：${summary.zoneLabel}\n開始：${formatTaipeiDateTime(summary.startedAt)}\n結束：${formatTaipeiDateTime(summary.endedAt)}\n掛機時長：${formatDuration(summary.elapsedMinutes)}\n可計算時長：${formatDuration(summary.effectiveMinutes)}（達標後連續累積）\n獲得：**${summary.reward.gold} 金幣**、**${summary.reward.exp} EXP**${summary.dailyLimitMinutes != null ? `\n非會員今日剩餘可領：${formatDuration(summary.dailyRemainingMinutes || 0)}` : `\n會員：今日可持續領取`}${extra}`
    );
  } catch (error) {
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds }).catch(() => null);
    const extra = status ? `\n\n${buildStatusText(status, "目前狀態：")}` : "";
    await interaction.editReply(`❌ 領取失敗：${error.message}${extra}`);
  }
}

async function handleIdleStatus(interaction) {
  const serviceContext = getServiceContext();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  try {
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds });
    const stickerUrl = status?.discordSession ? await resolveIdleStickerUrl(interaction) : null;
    if (stickerUrl) {
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("📊 掛機狀態")
        .setDescription(buildStatusText(status));
      embed.setImage(stickerUrl);
      await interaction.editReply({ content: "以下是你的最新掛機狀態。", embeds: [embed], components: status.discordSession ? buildSessionControlRows() : [] });
      return;
    }
    await interaction.editReply(buildStatusPayload(status, "📊 你的最新掛機狀態"));
  } catch (error) {
    await interaction.editReply(`❌ 讀取狀態失敗：${error.message}`);
  }
}

async function handleIdleRefresh(interaction) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  try {
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds });
    const stickerUrl = status?.discordSession ? await resolveIdleStickerUrl(interaction) : null;
    if (stickerUrl) {
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("📊 掛機狀態（已刷新）")
        .setDescription(buildStatusText(status));
      embed.setImage(stickerUrl);
      await interaction.editReply({ content: "時間已刷新。", embeds: [embed], components: status.discordSession ? buildSessionControlRows() : [] });
      return;
    }
    await interaction.editReply(buildStatusPayload(status, "📊 掛機狀態（已刷新）"));
  } catch (error) {
    await interaction.editReply({ content: `❌ 刷新失敗：${error.message}`, components: [] });
  }
}

async function handleIdleCancel(interaction) {
  const serviceContext = getServiceContext();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

  try {
    const summary = await serviceContext.idleService.cancelDiscordSession(discordId, displayName);
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds }).catch(() => null);
    const extra = status ? `\n\n${buildStatusText(status, "目前狀態：")}` : "";
    await interaction.editReply(
      `⛔ 已取消掛機\n區域：${summary.zoneLabel}\n開始：${formatTaipeiDateTime(summary.startedAt)}\n結束：${formatTaipeiDateTime(summary.endedAt)}\n掛機時長：${formatDuration(summary.elapsedMinutes)}\n可計算時長：${formatDuration(summary.effectiveMinutes)}（達標後連續累積）\n本次未領取獎勵。${extra}`
    );
  } catch (error) {
    const memberRoleIds = await resolveMemberRoleIds(interaction);
    const status = await serviceContext.idleService.getDiscordPanelStatus(discordId, displayName, { memberRoleIds }).catch(() => null);
    const extra = status ? `\n\n${buildStatusText(status, "目前狀態：")}` : "";
    await interaction.editReply(`❌ 取消失敗：${error.message}${extra}`);
  }
}

async function handleIdleZoneButton(interaction) {
  if (!(await ensurePlayerAllowed(interaction))) return;
  const id = interaction.customId;
  if (id === IDLE_ZONE_START_ID) {
    await handleIdleStart(interaction);
    return;
  }
  if (id === IDLE_ZONE_STATUS_ID) {
    await handleIdleStatus(interaction);
    return;
  }
  if (id === IDLE_ZONE_CLAIM_ID) {
    await handleIdleClaim(interaction);
    return;
  }
  if (id === IDLE_ZONE_CANCEL_ID) {
    await handleIdleCancel(interaction);
    return;
  }
  if (id === IDLE_ZONE_REFRESH_ID) {
    await handleIdleRefresh(interaction);
  }
}

function isIdleZoneButton(customId) {
  return customId === IDLE_ZONE_START_ID
    || customId === IDLE_ZONE_STATUS_ID
    || customId === IDLE_ZONE_CLAIM_ID
    || customId === IDLE_ZONE_CANCEL_ID
    || customId === IDLE_ZONE_REFRESH_ID;
}

function isIdleZoneSelect(customId) {
  return customId === IDLE_ZONE_SELECT_ID;
}

module.exports = {
  isIdleZoneButton,
  handleIdleZoneButton,
  isIdleZoneSelect,
  handleIdleZoneSelect
};
