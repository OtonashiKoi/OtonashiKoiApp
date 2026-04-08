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
    console.error("[MonsterZone] notifyKillRewards error", e);
  }
}

async function _announceDrops(sc, discordId, displayName, monsterName, droppedItems, isLucky = false) {
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
    if (isLucky) {
      await channel.send(`🍀 ${displayName} (<@${discordId}>) 在 ${timeStr} 參與戰鬥 **${monsterName}**，狗到了 **${itemList}**！`);
    } else {
      await channel.send(`🎉 ${displayName} (<@${discordId}>) 在 ${timeStr} 擊敗了 **${monsterName}**，獲得了 **${itemList}**！`);
    }
  } catch (e) {
    console.error("[MonsterZone] drop announce error", e);
  }
}

async function _announceGroupBonus(sc, luckyDiscordId, luckyName, monsterName, bonusItems, participantCount) {
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
    const itemList = bonusItems.join("、");
    await channel.send(
      `🌟🍀✨ **【${participantCount} 人加碼幸運獎】** ✨🍀🌟\n` +
      `**${luckyName}** (<@${luckyDiscordId}>) 在這場 **${participantCount} 人** 的史詩戰鬥中被神秘力量選中！\n` +
      `運氣好到不得了，額外獲得了 **${itemList}**！🎊`
    );
  } catch (e) {
    console.error("[MonsterZone] group bonus announce error", e);
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
          .catch((e) => console.error("[MonsterZone] update panel error", e));
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
    console.error("[MonsterZone] handleEnterBattle error", err);
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
    const roundLogs = [];
    let round = 1;
    let outcome = null; // "win" | "lose" | "timeout"
    let totalDamage = 0;

    // 武器描寫
    const wt = session.playerStats.weaponType || null;
    const atkVerbs = !wt
      ? ["揮拳猛擊", "飛腿踢出", "怒拳轟擊", "突刺重擊"]
      : (wt === "staff_1h" || wt === "staff_2h")
        ? ["施展魔法", "吟唱咒語", "釋放法術", "引導魔力"]
        : wt === "bow"
          ? ["拉弓射擊", "瞄準射出", "急速連射", "精準放箭"]
          : wt === "dagger"
            ? ["快速刺出", "連環割砍", "偷襲突刺", "趁隙猛刺"]
            : ["揮劍斬擊", "猛力劈下", "側身橫掃", "架勢突刺"];
    const critPhrases = ["會心一擊", "致命一擊", "弱點命中", "完美命中"];
    const comboPhrases = ["連擊！", "殘影連斬！", "急速追打！", "趁勢猛攻！"];
    const dodgePhrases = ["身形一閃", "靈巧側移", "緊急後退", "巧妙格開"];
    const mDodgePhrases = ["及時閃避", "往旁一跳", "後退一步", "以盾擋下"];
    const mAtkPhrases = ["猛力衝撞", "揮爪攻擊", "重擊落下", "怒吼突進"];
    const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // 傷害浮動 ±20%
    const rollDmg = (base) => Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));

    while (round <= MAX_ROUNDS && outcome === null) {
      const log = [`**【第 ${round} 回合】**`];

      // 玩家攻擊（雙持武器攻擊兩次，各自判定命中/暴擊）
      const attackCount = session.playerStats.attackCount || 1;
      const absoluteHit = session.playerStats.absoluteHit || false;
      for (let a = 0; a < attackCount && outcome === null; a++) {
        const hitChance = session.playerStats.hit - session.monsterStats.dodge;
        if (absoluteHit || Math.random() * 100 < hitChance) {
          let dmg = rollDmg(Math.max(1, session.playerStats.atk - session.monsterStats.def));
          const isCrit = Math.random() * 100 < session.playerStats.crit;
          if (isCrit) dmg = Math.round(dmg * 1.5);
          session.monsterHp -= dmg;
          totalDamage += dmg;
          const verb = rand(atkVerbs);
          if (isCrit) {
            log.push(`⚔️✨ **${rand(critPhrases)}**！${verb}，對 ${session.monsterName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, session.monsterHp)} HP）`);
          } else {
            log.push(`⚔️ ${verb}，對 ${session.monsterName} 造成 **${dmg}** 點傷害。（怪物剩 ${Math.max(0, session.monsterHp)} HP）`);
          }
          if (session.monsterHp <= 0) { outcome = "win"; break; }
          // 連擊判定（AGI → combo%，命中後額外一擊，不再判命中/閃避）
          if (outcome === null && Math.random() * 100 < session.playerStats.combo) {
            let cdmg = rollDmg(Math.max(1, session.playerStats.atk - session.monsterStats.def));
            session.monsterHp -= cdmg;
            totalDamage += cdmg;
            log.push(`⚡ **${rand(comboPhrases)}** 追加攻擊造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, session.monsterHp)} HP）`);
            if (session.monsterHp <= 0) { outcome = "win"; break; }
          }
        } else {
          log.push(`💨 ${session.monsterName} ${rand(dodgePhrases)}，你的攻擊落空了！`);
        }
      }

      if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

      // 怪物反擊（法杖裝備者每回合受兩次攻擊）
      const monsterAttackCount = session.playerStats.monsterAttackCount || 1;
      for (let ma = 0; ma < monsterAttackCount && outcome === null; ma++) {
        const monsterHitChance = session.monsterStats.hit - session.playerStats.dodge;
        if (Math.random() * 100 < monsterHitChance) {
          const dmg = rollDmg(Math.max(1, session.monsterStats.atk - session.playerStats.def));
          session.playerHp -= dmg;
          log.push(`💥 ${session.monsterName} ${rand(mAtkPhrases)}，造成 **${dmg}** 點傷害！（你剩 ${Math.max(0, session.playerHp)} HP）`);
          if (session.playerHp <= 0) { outcome = "lose"; break; }
        } else {
          log.push(`🛡️ ${session.monsterName} 猛撲而來，你${rand(mDodgePhrases)}，躲過了攻擊！`);
        }
      }
      if (outcome === "lose") { roundLogs.push(log.join("\n")); break; }

      roundLogs.push(log.join("\n"));
      round++;
    }
    if (outcome === null) outcome = "timeout";

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
    console.error("[MonsterZone] handleStartFight error", err);
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
  if (killInProgress.has(killKey)) {
    // 另一位玩家已在結算中，此次擊殺視為無效，不重複發獎
    return rewardLines;
  }
  killInProgress.add(killKey);

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
  if (monster.goldReward > 0) {
    const myMultiplier = dmgRatio(discordId) * levelPenalty(discordId);
    const myShare = Math.max(1, Math.round(monster.goldReward * myMultiplier));
    for (const pid of participants) {
      const share = Math.max(1, Math.round(monster.goldReward * dmgRatio(pid) * levelPenalty(pid)));
      try {
        await sc.rewardService.grantCurrency({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.MONSTER_KILL_REWARD, operator: "monster_zone"
        });
        if (perPidRewards[pid]) perPidRewards[pid].gold = share;
      } catch (e) { console.error("[MonsterZone] grantCurrency error", e); }
    }
    const pct = Math.round(dmgRatio(discordId) * 100);
    const pen = levelPenalty(discordId);
    const penNote = pen < 1 ? `　⚠️ 等級懲罰 ${Math.round(pen * 100)}%` : "";
    rewardLines.push(`💰 金幣 +${myShare}（傷害佔比 ${pct}%，共 ${monster.goldReward}）${penNote}`);
  }

  // ── EXP 依比例分配（含等級懲罰）──
  if (monster.expReward > 0) {
    const myMultiplier = dmgRatio(discordId) * levelPenalty(discordId);
    const myShare = Math.max(1, Math.round(monster.expReward * myMultiplier));
    let killerLvLine = "";
    for (const pid of participants) {
      const share = Math.max(1, Math.round(monster.expReward * dmgRatio(pid) * levelPenalty(pid)));
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
      } catch (e) { console.error("[MonsterZone] grantExp error", e); }
    }
    const pct = Math.round(dmgRatio(discordId) * 100);
    const pen = levelPenalty(discordId);
    const penNote = pen < 1 ? `　⚠️ 等級懲罰 ${Math.round(pen * 100)}%` : "";
    rewardLines.push(`⭐ EXP +${myShare}（傷害佔比 ${pct}%，共 ${monster.expReward}）${penNote}${killerLvLine}`);
  }

  // ── 承褒：所有參戰者各自決定是否掉落──
  // 規則：5% 先决機率 → 中後再依每個道具的 chance 骸
  if (Array.isArray(monster.drops) && monster.drops.length > 0) {
    const LUCKY_CHANCE = 5; // 先决 5%
    // 預載全部參戰者的 progress
    const progressCache = {};
    await Promise.all(participants.map(async (pid) => {
      const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
      if (prog) progressCache[pid] = prog;
    }));

    for (const pid of participants) {
      const isKiller = pid === discordId;
      // 擊殺者必中先决，其他參戰者有 5% 機率
      if (!isKiller && Math.random() * 100 >= LUCKY_CHANCE) continue;

      const prog = progressCache[pid];
      if (!prog) continue;
      if (!Array.isArray(prog.inventory)) prog.inventory = [];

      const droppedItems = [];
      for (const drop of monster.drops) {
        if (Math.random() * 100 < drop.chance) {
          const item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
          if (item) {
            prog.inventory.push({
              uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              itemType: item.itemType || "consumable",
              imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null, equipStats: item.equipStats || null,
              weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
              source: "monster_drop", sourceRef: monster.name,
              purchasedAt: new Date().toISOString()
            });
            droppedItems.push(item.name);
          }
        }
      }
      if (droppedItems.length > 0) {
        prog.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(prog);
        if (perPidRewards[pid]) perPidRewards[pid].drops = [...droppedItems];
        const pidName = isKiller ? displayName : (mergedDmg[pid]?.name || pid);
        if (isKiller) {
          rewardLines.push(`🎁 道具掉落：${droppedItems.join("、")}`);
          _announceDrops(sc, pid, pidName, monster.name, droppedItems, false).catch(() => {});
        } else {
          _announceDrops(sc, pid, pidName, monster.name, droppedItems, true).catch(() => {});
        }
      }
    }

    // 10 人加碼幸運獎：抽 1 人強制骰一次額外掉落（跳過先決機率）
    if (participants.length >= 10) {
      const luckyIdx = Math.floor(Math.random() * participants.length);
      const luckyPid = participants[luckyIdx];
      const luckyProg = progressCache[luckyPid];
      if (luckyProg) {
        if (!Array.isArray(luckyProg.inventory)) luckyProg.inventory = [];
        const bonusItems = [];
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
                source: "group_bonus_drop", sourceRef: monster.name,
                purchasedAt: new Date().toISOString()
              });
              bonusItems.push(item.name);
            }
          }
        }
        if (bonusItems.length > 0) {
          luckyProg.updatedAt = new Date().toISOString();
          await sc.progressRepository.save(luckyProg);
          const luckyName = luckyPid === discordId ? displayName : (mergedDmg[luckyPid]?.name || luckyPid);
          _announceGroupBonus(sc, luckyPid, luckyName, monster.name, bonusItems, participants.length).catch(() => {});
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
    damageMap: {}    // 新怪上場，傷害紀錄清零
  };
  await sc.monsterService.saveState(newState, zoneKey);

  if (nextMonster) {
    _republishPanel(sc, zoneKey, nextMonster, nextMonster.calc.maxHp, 0, {})
      .catch((e) => console.error("[MonsterZone] republish panel error", e));
  } else {
    _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap)
      .catch((e) => console.error("[MonsterZone] republish panel error", e));
  }

  // 通知非擊殺者參戰獎勵（DM，擊殺者已在戰鬥 embed 看到）
  _notifyKillRewards(monster.name, perPidRewards, discordId).catch(() => {});

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
  activeSessions
};
