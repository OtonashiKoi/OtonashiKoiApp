"use strict";

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { calcPlayerStats } = require("../../shared/combatStats");

// 戰鬥 session 依 discordId 儲存（記憶體）
const activeSessions = new Map();

// 擊殺結算互斥鎖（防止兩名玩家同時打死同一隻怪造成雙重結算）
// key: `${zoneKey}:${monsterSeq}`
const killInProgress = new Set();

const BTN = {
  enterBattle: "monster-zone:enter-battle",
  startFight:  "monster-zone:start-fight",
  deleteLog:   "monster-zone:delete-log"
};

const MAX_ROUNDS = 30;
const BATTLE_TIMEOUT_MS = 60 * 1000; // 1 分鐘未按開始戰鬥 → 視為逃跑
const ROUNDS_PER_TICK = 1;           // 每次更新顯示幾回合
const TICK_DELAY_MS = 1500;          // 每次更新間隔（ms）

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

function isMonsterZoneButton(customId) {
  return customId.startsWith("monster-zone:");
}

// 攻擊倍率常數已移至 src/shared/combatStats.js


function buildHpBar(hp, maxHp, fillEmoji = "🟥", emptyEmoji = "⬛", length = 10) {
  const filled = Math.round((Math.max(0, hp) / Math.max(1, maxHp)) * length);
  return fillEmoji.repeat(Math.max(0, filled)) + emptyEmoji.repeat(Math.max(0, length - filled));
}

// ──────────────────────────────────────────────
// 輔助：掉落裝備公告
// ──────────────────────────────────────────────
async function _notifyKillRewards(monsterName, perPidRewards, killerDiscordId) {
  try {
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;
    for (const [pid, rewards] of Object.entries(perPidRewards)) {
      if (pid === killerDiscordId) continue; // 擊殺者已在戰鬥結算 embed 看到
      const lines = [];
      if (rewards.gold > 0) lines.push(`💰 金幣 **+${rewards.gold}**`);
      if (rewards.exp > 0) {
        let expLine = `⭐ EXP **+${rewards.exp}**`;
        if (rewards.levelUps > 0) expLine += `　✨ 升級 ${rewards.levelUps} 次！**Lv.${rewards.newLevel}**`;
        lines.push(expLine);
      }
      if (rewards.drops.length > 0) lines.push(`🎁 道具：**${rewards.drops.join("、")}**`);
      if (!lines.length) continue;
      try {
        const user = await client.users.fetch(pid);
        await user.send(`⚔️ **${monsterName}** 已被擊倒，你的參戰獎勵：\n${lines.join("\n")}`);
      } catch (_) { /* DM 關閉則跳過 */ }
    }
  } catch (e) {
    // suppressed
  }
}

async function _announceDrops(sc, discordId, displayName, monsterName, droppedItems, kind = "fight") {
  try {
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;
    const layout = await sc.channelLayoutRepository.get();
    const allBindings = layout?.discord?.bindings || [];
    const binding = allBindings.find((b) => b.featureKey === "town_chat") ||
                    allBindings.find((b) => b.featureKey === "monster_zone");
    if (!binding?.channelId) return;
    const channel = await client.channels.fetch(binding.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const itemList = droppedItems.join("、");
    // kind: "fight" (努力戰鬥獲得), "participation" (10人參與獎項)
    if (kind === "participation") {
      await channel.send(`🎊 **10人參與獎項** — 太棒了！恭喜 ${displayName} (<@${discordId}>) 在 ${timeStr}（因為擊退 **${monsterName}**）取得：**${itemList}**！大家一起歡呼 🎉`);
    } else if (kind === "group") {
      await channel.send(`🎉 **努力戰鬥獲得** — 恭喜 ${displayName} (<@${discordId}>) 在 ${timeStr}（團隊努力）獲得 **${itemList}**！感謝所有參與者 🎊`);
    } else {
      // default: killer
      await channel.send(`🎉 **努力戰鬥獲得** — 恭喜 ${displayName} (<@${discordId}>) 在 ${timeStr} 英勇擊倒 **${monsterName}**，獲得 **${itemList}**！乾杯 🥳`);
    }
  } catch (e) {
    // suppressed
  }
}


// ──────────────────────────────────────────────
// 輔助：重發公開面板
// ──────────────────────────────────────────────
// ─── Zone 輔助 ─────────────────────────────────
function featureKeyToZone(featureKey) {
  return featureKey === "monster_zone_mid" ? "mid" : "normal";
}
async function getZoneFromChannel(sc, channelId) {
  const layout = await sc.channelLayoutRepository.get();
  const binding = (layout?.discord?.bindings || []).find(
    (b) => b.channelId === channelId && b.featureKey?.startsWith("monster_zone")
  );
  if (!binding) return null;
  return featureKeyToZone(binding.featureKey);
}

async function _republishPanel(sc, zoneKey, monster, monsterHp, participantCount, damageMap = {}) {
  const featureKey = zoneKey === "mid" ? "monster_zone_mid" : "monster_zone";
  const layout = await sc.channelLayoutRepository.get();
  const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey);
  if (binding?.channelId) {
    await sc.adminConsoleService.publishMonsterZonePanel(
      binding.channelId, monster, monsterHp, { participantCount, damageMap }
    );
  }
}

// BOSS 出場廣播：優先 town_chat，fallback monster_zone
async function _broadcastBossSpawn(sc, zoneKey, monster) {
  try {
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) {
      console.warn("[BOSS] bot not ready, skip broadcast");
      return;
    }

    const layout = await sc.channelLayoutRepository.get();
    const bindings = layout?.discord?.bindings || [];
    const binding = bindings.find((b) => b.featureKey === "town_chat" && b.enabled && b.channelId)
                 || bindings.find((b) => b.featureKey === "monster_zone" && b.enabled && b.channelId);
    if (!binding) {
      console.warn("[BOSS] no suitable channel binding found, skip broadcast");
      return;
    }

    const channel = await client.channels.fetch(binding.channelId).catch(() => null);
    if (!channel) {
      console.warn("[BOSS] channel fetch failed:", binding.channelId);
      return;
    }

    const zoneName = zoneKey === "mid" ? "中級戰鬥區" : "一般戰鬥區";
    const { EmbedBuilder } = require("discord.js");
    const thumbUrl = monster.imageUrl?.startsWith("http") ? monster.imageUrl : null;
    const embed = new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle(`⚠️ BOSS 登場！`)
      .setDescription(`**${zoneName}** 出現了強大的 BOSS！\n\n👹 **${monster.name}** 降臨！\n快去挑戰吧！`)
      .setFooter({ text: `Lv.${monster.level || "?"} · HP ${monster.calc?.maxHp || "?"}` })
      .setTimestamp();
    if (thumbUrl) embed.setThumbnail(thumbUrl);

    await channel.send({ embeds: [embed] });
    console.log(`[BOSS] broadcast sent for ${monster.name} in ${zoneKey}`);
  } catch (err) {
    console.error("[BOSS] broadcast error:", err);
  }
}

// ──────────────────────────────────────────────
// 出戰（入場）— 顯示準備畫面 + 開始戰鬥按鈕
// ──────────────────────────────────────────────
async function handleEnterBattle(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.username;

  // 已有進行中的戰鬥，拒絕重複出戰
  if (activeSessions.has(discordId)) {
    const s = activeSessions.get(discordId);
    const msg = s.state === "displaying"
      ? "⚔️ 戰鬥結果顯示中，請等待完成後再出戰！"
      : "⚔️ 你已經在戰鬥中了！請先完成當前戰鬥。";
    await interaction.editReply({ content: msg });
    return;
  }

  try {
    // 偵測頻道對應的區域
    const zoneKey = await getZoneFromChannel(sc, interaction.channelId);
    if (!zoneKey) {
      await interaction.editReply({ content: "❌ 此頻道未設定為放怪區。" });
      return;
    }

    // 中級區等級限制
    let cachedProgress = null;
    if (zoneKey === "mid") {
      cachedProgress = await sc.progressRepository.findByPlayerId(discordId);
      const playerLevel = cachedProgress?.level ?? 1;
      if (playerLevel < 10) {
        await interaction.editReply({ content: `🔒 **中級區**需要 **Lv.10** 以上才能進入！
目前等級：**Lv.${playerLevel}**` });
        return;
      }
    }

    const [state, monsters] = await Promise.all([
      sc.monsterService.getState(zoneKey),
      sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey })
    ]);
    if (!monsters.length) {
      await interaction.editReply({ content: "❌ 目前沒有啟用中的怪物，請稍後再試。" });
      return;
    }
    let monster = monsters.find((m) => m.seq === state.activeMonsterSeq);
    if (!monster) {
      // state.activeMonsterSeq 與現有區域怪物不符（首次或狀態過期）→ 同步到第一隻
      monster = monsters[0];
      const initHp = monster.calc.maxHp;
      await sc.monsterService.saveState(
        { ...state, activeMonsterSeq: monster.seq, currentHp: initHp },
        zoneKey
      );
      state = { ...state, activeMonsterSeq: monster.seq, currentHp: initHp };
    }
    const monsterHp = state.currentHp != null ? state.currentHp : monster.calc.maxHp;

    const progress = cachedProgress ?? await sc.progressRepository.findByPlayerId(discordId);
    const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    const equipped = progress?.equipment || {};
    const pStats = calcPlayerStats(attrs, equipped);

    // 入場費
    if (monster.entryFee > 0) {
      const wallet = await sc.walletRepository.findByPlayerId(discordId);
      const gold = wallet?.gold ?? 0;
      if (gold < monster.entryFee) {
        await interaction.editReply({
          content: `❌ 金幣不足！入場費需要 **${monster.entryFee}** 🪙，你目前有 **${gold}** 🪙。`
        });
        return;
      }
      await sc.rewardService.grantCurrency({
        discordId, displayName, currencyType: "gold",
        amount: -monster.entryFee, source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE, operator: "monster_zone"
      });
    }

    // 建立 session（state: waiting）
    const session = {
      state: "waiting",
      zoneKey,
      monsterId: monster.id, monsterSeq: monster.seq, monsterName: monster.name,
      monsterMaxHp: monster.calc.maxHp, monsterHp, monsterStats: monster.calc,
      playerMaxHp: pStats.maxHp, playerHp: pStats.maxHp, playerStats: pStats,
      entryFee: monster.entryFee, timeoutId: null
    };

    // 1 分鐘未開始 → 自動逃跑
    session.timeoutId = setTimeout(async () => {
      const s = activeSessions.get(discordId);
      if (s && s.state === "waiting") {
        activeSessions.delete(discordId);
        const feeNote = session.entryFee > 0 ? `\n入場費 **${session.entryFee}** 🪙 已損失。` : "";
        interaction.editReply({
          content: `⏰ 超過 1 分鐘未開始戰鬥，已自動逃跑。${feeNote}`,
          embeds: [], components: []
        }).catch(() => {});
      }
    }, BATTLE_TIMEOUT_MS);

    activeSessions.set(discordId, session);

    // 加入參戰名單（去重）並更新面板
    const participants = Array.isArray(state.participants) ? state.participants : [];
    if (!participants.includes(discordId)) {
      const newParticipants = [...participants, discordId];
      await sc.monsterService.saveState({ ...state, currentHp: monsterHp, participants: newParticipants }, zoneKey);
      const layout = await sc.channelLayoutRepository.get();
      const featureKey = zoneKey === "mid" ? "monster_zone_mid" : "monster_zone";
      const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey);
      if (binding?.channelId) {
        sc.adminConsoleService
          .publishMonsterZonePanel(binding.channelId, monster, monsterHp, { participantCount: newParticipants.length, damageMap: state.damageMap || {} })
          .catch(() => {});
      }
    }

    const monsterBar = buildHpBar(monsterHp, monster.calc.maxHp, "🟥", "⬛");
    const playerBar  = buildHpBar(pStats.maxHp, pStats.maxHp, "🟩", "⬛");
    const feeMsg = monster.entryFee > 0
      ? `入場費已扣除 **${monster.entryFee}** 🪙`
      : "本場免費入場";

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ 準備出戰 — ${monster.name}`)
      .setDescription([
        `👾 **${monster.name}** HP：${Math.max(0, monsterHp)} / ${monster.calc.maxHp}`,
        monsterBar, "",
        `❤️ 你的 HP：${pStats.maxHp} / ${pStats.maxHp}`,
        playerBar, "", feeMsg, "",
        "⏰ **請在 1 分鐘內按「開始戰鬥」，否則視為逃跑。**"
      ].join("\n"))
      .setColor(0xe74c3c);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN.startFight).setLabel("⚔️ 開始戰鬥").setStyle(ButtonStyle.Danger)
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (err) {
    await interaction.editReply({ content: "❌ 出戰失敗，請稍後再試。" });
  }
}

// ──────────────────────────────────────────────
// 開始戰鬥 — 自動跑完所有回合，顯示完整戰鬥紀錄
// ──────────────────────────────────────────────
async function handleStartFight(interaction) {
  await interaction.deferUpdate();
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.username;
  const session = activeSessions.get(discordId);

  if (!session) {
    await interaction.editReply({ content: "❌ 找不到你的戰鬥紀錄，請重新出戰。", embeds: [], components: [] });
    return;
  }

  if (session.timeoutId) { clearTimeout(session.timeoutId); session.timeoutId = null; }
  session.state = "fighting";
  const zoneKey = session.zoneKey || "normal";

  try {
    const state = await sc.monsterService.getState(zoneKey);
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    const monster = monsters.find((m) => m.id === session.monsterId);

    // 怪物已被別人打死
    if (!monster || state.activeMonsterSeq !== session.monsterSeq) {
      activeSessions.delete(discordId);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("😮 怪物已被擊倒！")
          .setDescription("怪物已被其他玩家擊倒，下一隻怪物已上場。\n請重新點擊出戰按鈕！")
          .setColor(0xaaaaaa)],
        components: []
      });
      return;
    }

    session.monsterHp = state.currentHp != null ? state.currentHp : session.monsterMaxHp;

    // ── 自動跑完所有回合 ──
    const { runCombatLoop } = require("../../shared/combatLoop");
    const { outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp } =
      runCombatLoop(session.playerStats, session.monsterStats, session.monsterName, session.monsterHp);
    session.monsterHp = finalMonsterHp;
    session.playerHp  = finalPlayerHp;

    // ── 結算 ──
    let rewardLines = [];
    let embedTitle, embedColor;
    const currentParticipants = Array.isArray(state.participants) ? state.participants : [];

    if (outcome === "win") {
      session.monsterHp = 0;
      rewardLines = await handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage, zoneKey });
      embedTitle = "🏆 勝利！";
      embedColor = 0xf1c40f;
    } else if (outcome === "lose") {
      session.monsterHp = Math.max(0, session.monsterHp);
      let damageMap = {};
      try {
        const freshState = await sc.monsterService.getState(zoneKey);
        const prev = freshState.damageMap || {};
        damageMap = { ...prev, [discordId]: { name: displayName, damage: (prev[discordId]?.damage || 0) + totalDamage } };
        await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap }, zoneKey);
      } catch (e) {
        await sc.monsterService.saveState({ ...state, currentHp: session.monsterHp }, zoneKey);
      }
      embedTitle = "💀 戰鬥失敗";
      embedColor = 0x555555;
      rewardLines = [
        `你被 **${session.monsterName}** 擊倒了！`,
        session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！"
      ];
      _republishPanel(sc, zoneKey, monster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
    } else {
      let damageMap = {};
      try {
        const freshState = await sc.monsterService.getState(zoneKey);
        const prev = freshState.damageMap || {};
        damageMap = { ...prev, [discordId]: { name: displayName, damage: (prev[discordId]?.damage || 0) + totalDamage } };
        await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap }, zoneKey);
      } catch (e) {
        await sc.monsterService.saveState({ ...state, currentHp: session.monsterHp }, zoneKey);
      }
      embedTitle = "⏸️ 戰鬥超時";
      embedColor = 0x888888;
      rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。`];
      _republishPanel(sc, zoneKey, monster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
    }

    // 戰鬥已結算，但先保留 session 至顯示完畢才刪除，避免期間重複出戰
    if (activeSessions.has(discordId)) activeSessions.get(discordId).state = "displaying";

    // ── 逐步顯示回合（每 ROUNDS_PER_TICK 回合更新一次）──
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const MAX_DESC = 3800;

    for (let i = ROUNDS_PER_TICK; i < roundLogs.length; i += ROUNDS_PER_TICK) {
      const soFar = roundLogs.slice(0, i).join("\n\n");
      const truncated = soFar.length > MAX_DESC ? soFar.slice(0, MAX_DESC) + "\n…" : soFar;
      const progressEmbed = new EmbedBuilder()
        .setTitle(`⚔️ 戰鬥中 — 第 ${Math.min(i, roundLogs.length)} 回合`)
        .setDescription(truncated + "\n\n⏳ 戰鬥繼續中...")
        .setColor(0xe74c3c);
      await interaction.editReply({ embeds: [progressEmbed], components: [] });
      await delay(TICK_DELAY_MS);
    }

    // ── 最終結果 ──
    const logText = roundLogs.join("\n\n");
    const displayLog = logText.length > MAX_DESC
      ? logText.slice(0, MAX_DESC) + "\n…（部分回合已省略）"
      : logText;
    const resultBlock = rewardLines.length > 0 ? "\n\n" + rewardLines.join("\n") : "";

    const embed = new EmbedBuilder()
      .setTitle(embedTitle)
      .setDescription(displayLog + resultBlock)
      .setColor(embedColor);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN.deleteLog).setLabel("🗑️ 刪除紀錄").setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
    activeSessions.delete(discordId);  // 顯示完畢才解除鎖定，允許下一場出戰
  } catch (err) {
    activeSessions.delete(discordId);
    await interaction.editReply({ content: "❌ 戰鬥發生錯誤，請稍後再試。", embeds: [], components: [] });
  }
}

// ──────────────────────────────────────────────
// 刪除戰鬥紀錄
// ──────────────────────────────────────────────
async function handleDeleteLog(interaction) {
  try {
    await interaction.deferUpdate();
    await interaction.deleteReply();
  } catch { /* 訊息可能已被刪除，忽略 */ }
}

// ──────────────────────────────────────────────
// 擊殺結算（發獎勵 + 推進怪物 + 重發面板）
// ──────────────────────────────────────────────
async function handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage = 0, zoneKey = "normal" }) {
  const sc = getServiceContext();
  const rewardLines = [];

  // ── 並發雙殺防護：同一隻怪只允許一次結算 ──
  const killKey = `${zoneKey}:${monster.seq}`;
  try {
    if (killInProgress.has(killKey)) {
      // 另一位玩家已在結算中，此次擊殺視為無效，不重複發獎
      return rewardLines;
    }
    killInProgress.add(killKey);
  } catch (e) {
    return rewardLines;
  }

  try {
  // DB 層原子收付擊殺權（防止 PM2 雙進程重載期間雙重結算）
  const claimed = await sc.monsterRepository.claimKill(zoneKey, monster.seq);
  if (!claimed) {
    return rewardLines;
  }

  // 參戰名單（含擊殺者）
  const participants = [...new Set([...(Array.isArray(state.participants) ? state.participants : []), discordId])];

  // ── 依傷害比例計算每人分配量 ──
  const rawDmgMap = state.damageMap || {};
  // 合入本次擊殺者的傷害
  const mergedDmg = { ...rawDmgMap, [discordId]: { name: displayName, damage: (rawDmgMap[discordId]?.damage || 0) + totalDamage } };
  const totalDmgAll = participants.reduce((s, pid) => s + (mergedDmg[pid]?.damage || 0), 0);
  const dmgRatio = (pid) => totalDmgAll > 0 ? (mergedDmg[pid]?.damage || 0) / totalDmgAll : 1 / participants.length;

  // ── 預先取得所有參戰者等級，計算等級懲罰係數 ──
  // 規則：玩家等級 > 怪物等級+2 時，每超一級扣 10%，最低保留 10%
  const monsterLevel = Math.max(1, Number(monster.level) || 1);
  const progressMap = {};
  await Promise.all(participants.map(async (pid) => {
    const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
    progressMap[pid] = prog?.level ?? 1;
  }));
  const levelPenalty = (pid) => {
    const overLevel = Math.max(0, progressMap[pid] - (monsterLevel + 2));
    return Math.max(0.1, 1 - overLevel * 0.1);
  };

  // 每位參戰者的獎勵紀錄（用來最後 DM 通知）
  const perPidRewards = {};
  participants.forEach(pid => { perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] }; });

  // ── 金幣依比例分配（含等級懲罰）──
  // 實際獎池 = max(goldReward, 參戰人數 × entryFee × 1.3)
  // 入場費回饋到獎池，保證參戰者平均小賺
  const entryFeePool = Math.round(participants.length * (monster.entryFee || 0) * 1.15);
  const effectiveGoldReward = Math.max(monster.goldReward || 0, entryFeePool);

  // ── 等級懲罰充公值計算（充公的部分下放給未被壓制的玩家）──
  // 未被壓制：levelPenalty = 1
  const unpenalizedPids = participants.filter(pid => levelPenalty(pid) >= 1);
  // 未被壓制玩家的傷害比例總和（用來按比例分配充公值）
  const unpenalizedDmgTotal = unpenalizedPids.reduce((s, pid) => s + (mergedDmg[pid]?.damage || 0), 0);
  const unpenalizedDmgRatio = (pid) =>
    unpenalizedDmgTotal > 0 ? (mergedDmg[pid]?.damage || 0) / unpenalizedDmgTotal : 1 / (unpenalizedPids.length || 1);

  if (effectiveGoldReward > 0) {
    // ── 50% 上限截斷：單人不可拿超過獎池的 50%，多出來按比例分給其他人 ──
    const cappedRatios = {};
    const CAP = 0.5;
    let overflow = 0;
    for (const pid of participants) {
      const r = dmgRatio(pid);
      if (r > CAP) { cappedRatios[pid] = CAP; overflow += r - CAP; }
      else { cappedRatios[pid] = r; }
    }
    // 將 overflow 按非上限者的原始比例重新分配
    const nonCappedTotal = participants.reduce((s, pid) => s + (cappedRatios[pid] < CAP ? cappedRatios[pid] : 0), 0);
    if (overflow > 0 && nonCappedTotal > 0) {
      for (const pid of participants) {
        if (cappedRatios[pid] < CAP) {
          cappedRatios[pid] += overflow * (cappedRatios[pid] / nonCappedTotal);
        }
      }
    }
    const cappedDmgRatio = (pid) => cappedRatios[pid] ?? dmgRatio(pid);

    // 計算每人基本份額（不含充公下放）
    const baseShares = {};
    let confiscatedGold = 0;
    for (const pid of participants) {
      const base = effectiveGoldReward * cappedDmgRatio(pid);
      const penalized = Math.round(base * levelPenalty(pid));
      baseShares[pid] = penalized;
      confiscatedGold += Math.round(base - base * levelPenalty(pid));
    }

    // 充公值按比例下放給未被壓制的玩家
    const goldShares = { ...baseShares };
    if (confiscatedGold > 0 && unpenalizedPids.length > 0) {
      for (const pid of unpenalizedPids) {
        goldShares[pid] = (goldShares[pid] || 0) + Math.round(confiscatedGold * unpenalizedDmgRatio(pid));
      }
    }

    for (const pid of participants) {
      const share = Math.max(1, goldShares[pid] || 1);
      try {
        await sc.rewardService.grantCurrency({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.MONSTER_KILL_REWARD, operator: "monster_zone"
        });
        if (perPidRewards[pid]) perPidRewards[pid].gold = share;
      } catch (e) { console.error(`[MonsterZone] grantCurrency(gold) failed for ${pid}`, e); }
    }

    const myShare = Math.max(1, goldShares[discordId] || 1);
    const rawPct = Math.round(dmgRatio(discordId) * 100);
    const capPct = Math.round(cappedDmgRatio(discordId) * 100);
    const pct = rawPct !== capPct ? `${capPct}%（原${rawPct}%，已截斷）` : `${capPct}%`;
    const pen = levelPenalty(discordId);
    const penNote = pen < 1 ? `　⚠️ 等級懲罰 ${Math.round(pen * 100)}%` : "";
    const poolNote = entryFeePool > (monster.goldReward || 0) ? `（入場費加成）` : "";
    const bonusNote = pen >= 1 && confiscatedGold > 0 ? `　🎁 充公加成` : "";
    rewardLines.push(`💰 金幣 +${myShare}（傷害佔比 ${pct}，共 ${effectiveGoldReward}${poolNote}）${penNote}${bonusNote}`);
  }

  // ── EXP 依比例分配（含組隊倍率、等級懲罰、充公下放）──
  // 組隊倍率：人多共鬥獎勵更多，封頂 ×3.5
  // 組隊倍率公式：1~2人=×1.0，3人起平滑無上限增加
  // mult = 1 + (n-2)^0.7 × 0.6，人越多總池越大但每人平均遞減，不會爆量
  const n = participants.length;
  const partyMult = n <= 2 ? 1.0 : +(1 + Math.pow(n - 2, 0.7) * 0.6).toFixed(2);
  const effectiveExpReward = Math.round(monster.expReward * partyMult);

  if (effectiveExpReward > 0) {
    const baseExpShares = {};
    let confiscatedExp = 0;
    for (const pid of participants) {
      const base = effectiveExpReward * dmgRatio(pid);
      const penalized = Math.round(base * levelPenalty(pid));
      baseExpShares[pid] = penalized;
      confiscatedExp += Math.round(base - base * levelPenalty(pid));
    }

    const expShares = { ...baseExpShares };
    if (confiscatedExp > 0 && unpenalizedPids.length > 0) {
      for (const pid of unpenalizedPids) {
        expShares[pid] = (expShares[pid] || 0) + Math.round(confiscatedExp * unpenalizedDmgRatio(pid));
      }
    }

    const myShare = Math.max(1, expShares[discordId] || 1);
    let killerLvLine = "";
    for (const pid of participants) {
      const share = Math.max(1, expShares[pid] || 1);
      try {
        const expResult = await sc.progressService.grantExp({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          amount: share, source: EXP_SOURCES.MONSTER_KILL
        });
        if (perPidRewards[pid]) {
          perPidRewards[pid].exp = share;
          if (expResult.levelUps > 0) {
            perPidRewards[pid].levelUps = expResult.levelUps;
            perPidRewards[pid].newLevel = expResult.progress?.level ?? 0;
          }
        }
        if (pid === discordId && expResult.levelUps > 0) {
          killerLvLine = ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}`;
        }
      } catch (e) { console.error(`[MonsterZone] grantExp failed for ${pid}`, e); }
    }

    const pct = Math.round(dmgRatio(discordId) * 100);
    const pen = levelPenalty(discordId);
    const penNote = pen < 1 ? `　⚠️ 等級懲罰 ${Math.round(pen * 100)}%` : "";
    const bonusNote = pen >= 1 && confiscatedExp > 0 ? `　🎁 充公加成` : "";
    const partyNote = partyMult > 1 ? `　👥 ×${partyMult}（${participants.length}人）` : "";
    rewardLines.push(`⭐ EXP +${myShare}（傷害佔比 ${pct}%，共 ${effectiveExpReward}${partyMult > 1 ? ` 原${monster.expReward}` : ""}）${partyNote}${penNote}${bonusNote}${killerLvLine}`);
  }

  // ── 道具掉落：從所有參戰者中抽一人，再骰各道具掉落率 ──
  // 規則：1. 從 participants 隨機抽出一位幸運者
  //        2. 幸運者對每個掉落項目各自骰 chance%
  //        3. 骰中的道具進入幸運者背包
  if (Array.isArray(monster.drops) && monster.drops.length > 0 && participants.length > 0) {
    // 預載全部參戰者的 progress
    const progressCache = {};
    await Promise.all(participants.map(async (pid) => {
      const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
      if (prog) progressCache[pid] = prog;
    }));

    // 抽幸運者
    const luckyIdx = Math.floor(Math.random() * participants.length);
    const luckyPid = participants[luckyIdx];
    const luckyProg = progressCache[luckyPid];

    if (luckyProg) {
      if (!Array.isArray(luckyProg.inventory)) luckyProg.inventory = [];
      const droppedItems = [];

      for (const drop of monster.drops) {
        if (Math.random() * 100 < drop.chance) {
          const item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
          if (item) {
            luckyProg.inventory.push({
              uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              itemType: item.itemType || "consumable",
              imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null, equipStats: item.equipStats || null,
              weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
              atkStat: item.atkStat || null, tier: item.tier || null, enhanceLevel: 0,
              source: "monster_drop", sourceRef: monster.name,
              purchasedAt: new Date().toISOString()
            });
            droppedItems.push(item.name);
          }
        }
      }

      if (droppedItems.length > 0) {
        luckyProg.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(luckyProg);
        if (perPidRewards[luckyPid]) perPidRewards[luckyPid].drops = [...droppedItems];
        const luckyName = luckyPid === discordId ? displayName : (mergedDmg[luckyPid]?.name || luckyPid);
        const isKiller = luckyPid === discordId;
        if (isKiller) {
          rewardLines.push(`🎁 道具掉落：${droppedItems.join("、")}`);
          _announceDrops(sc, luckyPid, luckyName, monster.name, droppedItems, "kill").catch(() => {});
        } else {
          _announceDrops(sc, luckyPid, luckyName, monster.name, droppedItems, "group").catch(() => {});
        }
      }
    }

    // 10 人加碼：再額外抽一位（可與第一位不同），再骰一次掉落
    if (participants.length >= 10) {
      // 排除第一位幸運者，從剩餘參戰者中抽
      const bonusPool = participants.filter(pid => pid !== luckyPid);
      const bonusPid = bonusPool.length > 0
        ? bonusPool[Math.floor(Math.random() * bonusPool.length)]
        : luckyPid; // 只有一人時就還是他
      const bonusProg = progressCache[bonusPid];
      if (bonusProg) {
        if (!Array.isArray(bonusProg.inventory)) bonusProg.inventory = [];
        const bonusItems = [];
        for (const drop of monster.drops) {
          if (Math.random() * 100 < drop.chance) {
            const item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
            if (item) {
              bonusProg.inventory.push({
                uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
                itemEffect: item.effect || { type: "none", value: 0 },
                itemType: item.itemType || "consumable",
                imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
                equipSlot: item.equipSlot || null, equipStats: item.equipStats || null,
                weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
                atkStat: item.atkStat || null, tier: item.tier || null, enhanceLevel: 0,
                source: "monster_drop_bonus", sourceRef: monster.name,
                purchasedAt: new Date().toISOString()
              });
              bonusItems.push(item.name);
            }
          }
        }
        if (bonusItems.length > 0) {
          bonusProg.updatedAt = new Date().toISOString();
          await sc.progressRepository.save(bonusProg);
          if (perPidRewards[bonusPid]) perPidRewards[bonusPid].drops = [...(perPidRewards[bonusPid].drops || []), ...bonusItems];
          const bonusName = bonusPid === discordId ? displayName : (mergedDmg[bonusPid]?.name || bonusPid);
          _announceDrops(sc, bonusPid, bonusName, monster.name, bonusItems, "participation").catch(() => {});
        }
      }
    }
  }

  // 擊殺數 + 推進下一隻怪物
  const newKillCount = { ...(state.killCount || {}), [monster.id]: ((state.killCount?.[monster.id] || 0) + 1) };
  // 取最新 state 以免多人並發時覆蓋其他人的 damageMap
  const freshState = await sc.monsterService.getState(zoneKey);
  const finalDamageMap = { ...(freshState.damageMap || {}), ...mergedDmg };

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
  // 加權隨機選下一隻（spawnRate 越高越常出現，預設 10）
  const pool = allMonsters.filter(m => m.id !== monster.id || allMonsters.length === 1);
  const totalWeight = pool.reduce((s, m) => s + (m.spawnRate || 10), 0);
  let r = Math.random() * totalWeight;
  let nextMonster = pool[pool.length - 1];
  for (const m of pool) { r -= (m.spawnRate || 10); if (r <= 0) { nextMonster = m; break; } }

  const newState = {
    ...freshState,
    currentHp: nextMonster ? nextMonster.calc.maxHp : 0,
    activeMonsterSeq: nextMonster ? nextMonster.seq : freshState.activeMonsterSeq,
    killCount: newKillCount,
    participants: [], // 新怪上場，參戰名單清零
    damageMap: {},   // 新怪上場，傷害紀錄清零
    killClaimedSeq: null // 重置擊殺權，避免遺留造成未來結算失敗
  };
  await sc.monsterService.saveState(newState, zoneKey);

  if (nextMonster) {
    _republishPanel(sc, zoneKey, nextMonster, nextMonster.calc.maxHp, 0, {})
      .catch(() => {});
    // BOSS 出場廣播
    if (nextMonster.isBoss) {
      console.log(`[BOSS] next monster "${nextMonster.name}" is a boss, broadcasting...`);
      _broadcastBossSpawn(sc, zoneKey, nextMonster).catch((e) => console.error("[BOSS] top-level catch:", e));
    }
  } else {
    _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap)
      .catch(() => {});
  }

  // 通知非擊殺者參戰獎勵（DM，擊殺者已在戰鬥 embed 看到）
  _notifyKillRewards(monster.name, perPidRewards, discordId).catch(() => {});

  // 推送 SSE reward 事件給所有非擊殺者參戰者（web 端）
  try {
    const pushReward = sc._pushRewardToPlayer;
    if (typeof pushReward === "function") {
      for (const [pid, rewards] of Object.entries(perPidRewards)) {
        if (pid === discordId) continue; // 擊殺者自己在戰鬥結算看到
        if (!rewards.gold && !rewards.exp && !rewards.drops?.length) continue;
        pushReward(pid, {
          monsterName: monster.name,
          gold:     rewards.gold,
          exp:      rewards.exp,
          levelUps: rewards.levelUps,
          newLevel: rewards.newLevel,
          drops:    rewards.drops,
        });
      }
    }
  } catch (_) {}

  // 回傳結構化摘要供 web API 使用
  const myReward = perPidRewards[discordId] || { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
  rewardLines._summary = {
    gold:     myReward.gold,
    exp:      myReward.exp,
    levelUps: myReward.levelUps,
    newLevel: myReward.newLevel,
    drops:    myReward.drops,
  };

  return rewardLines;
  } finally {
    killInProgress.delete(killKey);
  }
}

// ──────────────────────────────────────────────
// 主路由
// ──────────────────────────────────────────────
async function handleMonsterZoneButton(interaction) {
  const { customId } = interaction;
  if (!isMonsterZoneButton(customId)) return false;
  if (customId === BTN.enterBattle)     await handleEnterBattle(interaction);
  else if (customId === BTN.startFight) await handleStartFight(interaction);
  else if (customId === BTN.deleteLog)  await handleDeleteLog(interaction);
  return true;
}

module.exports = {
  handleMonsterZoneButton,
  isMonsterZoneButton,
  handleMonsterKill,
  _republishPanel,
  MAX_ROUNDS,
  _broadcastBossSpawn,
  activeSessions
};
