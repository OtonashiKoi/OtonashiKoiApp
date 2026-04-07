"use strict";

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");

// 戰鬥 session 依 discordId 儲存（記憶體）
const activeSessions = new Map();

const BTN = {
  enterBattle: "monster-zone:enter-battle",
  startFight:  "monster-zone:start-fight",
  deleteLog:   "monster-zone:delete-log"
};

const MAX_ROUNDS = 60;
const BATTLE_TIMEOUT_MS = 60 * 1000; // 1 分鐘未按開始戰鬥 → 視為逃跑
const ROUNDS_PER_TICK = 1;           // 每次更新顯示幾回合
const TICK_DELAY_MS = 1500;          // 每次更新間隔（ms）

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

function isMonsterZoneButton(customId) {
  return customId.startsWith("monster-zone:");
}

// 攻擊倍率：單手 ×3（1次）；雙持（主手+副手各一武器）×2 打兩次
const ATK_MULT_1H = 3;
const ATK_MULT_DUAL = 2;

function calcPlayerStats({ str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1, luk = 1 } = {}, equipped = {}) {
  // 加總所有已裝備物品的屬性加成
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in bonus) bonus[k] += (v || 0);
    }
  }
  const S = str + bonus.str;
  const A = agi + bonus.agi;
  const V = vit + bonus.vit;
  const I = INT + bonus.int;
  const D = dex + bonus.dex;
  const L = luk + bonus.luk;

  // 攻擊力依武器種類決定 scaling stat
  const weapon = equipped.weapon || null;
  // 雙持：主手有武器 + 副手也是武器（非盾/空）且非雙手武器
  const offhand = equipped.shield || null;
  // 副手有 weaponType 代表裝了武器（非盾牌），才算雙持
  const isDualWield = weapon && !weapon.isTwoHanded && offhand?.weaponType != null;
  const mult = isDualWield ? ATK_MULT_DUAL : ATK_MULT_1H;
  const attackCount = isDualWield ? 2 : 1;

  let baseStat;
  const wt = weapon?.weaponType;
  if (!wt) {
    baseStat = S; // 徒手 → STR
  } else if (wt === "staff_1h" || wt === "staff_2h") {
    baseStat = I; // 法杖 → INT
  } else if (wt === "bow") {
    baseStat = D; // 弓箭 → DEX
  } else {
    baseStat = S; // 劍/斧/錘/匕首 → STR
  }

  return {
    maxHp: V * 15 + 50,
    atk: Math.round(baseStat * mult),
    attackCount,
    def: bonus.vit, // 只算裝備加成，基礎 VIT 管血量
    dodge: Math.min(50, A * 0.5),
    hit: Math.min(100, 80 + D),
    crit: Math.min(100, L * 0.3),
    weaponType: wt || null
  };
}

function buildHpBar(hp, maxHp, fillEmoji = "🟥", emptyEmoji = "⬛", length = 10) {
  const filled = Math.round((Math.max(0, hp) / Math.max(1, maxHp)) * length);
  return fillEmoji.repeat(Math.max(0, filled)) + emptyEmoji.repeat(Math.max(0, length - filled));
}

// ──────────────────────────────────────────────
// 輔助：掉落裝備公告
// ──────────────────────────────────────────────
async function _announceDrops(sc, discordId, displayName, monsterName, droppedItems) {
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
    await channel.send(`🎉 **<@${discordId}>** 在 ${timeStr} 擊敗了 **${monsterName}**，獲得了 **${itemList}**！`);
  } catch (e) {
    console.error("[MonsterZone] drop announce error", e);
  }
}

// ──────────────────────────────────────────────
// 輔助：重發公開面板
// ──────────────────────────────────────────────
async function _republishPanel(sc, monster, monsterHp, participantCount, damageMap = {}) {
  const layout = await sc.channelLayoutRepository.get();
  const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === "monster_zone");
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
    const state = await sc.monsterService.getState();
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: false });
    if (!monsters.length) {
      await interaction.editReply({ content: "❌ 目前沒有啟用中的怪物，請稍後再試。" });
      return;
    }
    const monster = monsters.find((m) => m.seq === state.activeMonsterSeq) || monsters[0];
    const monsterHp = state.currentHp != null ? state.currentHp : monster.calc.maxHp;

    const progress = await sc.progressRepository.findByPlayerId(discordId);
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
      await sc.monsterService.saveState({ ...state, currentHp: monsterHp, participants: newParticipants });
      const layout = await sc.channelLayoutRepository.get();
      const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === "monster_zone");
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

  try {
    const state = await sc.monsterService.getState();
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: false });
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
      for (let a = 0; a < attackCount && outcome === null; a++) {
        const hitChance = session.playerStats.hit - session.monsterStats.dodge;
        if (Math.random() * 100 < hitChance) {
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
        } else {
          log.push(`💨 ${session.monsterName} ${rand(dodgePhrases)}，你的攻擊落空了！`);
        }
      }

      if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

      // 怪物反擊
      const monsterHitChance = session.monsterStats.hit - session.playerStats.dodge;
      if (Math.random() * 100 < monsterHitChance) {
        const dmg = rollDmg(Math.max(1, session.monsterStats.atk - session.playerStats.def));
        session.playerHp -= dmg;
        log.push(`💥 ${session.monsterName} ${rand(mAtkPhrases)}，造成 **${dmg}** 點傷害！（你剩 ${Math.max(0, session.playerHp)} HP）`);
      } else {
        log.push(`🛡️ ${session.monsterName} 猛撲而來，你${rand(mDodgePhrases)}，躲過了攻擊！`);
      }

      if (session.playerHp <= 0) { outcome = "lose"; roundLogs.push(log.join("\n")); break; }

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
      rewardLines = await handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage });
      embedTitle = "🏆 勝利！";
      embedColor = 0xf1c40f;
    } else if (outcome === "lose") {
      session.monsterHp = Math.max(0, session.monsterHp);
      let damageMap = {};
      try {
        const freshState = await sc.monsterService.getState();
        const prev = freshState.damageMap || {};
        damageMap = { ...prev, [discordId]: { name: displayName, damage: (prev[discordId]?.damage || 0) + totalDamage } };
        await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap });
      } catch (e) {
        await sc.monsterService.saveState({ ...state, currentHp: session.monsterHp });
      }
      embedTitle = "💀 戰鬥失敗";
      embedColor = 0x555555;
      rewardLines = [
        `你被 **${session.monsterName}** 擊倒了！`,
        session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！"
      ];
      _republishPanel(sc, monster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
    } else {
      let damageMap = {};
      try {
        const freshState = await sc.monsterService.getState();
        const prev = freshState.damageMap || {};
        damageMap = { ...prev, [discordId]: { name: displayName, damage: (prev[discordId]?.damage || 0) + totalDamage } };
        await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap });
      } catch (e) {
        await sc.monsterService.saveState({ ...state, currentHp: session.monsterHp });
      }
      embedTitle = "⏸️ 戰鬥超時";
      embedColor = 0x888888;
      rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。`];
      _republishPanel(sc, monster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
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
async function handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage = 0 }) {
  const sc = getServiceContext();
  const rewardLines = [];

  // 參戰名單（含擊殺者）
  const participants = [...new Set([...(Array.isArray(state.participants) ? state.participants : []), discordId])];

  // ── 依傷害比例計算每人分配量 ──
  const rawDmgMap = state.damageMap || {};
  // 合入本次擊殺者的傷害
  const mergedDmg = { ...rawDmgMap, [discordId]: { name: displayName, damage: (rawDmgMap[discordId]?.damage || 0) + totalDamage } };
  const totalDmgAll = participants.reduce((s, pid) => s + (mergedDmg[pid]?.damage || 0), 0);
  const dmgRatio = (pid) => totalDmgAll > 0 ? (mergedDmg[pid]?.damage || 0) / totalDmgAll : 1 / participants.length;

  // ── 金幣依比例分配 ──
  if (monster.goldReward > 0) {
    const myShare = Math.max(1, Math.round(monster.goldReward * dmgRatio(discordId)));
    for (const pid of participants) {
      const share = Math.max(1, Math.round(monster.goldReward * dmgRatio(pid)));
      try {
        await sc.rewardService.grantCurrency({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.MONSTER_KILL_REWARD, operator: "monster_zone"
        });
      } catch (e) { console.error("[MonsterZone] grantCurrency error", e); }
    }
    const pct = Math.round(dmgRatio(discordId) * 100);
    rewardLines.push(`💰 金幣 +${myShare}（傷害佔比 ${pct}%，共 ${monster.goldReward}）`);
  }

  // ── EXP 依比例分配 ──
  if (monster.expReward > 0) {
    const myShare = Math.max(1, Math.round(monster.expReward * dmgRatio(discordId)));
    let killerLvLine = "";
    for (const pid of participants) {
      const share = Math.max(1, Math.round(monster.expReward * dmgRatio(pid)));
      try {
        const expResult = await sc.progressService.grantExp({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          amount: share, source: EXP_SOURCES.MONSTER_KILL
        });
        if (pid === discordId && expResult.levelUps > 0) {
          killerLvLine = ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}`;
        }
      } catch (e) { console.error("[MonsterZone] grantExp error", e); }
    }
    const pct = Math.round(dmgRatio(discordId) * 100);
    rewardLines.push(`⭐ EXP +${myShare}（傷害佔比 ${pct}%，共 ${monster.expReward}）${killerLvLine}`);
  }

  if (Array.isArray(monster.drops) && monster.drops.length > 0) {
    const droppedItems = [];
    const progress = await sc.progressRepository.findByPlayerId(discordId);
    if (progress) {
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      for (const drop of monster.drops) {
        if (Math.random() * 100 < drop.chance) {
          const item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
          if (item) {
            progress.inventory.push({
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
      progress.updatedAt = new Date().toISOString();
      await sc.progressRepository.save(progress);
    }
    if (droppedItems.length > 0) {
      rewardLines.push(`🎁 道具掉落：${droppedItems.join("、")}`);
      _announceDrops(sc, discordId, displayName, monster.name, droppedItems).catch(() => {});
    }
  }

  // 擊殺數 + 推進下一隻怪物
  const newKillCount = { ...(state.killCount || {}), [monster.id]: ((state.killCount?.[monster.id] || 0) + 1) };
  // 取最新 state 以免多人並發時覆蓋其他人的 damageMap
  const freshState = await sc.monsterService.getState();
  const finalDamageMap = { ...(freshState.damageMap || {}), ...mergedDmg };

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false });
  const sorted = [...allMonsters].sort((a, b) => a.seq - b.seq);
  const idx = sorted.findIndex((m) => m.id === monster.id);
  const nextMonster = sorted.length > 0 ? sorted[(idx + 1) % sorted.length] : null;

  const newState = {
    ...freshState,
    currentHp: nextMonster ? nextMonster.calc.maxHp : 0,
    activeMonsterSeq: nextMonster ? nextMonster.seq : freshState.activeMonsterSeq,
    killCount: newKillCount,
    participants: [], // 新怪上場，參戰名單清零
    damageMap: {}    // 新怪上場，傷害紀錄清零
  };
  await sc.monsterService.saveState(newState);

  if (nextMonster) {
    _republishPanel(sc, nextMonster, nextMonster.calc.maxHp, 0, {})
      .catch((e) => console.error("[MonsterZone] republish panel error", e));
  } else {
    // 沒有下一隻怪，仍更新面板並顯示擊殺者傷害（不清零先展示）
    _republishPanel(sc, null, 0, 0, finalDamageMap)
      .catch((e) => console.error("[MonsterZone] republish panel error", e));
  }

  return rewardLines;
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

module.exports = { handleMonsterZoneButton, isMonsterZoneButton };
