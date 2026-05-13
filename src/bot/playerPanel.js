const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const { BUTTON_IDS, createPlayerPanelMessage } = require("./playerPanelView");
const { expToNextLevel, MAX_LEVEL } = require("../shared/progression");
const config = require("../config");
const { createCode } = require("./bindingStore");
const { renderEquipmentCard, LEFT_SLOTS: EQ_LEFT_SLOTS, RIGHT_SLOTS: EQ_RIGHT_SLOTS, COL3_SLOTS: EQ_COL3_SLOTS, SLOT_LABELS: EQ_SLOT_LABELS } = require("./equipmentCardRenderer");
const { calcPlayerStats } = require("../shared/combatStats");
const { EFFECT_NAME_ZH } = require("../shared/effectDisplayNames");
const { isEffectConditionMet, mergeEquippedFromLibrary } = require("../shared/effectEngine");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../shared/sources");
const { MAX_ENHANCE_LEVEL, getEnhanceCost } = require("../shared/enhanceConfig");

const ACTIVE_REPLY_BY_USER = new Map();
const ENHANCE_MODE_NORMAL = "normal";
const ENHANCE_MODE_GAMBLE = "gamble";

function normalizeEnhanceMode(mode) {
  return String(mode || ENHANCE_MODE_NORMAL).toLowerCase() === ENHANCE_MODE_GAMBLE
    ? ENHANCE_MODE_GAMBLE
    : ENHANCE_MODE_NORMAL;
}

function getEnhanceModeLabel(mode) {
  return normalizeEnhanceMode(mode) === ENHANCE_MODE_GAMBLE
    ? "🎰 賭鬼強化（消耗減半，失敗有 50% 機率爆裝）"
    : "🛡️ 一般強化（正常消耗）";
}

function getEnhanceModeToggleLabel(mode) {
  return normalizeEnhanceMode(mode) === ENHANCE_MODE_GAMBLE
    ? "一般強化"
    : "賭鬼強化";
}

function getServiceContext() {
  return require("./runtimeContext").serviceContext;
}

function formatTransactions(rows) {
  if (rows.length === 0) {
    return "目前沒有交易紀錄。";
  }

  return rows
    .map((row) => {
      const sign = row.direction === "debit" ? "-" : "+";
      return `${row.currencyType} ${sign}${Math.abs(row.amount)} | ${row.source} | ${row.balanceAfter}`;
    })
    .join("\n");
}

/** editReply wrapper：忽略 10008 Unknown Message（互動已過期或訊息被刪）*/
async function safeEditReply(interaction, payload) {
  try {
    return await interaction.editReply(payload);
  } catch (err) {
    if (err?.code === 10008) return; // Unknown Message — 忽略
    throw err;
  }
}

/** 切換面板前先關掉前一個個人面板回覆 */
async function clearActiveReply(interaction) {
  const userId = interaction?.user?.id;
  if (!userId) return;
  const previous = ACTIVE_REPLY_BY_USER.get(userId);
  if (!previous) return;
  try {
    await previous.webhook.deleteMessage(previous.messageId);
  } catch (_) {}
  ACTIVE_REPLY_BY_USER.delete(userId);
}

async function rememberActiveReply(interaction) {
  const userId = interaction?.user?.id;
  if (!userId) return;
  try {
    const msg = await interaction.fetchReply();
    ACTIVE_REPLY_BY_USER.set(userId, {
      webhook: interaction.webhook,
      messageId: msg.id
    });
  } catch (_) {}
}

async function replyAndAutoDelete(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function replyPlayerBlocked(interaction) {
  await replyAndAutoDelete(interaction, "❌ 你目前不在可用玩家白名單中。");
}

function formatStreamMembershipRules() {
  const rules = config.streamMembership || {};
  const youtubeTiers = rules.youtubeTiers || {};
  const twitchTiers = rules.twitchTiers || {};
  const youtubeLine = Object.entries(youtubeTiers).map(([tier, name]) => `${name}-${tier}`).join("、") || "未設定";
  const twitchLine = Object.entries(twitchTiers).map(([tier, tierName]) => `位階${tier}=${tierName}`).join("、") || "未設定";
  const noMembership = rules.noMembershipPolicy === "unchanged" ? "不變" : String(rules.noMembershipPolicy || "不變");
  return [
    `管理員 DCID：${(rules.adminUserIds || []).join("、") || "未設定"}`,
    `YouTube：${rules.youtubeChannel || "未設定"}`,
    `Twitch：${rules.twitchChannel || "未設定"}`,
    `YouTube 會員 → ${youtubeLine}`,
    `Twitch 訂閱 → ${twitchLine}`,
    `沒會員 → ${noMembership}`
  ];
}

function formatBindingSnapshot(binding) {
  const platformLabel = binding.platform === "youtube" ? "YouTube" : binding.platform === "twitch" ? "Twitch" : binding.platform;
  const linkedAt = binding.linkedAt ? `（綁定：${new Date(binding.linkedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}）` : "";
  const tierAtLink = binding.playerTierAtLink ? `，綁定時位階：${binding.playerTierAtLink}` : "";
  const roleCount = Array.isArray(binding.memberRoleIdsAtLink) && binding.memberRoleIdsAtLink.length > 0
    ? `，綁定時身分組：${binding.memberRoleIdsAtLink.length} 個`
    : "";
  const displayName = binding.displayName ? `，顯示名稱：${binding.displayName}` : "";
  return `• ${platformLabel}：\`${binding.platformUserId}\`${displayName}${tierAtLink}${roleCount}${linkedAt}`;
}

async function getBindingRows(interaction) {
  const serviceContext = getServiceContext();
  const player = await serviceContext.playerRepository.findByDiscordId(interaction.user.id);
  const bindingRepo = serviceContext.streamAccountBindingRepository;
  const bindings = bindingRepo ? await bindingRepo.listByDiscordId(interaction.user.id).catch(() => []) : [];
  const bindingLines = bindings.map((binding) => formatBindingSnapshot(binding));
  return { player, bindings, bindingLines };
}


async function handleProfile(interaction) {
  const serviceContext = getServiceContext();
  let result = null;
  let fallbackUsed = false;
  try {
    result = await serviceContext.playerService.getProfile(interaction.user.id, interaction.user.username);
  } catch (err) {
    fallbackUsed = true;
    console.warn("[PlayerPanel] getProfile failed, falling back to direct repositories:", err?.message || err);
    const [player, wallet, progress] = await Promise.all([
      serviceContext.playerRepository.findByDiscordId(interaction.user.id).catch(() => null),
      serviceContext.walletRepository.findByPlayerId(interaction.user.id).catch(() => null),
      serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null)
    ]);
    result = { player, wallet, progress };
  }

  const freshProgress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id).catch(() => null);
  const p = freshProgress || result?.progress || {};
  const attrs = p.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const tierLine = p.playerTier ? `\n玄家等級：**${p.playerTier}級**` : "";
  const playerLevel = Number(p.level || 1);
  const playerExp = Number(p.exp || 0);
  const isMaxLevel = playerLevel >= MAX_LEVEL;
  const expNeeded = isMaxLevel ? 0 : expToNextLevel(playerLevel);
  const expLine = isMaxLevel
    ? `等級：Base ${playerLevel} ⭐ 已達最高等級${tierLine}`
    : `等級：Base ${playerLevel} (EXP: ${playerExp} / ${expNeeded}，還差 ${Math.max(0, expNeeded - playerExp)})${tierLine}`;

  // ── 計算戰鬥能力（使用 shared/combatStats 確保與戰鬥邏輯一致）──
  // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
  let equipped = p.equipment || {};
  try {
    equipped = await mergeEquippedFromLibrary(equipped, serviceContext.itemRepository);
  } catch (err) {
    fallbackUsed = true;
    console.warn("[PlayerPanel] mergeEquippedFromLibrary failed, using snapshot equipment:", err?.message || err);
  }
  const cs = calcPlayerStats(attrs, equipped, p.activeEffects || [], p.inventory || []);
  const calcHp    = Math.ceil(cs.maxHp);
  const calcAtk   = Math.ceil(cs.atk);
  const calcDef   = Math.ceil(cs.def);
  const calcCrit  = Math.ceil(cs.crit);
  const calcCombo = Math.ceil(cs.combo);
  const calcDodge = Math.ceil(cs.dodge || 0);
  const calcBlock = Math.ceil(cs.blockChance || 0);

  // ── 裝備屬性加成 ──
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in bonus) bonus[k] += (v || 0);
    }
  }
  const fmt = (base, key) => bonus[key] > 0 ? `${base} (+${bonus[key]})` : `${base}`;

  // ── 武器特效說明（由 combatStats 推斷，並結合已裝備武器描述） ──
  const wt = cs.weaponType;
  const specialEffects = [];
  if (wt === "dagger") specialEffects.push("🗡️ 匕首：連擊率 +20%");
  if (wt === "axe_2h") specialEffects.push("🪓 雙手斧：攻擊倍率 ×4");
  if (wt === "staff_1h") specialEffects.push("🪄 法杖：無視怪物 50% DEF、怪物攻擊 ×2");
  if (wt === "staff_2h") specialEffects.push("🪄 雙手法杖：無視怪物 50% DEF、怪物攻擊 ×2、倍率 ↑");
  if (wt === "mace_1h") specialEffects.push("🔨 單手槌：攻擊倍率 ×3、基礎擊暈 +20%、矮人高血再 +10%、對暈眩目標 +5%");
  if (wt === "mace_2h") specialEffects.push("🔨 雙手槌：攻擊倍率 ×4、基礎擊暈 +30%、矮人高血再 +10%、對暈眩目標 +15%");
  if (cs.isDualWield) specialEffects.push("⚔️ 雙持：可觸發副手追擊");

  // 使用 combatStats 提供的欄位顯示進一步特效
  if (cs.stunChance && cs.stunChance > 0) specialEffects.push(`💥 擊暈機率 ${cs.stunChance}%`);
  if (cs.armorBreakChance && cs.armorBreakChance > 0) specialEffects.push(`🛠️ 破防機率 ${cs.armorBreakChance}%`);
  if (cs.bypassMonsterDefPct > 0) specialEffects.push(`🪄 無視怪物 ${cs.bypassMonsterDefPct}% DEF`);
  if (cs.monsterAttackCount && cs.monsterAttackCount > 1) specialEffects.push(`⚠️ 觸發時怪物攻擊 ×${cs.monsterAttackCount}`);

  // 顯示裝備特效（優先顯示已裝備武器的說明，否則使用推斷的武器特效）
  let effectLineParts = [...specialEffects];
    try {
      const weaponItem = equipped.weapon || null;
      if (weaponItem && weaponItem.weaponEffectDescription) {
        // 放在最前面並換行顯示
        effectLineParts.unshift(`🔸 裝備特效：${weaponItem.weaponEffectDescription}`);
      }
    } catch (e) { /* ignore */ }
  const effectLine = effectLineParts.length ? "\n" + effectLineParts.join("\n") : "";
  const tierSetBonuses = cs.tierSetBonuses || { tierCounts: {} };
  const tierSetLines = [];
  const tierCounts = tierSetBonuses.tierCounts || {};
  if ((tierCounts.D || 0) >= 3) {
    const parts = ["3件：STR/INT/DEX +3"];
    if (tierCounts.D >= 5) parts.push("5件：金幣 +10%");
    if (tierCounts.D >= 7) parts.push("7件：EXP +10%");
    tierSetLines.push(`D階 ${tierCounts.D}件 - ${parts.join("、")}`);
  }
  if ((tierCounts.C || 0) >= 3) {
    const parts = ["3件：迴避 +10%"];
    if (tierCounts.C >= 5) parts.push("5件：傷害 +5%");
    if (tierCounts.C >= 7) parts.push("7件：命中 +15%");
    tierSetLines.push(`C階 ${tierCounts.C}件 - ${parts.join("、")}`);
  }
  if ((tierCounts.B || 0) >= 3) {
    const parts = ["3件：傷害 +10%"];
    if (tierCounts.B >= 5) parts.push("5件：暴擊率 +5%");
    if (tierCounts.B >= 7) parts.push("7件：暴擊傷害 +10%");
    tierSetLines.push(`B階 ${tierCounts.B}件 - ${parts.join("、")}`);
  }
  if ((tierCounts.A || 0) >= 3) {
    const parts = ["3件：最終傷害 +5%"];
    if (tierCounts.A >= 5) parts.push("5件：Boss傷害 +10%");
    if (tierCounts.A >= 7) parts.push("7件：掉落率 +10%");
    tierSetLines.push(`A階 ${tierCounts.A}件 - ${parts.join("、")}`);
  }
  const tierSetLine = tierSetLines.length ? `\n【階級套裝】\n${tierSetLines.join("\n")}` : "";

  // ── 職業區（只顯示職業名稱）──
  const jobAreaLine = `職業：${p.job || "Novice"} (Job ${p.jobLevel || 1})`;

  // ── 職業特性區（顯示職業名稱，穿對武器時顯示特性）──
  const jobEq = equipped.job_eq || null;
  let jobTraitAreaLine = "職業特性：無（未裝備職業裝）";

  if (jobEq) {
    const jobId = String(jobEq.itemId || jobEq.id || "").toLowerCase();
    const jobName = String(jobEq.itemName || jobEq.name || "").toLowerCase();
    const wt = cs.weaponType;

    const jobDisplayName = jobEq.itemName || jobEq.name || "未知職業";

    // 職業裝備加成
    const jobBonusParts = [];
    for (const eff of (jobEq.passiveEffects || [])) {
      const v = eff?.params?.value;
      if (!v) continue;
      if (eff.key === 'gold_gain_up')  jobBonusParts.push(`金幣 +${v}%`);
      if (eff.key === 'exp_gain_up')   jobBonusParts.push(`經驗 +${v}%`);
      if (eff.key === 'drop_rate_up')  jobBonusParts.push(`掉落 +${v}%`);
    }
    const jobBonusLine = jobBonusParts.length ? `\n結算加成：${jobBonusParts.join("、")}` : "";

    // 稱號裝備加成
    const titleBonusParts = [];
    const titleEq = equipped.title_eq;
    if (titleEq) {
      for (const eff of (titleEq.passiveEffects || [])) {
        const v = eff?.params?.value;
        if (!v) continue;
        if (eff.key === 'gold_gain_up')  titleBonusParts.push(`金幣 +${v}%`);
        if (eff.key === 'exp_gain_up')   titleBonusParts.push(`經驗 +${v}%`);
        if (eff.key === 'drop_rate_up')  titleBonusParts.push(`掉落 +${v}%`);
      }
    }
    const titleBonusLine = titleBonusParts.length ? `\n稱號加成：${titleBonusParts.join("、")}` : "";
    const bonusLine = jobBonusLine + titleBonusLine;

    // 從 jobSkills 讀取技能名稱與效果描述
    const jobSkills = Array.isArray(jobEq.jobSkills) ? jobEq.jobSkills : [];
    if (jobSkills.length > 0) {
      const skillLines = jobSkills.map(sk => {
        const cond = sk.condition || {};
        const condParts = [];
        if (Number.isFinite(Number(cond.ownerHpBelowPct))) condParts.push(`HP<${cond.ownerHpBelowPct}%`);
        if (Number.isFinite(Number(cond.ownerHpAbovePct))) condParts.push(`HP>${cond.ownerHpAbovePct}%`);
        const condStr = condParts.length ? `（${condParts.join("、")}）` : "";
        return `・${sk.name}${condStr}：${sk.description || ""}`;
      });
      jobTraitAreaLine = `職業技能：${jobDisplayName}\n${skillLines.join("\n")}${bonusLine}`;
    } else {
      jobTraitAreaLine = `職業技能：${jobDisplayName}${bonusLine}`;
    }
  }

  // ── 卡片效果區（顯示已裝備卡片及其效果）──
  let cardEffectLine = "";
  try {
    const specialSlots = ['special_1', 'special_2', 'special_3'];
    const lines = [];
    const active = Array.isArray(p.activeEffects) ? p.activeEffects : [];

    for (const slot of specialSlots) {
      const it = equipped[slot];
      if (!it) continue;

      const cardName = it.itemName || it.name || '';
      const skill = it.monsterCardSkill || null;

      if (!skill || !skill.name) {
        lines.push(`🎴 ${cardName}：（無效果）`);
        continue;
      }

      // 檢查該卡片的效果是否發動中
      const procKeys = skill.procEffects?.map(pe => pe.key).filter(Boolean) || [];
      const isActive = procKeys.some(k => active.some(e => e && e.key === k));
      const activeLabel = isActive ? " ⚡" : "";

      // 組合技能名稱和描述
      const skillDesc = skill.description ? `（${skill.description}）` : "";
      lines.push(`🎴 ${cardName}：${skill.name}${skillDesc}${activeLabel}`);
    }

    if (lines.length) cardEffectLine = `【已裝備卡片】\n${lines.join("\n")}`;
  } catch (e) { /* ignore */ }

  let npcBuffAreaLine = "";
  if (p.activeEffects && Array.isArray(p.activeEffects) && p.activeEffects.length > 0) {
    const toLabel = (effect) => {
      const effectName = EFFECT_NAME_ZH[effect.key] || effect.definitionName || effect.key;
      const value = Number(effect?.params?.value);
      const valueText = Number.isFinite(value) ? `(${value})` : "";
      return `${effectName}${valueText} (臨時效果)`;
    };
    const buffLabels = p.activeEffects.map(toLabel);
    npcBuffAreaLine = `【NPC Buff】\n${buffLabels.join("\n")}`;
  }

  // ── 裝備清單（只列有裝備的格子）──
  const SLOT_ICONS = {
    weapon: "⚔️", shield: "🛡️", armor: "🥋", head_top: "🪖", head_mid: "🎭",
    head_low: "😷", garment: "🧣", shoes: "👟", accessory_l: "💍", accessory_r: "💍",
    title_eq: "🏅", job_eq: "📖", special_1: "✨", special_2: "✨", special_3: "✨"
  };
  const ALL_SLOTS = [...EQ_LEFT_SLOTS, ...EQ_RIGHT_SLOTS, ...EQ_COL3_SLOTS];
  const standardParts = ALL_SLOTS
    .filter(s => !EQ_COL3_SLOTS.includes(s) && equipped[s])
    .map(s => `${SLOT_ICONS[s] || "▪️"}${equipped[s].itemName || equipped[s].name}`);
  const specialParts = EQ_COL3_SLOTS
    .filter(s => equipped[s])
    .map(s => `[${EQ_SLOT_LABELS[s]}] ${equipped[s].itemName || equipped[s].name}`);
  const equipLine = standardParts.length || specialParts.length
    ? [...standardParts, ...specialParts].join("　")
    : "（尚未裝備）";

  // ── 組合獨立區域 ──
  const cardSection = cardEffectLine ? `${cardEffectLine}\n==============\n` : "";
  const npcBuffSection = npcBuffAreaLine ? `${npcBuffAreaLine}\n==============\n` : "";

  const displayName = result?.player?.displayName || interaction.user.displayName || interaction.user.username;
  const wallet = result?.wallet || { gold: 0, diamond: 0 };

  await replyAndAutoDelete(interaction,
    `🧧 **${displayName} 的冒險者履歷**${fallbackUsed ? "（資料已降級顯示）" : ""}\n` +
    `==============\n` +
    `【職業技能】\n` +
    `${jobTraitAreaLine}\n` +
    `==============\n` +
    `${cardSection}` +
    `${npcBuffSection}` +
    `${expLine}\n` +
    `==============\n` +
    `【基本素質】\n` +
    `STR: ${fmt(attrs.str,"str")} | AGI: ${fmt(attrs.agi,"agi")} | VIT: ${fmt(attrs.vit,"vit")}\n` +
    `INT: ${fmt(attrs.int,"int")} | DEX: ${fmt(attrs.dex,"dex")} | LUK: ${fmt(attrs.luk,"luk")}\n` +
    `==============\n` +
    `【戰鬥能力】\n` +
    `❤️ HP: ${calcHp}　⚔️ ATK: ${calcAtk}　🛡️ DEF: ${calcDef}\n` +
    `🎯 CRIT: ${calcCrit}%　⚡ 連擊: ${calcCombo}%　🟢 迴避: ${calcDodge}%　🪨 格擋: ${calcBlock}%` +
    effectLine + "\n" +
    tierSetLine + (tierSetLine ? "\n" : "") +
    equipLine + "\n" +
    `==============\n` +
    `【資產】\n` +
    `💰 金幣: ${Number(wallet.gold || 0)}\n` +
    `💎 鑽石: ${Number(wallet.diamond || 0)}`
  );
}

async function handleWallet(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.walletService.getWalletByDiscordId(
    interaction.user.id,
    interaction.user.username
  );

  await replyAndAutoDelete(interaction,
    `💰 ${result.player.displayName} 的錢包\n` +
    `金幣：${result.wallet.gold}\n` +
    `鑽石：${result.wallet.diamond}`
  );
}

async function handleTransactions(interaction) {
  const serviceContext = getServiceContext();
  const result = await serviceContext.transactionService.listRecentByDiscordId(
    interaction.user.id,
    interaction.user.username,
    8
  );

  await replyAndAutoDelete(interaction, `📘 最近交易\n${formatTransactions(result.transactions)}`);
}

async function handleCheckinStatus(interaction) {
  const serviceContext = getServiceContext();
  const checkins = await serviceContext.checkinService.listRecentByDiscordId(
    interaction.user.id,
    7
  );

  const today = new Date().toISOString().slice(0, 10);
  const todayCheckin = checkins.find((c) => (c.occurredAt || "").slice(0, 10) === today);

  const statusLine = todayCheckin
    ? `✅ 今日已打卡！（${new Date(todayCheckin.occurredAt).toLocaleTimeString("zh-TW")} 獲得 ${todayCheckin.rewardDetail?.amount ?? 0} 金幣）`
    : `❌ 今日尚未打卡，在直播輸入 **!打卡** 可獲得 100 金幣！`;

  const historyLines = checkins.length
    ? checkins.map((c) => `${(c.occurredAt || "").slice(0, 10)}  +${c.rewardDetail?.amount ?? 0} 金幣`).join("\n")
    : "尚無打卡紀錄";

  await replyAndAutoDelete(interaction,
    `📅 **打卡狀態**\n${statusLine}\n\n` +
    `🗓️ **最近 7 天紀錄**\n${historyLines}`
  );
}

const TIER_SELL_PRICE = { D: 200, C: 500, B: 1000, A: 10000 };

/** 根據 itemType 產生背包 ActionRow，idx 為顯示編號（0-based） */
function buildInventoryRow(e, idx) {
  const itemType = e.itemType || "consumable";
  const prefix = ["①","②","③","④","⑤"][idx] ?? `${idx+1}.`;
  const btns = [];

  // 強化寶石不能使用（只能用於強化）
  const ENHANCE_GEM_IDS = new Set([
    '72fde92d-e33f-42fb-8d86-2e811d03f84d', // D
    '556db9e1-b084-4b22-bab5-a66c2b586184', // C
    '8fdfa7d9-f0fa-4e6a-a291-703b1e354072', // B
    'a6ae293d-52fc-4af5-8770-891ddf842e35'  // A
  ]);
  const isEnhanceGem = ENHANCE_GEM_IDS.has(e.itemId);

  if (isEnhanceGem) {
    // 強化寶石：只有販售和丟棄（寶石本身不能強化）
    // 販售按鈕會在下面的 tier 判斷加上
  } else if (itemType === "consumable") {
    // 普通消耗品：使用、丟棄
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_use:${e.uuid}`)
        .setLabel(`${prefix} 使用`)
        .setStyle(ButtonStyle.Success)
    );
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel("丟棄")
        .setStyle(ButtonStyle.Danger)
    );
  } else {
    // 其他物品：丟棄
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel(`${prefix} 丟棄`)
        .setStyle(ButtonStyle.Danger)
    );
  }
  // 有 tier 的道具顯示販售按鈕
  const sellPrice = e.tier ? TIER_SELL_PRICE[String(e.tier).toUpperCase()] : null;
  if (sellPrice != null) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell:${e.uuid}`)
        .setLabel(`售 ${sellPrice}💰`)
        .setStyle(ButtonStyle.Secondary)
    );
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell_bulk:${e.uuid}:item:0`)
        .setLabel("批量售")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (e.imageUrl) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_view:${e.uuid}`)
        .setLabel("🖼️")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return new ActionRowBuilder().addComponents(btns);
}

const EQ_SPECIAL_SLOTS = new Set(EQ_COL3_SLOTS);
const EQ_STANDARD_SLOTS = new Set([...EQ_LEFT_SLOTS, ...EQ_RIGHT_SLOTS]);
const EQ_WEAPON_LIKE_SLOTS = new Set(["weapon", "shield"]);
const EQ_SORT_ORDER = ["weapon","shield","head_top","head_mid","head_low","armor","garment","shoes","accessory_l","accessory_r","special_1","special_2","special_3"];
const EQ_SORT_ORDER_MAP = EQ_SORT_ORDER.reduce((acc, slot, idx) => ({ ...acc, [slot]: idx }), {});
const BACKPACK_MAIN_TABS = [
  { tab: "item", label: "🎮 道具" },
  { tab: "weapon", label: "⚔️ 武器" },
  { tab: "armor", label: "🛡️ 防裝" },
  { tab: "offhand", label: "🪓 副手" },
  { tab: "special", label: "✨ 特殊" },
  { tab: "card", label: "🎴 卡片" },
  { tab: "badge", label: "📖 職業" },
];
const BACKPACK_SECTION_TABS = new Set(["weapon", "armor", "offhand", "special", "badge"]);
const BACKPACK_WEAPON_SUBTABS = [
  { subTab: "all", label: "📦 全部" },
  { subTab: "melee1", label: "🗡️ 單手" },
  { subTab: "melee2", label: "🪓 雙手" },
  { subTab: "ranged", label: "🏹 遠程" },
  { subTab: "magic", label: "🪄 法系" },
];
const BACKPACK_ARMOR_SUBTABS = [
  { subTab: "all", label: "📦 全部" },
  { subTab: "head", label: "🪖 頭部" },
  { subTab: "core", label: "🥋 核心" },
  { subTab: "shield", label: "🛡️ 盾牌" },
  { subTab: "accessory", label: "💍 飾品" },
];

function normalizeName(name) {
  return String(name || "").replace(/\s*\+\d+$/, "").trim();
}

function isWeaponLikeSlot(slot) {
  return EQ_WEAPON_LIKE_SLOTS.has(slot);
}

function isWeaponSlotItem(entry) {
  return entry?.itemType === "equipment" && entry?.equipSlot === "weapon";
}

function isOffhandSlotItem(entry) {
  const weaponType = String(entry?.weaponType || "").toLowerCase();
  return entry?.itemType === "equipment"
    && entry?.equipSlot === "shield"
    && weaponType.startsWith("offhand_");
}

function isArmorSlotItem(entry) {
  return entry?.itemType === "equipment"
    && entry?.equipSlot
    && !isOffhandSlotItem(entry)
    && [
    "shield",
    "head_top",
    "head_mid",
    "head_low",
    "armor",
    "garment",
    "shoes",
    "accessory_l",
    "accessory_r",
  ].includes(entry.equipSlot);
}

function weaponFamily(entry) {
  const wt = String(entry?.weaponType || "").toLowerCase();
  if (!wt) return "other";
  if (wt.startsWith("staff")) return "magic";
  if (wt === "bow") return "ranged";
  if (wt === "dagger") return "melee1";
  if (wt.startsWith("sword_1h") || wt.startsWith("axe_1h") || wt.startsWith("mace_1h")) return "melee1";
  if (wt.startsWith("sword_2h") || wt.startsWith("axe_2h") || wt.startsWith("mace_2h")) return "melee2";
  return "other";
}

function matchWeaponSubTab(entry, subTab = "all") {
  if (subTab === "all") return true;
  return weaponFamily(entry) === subTab;
}

function matchArmorSubTab(entry, subTab = "all") {
  if (subTab === "all") return true;
  const slot = entry?.equipSlot || "";
  if (subTab === "head") return ["head_top", "head_mid", "head_low"].includes(slot);
  if (subTab === "core") return ["armor", "garment", "shoes"].includes(slot);
  if (subTab === "shield") return slot === "shield" && !isOffhandSlotItem(entry);
  if (subTab === "accessory") return ["accessory_l", "accessory_r"].includes(slot);
  return false;
}

function sortBackpackItems(items, tab) {
  const arr = [...items];
  return arr.sort((a, b) => {
    if (tab === "item") {
      return String(a.itemName || "").localeCompare(String(b.itemName || ""), "zh-Hant");
    }

    const aSlot = a.equipSlot || "";
    const bSlot = b.equipSlot || "";
    const aOrd = EQ_SORT_ORDER_MAP[aSlot] ?? 999;
    const bOrd = EQ_SORT_ORDER_MAP[bSlot] ?? 999;
    if (aOrd !== bOrd) return aOrd - bOrd;

    const an = normalizeName(a.itemName);
    const bn = normalizeName(b.itemName);
    if (an !== bn) return an.localeCompare(bn, "zh-Hant");

    const aEnh = Number(a.enhanceLevel || 0);
    const bEnh = Number(b.enhanceLevel || 0);
    if (aEnh !== bEnh) return bEnh - aEnh;

    return String(a.uuid || "").localeCompare(String(b.uuid || ""));
  });
}

function canonicalStatsKey(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  const keys = Object.keys(s).sort();
  return keys.map((k) => `${k}:${s[k]}`).join("|");
}

function canonicalEquipmentKey(entry) {
  const itemId = String(entry?.itemId || "").trim();
  const nameKey = normalizeName(entry?.itemName);
  const slot = String(entry?.equipSlot || "").trim();
  const tier = String(entry?.tier || "").trim().toUpperCase();
  const enh = String(Number(entry?.enhanceLevel || 0));
  const weaponType = String(entry?.weaponType || "").trim().toLowerCase();
  const statsKey = canonicalStatsKey(entry?.equipStats);

  // 同名但數值不同、武器型態不同或來源不同的裝備，不要疊在同一筆
  return [
    itemId || nameKey,
    nameKey,
    slot,
    tier,
    enh,
    weaponType,
    statsKey
  ].join("|");
}

function formatEquipStats(stats) {
  const statOrder = ["str", "agi", "vit", "int", "dex", "luk"];
  const s = stats && typeof stats === "object" ? stats : null;
  if (!s) return "";
  const sorted = Object.entries(s)
    .filter(([, value]) => typeof value === "number" && value !== 0 && !Number.isNaN(value))
    .sort((a, b) => {
      const ai = statOrder.indexOf(String(a[0]).toLowerCase());
      const bi = statOrder.indexOf(String(b[0]).toLowerCase());
      if (ai !== -1 && bi !== -1 && ai !== bi) return ai - bi;
      if (ai !== -1 && bi === -1) return -1;
      if (ai === -1 && bi !== -1) return 1;
      return String(a[0]).localeCompare(String(b[0]), "en");
    });
  return sorted.map(([k, v]) => `${String(k).toUpperCase()}${v > 0 ? "+" : ""}${v}`).join(" ");
}

function groupEquipmentItems(items, tab) {
  const list = sortBackpackItems(items, tab);
  const groups = new Map();

  for (const entry of list) {
    const slot = entry.equipSlot || "";
    const enh = Number(entry.enhanceLevel || 0);
    const tier = entry.tier ? String(entry.tier).toUpperCase() : "";
    const key = canonicalEquipmentKey(entry);

    if (!groups.has(key)) {
      const sellPrice = tier ? TIER_SELL_PRICE[tier] : null;
      groups.set(key, {
        key,
        repUuid: entry.uuid,
        itemName: entry.itemName,
        equipSlot: slot,
        tier,
        enhanceLevel: enh,
        equipStats: entry.equipStats || null,
        sellPrice,
        imageUrl: entry.imageUrl || "",
        count: 0,
      });
    }
    const g = groups.get(key);
    g.count += 1;
    if (!g.imageUrl && entry.imageUrl) g.imageUrl = entry.imageUrl;
  }

  return [...groups.values()];
}

function buildEquipmentGroupRow(group, idx, opts = {}) {
  const { tab = "item", subTab = "all", page = 0, showImage = true, showEquip = true } = opts;
  const prefix = ["①","②","③","④","⑤"][idx] ?? `${idx + 1}.`;
  const btns = [];

  if (showEquip) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_equip:${group.repUuid}:${tab}:${subTab}:${page}`)
        .setLabel(`${prefix} 裝備`)
        .setStyle(ButtonStyle.Success)
    );
  }

  // 強化按鈕：只有武器和防具可強化
  const isWeaponOrArmor = group.equipSlot &&
    (["weapon", "shield", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_l", "accessory_r"].includes(group.equipSlot));
  const hasValidTier = group.tier && ["D", "C", "B", "A"].includes(String(group.tier || "").toUpperCase());
  const canEnhance = isWeaponOrArmor && hasValidTier;

  if (canEnhance) {
    const currentLevel = Number(group.enhanceLevel || 0);
    const isMaxed = currentLevel >= MAX_ENHANCE_LEVEL;
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_enhance:${group.repUuid}:${tab}:${subTab}:${page}`)
        .setLabel(`⚡ 強化 ${currentLevel > 0 ? `(+${currentLevel}→+${currentLevel + 1})` : "(+0→+1)"}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isMaxed)
    );
  }

  if (group.sellPrice != null) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell:${group.repUuid}:${tab}:${subTab}:${page}`)
        .setLabel(`售 1件 (${group.sellPrice}💰)`)
        .setStyle(ButtonStyle.Secondary)
    );
    if (group.count > 1) {
      btns.push(
        new ButtonBuilder()
          .setCustomId(`backpack_sell_bulk:${group.repUuid}:${tab}:${subTab}:${page}`)
          .setLabel(`批量售 (共${group.count}件)`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
  } else {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell:${group.repUuid}:${tab}:${subTab}:${page}`)
        .setLabel("不可販售")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
  }

  if (showImage && group.imageUrl) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_view:${group.repUuid}`)
        .setLabel("🖼️")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return new ActionRowBuilder().addComponents(btns);
}

function filterByTab(inventory, tab, subTab = "all") {
  if (tab === "equip") {
    return inventory.filter(e => e.itemType === "equipment" && EQ_STANDARD_SLOTS.has(e.equipSlot) && !isOffhandSlotItem(e));
  }
  if (tab === "weapon") {
    return inventory.filter(e => isWeaponSlotItem(e) && matchWeaponSubTab(e, subTab));
  }
  if (tab === "armor") {
    return inventory.filter(e => isArmorSlotItem(e) && matchArmorSubTab(e, subTab));
  }
  if (tab === "offhand") {
    return inventory.filter(e => isOffhandSlotItem(e));
  }
  if (tab === "special") {
    return inventory.filter(e =>
      e.itemType === "equipment" &&
      (EQ_SPECIAL_SLOTS.has(e.equipSlot) || e.equipSlot === "special") &&
      !e.monsterCardSkill
    );
  }
  if (tab === "card") {
    return inventory.filter(e => e.itemType === "monster_card" || Boolean(e.monsterCardSkill));
  }
  if (tab === "badge") return inventory.filter(e => e.itemType === "job_badge");
  return inventory.filter(e => e.itemType !== "equipment" && e.itemType !== "job_badge" && e.itemType !== "monster_card");
}

const PAGE_SIZE = 3;
const EQUIP_PAGE_SIZE = 2;

function buildTabRow(activeTab, activeSubTab = "all") {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`backpack_tab_select:${activeSubTab}`)
    .setPlaceholder("選擇背包分類")
    .addOptions(
      BACKPACK_MAIN_TABS.map((d) => ({
        label: d.label,
        value: d.tab,
        default: d.tab === activeTab
      }))
    );
  return [new ActionRowBuilder().addComponents(menu)];
}

function buildBackpackHomeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("backpack_home")
      .setLabel("返回背包")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildSubTabRows(tab, activeSubTab = "all") {
  const defs = tab === "weapon" ? BACKPACK_WEAPON_SUBTABS : tab === "armor" ? BACKPACK_ARMOR_SUBTABS : [];
  if (!defs.length) return [];
  const rows = [];
  for (let i = 0; i < defs.length; i += 5) {
    const rowDefs = defs.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        rowDefs.map((d) => new ButtonBuilder()
          .setCustomId(`backpack_subtab:${tab}:${d.subTab}:0`)
          .setLabel(d.label)
          .setStyle(d.subTab === activeSubTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
        )
      )
    );
  }
  return rows;
}

function buildPageRow(tab, subTab, page, totalPages, options = {}) {
  const btns = [];
  btns.push(new ButtonBuilder()
    .setCustomId(`backpack_prev:${tab}:${subTab}:${page - 1}`)
    .setLabel("◀ 上一頁")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0)
  );
  btns.push(new ButtonBuilder()
    .setCustomId(`backpack_page_input:${tab}:${subTab}:${page}:${totalPages}`)
    .setLabel(`${page + 1} / ${totalPages}`)
    .setStyle(ButtonStyle.Primary)
  );
  btns.push(new ButtonBuilder()
    .setCustomId(`backpack_next:${tab}:${subTab}:${page + 1}`)
    .setLabel("下一頁 ▶")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1)
  );
  if (options.includeHome) {
    btns.push(new ButtonBuilder()
      .setCustomId("backpack_home")
      .setLabel("返回背包")
      .setStyle(ButtonStyle.Secondary)
    );
  }
  return new ActionRowBuilder().addComponents(btns);
}

function buildBackpackMessage(inventory, tab = "item", prefixMsg, page = 0, subTab = "all", options = {}) {
  const sectionMode = Boolean(options.sectionMode) || BACKPACK_SECTION_TABS.has(tab);
  const rawFiltered = filterByTab(inventory, tab, subTab);
  const isEquipTab = tab === "equip" || tab === "weapon" || tab === "armor" || tab === "offhand" || tab === "special" || tab === "card" || tab === "badge";
  const filtered = isEquipTab ? groupEquipmentItems(rawFiltered, tab) : sortBackpackItems(rawFiltered, tab);

  const header = prefixMsg ? prefixMsg + "\n\n" : "";
  const tabLabel =
    tab === "weapon" ? `武器${subTab === "all" ? "" : ` / ${BACKPACK_WEAPON_SUBTABS.find(d => d.subTab === subTab)?.label || subTab}`}` :
    tab === "armor"  ? `防裝${subTab === "all" ? "" : ` / ${BACKPACK_ARMOR_SUBTABS.find(d => d.subTab === subTab)?.label || subTab}`}` :
    tab === "offhand" ? "副手" :
    tab === "card"   ? "卡片" :
    tab === "equip"  ? "裝備" :
    tab === "special"? "特殊" :
    tab === "badge"  ? "職業" : "道具";
  const tabRows = buildTabRow(tab, subTab);
  const subTabRows = sectionMode ? [] : buildSubTabRows(tab, subTab);

  if (!filtered.length) {
    const components = sectionMode
      ? [buildBackpackHomeRow()]
      : [...tabRows, ...subTabRows];
    return { content: header + `🎒 **背包 — ${tabLabel}**\n\n此分類目前為空。`, components };
  }

  const pageSize = sectionMode && isEquipTab
    ? 4
    : ((tab === "weapon" || tab === "armor") ? EQUIP_PAGE_SIZE : PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / pageSize);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const offset = safePage * pageSize;

  const lines = [];
  if (tab === "weapon" && pageItems.length) lines.push("【武器】");
  if (tab === "armor" && pageItems.length) lines.push("【防裝】");
  if (tab === "offhand" && pageItems.length) lines.push("【副手】");
  if (tab === "card" && pageItems.length) lines.push("【卡片】");

  pageItems.forEach((e, i) => {
    if (tab === "equip" && i > 0) {
      const prev = pageItems[i - 1];
      const prevIsWeapon = isWeaponLikeSlot(prev.equipSlot);
      const curIsWeapon = isWeaponLikeSlot(e.equipSlot);
      if (prevIsWeapon !== curIsWeapon) lines.push(curIsWeapon ? "【武器】" : "【防具】");
    }

    if (isEquipTab) {
      const baseName = normalizeName(e.itemName);
      const enhLv = Number(e.enhanceLevel || 0);
      const enh = enhLv > 0 ? ` +${enhLv}` : "";
      const slotLabel = e.equipSlot ? (EQ_SLOT_LABELS[e.equipSlot] || e.equipSlot) : "";
      const slot = slotLabel ? `（${slotLabel}）` : "";
      const statStr = formatEquipStats(e.equipStats);
      const statsPart = statStr ? `｜${statStr}` : "";
      const overMax = enhLv > MAX_ENHANCE_LEVEL ? ` ⚠️超過上限(+${MAX_ENHANCE_LEVEL})` : "";
      const price = e.sellPrice != null ? `售 ${e.sellPrice}💰/件` : "不可販售";
      lines.push(`${offset + i + 1}. **${baseName}**${enh}${slot}${statsPart}｜${price}${overMax} ×${e.count}`);
      return;
    }

    const slot = e.equipSlot ? ` (${EQ_SLOT_LABELS[e.equipSlot] || e.equipSlot})` : "";
    const stackDisplay = e.stackCount ? ` ×${e.stackCount}` : "";
    lines.push(`${offset + i + 1}. **${e.itemName}**${slot}${stackDisplay}　${e.source === "monster_drop" ? `掉落自 ${e.sourceRef || "怪物"}` : `購於 ${(e.purchasedAt || "").slice(0, 10)}`}`);
  });

  const rows = sectionMode ? [] : [...tabRows, ...subTabRows];
  const itemRows = isEquipTab
    ? pageItems.map((g, i) => buildEquipmentGroupRow(g, i, {
      tab,
      subTab,
      page: safePage,
      showImage: !(tab === "weapon" || tab === "armor"),
      showEquip: true,
    }))
    : pageItems.map((e, i) => buildInventoryRow(e, i));
  rows.push(...itemRows);
  if (sectionMode) {
    if (totalPages > 1) rows.push(buildPageRow(tab, subTab, safePage, totalPages, { includeHome: true }));
    else rows.push(buildBackpackHomeRow());
  } else if (totalPages > 1) {
    rows.push(buildPageRow(tab, subTab, safePage, totalPages));
  }

  return { content: header + `🎒 **背包 — ${tabLabel}**（第 ${safePage + 1}/${totalPages} 頁，共 ${filtered.length} 項）\n\n${lines.join("\n")}`, components: rows };
}

async function handleBind(interaction) {
  const { player, bindings, bindingLines } = await getBindingRows(interaction);
  const boundLines = [...bindingLines];

  if (boundLines.length === 0) {
    const externalIds = player?.externalIds || {};
    const streamAliases = player?.streamAliases || [];
    for (const [platform, uid] of Object.entries(externalIds)) {
      boundLines.push(`• ${platform}：\`${uid}\``);
    }
    for (const alias of streamAliases) {
      boundLines.push(`• 顯示名稱：\`${alias}\``);
    }
  }

  if (boundLines.length > 0) {
    const code = createCode(interaction.user.id);
    await replyAndAutoDelete(interaction,
      `🔗 **直播帳號綁定狀態**\n\n` +
      `✅ 已綁定以下帳號：\n${boundLines.join("\n")}\n\n` +
      `如需重新綁定，請在直播聊天輸入以下指令：\n` +
      `**!綁定 ${code}**（10 分鐘內有效）`
    );
    return;
  }

  const code = createCode(interaction.user.id);
  await replyAndAutoDelete(interaction,
    `🔗 **直播帳號綁定**\n\n` +
    `你的綁定碼是：\`\`\`${code}\`\`\`\n` +
    `請在 **10 分鐘內**到直播聊天室（YT / Twitch）輸入：\n` +
    `**!綁定 ${code}**\n\n` +
    `綁定後，打卡就會自動識別你的直播帳號。`
  );
}

function resolveSnapshotTier(binding, playerTierService) {
  const tier = String(binding?.playerTierAtLink || "").trim().toUpperCase();
  if (tier) return tier;
  const roleIds = Array.isArray(binding?.memberRoleIdsAtLink) ? binding.memberRoleIdsAtLink : [];
  if (!playerTierService || roleIds.length === 0) return null;
  return playerTierService.resolveHighestTier(roleIds).catch(() => null);
}

async function handleBackpack(interaction) {
  const serviceContext = getServiceContext();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, "item");
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
}

// ── 裝備槽畫面（原本 5 列，進入某分頁後顯示）──
function buildEquipmentViewPayload({ progress, player, wallet, imgBuffer }) {
  const equipped = progress?.equipment || {};
  const activePreset = progress?.activePreset || "A";

  const rows = EQ_LEFT_SLOTS.map((leftSlot, i) => {
    const rightSlot = EQ_RIGHT_SLOTS[i];
    const col3Slot  = EQ_COL3_SLOTS[i];
    const makeSlotBtn = (slot) => {
      const item = equipped[slot];
      const label = item ? (item.itemName || item.name || '').slice(0, 20) : EQ_SLOT_LABELS[slot];
      return new ButtonBuilder()
        .setCustomId(`eq_btn:${slot}`)
        .setLabel(label)
        .setStyle(item ? ButtonStyle.Success : ButtonStyle.Secondary);
    };
    return new ActionRowBuilder().addComponents(
      makeSlotBtn(leftSlot), makeSlotBtn(rightSlot), makeSlotBtn(col3Slot)
    );
  });

  const payload = { components: rows, flags: MessageFlags.Ephemeral };
  if (imgBuffer) {
    const attachment = new AttachmentBuilder(imgBuffer, { name: "equipment.png" });
    payload.files = [attachment];
    payload.content = `【裝備方案 ${activePreset}】`;
  } else {
    const SLOT_ORDER = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r"];
    const lines = SLOT_ORDER.map(s => {
      const item = equipped[s];
      return `　${EQ_SLOT_LABELS[s]}：${item ? `**${item.itemName}**` : "空"}`;
    });
    payload.content = `⚔️ **裝備欄【裝備方案 ${activePreset}】**\n\n${lines.join("\n")}`;
  }
  return payload;
}

// ── 第一層：裝備方案總覽畫面 ──
// 列1：下拉選單快速切換方案（套裝備）
// 列2：A / B / C 按鈕（進去換裝）
function buildPresetSelectPayload({ progress, imgBuffer }) {
  const equipped = progress?.equipment || {};
  const activePreset = progress?.activePreset || "A";
  const PRESETS = ["A", "B", "C"];

  // 下拉選單：快速切換目前生效的分頁
  const switchMenu = new StringSelectMenuBuilder()
    .setCustomId("eq_preset_switch_select")
    .setPlaceholder(`目前方案：${activePreset}　▾ 快速切換裝備方案`)
    .addOptions(PRESETS.map(p => ({
      label: `裝備方案 ${p}`,
      description: p === activePreset ? "目前使用中" : "切換並套用此方案的裝備記錄",
      value: p,
      default: p === activePreset
    })));

  // 按鈕列：進入各方案換裝
  const enterRow = new ActionRowBuilder().addComponents(
    PRESETS.map(p =>
      new ButtonBuilder()
        .setCustomId(`eq_preset:${p}`)
        .setLabel(`方案 ${p} 換裝`)
        .setStyle(p === activePreset ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );

  const components = [
    new ActionRowBuilder().addComponents(switchMenu),
    enterRow
  ];

  const payload = { components, flags: MessageFlags.Ephemeral };
  if (imgBuffer) {
    payload.files = [new AttachmentBuilder(imgBuffer, { name: "equipment.png" })];
    payload.content = `⚔️ **裝備方案**　目前：**方案 ${activePreset}**`;
  } else {
    const SLOT_ORDER = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r"];
    const lines = SLOT_ORDER.map(s => {
      const item = equipped[s];
      return `　${EQ_SLOT_LABELS[s]}：${item ? `**${item.itemName}**` : "空"}`;
    });
    payload.content = `⚔️ **裝備方案**　目前：**方案 ${activePreset}**\n\n${lines.join("\n")}`;
  }
  return payload;
}

function hasEquipPresetAccess(progress, targetPreset) {
  if (targetPreset === "A") return true;
  return !!progress?.playerTier;
}

const PRESET_NO_ACCESS_MSG = { content: "🔒 **裝備方案 B / C** 限頻道付費會員使用。", components: [], files: [], flags: MessageFlags.Ephemeral };

async function handleEquipmentView(interaction) {
  const serviceContext = getServiceContext();
  await clearActiveReply(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [progress, player, wallet] = await Promise.all([
    serviceContext.progressRepository.findByPlayerId(interaction.user.id),
    serviceContext.playerRepository.findByDiscordId(interaction.user.id),
    serviceContext.walletRepository.findByPlayerId(interaction.user.id),
  ]);

  const equipped = progress?.equipment || {};
  const avatarUrl = interaction.user.displayAvatarURL({ extension: "png", forceStatic: true });
  const publicDir = path.resolve(__dirname, "../web/public");
  let imgBuffer = null;
  try {
    imgBuffer = await renderEquipmentCard({ equipped, avatarUrl, publicDir, progress, player, wallet });
  } catch { /* 退回文字 */ }

  await safeEditReply(interaction, buildPresetSelectPayload({ progress, imgBuffer }));
  await rememberActiveReply(interaction, 120_000);
}

// 下拉選單快速切換（只換套裝，留在總覽畫面）
async function handlePresetSwitchSelect(interaction) {
  const serviceContext = getServiceContext();
  const targetPreset = interaction.values[0];
  await interaction.deferUpdate();

  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  if (!hasEquipPresetAccess(progress, targetPreset)) {
    await safeEditReply(interaction, PRESET_NO_ACCESS_MSG);
    return;
  }

  try {
    await serviceContext.shopService.switchEquipPreset(interaction.user.id, targetPreset);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 切換失敗：${err.message}`, components: [], files: [] });
    return;
  }

  const [freshProgress, player, wallet] = await Promise.all([
    serviceContext.progressRepository.findByPlayerId(interaction.user.id),
    serviceContext.playerRepository.findByDiscordId(interaction.user.id),
    serviceContext.walletRepository.findByPlayerId(interaction.user.id),
  ]);
  const equipped = freshProgress?.equipment || {};
  const avatarUrl = interaction.user.displayAvatarURL({ extension: "png", forceStatic: true });
  const publicDir = path.resolve(__dirname, "../web/public");
  let imgBuffer = null;
  try {
    imgBuffer = await renderEquipmentCard({ equipped, avatarUrl, publicDir, progress: freshProgress, player, wallet });
  } catch { /* 退回文字 */ }

  await safeEditReply(interaction, buildPresetSelectPayload({ progress: freshProgress, imgBuffer }));
}

// 按鈕進入換裝 → 切換裝備方案並進裝備槽畫面
async function handleEquipPresetSwitch(interaction, targetPreset) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();

  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  if (!hasEquipPresetAccess(progress, targetPreset)) {
    await safeEditReply(interaction, PRESET_NO_ACCESS_MSG);
    return;
  }

  try {
    await serviceContext.shopService.switchEquipPreset(interaction.user.id, targetPreset);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 切換失敗：${err.message}`, components: [], files: [] });
    return;
  }

  const [freshProgress, player, wallet] = await Promise.all([
    serviceContext.progressRepository.findByPlayerId(interaction.user.id),
    serviceContext.playerRepository.findByDiscordId(interaction.user.id),
    serviceContext.walletRepository.findByPlayerId(interaction.user.id),
  ]);
  const equipped = freshProgress?.equipment || {};
  const avatarUrl = interaction.user.displayAvatarURL({ extension: "png", forceStatic: true });
  const publicDir = path.resolve(__dirname, "../web/public");
  let imgBuffer = null;
  try {
    imgBuffer = await renderEquipmentCard({ equipped, avatarUrl, publicDir, progress: freshProgress, player, wallet });
  } catch { /* 退回文字 */ }

  await safeEditReply(interaction, buildEquipmentViewPayload({ progress: freshProgress, player, wallet, imgBuffer }));
}

async function handleEquipAction(interaction, action, value) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    let result;
    if (action === "equip") {
      result = await serviceContext.shopService.equipItem(interaction.user.id, value);
      await safeEditReply(interaction, { content: `\u2705 已裝備 **${result.itemName}**！`, components: [] });
    } else {
      result = await serviceContext.shopService.unequipItem(interaction.user.id, value);
      await safeEditReply(interaction, { content: `\u2705 已卸下 **${result.itemName}**，已放回背包。`, components: [] });
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `\u274c 操作失敗\uff1a${err.message}`, components: [] });
  }
}

async function handleBackpackView(interaction, uuid) {
  const serviceContext = getServiceContext();
  await clearActiveReply(interaction);
  // 先 defer，給後續 I/O 最多 15 分鐘
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const entry = (progress?.inventory || []).find((e) => e.uuid === uuid);
  if (!entry || !entry.imageUrl) {
    await safeEditReply(interaction, { content: "此道具沒有圖片。" });
    return;
  }
  try {
    const imageUrl = String(entry.imageUrl || "").trim();
    if (/^https?:\/\//i.test(imageUrl)) {
      const embed = new EmbedBuilder().setImage(imageUrl);
      await safeEditReply(interaction, {
        content: `🖼️ **${entry.itemName}**\n${entry.source === "monster_drop" ? `掉落自 ${entry.sourceRef || "怪物"}` : `購於 ${(entry.purchasedAt || "").slice(0, 10)}`}\n\n你可以右鍵點擊圖片 → 在瀏覽器中開啟或另存圖片。`,
        embeds: [embed]
      });
      await rememberActiveReply(interaction, 60_000);
      return;
    }
    const imagePath = path.resolve(__dirname, "../web/public", imageUrl.replace(/^\//, ""));
    if (!fs.existsSync(imagePath)) {
      await safeEditReply(interaction, { content: "❌ 圖片檔案不存在。" });
      return;
    }
    const fileName = path.basename(imagePath);
    const attachment = new AttachmentBuilder(imagePath, { name: fileName });
    await safeEditReply(interaction, {
      content: `🖼️ **${entry.itemName}**\n${entry.source === "monster_drop" ? `掉落自 ${entry.sourceRef || "怪物"}` : `購於 ${(entry.purchasedAt || "").slice(0, 10)}`}\n\n你可以右鍵點擊圖片 → 另存圖片。`,
      files: [attachment]
    });
    await rememberActiveReply(interaction, 60_000);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 無法載入圖片：${err.message}` });
  }
}

async function handleBackpackTab(interaction, tab, page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, tab, undefined, page, subTab);
  await safeEditReply(interaction, msg);
}

async function handleBackpackTabSelect(interaction) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const selectedTab = String(interaction.values?.[0] || "item");
  const activeSubTab = interaction.customId.startsWith("backpack_tab_select:")
    ? interaction.customId.slice("backpack_tab_select:".length) || "all"
    : "all";
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, selectedTab, undefined, 0, activeSubTab, BACKPACK_SECTION_TABS.has(selectedTab) ? { sectionMode: true } : {});
  await safeEditReply(interaction, msg);
}

async function openBackpackSection(interaction, tab, page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, tab, undefined, page, subTab, { sectionMode: true });
  await interaction.followUp({ ...msg, flags: MessageFlags.Ephemeral });
}

async function handleBackpackEquip(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    // 檢查是否是怪物卡片，自動穿上第一個空槽位
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const item = progress?.inventory?.find(i => i.uuid === uuid);
    let targetSlot = null;

    if (item?.equipSlot === "special" || item?.itemType === "monster_card") {
      const SPECIAL_SLOTS = ["special_1", "special_2", "special_3"];
      const equipped = progress?.equipment || {};
      targetSlot = SPECIAL_SLOTS.find(s => !equipped[s]) || SPECIAL_SLOTS[0];
    }

    const result = await serviceContext.shopService.equipItem(interaction.user.id, uuid, targetSlot);
    const updatedProgress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = updatedProgress?.inventory || [];
    const msg = buildBackpackMessage(inventory, tab, `✅ 已裝備 **${result.itemName}**！`, page, subTab);
    await safeEditReply(interaction, msg);
  } catch (err) {
    try {
      const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
      const inventory = progress?.inventory || [];
      const msg = buildBackpackMessage(inventory, tab, `❌ 裝備失敗：${err.message}`, page, subTab);
      await safeEditReply(interaction, msg);
    } catch (_) {
      await safeEditReply(interaction, { content: `❌ 裝備失敗：${err.message}`, components: [] });
    }
  }
}

async function handleBackpackAction(interaction, action, uuid) {
  const serviceContext = getServiceContext();

  // 危險型消耗品需要確認
  if (action === "use") {
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const entry = (progress?.inventory || []).find(e => e.uuid === uuid);
    if (entry?.itemEffect?.type === "reroll_attributes" || entry?.itemEffect?.type === "level_down_random_attributes") {
      const isLevelDown = entry?.itemEffect?.type === "level_down_random_attributes";
      await interaction.deferUpdate();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reroll_confirm:${uuid}`)
          .setLabel(isLevelDown ? "確認使用降等藥水" : "確認重製屬性")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`reroll_cancel`)
          .setLabel("取消")
          .setStyle(ButtonStyle.Secondary)
      );
      await safeEditReply(interaction, {
        content: isLevelDown
          ? `⚠️ 確定要使用 **${entry.itemName}** 嗎？\n使用後會**降低 1 級**，並**隨機下降 2 點屬性**（屬性最低不會低於 1），此操作不可逆！`
          : `⚠️ 確定要使用 **${entry.itemName}** 嗎？\n你目前所有的升等屬性點將會**完全重新隨機分配**，此操作不可逆！`,
        components: [row]
      });
      return;
    }

    // 如果有 stackCount，顯示數量選擇模態
    if (entry?.stackCount && entry.stackCount > 1) {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`consumable_quantity:${uuid}`)
          .setTitle(`使用 ${entry.itemName}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("quantity_input")
                .setLabel(`請輸入使用數量 (1-${entry.stackCount})`)
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(10)
                .setPlaceholder("1")
                .setRequired(true)
            )
          )
      );
      return;
    }
  }

  await interaction.deferUpdate();
  try {
    const isUse = action === "use";
    const result = isUse
      ? await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username)
      : await serviceContext.shopService.discardItem(interaction.user.id, uuid);
    const verb = isUse ? "使用" : "丟棄";
    const extra = isUse && result.effectDesc ? `\n${result.effectDesc}` : "";
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    // 判斷原本在哪個 tab（根據被操作的道具欄位）
    const tab = "item";
    const msg = buildBackpackMessage(inventory, tab, `✅ 已${verb} **${result.itemName}**。${extra}`);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 操作失敗：${err.message}`, components: [] });
  }
}

/** 販售道具 */
async function handleBackpackSell(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const quote = await serviceContext.shopService.getSellQuote(interaction.user.id, uuid, 1);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`backpack_sell_confirm:${uuid}:${tab}:${subTab}:${page}`)
        .setLabel("確定販售")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`backpack_sell_cancel:${tab}:${subTab}:${page}`)
        .setLabel("取消")
        .setStyle(ButtonStyle.Secondary)
    );
    await safeEditReply(interaction, {
      content:
        `⚠️ **販售確認**\n\n` +
        `你確定要販售 **${quote.itemName}** 嗎？\n` +
        `販售數量：**1**\n` +
        `販售總價值：💰 **${quote.totalGold.toLocaleString()} 金幣**\n\n` +
        `確認後道具會從背包移除，無法復原。`,
      components: [row]
    });
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 販售失敗：${err.message}`, components: [] });
  }
}

/** 確認販售道具 */
async function handleBackpackSellConfirm(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.sellItem(interaction.user.id, uuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(inventory, tab, `✅ 已販售 **${result.itemName}**，獲得 💰 ${result.price} 金幣。`, page, subTab);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 販售失敗：${err.message}`, components: [] });
  }
}

/** 批量販售：彈出 Modal 讓玩家輸入數量 */
async function handleBackpackSellBulkPrompt(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const modal = new ModalBuilder()
    .setCustomId(`backpack_sell_bulk_modal:${uuid}:${tab}:${subTab}:${page}`)
    .setTitle("批量販售");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("qty")
        .setLabel("販售數量")
        .setPlaceholder("輸入要賣出的數量（例如：5）")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(4)
    )
  );
  await interaction.showModal(modal);
}

/** 批量販售：處理 Modal 提交 */
async function handleBackpackSellBulkConfirm(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const qtyRaw = interaction.fields.getTextInputValue("qty");
    const qty = parseInt(qtyRaw, 10);
    if (isNaN(qty) || qty < 1) {
      await safeEditReply(interaction, { content: "❌ 請輸入有效的數量（正整數）。", components: [] });
      return;
    }
    const quote = await serviceContext.shopService.getSellQuote(interaction.user.id, uuid, qty);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`backpack_sell_bulk_confirm:${uuid}:${tab}:${subTab}:${page}:${quote.sellCount}`)
        .setLabel("確定批量販售")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`backpack_sell_cancel:${tab}:${subTab}:${page}`)
        .setLabel("取消")
        .setStyle(ButtonStyle.Secondary)
    );
    await safeEditReply(interaction, {
      content:
        `⚠️ **批量販售確認**\n\n` +
        `你確定要販售 **${quote.itemName}** × **${quote.sellCount}** 嗎？\n` +
        `單價：💰 **${quote.priceEach.toLocaleString()} 金幣**\n` +
        `販售總價值：💰 **${quote.totalGold.toLocaleString()} 金幣**\n\n` +
        `確認後道具會從背包移除，無法復原。`,
      components: [row]
    });
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 批量販售失敗：${err.message}`, components: [] });
  }
}

/** 確認批量販售 */
async function handleBackpackSellBulkExecute(interaction, uuid, tab = "item", page = 0, qty = 1, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.sellItemBulk(interaction.user.id, uuid, qty);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(
      inventory, tab,
      `✅ 已批量販售 **${result.itemName}** × ${result.sellCount} 件，獲得 💰 ${result.totalGold} 金幣。`,
      page,
      subTab
    );
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 批量販售失敗：${err.message}`, components: [] });
  }
}

function formatEnhanceNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "?";
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatEnhanceAppliedStats(info) {
  const applied = String(info?.appliedStats || "").trim();
  if (applied) return applied;

  const statLabel = info?.statBoostedZh || (info?.statBoosted ? String(info.statBoosted).toUpperCase() : "");
  const from = info?.oldStatValue;
  const to = info?.newStatValue;
  const delta = Number(info?.statDelta || 0);
  if (statLabel && Number.isFinite(Number(from)) && Number.isFinite(Number(to))) {
    const deltaText = delta >= 0 ? `+${formatEnhanceNumber(delta)}` : formatEnhanceNumber(delta);
    return `${statLabel} ${formatEnhanceNumber(from)} → ${formatEnhanceNumber(to)}（${deltaText}）`;
  }
  if (statLabel && delta) {
    const deltaText = delta >= 0 ? `+${formatEnhanceNumber(delta)}` : formatEnhanceNumber(delta);
    return `${statLabel} ${deltaText}`;
  }
  return "";
}

function formatEnhanceStatsBeforeAfter(info) {
  const beforeText = formatEquipStats(info?.beforeEquipStats || null);
  const afterText = formatEquipStats(info?.currentEquipStats || null);
  if (!beforeText && !afterText) return "";
  if (beforeText && afterText) return `${beforeText} → ${afterText}`;
  return afterText || beforeText || "";
}

function buildEnhanceConfirmLines(info) {
  const itemName = info?.itemName || "未知道具";
  const currentLevel = Number(info?.currentLevel || 0);
  const currentEquipStatsText = formatEquipStats(info?.currentEquipStats);
  const mode = normalizeEnhanceMode(info?.mode);
  if (info?.isMaxed) {
    const lines = [
      `🎯 **目標道具**：${itemName}`,
      `⚡ **強化等級**：已達上限 +${currentLevel}`,
      "⚠️ 這件裝備已達最高強化等級，無法再強化。"
    ];
    if (currentEquipStatsText) {
      lines.splice(2, 0, `📊 **目前屬性**：${currentEquipStatsText}`);
    }
    return lines.join("\n");
  }

  const nextLevel = info?.nextLevel ?? (currentLevel + 1);
  const gemsRequired = Number(info?.gemsRequired || 0);
  const goldRequired = Number(info?.goldRequired || 0);
  const gemsOwned = Number(info?.gemsOwned || 0);
  const goldOwned = Number(info?.goldOwned || 0);
  const successRate = Number(info?.successRate || 0);
  const statBoosted = info?.statBoostedZh || (info?.statBoosted ? String(info.statBoosted).toUpperCase() : "");
  const oldStatValue = info?.oldStatValue;
  const newStatValue = info?.newStatValue;
  const statDelta = Number(info?.statDelta || 0);
  const targetStatSummary = String(info?.targetStatSummary || "").trim();

  const lines = [
    `🎯 **目標道具**：${itemName}`,
    `⚡ **強化等級**：+${currentLevel} → +${nextLevel}`,
    `📌 **模式**：${getEnhanceModeLabel(mode)}`,
    `🧪 **素材消耗**：${gemsRequired} 顆 ${info?.tier || ""}階強化石`,
    `💰 **金幣消耗**：${goldRequired > 0 ? `${goldRequired}` : "免費"}`,
    `📦 **持有素材**：${gemsOwned} 顆強化石 / ${goldOwned} 金幣`,
    `🎲 **成功率**：${successRate}%`,
  ];

  if (currentEquipStatsText) {
    lines.push(`📊 **目前屬性**：${currentEquipStatsText}`);
  }

  if (targetStatSummary && (!statBoosted || statBoosted === "隨機屬性" || statBoosted === "random")) {
    const deltaText = statDelta >= 0 ? `+${formatEnhanceNumber(statDelta)}` : formatEnhanceNumber(statDelta);
    lines.push(`📈 **數值預覽**：隨機分配 ${deltaText} 點至 ${targetStatSummary}`);
  } else if (statBoosted && Number.isFinite(Number(oldStatValue)) && Number.isFinite(Number(newStatValue))) {
    const deltaText = statDelta >= 0 ? `+${formatEnhanceNumber(statDelta)}` : formatEnhanceNumber(statDelta);
    lines.push(`📈 **數值預覽**：${statBoosted} ${formatEnhanceNumber(oldStatValue)} → ${formatEnhanceNumber(newStatValue)}（${deltaText}）`);
  }

  lines.push("⚠️ 確認後會直接消耗素材與金幣，請再次確認要強化的道具。");
  if (mode === ENHANCE_MODE_GAMBLE) {
    lines.splice(4, 0, "💥 **失敗效果**：有 50% 機率直接爆裝。");
  }
  return lines.join("\n");
}

/** 寶石強化：顯示強化信息並執行 */
async function handleBackpackEnhance(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    // 先取得強化信息（不消耗）
    const info = await serviceContext.enhanceService.getEnhanceInfo(interaction.user.id, uuid);
    if (!info) {
      await safeEditReply(interaction, { content: "❌ 該道具無法強化。", components: [] });
      return;
    }

    // 構建確認訊息
    const statusLine = info.isMaxed
      ? `已達最大強化等級 +${info.currentLevel}`
      : `目前強化等級：+${info.currentLevel}→+${info.nextLevel}`;

    const canEnhance = !info.isMaxed && info.gemsOwned >= info.gemsRequired && info.goldOwned >= info.goldRequired;
    const buttonLabel = info.isMaxed
      ? "已達上限"
      : `確認強化 +${info.nextLevel}`;

    const row = new ActionRowBuilder();
    if (!info.isMaxed) {
      row.addComponents(
      new ButtonBuilder()
        .setCustomId(`backpack_enhance_confirm:${uuid}:${tab}:${subTab}:${page}`)
        .setLabel(buttonLabel)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!canEnhance)
      );
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`backpack_enhance_cancel:${tab}:${subTab}:${page}`)
        .setLabel("取消")
        .setStyle(ButtonStyle.Secondary)
    );

    await safeEditReply(interaction, {
      content: `⚡ **${info.itemName}**\n${statusLine}\n${buildEnhanceConfirmLines(info)}${!canEnhance && !info.isMaxed ? "\n❌ 素材或金幣不足" : ""}`,
      components: [row]
    });
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 強化失敗：${err.message}`, components: [] });
  }
}

/** 寶石強化確認：執行強化 */
async function handleBackpackEnhanceConfirm(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.enhanceService.enhanceEquipment(interaction.user.id, uuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const statLabel = result.statBoostedZh || String(result.statBoosted || "").toUpperCase();
    const from = formatEnhanceNumber(result.oldStatValue ?? "?");
    const to = formatEnhanceNumber(result.newStatValue ?? "?");
    const deltaText = Number.isFinite(Number(result.statDelta))
      ? (Number(result.statDelta) >= 0 ? `+${formatEnhanceNumber(result.statDelta)}` : formatEnhanceNumber(result.statDelta))
      : "";
    const goldText = Number(result.goldUsed || 0) > 0 ? `${result.goldUsed} 金幣` : "免費";
    const inventory = progress?.inventory || [];

    const statusEmoji = result.success ? "✅" : "❌";
    const prefixMsg = result.success
      ? `${statusEmoji} 強化成功！**${result.itemName}**（${statLabel} ${from} → ${to}${deltaText ? `，${deltaText}` : ""}）`
      : `${statusEmoji} 強化失敗，**${result.itemName}** 已消耗 ${result.gemsUsed} 顆 ${result.tier}階寶石與 ${goldText}。`;

    const msg = buildBackpackMessage(inventory, tab, prefixMsg, page, subTab);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 強化失敗：${err.message}`, components: [] });
  }
}

/** 屬性重製確認 */
async function handleRerollConfirm(interaction, uuid) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(inventory, "item", `✅ 已使用 **${result.itemName}**。\n${result.effectDesc}`);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 使用失敗：${err.message}`, components: [] });
  }
}

const ENHANCE_SLOT_ORDER = ["weapon","shield","head_top","head_mid","head_low","armor","garment","shoes","accessory_l","accessory_r"];

function buildEnhanceEntryPayload(progress, notice = "") {
  const equipped = progress?.equipment || {};

  const overMax = ENHANCE_SLOT_ORDER
    .map((slot) => equipped[slot])
    .filter((entry) => entry && Number(entry.enhanceLevel || 0) > MAX_ENHANCE_LEVEL);

  const overMaxLine = overMax.length
    ? `\n\n⚠️ 偵測到超過強化上限（+${MAX_ENHANCE_LEVEL}）的裝備：\n${overMax.slice(0, 5).map((entry) => `・${entry.itemName}（+${entry.enhanceLevel}）`).join("\n")}${overMax.length > 5 ? `\n…共 ${overMax.length} 件` : ""}`
    : "";

  const enhanceable = ENHANCE_SLOT_ORDER
    .map((slot) => equipped[slot])
    .filter((entry) => entry && ((entry.tier) || (entry.equipStats && Object.keys(entry.equipStats).length > 0)) && (entry.enhanceLevel ?? 0) < MAX_ENHANCE_LEVEL);

  if (!enhanceable.length) {
    return {
      content: (notice ? `${notice}\n\n` : "") + `⚗️ 目前裝備槽上沒有可強化的裝備（需有 tier 或裝備屬性，且未達 +${MAX_ENHANCE_LEVEL} 上限）。`,
      components: [],
    };
  }

  const opts = enhanceable.slice(0, 25).map((entry) => {
    const slot = EQ_SLOT_LABELS[entry.equipSlot] || entry.equipSlot;
    const curLevel = Number(entry.enhanceLevel || 0);
    const { gemsRequired, goldRequired, successRate } = getEnhanceCost(entry.tier, curLevel);
    const gemsText = Number.isFinite(Number(gemsRequired)) ? `${gemsRequired} 石` : "未知石數";
    const goldText = Number.isFinite(Number(goldRequired)) ? (Number(goldRequired) > 0 ? `${goldRequired} 金` : "免費") : "未知金額";
    const rateText = Number.isFinite(Number(successRate)) ? `${successRate}%` : "未知成功率";
    return {
      label: `${entry.itemName}（+${entry.enhanceLevel ?? 0}）`,
      description: `${slot}　${gemsText} / ${goldText} / ${rateText}`,
      value: entry.uuid,
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("enhance_pick_target")
    .setPlaceholder("選擇要強化的裝備")
    .addOptions(opts);

  return {
    content: (notice ? `${notice}\n\n` : "") + "⚗️ **裝備強化**\n選擇裝備槽上的裝備作為強化目標：" + overMaxLine,
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/** 強化入口：列出裝備槽上可強化目標 */
async function handleEnhanceEntry(interaction) {
  const serviceContext = getServiceContext();
  if (!interaction.deferred && !interaction.replied) {
    await clearActiveReply(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  await safeEditReply(interaction, buildEnhanceEntryPayload(progress));
  await rememberActiveReply(interaction, 120_000);
}

/** 強化步驟2：選定目標後，顯示自動強化需求 */
async function handleEnhanceSelect(interaction, targetUuid, mode = ENHANCE_MODE_NORMAL) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const enhanceMode = normalizeEnhanceMode(mode);
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);

  let target = null;
  for (const entry of Object.values(progress?.equipment || {})) {
    if (entry?.uuid === targetUuid) { target = entry; break; }
  }
  if (!target) {
    await safeEditReply(interaction, { content: "❌ 找不到目標裝備，請確認裝備仍在裝備槽上。", components: [] });
    return;
  }

  const curLevel = target.enhanceLevel ?? 0;
  if (curLevel >= MAX_ENHANCE_LEVEL) {
    await safeEditReply(interaction, { content: `❌ **${target.itemName}** 已達強化上限（+${MAX_ENHANCE_LEVEL}）。`, components: [] });
    return;
  }
  // 使用寶石強化流程：詢問 enhanceService 取得寶石需求與成功率
  try {
    const enhanceInfo = await serviceContext.enhanceService.getEnhanceInfo(interaction.user.id, targetUuid, { mode: enhanceMode });
    if (!enhanceInfo) {
      await safeEditReply(interaction, { content: `❌ 該裝備無法使用寶石強化。`, components: [] });
      return;
    }

    if (enhanceInfo.isMaxed) {
      await safeEditReply(interaction, { content: `❌ **${enhanceInfo.itemName}** 已達強化上限（+${MAX_ENHANCE_LEVEL}）。`, components: [] });
      return;
    }

    const gemsRequired = enhanceInfo.gemsRequired ?? 0;
    const gemsOwned = enhanceInfo.gemsOwned ?? 0;
    const goldRequired = enhanceInfo.goldRequired ?? 0;
    const goldOwned = enhanceInfo.goldOwned ?? 0;
    const nextLevel = enhanceInfo.nextLevel ?? (curLevel + 1);

    const canEnhanceWithGems = gemsOwned >= gemsRequired && goldOwned >= goldRequired;
    const toggleMode = enhanceMode === ENHANCE_MODE_GAMBLE ? ENHANCE_MODE_NORMAL : ENHANCE_MODE_GAMBLE;
    const confirmLabel = enhanceMode === ENHANCE_MODE_GAMBLE
      ? `確認賭鬼強化 +${nextLevel}`
      : `確認強化 +${nextLevel}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`enhance_auto:${enhanceMode}:${targetUuid}`)
        .setLabel(canEnhanceWithGems ? confirmLabel : `素材不足：需 ${gemsRequired} 石 / ${goldRequired} 金`)
        .setStyle(enhanceMode === ENHANCE_MODE_GAMBLE ? ButtonStyle.Danger : ButtonStyle.Success)
        .setDisabled(!canEnhanceWithGems),
      new ButtonBuilder()
        .setCustomId(`enhance_mode:${toggleMode}:${targetUuid}`)
        .setLabel(getEnhanceModeToggleLabel(enhanceMode))
        .setStyle(enhanceMode === ENHANCE_MODE_GAMBLE ? ButtonStyle.Secondary : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("enhance_back")
        .setLabel("返回")
        .setStyle(ButtonStyle.Secondary)
    );

    const baseName = normalizeName(enhanceInfo.itemName);
    await safeEditReply(interaction, {
      content: `⚗️ ${baseName}（目前 +${curLevel}）→ 強化至 +${nextLevel}\n${buildEnhanceConfirmLines(enhanceInfo)}`,
      components: [row],
    });
    return;
  } catch (e) {
    await safeEditReply(interaction, { content: `❌ 讀取強化資訊失敗：${e.message}`, components: [] });
    return;
  }
}

/** 強化步驟3：手動指定材料（保留相容） */
async function handleEnhanceConfirm(interaction, targetUuid, materialUuid) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.enhanceItem(interaction.user.id, targetUuid, materialUuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const consumed = result.materialsConsumed
      ? `（需求等價 ${result.materialsConsumed} 把，實際消耗 ${result.materialsConsumedItems || "?"} 件，等價總和 ${result.materialsConsumedUnits || "?"}）`
      : "";
    const appliedText = formatEnhanceAppliedStats(result);
    const statsBeforeAfterText = formatEnhanceStatsBeforeAfter(result);
    const goldText = Number(result.goldUsed || 0) > 0 ? `${result.goldUsed} 金幣` : "免費";
    const equippedEntry = (progress?.inventory || []).find((item) => item?.uuid === targetUuid)
      || Object.values(progress?.equipment || {}).find((item) => item?.uuid === targetUuid)
      || null;
    const currentStatsText = formatEquipStats(equippedEntry?.equipStats || result.currentEquipStats || null);
    const notice = result.success
      ? `✅ 強化成功！**${result.itemName}**\n📈 本次強化：${appliedText || "已提升"}${consumed}\n📊 強化前 → 後：${statsBeforeAfterText || currentStatsText || "無"}`
      : `❌ 強化失敗！**${result.itemName}**\n📈 本次強化：${appliedText || "已提升"}${consumed}\n📊 強化前 → 後：${statsBeforeAfterText || currentStatsText || "無"}\n🧾 消耗：${result.gemsUsed} 顆 ${result.tier}階強化石 / ${goldText}`;
    await safeEditReply(interaction, buildEnhanceEntryPayload(progress, notice));

    if (result.success && (result.newLevel || 0) >= 3) {
      _announceEnhance(interaction, {
        ...result,
        success: true,
        beforeEquipStats: result.beforeEquipStats || null,
        currentEquipStats: result.currentEquipStats || null
      }).catch(() => {});
    } else if (!result.success && (result.currentLevel || 0) >= 3) {
      _announceEnhance(interaction, result).catch(() => {});
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 強化失敗：${err.message}`, components: [] });
  }
}

async function handleEnhanceAuto(interaction, targetUuid, mode = ENHANCE_MODE_NORMAL) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    // 使用 EnhanceService（寶石強化）而非舊的材料等價實作
    const result = await serviceContext.enhanceService.enhanceEquipment(interaction.user.id, targetUuid, { mode });
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const goldText = Number(result.goldUsed || 0) > 0 ? `${result.goldUsed} 金幣` : "免費";
    const appliedText = formatEnhanceAppliedStats(result);
    const statsBeforeAfterText = formatEnhanceStatsBeforeAfter(result);
    const equippedEntry = (progress?.inventory || []).find((item) => item?.uuid === targetUuid)
      || Object.values(progress?.equipment || {}).find((item) => item?.uuid === targetUuid)
      || null;
    const currentStatsText = formatEquipStats(equippedEntry?.equipStats || result.currentEquipStats || null);

    const modeText = normalizeEnhanceMode(result.mode) === ENHANCE_MODE_GAMBLE ? "賭鬼強化" : "一般強化";
    const notice = result.success
      ? `✅ 強化成功！**${result.itemName}**\n📈 本次強化：${appliedText || "已提升"}\n📊 強化前 → 後：${statsBeforeAfterText || currentStatsText || "無"}`
      : result.exploded
        ? `💥 ${modeText}失敗！**${result.itemName}** 已爆裝消失。\n🧾 消耗：${result.gemsUsed} 顆 ${result.tier}階寶石 / ${goldText}`
        : `❌ ${modeText}失敗，**${result.itemName}** 已消耗 ${result.gemsUsed} 顆 ${result.tier}階寶石與 ${goldText}。`;
    await safeEditReply(interaction, buildEnhanceEntryPayload(progress, notice));

    if (result.success && (result.newLevel || 0) >= 3) {
      _announceEnhance(interaction, {
        ...result,
        success: true,
        beforeEquipStats: result.beforeEquipStats || null,
        currentEquipStats: result.currentEquipStats || null
      }).catch(() => {});
    } else if (result.exploded || (!result.success && (result.currentLevel || 0) >= 3)) {
      _announceEnhance(interaction, {
        ...result,
        success: false,
        beforeEquipStats: result.beforeEquipStats || null,
        currentEquipStats: result.currentEquipStats || null
      }).catch(() => {});
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 強化失敗：${err.message}`, components: [] });
  }
}

async function _announceEnhance(interaction, result) {
  try {
    const { getBotClient } = require("./runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;
    const channelId = result.success
      ? (config.discord?.enhanceSuccessAnnounceChannelId || "1450062298076151952")
      : (config.discord?.enhanceFailureAnnounceChannelId || "1498608950671839263");
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const displayName = interaction.member?.displayName || interaction.user.username;
    const shortName = String(displayName).replace(/[（(].*$/, "").trim() || displayName;
    const currentEquipStatsText = formatEquipStats(result.currentEquipStats || null);
    const brokenItemName = result.itemName || "未知道具";
    const header = result.success
      ? `⚗️ @${shortName} 強化成功！`
      : result.exploded
        ? `💥 @${shortName} 的 ${brokenItemName} 爆掉了！`
        : `⚗️ @${shortName} 強化 "${result.itemName || "未知道具"}" 失敗！`;
    const lines = [header];
    if (result.success) {
      lines.push(`🎯 目標道具：${result.itemName}${currentEquipStatsText ? `  ${currentEquipStatsText}` : ""}`);
    } else {
      lines[0] = result.exploded
        ? `💥 @${shortName} 的 ${brokenItemName} 爆掉了！`
        : `⚗️ @${shortName} 強化道具失敗！`;
      if (result.exploded) {
        lines.push(`🎯 目標道具：${brokenItemName}`);
      }
    }
    await channel.send(lines.join("\n"));
  } catch (_) { /* suppressed */ }
}

const QUEST_TAB_META = {
  onboarding: { label: "新手任務", emoji: "🌱", resetText: "一次性任務（不重置）" },
  job: { label: "職業任務", emoji: "🎖️", resetText: "符合條件時自動出現，完成後獲得職業徽章" },
  daily: { label: "每日任務", emoji: "🗓️", resetText: "台灣時間每日 00:00 重置" },
  weekly: { label: "每週任務", emoji: "📅", resetText: "台灣時間每週一 00:00 重置" }
};

function formatRewardWeaponSummary(item) {
  if (!item?.weaponType) return "";
  const formatMaceStun = (baseStun, dwarfHighHpBonus, dwarfStunnedBonus) => {
    const parts = [`擊暈率 +${baseStun}%`];
    if (dwarfHighHpBonus > 0) parts.push(`矮人高血再 +${dwarfHighHpBonus}%`);
    if (dwarfStunnedBonus > 0) parts.push(`對暈眩目標 +${dwarfStunnedBonus}%`);
    return parts.join("、");
  };
  const weaponText = {
    sword_1h: "單手劍：攻擊倍率 ×4",
    sword_2h: "雙手劍：攻擊倍率 ×7",
    mace_1h: `單手槌：攻擊倍率 ×3，${formatMaceStun(20, 10, 5)}`,
    mace_2h: `雙手槌：攻擊倍率 ×4，${formatMaceStun(30, 10, 15)}`,
    axe_1h: "單手斧：攻擊倍率 ×3，破防率 +15%，爆擊 +10%",
    axe_2h: "雙手斧：攻擊倍率 ×5，破防率 +15%，爆擊 +20%",
    dagger: "匕首：攻擊倍率 ×2，連擊率 +20%",
    staff_1h: "單手法杖：攻擊倍率 ×3，主屬性 INT，無視怪物 DEF 15%，怪物攻擊 ×2",
    staff_2h: "雙手法杖：攻擊倍率 ×4，主屬性 INT，無視怪物 DEF 25%，怪物攻擊 ×2",
    bow: "弓：攻擊倍率 ×4，主屬性 DEX，迴避 +20%，雙手武器"
  }[item.weaponType];
  if (!weaponText) return "";
  const statText = formatEquipStats(item.equipStats);
  return statText ? `${weaponText}，${statText}` : weaponText;
}

function formatRewardItemLabel(item) {
  if (!item) return "＋道具";
  const itemName = item.name || item.itemName || "未命名道具";
  const parts = [`${itemName}`];
  if (item.itemType === "equipment") {
    const statText = formatEquipStats(item.equipStats);
    const weaponSummary = formatRewardWeaponSummary(item);
    if (weaponSummary) {
      parts.push(`武器效果：${weaponSummary}`);
    } else if (statText) {
      parts.push(`裝備效果：${statText}`);
    }
  }
  return `${parts.join("（")}${parts.length > 1 ? "）" : ""}`;
}

async function enrichQuestRewards(serviceContext, progressList) {
  const itemRepo = serviceContext?.itemRepository;
  if (!itemRepo) return progressList;

  const cache = new Map();
  const getItem = async (itemId) => {
    const key = String(itemId || "");
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    const item = await itemRepo.findById(key).catch(() => null);
    cache.set(key, item || null);
    return item || null;
  };

  return Promise.all(progressList.map(async (row) => {
    const quest = row?.quest ? { ...row.quest } : null;
    if (quest?.rewardItemId) {
      const item = await getItem(quest.rewardItemId);
      if (item) {
        quest.rewardItemName = item.name || item.itemName || null;
        quest.rewardItemSummary = formatRewardItemLabel(item);
      }
    }
    return { ...row, quest };
  }));
}

function buildQuestTabRow(activeCadence = "weekly") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("quest_tab:onboarding")
      .setLabel("🌱 新手")
      .setStyle(activeCadence === "onboarding" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("quest_tab:job")
      .setLabel("🎖️ 職業")
      .setStyle(activeCadence === "job" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("quest_tab:daily")
      .setLabel("🗓️ 每日")
      .setStyle(activeCadence === "daily" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("quest_tab:weekly")
      .setLabel("📅 每週")
      .setStyle(activeCadence === "weekly" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}

function buildQuestCenterMessage(progressList, cadence = "weekly", claimPage = 0) {
  const meta = QUEST_TAB_META[cadence] || QUEST_TAB_META.weekly;
  const lines = [];
  const claimButtons = [];
  const periodKey = progressList?.[0]?.periodKey || null;
  const titleSuffix = periodKey ? `（${periodKey}）` : "";

  for (const { quest, current, claimed, done } of progressList) {
    const bar = buildProgressBar(current, quest.target, 8);
    const status = claimed ? "✅ 已領取" : done ? "🔔 可領取" : "🔲 進行中";
    const rewards = [];
    if (quest.rewardGold) rewards.push(`${quest.rewardGold} 🪙`);
    if (quest.rewardExp) rewards.push(`${quest.rewardExp} ⭐`);
    if (quest.rewardItemSummary) rewards.push(`＋${quest.rewardItemSummary}`);
    else if (quest.rewardItemName) rewards.push(`＋${quest.rewardItemName}`);
    else if (quest.rewardItemId) rewards.push("＋道具");
    const rewardStr = rewards.length ? ` ｜ 獎勵：${rewards.join(" ")}` : "";
    const descStr = quest.description ? `\n${quest.description}` : "";
    lines.push(`**${quest.title}** ${status}${descStr}\n${bar} ${current}／${quest.target}${rewardStr}`);

    if (done && !claimed) {
      claimButtons.push(
        new ButtonBuilder()
          .setCustomId(`quest_claim:${quest.id}:${cadence}`)
          .setLabel(`🎁 領取「${quest.title.slice(0, 16)}」`)
          .setStyle(ButtonStyle.Success)
      );
    }
  }

  const pageSize = 5;
  const totalClaimPages = Math.max(1, Math.ceil(claimButtons.length / pageSize));
  const safeClaimPage = Math.min(Math.max(Number(claimPage) || 0, 0), totalClaimPages - 1);
  const pageStart = safeClaimPage * pageSize;
  const pageButtons = claimButtons.slice(pageStart, pageStart + pageSize);
  const claimPageText = claimButtons.length > pageSize
    ? `\n可領取按鈕：第 ${safeClaimPage + 1} / ${totalClaimPages} 頁`
    : "";

  const content = `${meta.emoji} **${meta.label}**${titleSuffix}\n${meta.resetText}${claimPageText}\n\n${lines.join("\n\n")}`;
  const components = [buildQuestTabRow(cadence)];
  if (pageButtons.length) {
    components.push(new ActionRowBuilder().addComponents(pageButtons));
  }
  if (claimButtons.length > pageSize) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`quest_claim_page:${cadence}:${safeClaimPage - 1}`)
        .setLabel("上一頁")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeClaimPage <= 0),
      new ButtonBuilder()
        .setCustomId(`quest_claim_page:${cadence}:${safeClaimPage + 1}`)
        .setLabel("下一頁")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeClaimPage >= totalClaimPages - 1)
    ));
  }
  return { content, components };
}

async function grantQuestRewardDiscord(serviceContext, discordId, displayName, reward) {
  if (reward.gold > 0) {
    await serviceContext.rewardService.grantCurrency({
      discordId,
      displayName,
      currencyType: "gold",
      amount: reward.gold,
      source: CURRENCY_SOURCES.QUEST_REWARD,
      operator: "quest"
    });
  }
  if (reward.exp > 0) {
    await serviceContext.progressService.grantExp({
      discordId,
      displayName,
      amount: reward.exp,
      source: EXP_SOURCES.QUEST_REWARD_EXP
    });
  }
  // diamond rewards are deprecated.
  if (reward.rewardItemId) {
    const item = await serviceContext.itemRepository.findById(reward.rewardItemId).catch(() => null);
    if (item) {
      const prog = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (prog) {
        if (!Array.isArray(prog.inventory)) prog.inventory = [];
        prog.inventory.push({
          uuid: crypto.randomUUID(),
          itemId: item.id,
          itemName: item.name,
          itemEffect: item.effect || { type: "none", value: 0 },
          useEffects: item.useEffects || [],
          passiveEffects: item.passiveEffects || [],
          procEffects: item.procEffects || [],
          combatEffects: item.combatEffects || [],
          itemType: item.itemType || "consumable",
          imageUrl: item.imageUrl || null,
          imageThumbnailUrl: item.imageThumbnailUrl || null,
          equipSlot: item.equipSlot || null,
          equipStats: item.equipStats || null,
          weaponType: item.weaponType || null,
          isTwoHanded: item.isTwoHanded || false,
          tier: item.tier || null,
          source: "quest",
          obtainedAt: new Date().toISOString()
        });
        prog.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(prog);
      }
      reward.rewardItemName = item.name;
      reward.rewardItemSummary = formatRewardItemLabel(item);
    }
  }
}

async function renderQuestCenter(interaction, cadence = "weekly", prefixText = "", claimPage = 0) {
  const serviceContext = getServiceContext();
  const questService = serviceContext.questService || serviceContext.weeklyQuestService;
  const rawProgressList = await questService.getPlayerProgress(interaction.user.id, cadence);
  const visibleProgressList = rawProgressList.filter((row) => !row?.claimed);
  const progressList = await enrichQuestRewards(serviceContext, visibleProgressList);
  if (!progressList.length) {
    const meta = QUEST_TAB_META[cadence] || QUEST_TAB_META.weekly;
    await safeEditReply(interaction, {
      content: `${meta.emoji} **${meta.label}**\n${meta.resetText}\n\n目前沒有未領取或進行中的任務。`,
      components: [buildQuestTabRow(cadence)]
    });
    return;
  }
  const payload = buildQuestCenterMessage(progressList, cadence, claimPage);
  if (prefixText) {
    payload.content = `${prefixText}\n\n${payload.content}`;
  }
  await safeEditReply(interaction, payload);
}

async function handleWeeklyQuests(interaction, defaultCadence = "weekly") {
  try {
    await clearActiveReply(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await renderQuestCenter(interaction, defaultCadence);
    await rememberActiveReply(interaction, 120_000);
  } catch (err) {
    if (interaction.deferred || interaction.replied) {
      await safeEditReply(interaction, { content: `❌ 讀取任務中心失敗：${err.message}` });
    } else {
      await interaction.reply({ content: `❌ 讀取任務中心失敗：${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleWeeklyQuestClaim(interaction, questId, cadenceHint = "weekly") {
  const serviceContext = getServiceContext();
  const questService = serviceContext.questService || serviceContext.weeklyQuestService;
  const discordId = interaction.user.id;
  const player = await serviceContext.playerRepository.findByDiscordId(discordId);
  const displayName = player?.displayName || interaction.user.username;

  try {
    await interaction.deferUpdate();
    const reward = await questService.claimReward(discordId, questId);
    await grantQuestRewardDiscord(serviceContext, discordId, displayName, reward);

    const rewardParts = [];
    if (reward.gold > 0) rewardParts.push(`${reward.gold} 🪙`);
    if (reward.exp > 0) rewardParts.push(`${reward.exp} ⭐`);
    if (reward.rewardItemSummary) rewardParts.push(reward.rewardItemSummary);
    else if (reward.rewardItemName) rewardParts.push(`「${reward.rewardItemName}」`);
    const rewardDesc = rewardParts.length ? rewardParts.join(" ＋ ") : "（無獎勵）";

    const nextCadence = reward.cadence || cadenceHint || "weekly";
    await renderQuestCenter(interaction, nextCadence, `✅ 已領取「${reward.questTitle}」獎勵：${rewardDesc}`);
  } catch (err) {
    const msg = err.message || "領取失敗";
    await interaction.followUp({ content: `❌ ${msg}`, flags: MessageFlags.Ephemeral });
  }
}

function buildProgressBar(current, target, width = 10) {
  const filled = Math.round((Math.min(current, target) / Math.max(target, 1)) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

async function handleButton(interaction) {
  const id = interaction.customId;

  // 每週任務領取
  if (id.startsWith("wq_claim:")) {
    await handleWeeklyQuestClaim(interaction, id.slice("wq_claim:".length));
    return;
  }
  if (id.startsWith("quest_claim:")) {
    const [, questId = "", cadence = "weekly"] = id.split(":");
    await handleWeeklyQuestClaim(interaction, questId, cadence);
    return;
  }
  if (id.startsWith("quest_claim_page:")) {
    const [, cadence = "weekly", pageText = "0"] = id.split(":");
    const claimPage = Math.max(0, parseInt(pageText, 10) || 0);
    await interaction.deferUpdate();
    await renderQuestCenter(interaction, cadence, "", claimPage);
    return;
  }
  if (id.startsWith("quest_tab:")) {
    const cadence = id.split(":")[1] || "weekly";
    await interaction.deferUpdate();
    await renderQuestCenter(interaction, cadence);
    return;
  }

  // 背包動作
  if (id.startsWith("backpack_tab:")) {
    const parts = id.slice("backpack_tab:".length).split(":");
    const tab = parts[0] || "item";
    const subTab = parts.length >= 3 ? (parts[1] || "all") : "all";
    const page = parseInt(parts.length >= 3 ? (parts[2] ?? "0") : (parts[1] ?? "0"), 10) || 0;
    if (BACKPACK_SECTION_TABS.has(tab)) {
      await openBackpackSection(interaction, tab, page, subTab);
    } else {
      await handleBackpackTab(interaction, tab, page, subTab);
    }
    return;
  }
  if (id === "backpack_home") {
    await interaction.deferUpdate();
    const serviceContext = getServiceContext();
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const inventory = progress?.inventory || [];
    const msg = buildBackpackMessage(inventory, "item");
    await interaction.followUp({ ...msg, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id.startsWith("backpack_subtab:")) {
    const parts = id.slice("backpack_subtab:".length).split(":");
    const tab = parts[0];
    const subTab = parts[1] || "all";
    const page = parseInt(parts[2] ?? "0", 10) || 0;
    await handleBackpackTab(interaction, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_prev:") || id.startsWith("backpack_next:")) {
    const parts = id.split(":");
    const tab = parts[1] || "item";
    const subTab = parts.length >= 4 ? (parts[2] || "all") : "all";
    const page = parseInt(parts.length >= 4 ? (parts[3] ?? "0") : (parts[2] ?? "0"), 10) || 0;
    await handleBackpackTab(interaction, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_page_input:")) {
    const parts = id.split(":");
    const tab = parts[1] || "item";
    const subTab = parts.length >= 5 ? (parts[2] || "all") : "all";
    const currentPage = parseInt(parts.length >= 5 ? (parts[3] ?? "0") : (parts[2] ?? "0"), 10) || 0;
    const totalPages = Math.max(1, parseInt(parts.length >= 5 ? (parts[4] ?? "1") : (parts[3] ?? "1"), 10) || 1);
    const modal = new ModalBuilder()
      .setCustomId(`backpack_page_modal:${tab}:${subTab}:${totalPages}`)
      .setTitle("跳轉背包頁數");
    const input = new TextInputBuilder()
      .setCustomId("target_page")
      .setLabel(`請輸入頁數（1 ~ ${totalPages}）`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder(String(Math.min(totalPages, currentPage + 1)));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }
  if (id.startsWith("backpack_equip:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 5 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 5 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    await handleBackpackEquip(interaction, uuid, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_view:")) {
    await handleBackpackView(interaction, id.slice("backpack_view:".length));
    return;
  }
  if (id.startsWith("backpack_use:") || id.startsWith("backpack_discard:")) {
    const action = id.startsWith("backpack_use:") ? "use" : "discard";
    const uuid = id.slice(id.indexOf(":") + 1);
    await handleBackpackAction(interaction, action, uuid);
    return;
  }
  if (id.startsWith("backpack_sell_confirm:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 5 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 5 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    await handleBackpackSellConfirm(interaction, uuid, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_sell_bulk_confirm:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 6 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 6 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    const qty = parseInt(parts.length >= 6 ? (parts[5] ?? "1") : (parts[4] ?? "1"), 10) || 1;
    await handleBackpackSellBulkExecute(interaction, uuid, tab, page, qty, subTab);
    return;
  }
  if (id.startsWith("backpack_sell_cancel:")) {
    const parts = id.split(":");
    const tab = parts[1] || "item";
    const subTab = parts.length >= 4 ? (parts[2] || "all") : "all";
    const page = parseInt(parts.length >= 4 ? (parts[3] ?? "0") : (parts[2] ?? "0"), 10) || 0;
    await interaction.deferUpdate();
    const serviceContext = getServiceContext();
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const msg = buildBackpackMessage(progress?.inventory || [], tab, "已取消販售。", page, subTab);
    await safeEditReply(interaction, msg);
    return;
  }
  if (id.startsWith("backpack_sell:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 5 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 5 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    await handleBackpackSell(interaction, uuid, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_sell_bulk:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 5 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 5 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    await handleBackpackSellBulkPrompt(interaction, uuid, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_enhance:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 5 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 5 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    await handleBackpackEnhance(interaction, uuid, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_enhance_confirm:")) {
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 5 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 5 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    await handleBackpackEnhanceConfirm(interaction, uuid, tab, page, subTab);
    return;
  }
  if (id.startsWith("backpack_enhance_cancel:")) {
    const parts = id.split(":");
    const tab = parts[1] || "item";
    const subTab = parts.length >= 4 ? (parts[2] || "all") : "all";
    const page = parseInt(parts.length >= 4 ? (parts[3] ?? "0") : (parts[2] ?? "0"), 10) || 0;
    await handleBackpackTab(interaction, tab, page, subTab);
    return;
  }
  if (id === "enhance_back") {
    await interaction.deferUpdate();
    await handleEnhanceEntry(interaction);
    return;
  }
  if (id.startsWith("enhance_mode:")) {
    const parts = id.split(":");
    const mode = parts[1] || ENHANCE_MODE_NORMAL;
    const targetUuid = parts.slice(2).join(":");
    await handleEnhanceSelect(interaction, targetUuid, mode);
    return;
  }
  if (id.startsWith("enhance_auto:")) {
    const parts = id.split(":");
    if (parts.length >= 3) {
      const mode = parts[1] || ENHANCE_MODE_NORMAL;
      const targetUuid = parts.slice(2).join(":");
      await handleEnhanceAuto(interaction, targetUuid, mode);
    } else {
      await handleEnhanceAuto(interaction, id.slice("enhance_auto:".length), ENHANCE_MODE_NORMAL);
    }
    return;
  }
  if (id === BUTTON_IDS.enhance) {
    await handleEnhanceEntry(interaction);
    return;
  }
  if (id.startsWith("reroll_confirm:")) {
    await handleRerollConfirm(interaction, id.slice("reroll_confirm:".length));
    return;
  }
  if (id === "reroll_cancel") {
    await interaction.deferUpdate();
    const progress = await getServiceContext().progressRepository.findByPlayerId(interaction.user.id);
    const msg = buildBackpackMessage(progress?.inventory || [], "item");
    await safeEditReply(interaction, msg);
    return;
  }

  // 裝備欄格按鈕
  if (id.startsWith("eq_btn:")) {
    await handleEquipSlotButton(interaction, id.slice("eq_btn:".length));
    return;
  }

  // 裝備分頁切換
  if (id.startsWith("eq_preset:")) {
    await handleEquipPresetSwitch(interaction, id.slice("eq_preset:".length));
    return;
  }

  // 裝備動作（舊版相容）
  if (id.startsWith("equip_equip:") || id.startsWith("equip_unequip:")) {
    const action = id.startsWith("equip_equip:") ? "equip" : "unequip";
    const value = id.slice(id.indexOf(":") + 1);
    await handleEquipAction(interaction, action, value);
    return;
  }

  if (!Object.values(BUTTON_IDS).includes(id)) {
    return;
  }

  const serviceContext = getServiceContext();
  const allowed = await serviceContext.accessControlService.isDiscordPlayerAllowed(interaction);
  if (!allowed) {
    await replyPlayerBlocked(interaction);
    return;
  }

  if (id === BUTTON_IDS.profile) {
    await handleProfile(interaction);
    return;
  }

  if (id === BUTTON_IDS.transactions) {
    await handleTransactions(interaction);
    return;
  }

  if (id === BUTTON_IDS.checkinStatus) {
    await handleCheckinStatus(interaction);
    return;
  }

  if (id === BUTTON_IDS.backpack) {
    await handleBackpack(interaction);
    return;
  }

  if (id === BUTTON_IDS.equipment) {
    await handleEquipmentView(interaction);
    return;
  }

  if (id === BUTTON_IDS.weeklyQuests) {
    await handleWeeklyQuests(interaction, "onboarding");
    return;
  }

  if (id === BUTTON_IDS.bindStream) {
    await handleBind(interaction);
    return;
  }
}

async function handleEquipSlotButton(interaction, slot) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const equipped = progress?.equipment || {};
  const inventory = (progress?.inventory || []).filter((e) => {
    if (!e) return false;
    if (e.itemType === "job_badge") return e.equipSlot === slot;
    if (e.itemType === "equipment") {
      if (e.equipSlot === slot) return true;
      if (slot.startsWith("special_") && e.equipSlot === "special") return true;
      return false;
    }
    if (e.itemType === "monster_card") {
      return slot.startsWith("special_");
    }
    return false;
  });

  const getItemLabel = (item) => String(item?.itemName || item?.name || item?.itemId || item?.uuid || "未知道具");

  const options = [];
  if (equipped[slot]) {
    const item = equipped[slot];
    options.push({
      label: `↩️ 卸下`.slice(0, 25),
      description: getItemLabel(item).slice(0, 50),
      value: `unequip:${slot}`
    });
  }
  inventory.slice(0, 24).forEach(e => {
    const stats = e.equipStats || {};
    const statStr = Object.entries(stats).filter(([,v])=>v).map(([k,v])=>`${k.toUpperCase()}${v>0?"+":""}${v}`).join(" ");
    options.push({
      label: getItemLabel(e).slice(0, 25),
      description: (statStr || "點此裝備").slice(0, 50),
      value: `equip:${e.uuid}`
    });
  });

  if (options.length === 0) {
    await safeEditReply(interaction, { content: `❌ 背包沒有可裝備在 **${EQ_SLOT_LABELS[slot]}** 的道具，且此槽位是空的。`, components: [], files: [] });
    return;
  }

  const picker = new StringSelectMenuBuilder()
    .setCustomId(`eq_pick:${slot}`)
    .setPlaceholder(`${EQ_SLOT_LABELS[slot]} — 選擇動作…`)
    .addOptions(options);

  await safeEditReply(interaction, {
    content: `⚔️ **${EQ_SLOT_LABELS[slot]}** — 選擇裝備或卸下：`,
    components: [new ActionRowBuilder().addComponents(picker)],
    files: []
  });
}

async function handleEquipmentSelect(interaction) {
  const serviceContext = getServiceContext();
  const customId = interaction.customId;
  if (!customId.startsWith("eq_pick:")) return;

  await interaction.deferUpdate();
  const slot = customId.slice("eq_pick:".length);
  const value = interaction.values[0];
  try {
    let result;
    if (value.startsWith("unequip:")) {
      result = await serviceContext.shopService.unequipItem(interaction.user.id, slot);
      await safeEditReply(interaction, { content: `✅ 已卸下 **${result.itemName}**，放回背包。`, components: [], files: [] });
    } else {
      const uuid = value.slice("equip:".length);

      // 檢查是否是怪物卡片，自動穿上第一個空槽位
      const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
      const item = progress?.inventory?.find(i => i.uuid === uuid);
      let targetSlot = null;

      if (item?.equipSlot === "special" || item?.itemType === "monster_card") {
        const SPECIAL_SLOTS = ["special_1", "special_2", "special_3"];
        const equipped = progress?.equipment || {};
        targetSlot = SPECIAL_SLOTS.find(s => !equipped[s]) || SPECIAL_SLOTS[0];
      }

      result = await serviceContext.shopService.equipItem(interaction.user.id, uuid, targetSlot);
      await safeEditReply(interaction, { content: `✅ 已裝備 **${result.itemName}**！`, components: [], files: [] });
    }
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 操作失敗：${err.message}`, components: [], files: [] });
  }
}

async function handleModal(interaction) {
  // 處理消耗品堆疊數量選擇
  if (interaction.customId.startsWith("consumable_quantity:")) {
    const uuid = interaction.customId.slice("consumable_quantity:".length);
    const quantityStr = interaction.fields.getTextInputValue("quantity_input").trim();
    const quantity = parseInt(quantityStr, 10);

    if (!Number.isFinite(quantity) || quantity < 1) {
      await interaction.reply({ content: "❌ 請輸入有效的數字。", flags: MessageFlags.Ephemeral });
      return true;
    }

    const serviceContext = getServiceContext();
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const entry = (progress?.inventory || []).find(e => e.uuid === uuid);

    if (!entry) {
      await interaction.reply({ content: "❌ 找不到該道具。", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (quantity > (entry.stackCount || 1)) {
      await interaction.reply({ content: `❌ 數量超出持有量 (最多 ${entry.stackCount || 1})。`, flags: MessageFlags.Ephemeral });
      return true;
    }

    try {
      // 先減少堆疊數量，再調用使用邏輯
      for (let i = 0; i < quantity; i++) {
        await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username);
      }

      // 重新載入背包
      const updatedProgress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
      const inventory = updatedProgress?.inventory || [];
      const msg = buildBackpackMessage(inventory, "item", `✅ 已使用 **${entry.itemName}** ×${quantity}。`);

      await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
      await rememberActiveReply(interaction, 120_000);
    } catch (err) {
      await interaction.reply({ content: `❌ 使用失敗：${err.message}`, flags: MessageFlags.Ephemeral });
    }

    return true;
  }

  if (interaction.customId.startsWith("backpack_sell_bulk_modal:")) {
    const parts = interaction.customId.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts.length >= 5 ? (parts[3] || "all") : "all";
    const page = parseInt(parts.length >= 5 ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0;
    await handleBackpackSellBulkConfirm(interaction, uuid, tab, page, subTab);
    return true;
  }

  if (!interaction.customId.startsWith("backpack_page_modal:")) return false;

  const parts = interaction.customId.split(":");
  const tab = parts[1] || "item";
  const subTab = parts.length >= 4 ? (parts[2] || "all") : "all";
  const totalRaw = parts.length >= 4 ? (parts[3] || "1") : (parts[2] || "1");
  const totalPages = Math.max(1, parseInt(totalRaw, 10) || 1);
  const raw = interaction.fields.getTextInputValue("target_page").trim();
  const parsedPage = parseInt(raw, 10);
  const targetPage = Number.isFinite(parsedPage)
    ? Math.min(totalPages, Math.max(1, parsedPage)) - 1
    : 0;

  const serviceContext = getServiceContext();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const msg = buildBackpackMessage(inventory, tab, undefined, targetPage, subTab);

  await clearActiveReply(interaction);
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  await rememberActiveReply(interaction, 120_000);
  return true;
}

module.exports = {
  createPlayerPanelMessage,
  handleButton,
  handleEquipmentSelect,
  handlePresetSwitchSelect,
  handleBackpackTabSelect,
  handleWeeklyQuests,
  handleWeeklyQuestClaim,
  handleEnhanceEntry,
  handleEnhanceSelect,
  handleEnhanceConfirm,
  handleModal,
};
