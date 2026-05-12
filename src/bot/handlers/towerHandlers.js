"use strict";

const { MessageFlags } = require("discord.js");
const config = require("../../config");
const { serviceContext, getBotClient } = require("../runtimeContext");
const { calcPlayerStats } = require("../../shared/combatStats");
const { mergeEquippedFromLibrary, applyEffectInstances, collectEquipmentEffects, isEffectConditionMet } = require("../../shared/effectEngine");
const { runCombatLoop } = require("../../shared/combatLoop");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { setTowerPresence, isTowerBattleActive } = require("../../shared/battlePresence");
const {
  TOWER_MAX_MEMBERS,
  TOWER_TOTAL_FLOORS,
  TOWER_LOBBY_TIMEOUT_MS,
  MAX_ROUNDS_PER_MEMBER,
  TOWER_MIN_LEVEL,
  TOWER_HOURLY_LIMIT,
  TOWER_HOURLY_WINDOW_MS,
  scaleTowerMonsterHp,
  scaleTowerMonsterAtk,
  getCumulativePartyBonus,
  calcTowerReward,
  getTowerClearBuff,
} = require("../../shared/towerConfig");
const {
  TOWER_IDS,
  createTowerHallMessage,
  createTowerThreadLobbyMessage,
  createTowerThreadBattleMessage,
  createTowerThreadResultMessage,
  createTowerRankingMessage,
} = require("../towerView");

// ── 記憶體狀態 ───────────────────────────────────────────────
// threadId → session
const activeSessions = new Map();
// discordId → threadId
const playerThreadMap = new Map();

// session.state:
//   "lobby"          → 等待加入
//   "ready_to_fight" → 等待隊長按「攻略下一層」
//   "fighting"       → 單層結算中（防重複按）
//   "done" | "failed"→ 結束

// ── Session 序列化（MongoDB 不支援 Set / Discord 物件）───────
function serializeSession(session) {
  return {
    threadId:        session.threadId,
    starterMessageId: session.starterMessage?.id || null,
    roomId:          session.roomId,
    leaderId:        session.leaderId,
    state:           session.state,
    members:         session.members,
    currentFloor:    session.currentFloor,
    clearedFloor:    session.clearedFloor,
    currentMonster:  session.currentMonster,
    lastFloorResult: session.lastFloorResult || null,
    failReason:      session.failReason || null,
    savedAt:         new Date().toISOString(),
  };
}

async function persistSession(session) {
  try {
    const sc = serviceContext;
    await sc.towerSessionRepository.save(serializeSession(session));
  } catch (e) {
    console.error("[Tower] persistSession error:", e);
  }
}

async function deletePersistSession(threadId) {
  try {
    await serviceContext.towerSessionRepository.delete(threadId);
  } catch (_) {}
}

let _roomCounter = 0;
function genRoomId() {
  _roomCounter = (_roomCounter + 1) % 9999;
  return `T${String(_roomCounter).padStart(4, "0")}`;
}

// ── 職業偵測（依 job_eq 徽章）────────────────────────────────
const JOB_TRAITS = {
  swordsman:    { name: "劍士",   emoji: "⚔️",  traits: ["單手劍傷害×1.2", "盾格擋+10%", "格擋反擊命中+20%"] },
  warrior:      { name: "戰士",   emoji: "🪓",  traits: ["雙手斧傷害×1.2", "低血傷害×1.15", "破防15%"] },
  dwarf_warrior:{ name: "矮人戰士",emoji: "🔨", traits: ["雙手槌傷害×1.2", "盾格擋+20%", "高血擊暈+5%"] },
  rogue:        { name: "盜賊",   emoji: "🗡️",  traits: ["匕首傷害×1.2", "連擊率+10%", "連擊傷害×1.1"] },
  mage:         { name: "法師",   emoji: "🪄",  traits: ["法杖傷害×1.15", "無視DEF 50%", "穿防遠攻"] },
  healer:       { name: "治療師", emoji: "💚",  traits: ["每回合回復3% MaxHP", "在場光環", "團隊支援"] },
  archer:       { name: "弓箭手", emoji: "🏹",  traits: ["弓傷害×1.2", "命中要害35%+", "迴避後必暴追擊"] },
  default:      { name: "冒險者", emoji: "🧑",  traits: ["無職業加成"] },
};

function detectJob(equipped = {}) {
  const jobEq  = equipped?.job_eq || null;
  const jobId  = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const jobName = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
  const has = (s) => jobId.includes(s) || jobName.includes(s);

  if (has("swordsman") || has("劍士")) return JOB_TRAITS.swordsman;
  if (has("dwarf") || has("矮人"))     return JOB_TRAITS.dwarf_warrior;
  if (has("warrior") || has("戰士"))   return JOB_TRAITS.warrior;
  if (has("archer") || has("弓箭手"))  return JOB_TRAITS.archer;
  if (has("healer") || has("治療師"))  return JOB_TRAITS.healer;
  if (has("mage") || has("法師"))      return JOB_TRAITS.mage;
  if (has("rogue") || has("盜賊"))     return JOB_TRAITS.rogue;
  return JOB_TRAITS.default;
}

// ── 讀取玩家資料（組隊時用，開始後不再讀 DB） ────────────────
async function loadMemberData(discordId) {
  const sc = serviceContext;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) return null;
  const attrs    = progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const equipped = await mergeEquippedFromLibrary(progress.equipment || {}, sc.itemRepository);
  const inventory     = Array.isArray(progress.inventory)     ? progress.inventory     : [];
  const activeEffects = Array.isArray(progress.activeEffects) ? progress.activeEffects : [];
  const pStats = calcPlayerStats(attrs, equipped, activeEffects, inventory,
    { pkRating: progress.pkRating });
  return {
    stats: pStats, equipped, inventory, activeEffects,
    level: Math.max(1, Number(progress.level || 1)),
    towerRecord: progress.towerRecord || null,
    job: detectJob(equipped),
  };
}

// ── 每小時挑戰次數檢查 ────────────────────────────────────────
async function checkHourlyLimit(discordId) {
  const sc = serviceContext;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) return { ok: false, reason: "找不到玩家資料" };
  const now = Date.now();
  const runs = Array.isArray(progress.towerRecord?.recentRuns) ? progress.towerRecord.recentRuns : [];
  const recent = runs.filter((t) => now - t < TOWER_HOURLY_WINDOW_MS);
  if (recent.length >= TOWER_HOURLY_LIMIT) {
    const oldest = Math.min(...recent);
    const resetIn = Math.ceil((oldest + TOWER_HOURLY_WINDOW_MS - now) / 60000);
    return { ok: false, reason: `每小時最多挑戰 ${TOWER_HOURLY_LIMIT} 次，還需等待約 ${resetIn} 分鐘。` };
  }
  return { ok: true };
}

// ── 解散 ─────────────────────────────────────────────────────
function disbandSession(threadId) {
  const session = activeSessions.get(threadId);
  if (!session) return;
  if (session.lobbyTimer) clearTimeout(session.lobbyTimer);
  for (const m of session.members) {
    playerThreadMap.delete(m.discordId);
    setTowerPresence([m.discordId], false);
  }
  activeSessions.delete(threadId);
  deletePersistSession(threadId);
}

// ── 更新 Thread 首篇訊息 ─────────────────────────────────────
async function updateThreadPanel(session, payload) {
  if (!session.starterMessage) return;
  await session.starterMessage.edit(payload).catch(() => {});
}

// ── 選怪 ─────────────────────────────────────────────────────
// 按 zone 順序（beginner→normal→mid→hard→elite）+ 同 zone 內 HP 低到高（boss 排後）
// 第 floor 層就取排序後第 floor 隻，每隻只打一次
const TOWER_ZONE_ORDER = ["beginner", "normal", "mid", "hard", "elite"];

let _cachedMonsterList = null; // 啟動後快取一次，避免每層都查 DB

async function buildTowerMonsterList() {
  const sc  = serviceContext;
  const all = await sc.monsterService.listMonsters({ includeDisabled: false }).catch(() => []);
  return [...all].sort((a, b) => {
    const za = TOWER_ZONE_ORDER.indexOf(a.zone || "normal");
    const zb = TOWER_ZONE_ORDER.indexOf(b.zone || "normal");
    if (za !== zb) return za - zb;
    // 同 zone：非 boss 先，再按 HP 低到高
    if (!!a.isBoss !== !!b.isBoss) return a.isBoss ? 1 : -1;
    return (a.maxHp || 0) - (b.maxHp || 0);
  });
}

async function pickFloorMonster(floor) {
  if (!_cachedMonsterList) {
    _cachedMonsterList = await buildTowerMonsterList();
  }
  const idx = floor - 1; // floor 1 = index 0
  return _cachedMonsterList[idx] || null;
}

// ── 收集全隊 party 光環 effects ──────────────────────────────
// 掃全員 equipped 的 target=party effects（與怪物區邏輯相同）
function buildTowerPartyEffects(members) {
  const partyEffects = [];
  for (const m of members) {
    if (!m.equipped || m.currentHp <= 0) continue;
    const context = { equipped: m.equipped, inventory: m.inventory || [] };
    const refs = collectEquipmentEffects(m.equipped, null, context);
    for (const r of refs) {
      if (r && r.target === "party" && isEffectConditionMet(r, context)) {
        partyEffects.push({ ...r, sourceName: m.name });
      }
    }
  }
  return partyEffects;
}

// ── 單層戰鬥結算（全職業完整邏輯） ──────────────────────────
// 存活隊員依序各自對同一隻怪跑 runCombatLoop，共享怪物殘血
// 每人打完把殘血帶給下一個人；全員陣亡或怪物死亡即結束
async function fightFloor(session, monster, scaledHp, scaledAtk) {
  const floor  = session.currentFloor;
  const bonus  = getCumulativePartyBonus(floor);

  // 怪物 calc 格式（runCombatLoop 需要 mCalc）
  // 全部從 monster.calc 讀取（effectiveCalc 已計算完整屬性）
  const calc = monster.calc || {};
  const mCalc = {
    atk:          scaledAtk,
    def:          calc.def          ?? monster.def ?? 0,
    agi:          calc.agi          ?? monster.agi ?? 1,
    maxHp:        scaledHp,
    dodge:        calc.dodge        ?? 0,
    hit:          calc.hit          ?? 80,
    defIgnorePct: calc.defIgnorePct ?? 0,
    critRate:     calc.critRate     ?? 0,
    comboChance:  calc.comboChance  ?? 0,
    finalDamageMultiplier: 1,
  };

  const aliveMembers = () => session.members.filter((m) => m.currentHp > 0);
  if (aliveMembers().length === 0)
    return { survived: false, memberLogs: [], totalRounds: 0, monsterKilled: false, monsterHpFinal: scaledHp };

  const partyEffects = buildTowerPartyEffects(session.members);
  let   monsterHp    = scaledHp;
  const memberLogs   = []; // 每位成員的 roundLogs
  let   totalRounds  = 0;

  for (const m of session.members) {
    if (m.currentHp <= 0 || monsterHp <= 0) continue;

    // 套用隊伍 atkPct 到個人 stats snapshot
    const effStats = {
      ...m.stats,
      atk: Math.round((m.stats.atk || 10) * (1 + bonus.atkPct / 100)),
      maxHp: m.maxHp, // 使用本層計算過的 maxHp
    };

    // options 用外部物件存放，讓 combatLoop 的 mutation 可以被讀回
    const combatOptions = {
      startMonsterHp:    monsterHp,
      playerName:        m.name,
      equipped:          m.equipped,
      inventory:         m.inventory  || [],
      playerActiveEffects: Array.isArray(m.activeEffects) ? [...m.activeEffects] : [],
      partyEffects,
      monsterEquipped:   monster.equipment || {},
      monsterIsBoss:     Boolean(monster.isBoss),
    };

    const result = runCombatLoop(
      effStats,
      mCalc,
      monster.name,
      scaledHp,
      MAX_ROUNDS_PER_MEMBER,
      combatOptions
    );

    monsterHp   = result.finalMonsterHp;
    m.currentHp = Math.max(0, Math.round(result.finalPlayerHp));
    // DOT 狀態不跨層，每層結束後清除戰鬥中產生的臨時效果
    totalRounds += (result.roundLogs?.length || 0);
    memberLogs.push({ name: m.name, logs: result.roundLogs || [], outcome: result.outcome });

    if (monsterHp <= 0) break;
  }

  const killed   = monsterHp <= 0;
  const survived = aliveMembers().length > 0;
  return { survived, memberLogs, totalRounds, monsterKilled: killed, monsterHpFinal: monsterHp };
}

// ── 攻略單層（隊長每次按按鈕觸發一層） ──────────────────────
async function processNextFloor(session) {
  const floor = session.clearedFloor + 1;
  session.currentFloor = floor;
  session.state = "fighting";

  // 區段升級時 maxHp 提升，差額直接補血（不超過新上限）
  const bonus = getCumulativePartyBonus(floor);
  for (const m of session.members) {
    const newMax = Math.round((m.stats.maxHp || 100) * (1 + bonus.hpPct / 100));
    if (newMax > m.maxHp) {
      m.currentHp = Math.min(newMax, m.currentHp + (newMax - m.maxHp));
      m.maxHp = newMax;
    }
  }

  // 顯示「結算中」（按鈕 disable）
  await updateThreadPanel(session, createTowerThreadBattleMessage(session));

  const monster = await pickFloorMonster(floor);
  if (!monster) {
    session.failReason = `第 ${floor} 層找不到合適怪物，攻塔中斷。`;
    return finishTower(session);
  }
  session.currentMonster = { name: monster.name, maxHp: 0, currentHp: 0 };

  const scaledHp  = scaleTowerMonsterHp(monster.calc?.maxHp || monster.maxHp || 200, floor);
  const scaledAtk = scaleTowerMonsterAtk(monster.calc?.atk  || 20,  floor);

  const fightResult = await fightFloor(session, monster, scaledHp, scaledAtk);
  session.currentMonster = null;

  // 戰鬥結果存入 session，供面板顯示
  session.lastFloorResult = {
    floor,
    monsterName:   monster.name,
    scaledHp,
    memberLogs:    fightResult.memberLogs,
    totalRounds:   fightResult.totalRounds,
    monsterKilled: fightResult.monsterKilled,
    survived:      fightResult.survived,
    monsterHpFinal: fightResult.monsterHpFinal,
  };

  if (!fightResult.monsterKilled || !fightResult.survived) {
    session.failReason = !fightResult.monsterKilled
      ? `第 ${floor} 層共 ${fightResult.totalRounds} 回合仍未擊敗 ${monster.name}，攻塔終止。`
      : `第 ${floor} 層通關後全員陣亡。`;
    await persistSession(session);
    return finishTower(session);
  }

  session.clearedFloor = floor;

  // 每層通關後嘗試掉落怪物卡
  awardFloorCardDrops(session, monster).catch(() => {});

  if (session.clearedFloor >= TOWER_TOTAL_FLOORS) {
    await persistSession(session);
    return finishTower(session);
  }

  session.state = "ready_to_fight";
  await persistSession(session);
  await updateThreadPanel(session, createTowerThreadBattleMessage(session));
}

// ── 攻塔結束（結算） ─────────────────────────────────────────
async function finishTower(session) {
  session.state = session.clearedFloor >= TOWER_TOTAL_FLOORS ? "done" : "failed";
  const reward = calcTowerReward(session.clearedFloor);
  await settleTowerSession(session, reward);
  await updateThreadPanel(session, createTowerThreadResultMessage(session, reward));

  setTimeout(async () => {
    const t = session.thread;
    disbandSession(session.threadId);
    if (t?.delete) await t.delete("攻塔結束自動清除").catch(() => {});
  }, 5 * 60 * 1000);
}

// ── 每層怪物卡掉落（在 processNextFloor 通關後呼叫） ─────────
async function awardFloorCardDrops(session, monster) {
  if (!monster || session.members.length === 0) return null;
  const sc = serviceContext;
  const pool = Array.isArray(monster.drops) ? [...monster.drops] : [];
  const cardItemId = monster?.equipment?.special_1?.itemId || monster?.equipment?.special_1?.id || null;
  if (cardItemId) {
    const card = await sc.itemRepository.findById(cardItemId).catch(() => null);
    if (card) {
      const existIdx = pool.findIndex((d) => d?.itemId === cardItemId);
      if (existIdx >= 0) pool[existIdx] = { ...pool[existIdx], chance: 1 };
      else pool.push({ itemId: card.id, chance: 1, source: "monster_card" });
    }
  }
  if (pool.length === 0) return null;

  const luckyMember = session.members[Math.floor(Math.random() * session.members.length)];
  const droppedItems = [];
  for (const drop of pool) {
    const item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
    if (!item) continue;
    const finalChance = Math.min(100, Math.max(0, Number(drop.chance)));
    if (Math.random() * 100 < finalChance) {
      const equipStats = item.equipStats ? { ...item.equipStats } : {};
      droppedItems.push({
        uuid: require("crypto").randomUUID(),
        itemId: item.id, itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: item.useEffects || [], passiveEffects: item.passiveEffects || [],
        procEffects: item.procEffects || [], combatEffects: item.combatEffects || [],
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null, equipStats,
        weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
        atkStat: item.atkStat || null, tier: item.tier || null,
        monsterCardSkill: item.monsterCardSkill || null,
        enhanceLevel: 0, source: "tower_drop", sourceRef: monster.name,
        purchasedAt: new Date().toISOString(),
      });
    }
  }
  if (droppedItems.length === 0) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const latestProg = await sc.progressRepository.findByPlayerId(luckyMember.discordId).catch(() => null);
    if (!latestProg) break;
    const next = { ...latestProg, inventory: [...(latestProg.inventory || []), ...droppedItems], updatedAt: new Date().toISOString() };
    try {
      if (typeof sc.progressRepository.saveIfUnchanged === "function") {
        const ok = await sc.progressRepository.saveIfUnchanged(next, latestProg.updatedAt);
        if (ok) return { name: luckyMember.name, items: droppedItems.map((i) => i.itemName) };
      } else {
        await sc.progressRepository.save(next);
        return { name: luckyMember.name, items: droppedItems.map((i) => i.itemName) };
      }
    } catch (_) {}
    if (attempt < 2) await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
  }
  return null;
}

// ── 結算：發獎 + 更新個人紀錄 ───────────────────────────────
async function settleTowerSession(session, reward) {
  const sc = serviceContext;
  const clearBuff = getTowerClearBuff(session.clearedFloor);

  for (const m of session.members) {
    try {
      const prog = await sc.progressRepository.findByPlayerId(m.discordId).catch(() => null);
      if (!prog) continue;
      const prevBest = prog.towerRecord?.bestFloor || 0;
      m.towerRecord = { ...(m.towerRecord || {}), prevBest };
      const newBest = Math.max(prevBest, session.clearedFloor);
      const isNewRecord = newBest > prevBest;
      const partySnapshot = session.members.map((p) => ({ discordId: p.discordId, name: p.name }));

      // 記錄本次挑戰時間（用於每小時次數限制）
      const now = Date.now();
      const recentRuns = Array.isArray(prog.towerRecord?.recentRuns) ? prog.towerRecord.recentRuns : [];
      const pruned = recentRuns.filter((t) => now - t < TOWER_HOURLY_WINDOW_MS);
      pruned.push(now);

      prog.towerRecord = {
        bestFloor: newBest,
        bestAt: isNewRecord
          ? new Date().toISOString()
          : (prog.towerRecord?.bestAt || new Date().toISOString()),
        totalRuns: (prog.towerRecord?.totalRuns || 0) + 1,
        bestParty: isNewRecord ? partySnapshot : (prog.towerRecord?.bestParty || partySnapshot),
        recentRuns: pruned,
      };
      m.towerRecord = prog.towerRecord;

      // 發放過關 Buff（刷新模式，condition: zone=monster）
      if (clearBuff) {
        const effectsToApply = clearBuff.effects.map((e) => ({
          ...e,
          duration: { mode: "seconds", value: clearBuff.durationSec },
          stackMode: "refresh",
          condition: { zone: ["monster"] },
        }));
        prog.activeEffects = applyEffectInstances(
          prog.activeEffects || [],
          effectsToApply,
          { source: "tower_buff", sourceType: "tower_buff" },
        );
      }

      await sc.progressRepository.save(prog).catch(() => {});

      if (reward.gold > 0) {
        await sc.rewardService.grantCurrency({
          discordId: m.discordId, displayName: m.name,
          currencyType: "gold", amount: reward.gold,
          source: CURRENCY_SOURCES.TOWER_REWARD, operator: "tower:clear",
        }).catch(() => {});
      }
      if (reward.exp > 0) {
        await sc.progressService.grantExp({
          discordId: m.discordId, displayName: m.name,
          amount: reward.exp, source: EXP_SOURCES.TOWER_REWARD_EXP,
        }).catch(() => {});
      }

      // DM 通知
      try {
        const client = getBotClient();
        const user   = await client.users.fetch(m.discordId).catch(() => null);
        if (user) {
          const isFull    = session.clearedFloor >= TOWER_TOTAL_FLOORS;
          const isNewRec  = session.clearedFloor > (m.towerRecord?.prevBest || 0);
          const rewardLines = [
            reward.gold > 0 ? `💰 金幣 +${reward.gold}` : null,
            reward.exp  > 0 ? `✨ EXP +${reward.exp}`   : null,
            reward.bonusMsg  || null,
          ].filter(Boolean).join("\n");

          const buffLine = clearBuff
            ? `⚡ **${clearBuff.label}** 已啟動（${clearBuff.durationSec >= 3600 ? "1 小時" : "30 分鐘"}，限怪物區）`
            : null;

          const dmLines = [
            isFull
              ? `🎉 **恭喜！組隊攻塔全層通關！**`
              : `🗼 **組隊攻塔結束 ― 第 ${session.clearedFloor} 層**`,
            session.failReason ? `❌ ${session.failReason}` : null,
            "",
            isNewRec ? `🆕 **個人新紀錄！** 最高層：${session.clearedFloor} 層` : `個人最高：${m.towerRecord?.bestFloor || session.clearedFloor} 層`,
            "",
            rewardLines ? `**── 獎勵 ──**\n${rewardLines}` : null,
            buffLine,
          ].filter((l) => l !== null).join("\n");

          await user.send({ content: dmLines }).catch(() => {});
        }
      } catch (_) {}
    } catch (_) {}
  }
}

// ── 取頻道 ───────────────────────────────────────────────────
async function getTowerForumChannel() {
  const client = getBotClient();
  if (!client?.isReady()) return null;
  const id = config.discord.towerForumChannelId;
  if (!id) return null;
  return client.channels.fetch(id).catch(() => null);
}

// ── 工具 ─────────────────────────────────────────────────────
function getDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
}

function findSessionByStarter(messageId) {
  if (!messageId) return null;
  for (const s of activeSessions.values()) {
    if (s.starterMessage?.id === messageId) return s;
  }
  return null;
}

// ── Handlers ─────────────────────────────────────────────────

async function handleOpenLobby(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;

  if (playerThreadMap.has(discordId)) {
    const tid = playerThreadMap.get(discordId);
    const rid = activeSessions.get(tid)?.roomId || tid;
    await interaction.editReply({ content: `⚠️ 你已有進行中的隊伍（\`${rid}\`），請先解散或等攻塔結束。` });
    return;
  }

  const pData = await loadMemberData(discordId);
  if (!pData) {
    await interaction.editReply({ content: "❌ 找不到玩家資料，請先建立角色。" });
    return;
  }
  if (pData.level < TOWER_MIN_LEVEL) {
    await interaction.editReply({ content: `❌ 需要達到 **${TOWER_MIN_LEVEL} 等**才能組隊攻塔（目前 ${pData.level} 等）。` });
    return;
  }
  const limitCheck = await checkHourlyLimit(discordId);
  if (!limitCheck.ok) {
    await interaction.editReply({ content: `❌ ${limitCheck.reason}` });
    return;
  }

  const forum = await getTowerForumChannel();
  if (!forum?.threads?.create) {
    await interaction.editReply({ content: "❌ 找不到組隊論壇頻道，請通知管理員確認設定。" });
    return;
  }

  const name   = getDisplayName(interaction);
  const roomId = genRoomId();
  const session = {
    roomId, threadId: null, thread: null, starterMessage: null,
    leaderId: discordId,
    state: "lobby",
    members: [],
    currentFloor: 0, clearedFloor: 0,
    currentMonster: null,
    lastFloorLog: [],
    failReason: null, lobbyTimer: null,
  };

  session.members.push({
    discordId, name, level: pData.level,
    stats: pData.stats,          // 快照（不再更新）
    equipped: pData.equipped,
    inventory: pData.inventory,
    activeEffects: pData.activeEffects,
    currentHp: 0, maxHp: 0,
    towerRecord: pData.towerRecord,
    job: pData.job,
  });

  const thread = await forum.threads.create({
    name: `[攻塔] ${name} 的隊伍 [${roomId}]`,
    autoArchiveDuration: 60,
    reason: "Tower party lobby",
    message: createTowerThreadLobbyMessage(session),
  }).catch(() => null);

  if (!thread) {
    await interaction.editReply({ content: "❌ 建立隊伍貼文失敗，請稍後再試。" });
    return;
  }

  session.thread   = thread;
  session.threadId = thread.id;
  session.starterMessage = await thread.fetchStarterMessage().catch(() => null);

  activeSessions.set(thread.id, session);
  playerThreadMap.set(discordId, thread.id);
  setTowerPresence([discordId], true);
  await persistSession(session);

  session.lobbyTimer = setTimeout(async () => {
    const s = activeSessions.get(thread.id);
    if (s?.state === "lobby") {
      disbandSession(thread.id);
      await thread.delete("等待逾時自動解散").catch(() => {});
    }
  }, TOWER_LOBBY_TIMEOUT_MS);

  await interaction.editReply({ content: `✅ 隊伍已建立！前往論壇邀請隊友：<#${thread.id}>` });
  await refreshHallPanel(interaction.message).catch(() => {});
}

async function handleJoin(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;

  if (playerThreadMap.has(discordId)) {
    const rid = activeSessions.get(playerThreadMap.get(discordId))?.roomId || "";
    await interaction.editReply({ content: `⚠️ 你已在房間 \`${rid}\` 中。` });
    return;
  }

  const session = findSessionByStarter(interaction.message?.id);
  if (!session) {
    await interaction.editReply({ content: "❌ 找不到對應隊伍，可能已解散。" });
    return;
  }
  if (session.state !== "lobby") {
    await interaction.editReply({ content: "❌ 攻塔已開始，無法加入。" });
    return;
  }
  if (session.members.length >= TOWER_MAX_MEMBERS) {
    await interaction.editReply({ content: `❌ 隊伍已滿（最多 ${TOWER_MAX_MEMBERS} 人）。` });
    return;
  }

  const pData = await loadMemberData(discordId);
  if (!pData) {
    await interaction.editReply({ content: "❌ 找不到你的玩家資料。" });
    return;
  }
  if (pData.level < TOWER_MIN_LEVEL) {
    await interaction.editReply({ content: `❌ 需要達到 **${TOWER_MIN_LEVEL} 等**才能加入攻塔隊伍（目前 ${pData.level} 等）。` });
    return;
  }
  const limitCheck = await checkHourlyLimit(discordId);
  if (!limitCheck.ok) {
    await interaction.editReply({ content: `❌ ${limitCheck.reason}` });
    return;
  }

  session.members.push({
    discordId, name: getDisplayName(interaction),
    level: pData.level, stats: pData.stats,
    equipped: pData.equipped, inventory: pData.inventory, activeEffects: pData.activeEffects,
    currentHp: 0, maxHp: 0, towerRecord: pData.towerRecord,
    job: pData.job,
  });
  playerThreadMap.set(discordId, session.threadId);
  setTowerPresence([discordId], true);
  await persistSession(session);

  await interaction.editReply({ content: `✅ 已加入隊伍 \`${session.roomId}\`！` });
  await updateThreadPanel(session, createTowerThreadLobbyMessage(session));
}

async function handleLeave(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const session   = activeSessions.get(playerThreadMap.get(discordId));

  if (!session) {
    await interaction.editReply({ content: "⚠️ 你不在任何隊伍中。" });
    return;
  }
  if (session.state !== "lobby") {
    await interaction.editReply({ content: "❌ 攻塔進行中，無法離開。" });
    return;
  }
  if (session.leaderId === discordId) {
    await interaction.editReply({ content: "⚠️ 你是隊長，請點 **解散** 而非離開。" });
    return;
  }

  session.members = session.members.filter((m) => m.discordId !== discordId);
  playerThreadMap.delete(discordId);
  setTowerPresence([discordId], false);
  await persistSession(session);
  await interaction.editReply({ content: "✅ 已離開隊伍。" });
  await updateThreadPanel(session, createTowerThreadLobbyMessage(session));
}

async function handleDisband(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const threadId  = playerThreadMap.get(discordId);
  const session   = threadId ? activeSessions.get(threadId) : null;

  if (!session) {
    await interaction.editReply({ content: "⚠️ 找不到你的隊伍。" });
    return;
  }
  if (session.leaderId !== discordId) {
    await interaction.editReply({ content: "❌ 只有隊長能解散。" });
    return;
  }
  if (session.state === "fighting") {
    await interaction.editReply({ content: "❌ 正在結算中，請稍候。" });
    return;
  }

  const thread = session.thread;
  disbandSession(threadId);
  await interaction.editReply({ content: `✅ 隊伍 \`${session.roomId}\` 已解散。` });
  if (thread) {
    await thread.delete("隊長解散隊伍").catch(() => {});
  }
}

// 開始：快照全員裝備，初始化 HP，切換到 ready_to_fight
async function handleStart(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const threadId  = playerThreadMap.get(discordId);
  const session   = threadId ? activeSessions.get(threadId) : null;

  if (!session) {
    await interaction.editReply({ content: "❌ 找不到你的隊伍。" });
    return;
  }
  if (session.leaderId !== discordId) {
    await interaction.editReply({ content: "❌ 只有隊長能開始。" });
    return;
  }
  if (session.state !== "lobby") {
    await interaction.editReply({ content: "⚠️ 攻塔已開始或結束。" });
    return;
  }

  if (session.lobbyTimer) { clearTimeout(session.lobbyTimer); session.lobbyTimer = null; }

  // ── 快照鎖定：此刻讀到的 stats 是最終戰鬥數值，之後不再讀 DB ──
  // 初始化每位成員 HP（依第 1 層區段 Buff 加成）
  const bonus1 = getCumulativePartyBonus(1);
  for (const m of session.members) {
    m.maxHp     = Math.round((m.stats.maxHp || 100) * (1 + bonus1.hpPct / 100));
    m.currentHp = m.maxHp;
  }

  session.state        = "ready_to_fight";
  session.clearedFloor = 0;
  await persistSession(session);

  await interaction.editReply({
    content: `✅ 攻塔開始！${session.members.length} 位冒險者的裝備已鎖定。隊長按按鈕攻略每一層！`,
  });
  await updateThreadPanel(session, createTowerThreadBattleMessage(session));
}

// 隊長按「攻略下一層」
async function handleFightNext(interaction) {
  await interaction.deferUpdate();
  const discordId = interaction.user.id;
  const session   = findSessionByStarter(interaction.message?.id);

  if (!session) {
    await interaction.followUp({ content: "❌ 找不到對應隊伍。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (session.leaderId !== discordId) {
    await interaction.followUp({ content: "❌ 只有隊長能操作攻略。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (session.state !== "ready_to_fight") {
    // 已在 fighting（防重複按）或已結束
    return;
  }

  await processNextFloor(session).catch((err) => {
    console.error("[Tower] processNextFloor error:", err);
    session.state = "failed";
    session.failReason = "系統錯誤，攻塔中斷。";
    finishTower(session).catch(() => {});
  });
}

async function handleRefresh(interaction) {
  const session = findSessionByStarter(interaction.message?.id);
  if (!session) {
    await interaction.update({ embeds: [{ title: "隊伍已解散", color: 0x95a5a6 }], components: [] });
    return;
  }
  const payload = session.state === "lobby"
    ? createTowerThreadLobbyMessage(session)
    : createTowerThreadBattleMessage(session);
  await interaction.update(payload);
}

async function handleRanking(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ranking = await serviceContext.progressRepository.findTopByTowerRecord(10).catch(() => []);
  await interaction.editReply(createTowerRankingMessage(ranking));
}

// ── 常駐大廳面板 ─────────────────────────────────────────────
async function publishTowerHallPanel(interaction) {
  const ranking = await serviceContext.progressRepository.findTopByTowerRecord(5).catch(() => []);
  await interaction.reply(createTowerHallMessage(ranking));
}

async function refreshHallPanel(hallMessage) {
  if (!hallMessage) return;
  const ranking = await serviceContext.progressRepository.findTopByTowerRecord(5).catch(() => []);
  await hallMessage.edit(createTowerHallMessage(ranking)).catch(() => {});
}

// ── Bot 重啟後從 DB 還原進行中的 session ──────────────────────
async function restoreTowerSessions() {
  const client = getBotClient();
  if (!client?.isReady()) return;

  let saved = [];
  try {
    saved = await serviceContext.towerSessionRepository.findAll();
  } catch (e) {
    console.error("[Tower] restoreTowerSessions DB error:", e);
    return;
  }

  let restored = 0;
  for (const data of saved) {
    // 已結束的清掉
    if (data.state === "done" || data.state === "failed") {
      await serviceContext.towerSessionRepository.delete(data.threadId).catch(() => {});
      continue;
    }

    try {
      const thread = await client.channels.fetch(data.threadId).catch(() => null);
      if (!thread) {
        await serviceContext.towerSessionRepository.delete(data.threadId).catch(() => {});
        continue;
      }

      // Forum thread 的 starter message 用儲存的 ID fetch，比 fetchStarterMessage() 更可靠
      let starterMessage = null;
      if (data.starterMessageId) {
        starterMessage = await thread.messages.fetch(data.starterMessageId).catch(() => null);
      }
      if (!starterMessage) {
        starterMessage = await thread.fetchStarterMessage().catch(() => null);
      }

      const session = {
        roomId:          data.roomId,
        threadId:        data.threadId,
        thread,
        starterMessage,
        leaderId:        data.leaderId,
        state:           data.state === "fighting" ? "ready_to_fight" : data.state,
        members:         data.members || [],
        currentFloor:    data.currentFloor || 0,
        clearedFloor:    data.clearedFloor || 0,
        currentMonster:  data.currentMonster || null,
        lastFloorResult: data.lastFloorResult || null,
        failReason:      data.failReason || null,
        lobbyTimer:      null,
      };

      activeSessions.set(session.threadId, session);
      for (const m of session.members) {
        playerThreadMap.set(m.discordId, session.threadId);
        setTowerPresence([m.discordId], true);
      }

      // 在 thread 補發還原通知
      if (starterMessage) {
        const payload = session.state === "lobby"
          ? createTowerThreadLobbyMessage(session)
          : createTowerThreadBattleMessage(session);
        await starterMessage.edit(payload).catch(() => {});
      }
      await thread.send({ content: "🔄 **伺服器已重啟，隊伍狀態已還原。** 隊長可繼續按攻略按鈕。" }).catch(() => {});

      restored++;
    } catch (e) {
      console.error(`[Tower] restore session ${data.threadId} error:`, e);
    }
  }

  if (restored > 0) console.log(`[Tower] 還原 ${restored} 個進行中的隊伍。`);
}

// ── 路由 ─────────────────────────────────────────────────────
function isTowerButton(customId) {
  return typeof customId === "string" && customId.startsWith("tower:");
}

async function handleTowerButton(interaction) {
  switch (interaction.customId) {
  case TOWER_IDS.openLobby:  return handleOpenLobby(interaction);
  case TOWER_IDS.join:       return handleJoin(interaction);
  case TOWER_IDS.leave:      return handleLeave(interaction);
  case TOWER_IDS.start:      return handleStart(interaction);
  case TOWER_IDS.disband:    return handleDisband(interaction);
  case TOWER_IDS.fightNext:  return handleFightNext(interaction);
  case TOWER_IDS.refresh:    return handleRefresh(interaction);
  case TOWER_IDS.ranking:    return handleRanking(interaction);
  }
}

module.exports = {
  isTowerButton,
  handleTowerButton,
  publishTowerHallPanel,
  restoreTowerSessions,
};
