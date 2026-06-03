const path = require("path");
const fs = require("fs");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { getZoneTheme, ZONE_BY_KEY, getZoneDefaultEntryFee } = require("../shared/zones");
const { isWorldBossZone } = require("../services/worldBoss/worldBossService");

const BUTTON_IDS = {
  enterBattle: "monster-zone:enter-battle",
  enterBattleHead: "monster-zone:enter-battle:head",
  enterBattleBody: "monster-zone:enter-battle:body",
  enterBattleLegs: "monster-zone:enter-battle:legs"
};

function formatRemainingTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} 小時 ${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }
  return `${seconds} 秒`;
}

function appendCacheBust(url, version) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return url;
  const v = String(version || "").trim();
  if (!v) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}v=${encodeURIComponent(v)}`;
}

async function createMonsterZonePanelMessage(monster, currentHp, participantCount = 0, damageMap = {}, options = {}) {
  const activeEvent = options.activeEvent || null;
  const activeTransition = options.activeTransition || null;
  const zoneKey = options.zoneKey || activeEvent?.zone || monster?.zone || "normal";
  const worldBossStatus = options.worldBossStatus || null;
  const worldBossPartsHp = options.worldBossPartsHp || null;
  const fastUpdate = options.fastUpdate === true;
  const zoneTheme = getZoneTheme(zoneKey);
  const zoneBinding = options.zoneBinding || null;
  const showEliteWaitingState = (
    isWorldBossZone(zoneKey) &&
    worldBossStatus &&
    !worldBossStatus.battleStartedAt &&
    !worldBossStatus.canChallenge
  );
  if (activeTransition) {
    return await createMonsterTransitionPanelMessage(activeTransition, zoneTheme, zoneKey);
  }
  if (activeEvent) {
    return await createEventPanelMessage(activeEvent, zoneTheme, zoneKey);
  }

  const maxHp = monster?.calc?.maxHp ?? 0;
  const hp = currentHp != null ? currentHp : maxHp;
  const hpBar = maxHp > 0 ? buildHpBar(hp, maxHp) : "";

  const monsterName = monster?.name ?? "尚未設定怪物";
  const entryFee = monster?.entryFee ?? getZoneDefaultEntryFee(zoneKey);
  const expReward = monster?.expReward ?? 0;
  const goldReward = monster?.goldReward ?? 0;

  const entryFeePool = Math.round(participantCount * entryFee * 1.15);
  const effectivePool = Math.max(goldReward, entryFeePool);
  const bonusNote = entryFeePool > goldReward && participantCount > 0 ? ` 額外+${entryFeePool - goldReward}` : "";

  const damageEntries = Object.values(damageMap).sort((a, b) => b.damage - a.damage);

  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100))) : 0;
  const hpLine = maxHp > 0 ? `${hp} / ${maxHp} (${hpPct}%)\n${hpBar}` : "尚未設定";
  let worldBossPartsLine = null;
  if (isWorldBossZone(zoneKey) && worldBossPartsHp && typeof worldBossPartsHp === "object") {
    const headHp = Math.max(0, Number(worldBossPartsHp.head || 0));
    const bodyHp = Math.max(0, Number(worldBossPartsHp.body || 0));
    const legsHp = Math.max(0, Number(worldBossPartsHp.legs || 0));
    const totalHp = headHp + bodyHp + legsHp;
    const doneCount = [headHp, bodyHp, legsHp].filter((v) => v <= 0).length;
    worldBossPartsLine = [
      `頭部：${Math.round(headHp)}`,
      `軀幹：${Math.round(bodyHp)}`,
      `下肢：${Math.round(legsHp)}`,
      `總計：${Math.round(totalHp)}（已擊破 ${doneCount}/3）`
    ].join("\n");
  }
  const rewardLine = [
    expReward > 0 ? `EXP +${expReward}` : null,
    effectivePool > 0 ? `金幣 +${effectivePool}${bonusNote}` : null
  ].filter(Boolean).join(" ・ ") || "尚未設定";
  const statsLine = [
    entryFee > 0 ? `入場費 ${entryFee}` : "免入場費",
    participantCount > 0 ? `參戰 ${participantCount} 人` : "暫無參戰者"
  ].join(" ・ ");
  const damageLine = damageEntries.length > 0
    ? damageEntries.map((v, i) => {
      const cooldownSec = v.cooldownRemaining ?? 0;
      const cooldownStr = cooldownSec > 0 ? ` ⏳ ${cooldownSec}s` : "";
      return `${i + 1}. ${v.name}${cooldownStr} - ${v.damage}`;
    }).join("\n")
    : "暫無排行";

  // 計算生效等級限制：binding 有設定優先，否則用 zone 靜態預設
  const zoneDef = ZONE_BY_KEY[zoneKey] || {};
  const effectiveMin = (zoneBinding && zoneBinding.minLevel != null) ? zoneBinding.minLevel : (zoneDef.minLevel ?? 1);
  const effectiveMax = (zoneBinding && zoneBinding.maxLevel !== undefined) ? zoneBinding.maxLevel : (zoneDef.maxLevel ?? null);
  const levelParts = [];
  if (effectiveMin > 1) levelParts.push(`Lv.${effectiveMin}+`);
  if (effectiveMax !== null) levelParts.push(`上限 Lv.${effectiveMax}`);
  const levelTag = levelParts.length > 0 ? ` ・ ${levelParts.join(" ")}` : "";

  const descLines = [
    `${zoneTheme.emoji} **${zoneTheme.label}**${levelTag}`,
    ""
  ];
  if (isWorldBossZone(zoneKey) && worldBossStatus) {
    if (worldBossStatus.cooldownRemainingMs > 0) {
      descLines.push(`⏳ 世界BOSS 冷卻中（剩餘 ${formatRemainingTime(worldBossStatus.cooldownRemainingMs)} 再現身）`);
    } else if (worldBossStatus.battleStartedAt) {
      descLines.push(`⚠️ 世界BOSS戰進行中（剩餘 ${formatRemainingTime(worldBossStatus.battleRemainingMs)}）`);
    } else {
      descLines.push("✅ 世界BOSS 可挑戰");
    }
    descLines.push("限制：開戰後 30 分鐘內未擊殺視為失敗");
    descLines.push(
      "",
      "**部位機制（三區全破才算贏）**",
      "🎯 頭部：怪物技能發動率↑（高風險）",
      "⚔️ 軀幹：防禦極高、你的傷害被削減",
      "🦵 下盤：怪物攻擊更兇（你受到傷害 ×1.3）"
    );
  } else {
    descLines.push("點擊下方按鈕即可進入戰鬥");
  }
  const desc = descLines.join("\n");

  const panelTitle = showEliteWaitingState
    ? `${zoneTheme.emoji} 世界BOSS 未現身`
    : `${zoneTheme.emoji} ${monsterName}`;

  const embed = new EmbedBuilder()
    .setTitle(panelTitle)
    .setDescription(desc)
    .setColor(zoneTheme.color)
    .setFooter({ text: "怪物區域" });
  const files = [];

  const imageVersion = monster?.imageUpdatedAt || monster?.updatedAt || monster?.createdAt || null;
  const imageSource = showEliteWaitingState ? "" : appendCacheBust((monster?.imageThumbnailUrl || monster?.imageUrl || ""), imageVersion);
  if (typeof imageSource === "string" && imageSource) {
    if (/^https?:\/\//i.test(imageSource)) {
      embed.setThumbnail(imageSource);
    } else {
      const imagePath = path.resolve(__dirname, "../web/public", imageSource.replace(/^\//, ""));
      if (fs.existsSync(imagePath)) {
        const fileName = path.basename(imagePath);
        files.push(new AttachmentBuilder(imagePath, { name: fileName }));
        embed.setThumbnail(`attachment://${fileName}`);
      }
    }
  }

  const fields = [];
  if (showEliteWaitingState) {
    const waitingStatusLine = `世界BOSS 已撤離，剩餘 ${formatRemainingTime(worldBossStatus.cooldownRemainingMs)} 再現身。`;
    const statusFields = [
      { name: "目前狀態", value: waitingStatusLine, inline: false },
      { name: "挑戰限制", value: "開戰後 30 分鐘內未擊殺視為失敗", inline: true }
    ];
    fields.push(...statusFields);
  } else {
    fields.push({ name: "HP", value: hpLine, inline: false });
    if (worldBossPartsLine) {
      fields.push({ name: "世界王部位血量", value: worldBossPartsLine, inline: false });
    }
    fields.push(
      { name: "獎勵", value: rewardLine, inline: true },
      { name: "狀態", value: statsLine, inline: true },
      { name: "傷害排行", value: damageLine, inline: false }
    );
  }
  embed.addFields(...fields);

  const canEnter = !isWorldBossZone(zoneKey) || !worldBossStatus || worldBossStatus.canChallenge;
  let components = [];
  if (isWorldBossZone(zoneKey) && canEnter) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.enterBattleHead)
        .setLabel("🎯 打頭部")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.enterBattleBody)
        .setLabel("⚔️ 打軀幹")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.enterBattleLegs)
        .setLabel("🦵 打下盤")
        .setStyle(ButtonStyle.Secondary)
    );
    components = [row];
  } else {
    const enterLabel = canEnter ? "進入戰鬥" : "暫時無法挑戰";
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.enterBattle)
        .setLabel(enterLabel)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!canEnter)
    );
    components = [row];
  }

  return { embeds: [embed], components, files };
}

const { isEffectConditionMet } = require("../shared/effectEngine");

async function createMonsterTransitionPanelMessage(activeTransition, zoneTheme = { label: "怪物區", color: 0xf59e0b, emoji: "◆", tagline: "" }, zoneKey = "normal") {
  const endAtMs = Date.parse(activeTransition?.endsAt || "");
  const remaining = Number.isFinite(endAtMs) ? Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000)) : null;
  const roll = Number.isFinite(Number(activeTransition?.diceRoll)) ? Number(activeTransition.diceRoll) : null;

  const desc = [
    `${zoneTheme.emoji} **${zoneTheme.label}**`,
    zoneTheme.tagline || "怪物換場中，請稍候…",
    "",
    "🎲 **骰子轉場中**",
    roll == null ? "結果：擲骰中…" : `結果：**${roll}**`,
    remaining == null ? null : `剩餘時間：約 ${remaining} 秒`,
    "",
    "下一隻怪物正在生成，請稍候…"
  ].filter(Boolean).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`${zoneTheme.emoji} 怪物生成中`)
    .setDescription(desc)
    .setColor(zoneTheme.color)
    .setFooter({ text: "怪物區域" });

  return { embeds: [embed], components: [], files: [] };
}

async function createEventPanelMessage(activeEvent, zoneTheme = { label: "怪物區", color: 0xf59e0b, emoji: "◆", tagline: "" }, zoneKey = "normal", options = {}) {
  const endAtMs = Date.parse(activeEvent.endsAt || "");
  const remaining = Number.isFinite(endAtMs) ? Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000)) : null;
  const remainLine = remaining == null ? "" : `剩餘時間：約 ${remaining} 秒`;

  // 取 start node（若有 nodes 則使用節點內容以顯示選項）
  const startNode = Array.isArray(activeEvent.nodes) && activeEvent.nodes.length
    ? (activeEvent.nodes.find((n) => n.id === "start") || activeEvent.nodes[0])
    : { id: "start", text: activeEvent.message || "", options: [] };
  const allOptions = Array.isArray(startNode.options) ? startNode.options : [];
  const conditionalCount = allOptions.filter(o => o && o.condition).length;
  // 若為公開面板（viewerContext 未提供），預設不顯示帶有 condition 的選項
  let optList = options.viewerContext ? allOptions : allOptions.filter(o => !o.condition);

  // 支援個人化隱藏按鈕：呼叫端可透過 options.viewerContext 傳入 { equipped, inventory }，
  // 若提供 viewerContext，依據每個選項的 condition 決定是否顯示。
  const viewerContext = options.viewerContext || null;
  if (viewerContext) {
    optList = optList.filter((opt) => {
      if (!opt || !opt.condition) return true;
      try {
        return isEffectConditionMet({ condition: opt.condition }, viewerContext);
      } catch (e) {
        return false;
      }
    });
  }

  const desc = [
    `${zoneTheme.emoji} **${zoneTheme.label} 事件**`,
    zoneTheme.tagline || "事件進行中，請稍候…",
    "",
    activeEvent.message || startNode.text || "事件進行中，請稍候…",
    remainLine,
    "",
    "事件結束後會自動切換到下一隻怪物。"
  ].filter(Boolean).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`${zoneTheme.emoji} ${activeEvent.name || "怪物過場事件"}`)
    .setDescription(desc)
    .setColor(zoneTheme.color)
    .setFooter({ text: `區域：${zoneTheme.label}${zoneKey ? ` · ${zoneKey}` : ""}` });

  // 建立按鈕（每列最多 5 個按鈕；Discord 一則訊息最多 5 列）
  // 若會加「顯示個人化選項」按鈕，保留 1 列給它，選項列最多 4 列（20 個），否則 5 列（25 個），避免超列導致整個面板發不出來
  const willAddPersonalRow = !viewerContext && conditionalCount > 0;
  const maxOptionRows = willAddPersonalRow ? 4 : 5;
  const cappedOpts = optList.slice(0, maxOptionRows * 5);
  const rows = [];
  for (let i = 0; i < cappedOpts.length; i += 5) {
    const row = new ActionRowBuilder();
    const chunk = cappedOpts.slice(i, i + 5);
    for (const opt of chunk) {
      const label = String(opt.label || "選項").slice(0, 80);
      const btn = new ButtonBuilder()
        .setCustomId(`monster-event:choose:${activeEvent.id}:${opt.id}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary);
      row.addComponents(btn);
    }
    rows.push(row);
  }

  // 如果是對所有玩家的公開面板，且存在條件選項，加入「顯示個人化選項」按鈕（會回傳 ephemeral 個人面板）
  if (willAddPersonalRow) {
    const personalRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`monster-event:personal:${activeEvent.id}`)
        .setLabel('顯示個人化選項')
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(personalRow);
  }

  if (!rows.length) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("monster-event:dummy").setLabel("事件進行中").setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
    rows.push(row);
  }

  return { embeds: [embed], components: rows, files: [] };
}

function buildHpBar(hp, maxHp, length = 10) {
  const filled = Math.round((hp / maxHp) * length);
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, length - filled));
}

module.exports = { createMonsterZonePanelMessage, createEventPanelMessage, BUTTON_IDS };
