const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const { createHash } = require("crypto");
const { BUTTON_IDS, createPlayerPanelMessage } = require("./playerPanelView");
const { expToNextLevel, MAX_LEVEL } = require("../shared/progression");
const config = require("../config");
const { createCode } = require("./bindingStore");
const { renderEquipmentCard, LEFT_SLOTS: EQ_LEFT_SLOTS, RIGHT_SLOTS: EQ_RIGHT_SLOTS, COL3_SLOTS: EQ_COL3_SLOTS, SLOT_LABELS: EQ_SLOT_LABELS } = require("./equipmentCardRenderer");
const { calcPlayerStats, getWeaponConfig } = require("../shared/combatStats");
const { isGemEntry: isGemEntryForSell, DISMANTLE_YIELD, DISMANTLE_SUCCESS_RATE, getElementStoneRate } = require("../services/shop/shopService");
const { pushBonusWeaponToInventory, pushRewardItemsToInventory } = require("../shared/jobBadgeBonus");
const { TIER_SET_SLOTS, getTierSetInfo } = require("../shared/equipmentTierSetBonuses");
const { getEquippedSetInfo } = require("../shared/equipmentSetBonuses");
const { getElementLabel } = require("../shared/elementSystem");
const { summarizeEquippedEnchantments } = require("../shared/enchantEngine");
const { EFFECT_NAME_ZH } = require("../shared/effectDisplayNames");
const { isEffectConditionMet, mergeEquippedFromLibrary } = require("../shared/effectEngine");
const { calcScaledAuraValue, getSupportJobKey } = require("../shared/supportAuraScaling");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../shared/sources");
const { MAX_ENHANCE_LEVEL, getEnhanceCost } = require("../shared/enhanceConfig");
const { bestiaryRequirement, bestiaryBonusPct } = require("../shared/bestiary");
const { ALL_ZONE_KEYS, ZONE_BY_KEY } = require("../shared/zones");
const { isWorldBossZone } = require("../services/worldBoss/worldBossService");

const ACTIVE_REPLY_BY_USER = new Map();

// 裝備卡圖片快取：相同裝備 + 頭像不重新渲染
const _equipCardCache = new Map(); // playerId → { hash, buffer }
function _equipCardHash(equipped, avatarUrl, progress, player, wallet) {
  const key = JSON.stringify({
    eq: equipped || {},
    lv: progress?.level,
    job: progress?.job,
    attrs: progress?.attributes,
    gold: wallet?.gold,
    name: player?.displayName,
    avatar: avatarUrl || "",
  });
  return createHash("sha1").update(key).digest("hex");
}
async function renderEquipmentCardCached({ equipped, avatarUrl, publicDir, progress, player, wallet }) {
  const playerId = progress?.playerId;
  const hash = _equipCardHash(equipped, avatarUrl, progress, player, wallet);
  const cached = playerId ? _equipCardCache.get(playerId) : null;
  if (cached?.hash === hash) return cached.buffer;
  const buffer = await renderEquipmentCard({ equipped, avatarUrl, publicDir, progress, player, wallet });
  if (playerId) {
    if (_equipCardCache.size >= 100) {
      for (const k of [..._equipCardCache.keys()].slice(0, 20)) _equipCardCache.delete(k);
    }
    _equipCardCache.set(playerId, { hash, buffer });
  }
  return buffer;
}
const ENHANCE_MODE_NORMAL = "normal";
const ENHANCE_MODE_GAMBLE = "gamble";
const GAMBLE_MIN_ENHANCE_LEVEL = 1;
const AURA_STAT_LABELS = { str: "STR", agi: "AGI", vit: "VIT", int: "INT", dex: "DEX", luk: "LUK" };

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

  const { transactionSourceLabel, currencyLabelZh } = require("../shared/transactionLabels");
  return rows
    .map((row) => {
      const sign = row.direction === "debit" ? "-" : "+";
      const meta = transactionSourceLabel(row.source);
      return `${meta.icon} ${meta.label}　${currencyLabelZh(row.currencyType)} ${sign}${Math.abs(row.amount).toLocaleString()}　餘額 ${Number(row.balanceAfter || 0).toLocaleString()}`;
    })
    .join("\n");
}

function taipeiDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
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

async function replyAndAutoDelete(interaction, content, components = null) {
  // 支援「已 defer」的情況：先 deferReply 過的 handler 走 editReply，否則才 reply
  const payload = components ? { content, components } : { content, components: [] };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
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

const DEPRECATED_JOB_PASSIVE_KEYS = new Set([
  "execute_chance_up",
  "execute_threshold_up",
]);

function formatSignedPct(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return null;
  return `${n > 0 ? "+" : ""}${n}%`;
}

const WEAPON_TYPE_LABELS = {
  sword_1h: "單手劍",
  sword_2h: "雙手劍",
  mace_1h: "單手槌",
  mace_2h: "雙手槌",
  axe_1h: "單手斧",
  axe_2h: "雙手斧",
  dagger: "匕首",
  staff_1h: "單手法杖",
  staff_2h: "雙手法杖",
  bow: "弓",
  dice: "骰子",
  offhand_sword: "副手劍",
  offhand_dagger: "副手匕首",
  offhand_mace: "副手槌"
};

const BASE_STAT_LABELS = {
  str: "STR",
  agi: "AGI",
  int: "INT",
  dex: "DEX"
};

function formatEquipStats(stats = {}) {
  const parts = [];
  for (const key of ["str", "agi", "vit", "int", "dex", "luk"]) {
    const value = Number(stats?.[key] || 0);
    if (Number.isFinite(value) && value !== 0) parts.push(`${key.toUpperCase()} ${value > 0 ? "+" : ""}${value}`);
  }
  return parts.join("、");
}

function formatEffectCondition(condition = {}) {
  if (!condition || typeof condition !== "object") return "";
  const weaponMap = {
    sword_1h: "單手劍",
    sword_2h: "雙手劍",
    mace_1h: "單手槌",
    mace_2h: "雙手槌",
    axe_1h: "單手斧",
    axe_2h: "雙手斧",
    dagger: "匕首",
    staff_1h: "單手法杖",
    staff_2h: "雙手法杖",
    bow: "弓",
    dice: "骰子"
  };
  const weaponTypes = [];
  if (condition.weaponType) weaponTypes.push(condition.weaponType);
  if (Array.isArray(condition.any)) {
    for (const entry of condition.any) {
      if (entry?.weaponType) weaponTypes.push(entry.weaponType);
    }
  }
  if (weaponTypes.length > 0) {
    return `（需${weaponTypes.map((type) => weaponMap[type] || type).join(" / ")}）`;
  }
  return "";
}

function formatSkillCondition(condition = {}) {
  const parts = [];
  if (Number.isFinite(Number(condition.ownerHpBelowPct))) parts.push(`自身HP<${condition.ownerHpBelowPct}%`);
  if (Number.isFinite(Number(condition.ownerHpAbovePct))) parts.push(`自身HP>${condition.ownerHpAbovePct}%`);
  if (Number.isFinite(Number(condition.targetHpBelowPct))) parts.push(`敵方HP<${condition.targetHpBelowPct}%`);
  return parts.length ? `條件：${parts.join("、")}；` : "";
}

function formatJobSkillLine(skill) {
  const cooldown = Number(skill?.cooldownTurns || 0);
  const cooldownText = cooldown > 0 ? `CD ${cooldown}回合；` : "";
  const conditionText = formatSkillCondition(skill?.condition || {});
  const detailText = [conditionText, cooldownText, skill?.description || ""].filter(Boolean).join("");
  return `・${skill?.name || skill?.key || "未命名技能"}：${detailText || "效果未設定"}`;
}

function formatPassiveNote(note) {
  return String(note || "")
    .replace(/攻擊倍率\s*[x×]\s*\d+(?:\.\d+)?/gi, "攻擊強化")
    .replace(/\s*[x×]\s*\d+(?:\.\d+)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPassiveEffect(effect, context) {
  if (!effect || !effect.key) return null;
  const active = isEffectConditionMet(effect, context);
  if (!active) return null;
  const note = formatPassiveNote(effect.notes || effect.description || "");
  const name = EFFECT_NAME_ZH[effect.key] || effect.key;
  const value = Number(effect?.params?.value);
  const valueText = Number.isFinite(value) ? ` ${value > 0 ? "+" : ""}${value}${effect?.params?.mode === "pct" ? "%" : ""}` : "";
  const targetText = effect.target === "party" ? "隊伍：" : effect.target === "enemy" ? "敵方：" : "";
  const conditionText = formatEffectCondition(effect.condition);
  const jobKey = effect.target === "party" ? getSupportJobKey({ equipped: context?.equipped || {} }) : null;
  const isPctAura = effect.target === "party" && jobKey && effect?.params?.mode === "pct" && Number.isFinite(value);
  if (isPctAura) {
    const scaled = calcScaledAuraValue(jobKey, effect.key, context?.providerStats || {}, value);
    const total = Number(scaled.value || value);
    const extra = Math.max(0, Math.round((total - value) * 10) / 10);
    const statText = scaled.statKey ? ` / ${AURA_STAT_LABELS[scaled.statKey] || scaled.statKey}` : "";
    return `・${targetText}${note || `${name}${valueText}`}（基礎 ${value}% + 追加 ${extra}%${statText}）${conditionText}`;
  }
  return `・${targetText}${note || `${name}${valueText}`}${conditionText}`;
}

function buildWeaponEffectLines(cs, equipped = {}) {
  const weaponType = cs.weaponType;
  if (!weaponType) return [];

  const cfg = getWeaponConfig(weaponType) || {};
  const weaponName = equipped?.weapon?.itemName || equipped?.weapon?.name || WEAPON_TYPE_LABELS[weaponType] || "武器";
  // 主屬性優先用戰鬥計算後的動態值(cs.weaponMainStat)，才能反映盜賊+匕首→AGI 等徽章加成
  const mainStatKey = cs.weaponMainStat || cfg.baseStat || "str";
  const baseStat = BASE_STAT_LABELS[mainStatKey] || String(mainStatKey).toUpperCase();
  const lines = [`🔸 武器：${weaponName}（${WEAPON_TYPE_LABELS[weaponType] || weaponType}，主屬性 ${baseStat}）`];

  const parts = [];
  if (Number(cs.combo || 0) > 0 && Number(cfg.comboBonus || 0) > 0) parts.push(`連擊率 ${formatSignedPct(cfg.comboBonus)}`);
  if (Number(cs.stunChance || 0) > 0) parts.push(`擊暈機率 ${Math.ceil(cs.stunChance)}%`);
  if (Number(cs.armorBreakChance || 0) > 0) parts.push(`破防機率 ${Math.ceil(cs.armorBreakChance)}%`);
  if (Number(cs.bypassMonsterDefPct || 0) > 0) parts.push(`無視怪物 DEF ${Math.ceil(cs.bypassMonsterDefPct)}%`);
  if (Number(cfg.critBonus || 0) > 0) parts.push(`暴擊率 ${formatSignedPct(cfg.critBonus)}`);
  if (Number(cfg.dodgeBonus || 0) > 0) parts.push(`迴避 ${formatSignedPct(cfg.dodgeBonus)}`);
  if (Number(cs.monsterAttackCount || 1) > 1) parts.push(`怪物攻擊次數 ×${cs.monsterAttackCount}`);
  if (cs.isDualWield) {
    const counterText = Number(cs.counterChance || 0) > 0 ? `副手追擊 ${Math.ceil(cs.counterChance)}%` : "副手追擊";
    parts.push(counterText);
  }

  if (parts.length > 0) lines.push(`⚙️ 武器效果：${parts.join("、")}`);
  // 武器附帶的特殊被動（例：S 龍系武器「屠龍特攻」於龍族之領/龍王巢穴 +20%）
  const weaponPassives = Array.isArray(equipped?.weapon?.passiveEffects) ? equipped.weapon.passiveEffects : [];
  for (const pe of weaponPassives) {
    const note = pe?.notes || pe?.description;
    if (note) lines.push(`🐉 武器特效：${note}`);
  }
  if (cs.hasDwarfWarriorBadge && weaponType.startsWith("mace")) {
    const highHpStun = Number(cs.stunChance || 0) + Number(cs.dwarfWarriorHighHpStunBoost || 0);
    if (highHpStun > Number(cs.stunChance || 0)) {
      lines.push(`🔨 矮人擊暈：HP≥60% 時 ${Math.ceil(highHpStun)}%`);
    }
    if (Number(cs.dwarfWarriorBonusVsStunnedPct || 0) > 0) {
      lines.push(`😵 對暈眩目標傷害 +${Math.ceil(cs.dwarfWarriorBonusVsStunnedPct)}%`);
    }
  }
  return lines;
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
  // 履歷要讀多筆 DB（getProfile→fallback→mergeEquipped），先 defer 避免 3 秒未回應而「互動失敗」
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }
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
  const tierLine = p.playerTier ? `\n玩家位階：**${p.playerTier}級**` : "";
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
  const cs = calcPlayerStats(attrs, equipped, p.activeEffects || [], p.inventory || [], { petStat: require("../shared/petDex").statBonusOf(p?.petDex) });
  const calcHp    = Math.ceil(cs.maxHp);
  const calcAtk   = Math.ceil(cs.atk);
  const calcDef   = Math.ceil(cs.def);
  const calcCrit  = Math.ceil(cs.crit);
  const calcCombo = Math.ceil(cs.combo);
  const calcDodge = Math.ceil(cs.dodge || 0);
  const calcBlock = Math.ceil(cs.blockChance || 0);
  const calcHit   = Math.ceil(cs.hit || 0);

  // ── 裝備屬性加成 ──
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in bonus) bonus[k] += (v || 0);
    }
  }
  const fmt = (base, key) => bonus[key] > 0 ? `${base} (+${bonus[key]})` : `${base}`;

  // ── 武器特效說明：只從 combatStats 最新計算結果生成，不使用舊硬寫文字 ──
  const wt = cs.weaponType;
  const effectLineParts = buildWeaponEffectLines(cs, equipped);
  const effectLine = effectLineParts.length ? "\n" + effectLineParts.join("\n") : "";
  const tierSetBonuses = cs.tierSetBonuses || { tierCounts: {} };
  // 階級套裝（D/C/B/A）：按身上同階件數給加成，與具名套裝「同時生效、疊加」。
  const tierSetInfo = getTierSetInfo(equipped);
  const tierSetLines = tierSetInfo.map((s) => {
    const tierTxt = s.tiers.map((t) => `${t.active ? "✅" : "▫️"}${t.count}件:${t.desc}`).join("　");
    return `🏅 ${s.name}（${s.count}件）\n　${tierTxt}`;
  });
  const tierSetLine = tierSetLines.length ? `\n【階級套裝】\n${tierSetLines.join("\n")}` : "";
  // 具名套裝（秘銀套/火焰套…）：顯示歸屬 + 每階效果 + 目前進度
  const namedSetInfo = getEquippedSetInfo(equipped);
  const namedSetLines = namedSetInfo.map((s) => {
    const tierTxt = s.tiers.map((t) => `${t.active ? "✅" : "▫️"}${t.count}件:${t.desc}`).join("　");
    return `👕 ${s.name}（${s.count}件）${s.note ? " " + s.note : ""}\n　${tierTxt}`;
  });
  const namedSetLine = namedSetLines.length ? `\n【套裝】\n${namedSetLines.join("\n")}` : "";
  const tierSummaryParts = [
    tierSetBonuses.damagePct ? `傷害 ${formatSignedPct(tierSetBonuses.damagePct)}` : null,
    tierSetBonuses.finalDamagePct ? `最終傷害 ${formatSignedPct(tierSetBonuses.finalDamagePct)}` : null,
    tierSetBonuses.bossDamagePct ? `Boss傷害 ${formatSignedPct(tierSetBonuses.bossDamagePct)}` : null,
    tierSetBonuses.critRatePct ? `暴擊率 ${formatSignedPct(tierSetBonuses.critRatePct)}` : null,
    tierSetBonuses.critDamagePct ? `暴擊傷害 ${formatSignedPct(tierSetBonuses.critDamagePct)}` : null,
    tierSetBonuses.hitPct ? `命中 ${formatSignedPct(tierSetBonuses.hitPct)}` : null,
    tierSetBonuses.dodgePct ? `迴避 ${formatSignedPct(tierSetBonuses.dodgePct)}` : null,
    tierSetBonuses.goldPct ? `金幣 ${formatSignedPct(tierSetBonuses.goldPct)}` : null,
    tierSetBonuses.expPct ? `EXP ${formatSignedPct(tierSetBonuses.expPct)}` : null,
    tierSetBonuses.dropPct ? `掉落 ${formatSignedPct(tierSetBonuses.dropPct)}` : null,
  ].filter(Boolean);
  const tierSummaryLine = tierSummaryParts.length ? `\n📦 套裝總加成：${tierSummaryParts.join("、")}` : "";

  // ── 附魔總和（全身裝備附魔跨件加總；屬性類/效果類分列）──
  const fmtEnch = (e) => `${e.label} ${e.value >= 0 ? "+" : ""}${e.value}${e.unit || ""}`;
  const enchTotals = summarizeEquippedEnchantments(equipped);
  const enchAttrTxt = enchTotals.filter((e) => !e.isEffect).map(fmtEnch);
  const enchEffTxt = enchTotals.filter((e) => e.isEffect).map(fmtEnch);
  const enchantLines = [];
  if (enchAttrTxt.length) enchantLines.push(`　屬性：${enchAttrTxt.join("、")}`);
  if (enchEffTxt.length) enchantLines.push(`　效果：${enchEffTxt.join("、")}`);
  const enchantTotalLine = enchantLines.length ? `\n🔮 附魔總和\n${enchantLines.join("\n")}` : "";

  // ── 職業區（只顯示職業名稱）──
  const jobAreaLine = `職業：${p.job || "Novice"} (Job ${p.jobLevel || 1})`;

  // ── 職業特性區（顯示職業名稱，穿對武器時顯示特性）──
  const jobEq = equipped.job_eq || null;
  let jobTraitAreaLine = "職業：無（未裝備職業徽章）";

  if (jobEq) {
    const jobId = String(jobEq.itemId || jobEq.id || "").toLowerCase();
    const jobName = String(jobEq.itemName || jobEq.name || "").toLowerCase();
    const wt = cs.weaponType;
    // ⭐ 職業判定一律走 jobAdvancement.resolveJobKey（唯一入口）：
    //    二轉徽章會解析回一轉 key，個人資料才會顯示正確的職業說明
    //    （劍鬼 id 是 swordoni、名字沒有「劍士」，舊的字串比對會整組落空）。
    const _jk = (() => {
      try { return require("../shared/jobAdvancement").resolveJobKey(jobEq); } catch (_) { return null; }
    })();
    const isArcherJob = _jk === "archer";
    const isSwordsmanJob = _jk === "swordsman";
    const isWarriorJob = _jk === "warrior";
    const isDwarfJob = _jk === "dwarf_warrior";
    const isRogueJob = _jk === "rogue";
    const isMageJob = _jk === "mage";
    const isHealerJob = _jk === "healer";
    const isTacticianJob = _jk === "tactician";
    const isBardJob = _jk === "bard";
    const isBarrierMageJob = _jk === "barrier_mage";
    const isGamblerJob = _jk === "gambler";

    const jobDisplayName = jobEq.itemName || jobEq.name || "未知職業";
    const jobStatLine = formatEquipStats(jobEq.equipStats)
      ? `\n徽章屬性：${formatEquipStats(jobEq.equipStats)}`
      : "";

    // 職業裝備加成
    const jobBonusParts = [];
    for (const eff of (jobEq.passiveEffects || [])) {
      const v = eff?.params?.value;
      if (!v) continue;
      if (eff.key === 'gold_gain_up')  jobBonusParts.push(`金幣 +${v}%`);
      if (eff.key === 'exp_gain_up')   jobBonusParts.push(`經驗 +${v}%`);
      if (eff.key === 'drop_rate_up')  jobBonusParts.push(`掉落 +${v}%`);
      if (eff.key === 'rare_drop_rate_up') jobBonusParts.push(`稀有掉落 +${v}%`);
    }
    const jobBonusLine = jobBonusParts.length ? `\n結算加成：${jobBonusParts.join("、")}` : "";

    const bonusLine = jobBonusLine;
    const activeJobEffects = [
      ...(Array.isArray(jobEq.passiveEffects) ? jobEq.passiveEffects : []),
      ...(Array.isArray(jobEq.procEffects) ? jobEq.procEffects : []),
      ...(Array.isArray(jobEq.combatEffects) ? jobEq.combatEffects : []),
    ];
    const passiveLines = activeJobEffects
      .filter((effect) => !DEPRECATED_JOB_PASSIVE_KEYS.has(effect?.key))
      .map((effect) => formatPassiveEffect(effect, { equipped, inventory: p.inventory || [], providerStats: cs }))
      .filter(Boolean);
    const passiveLine = passiveLines.length ? `\n徽章效果：\n${passiveLines.join("\n")}` : "";
    const mechanicLines = [];
    if (isDwarfJob) {
      if (wt && wt.startsWith("mace")) {
        if (Number(cs.dwarfWarriorHighHpStunBoost || 0) > 0) mechanicLines.push(`・HP≥60% 時擊暈 +${cs.dwarfWarriorHighHpStunBoost}%`);
        if (Number(cs.dwarfWarriorBonusVsStunnedPct || 0) > 0) mechanicLines.push(`・對暈眩目標傷害 +${cs.dwarfWarriorBonusVsStunnedPct}%`);
      }
    }
    if (isSwordsmanJob && Number(cs.blockChance || 0) > 0) {
      mechanicLines.push(`・劍系格擋/反擊：目前格擋 ${Math.ceil(cs.blockChance || 0)}%`);
    }
    if (isWarriorJob && Number(cs.armorBreakChance || 0) > 0) {
      mechanicLines.push(`・斧系破防：目前破防 ${cs.armorBreakChance || 0}%；低血量時會提高傷害`);
    }
    if (isRogueJob && wt === "dagger") {
      mechanicLines.push(`・匕首連擊：目前連擊 ${Math.ceil(cs.combo || 0)}%`);
    }
    if (isArcherJob && wt === "bow") {
      mechanicLines.push(`・弓系機動：目前迴避 ${Math.ceil(cs.dodge || 0)}%`);
    }
    if (isGamblerJob && wt === "dice") {
      mechanicLines.push(`・骰子賭運：ATK 吃 LUK（目前 ${cs.luk}）；目前爆擊 ${Math.ceil(cs.crit || 0)}%`);
    }
    if (isMageJob && wt && wt.startsWith("staff") && Number(cs.bypassMonsterDefPct || 0) > 0) {
      mechanicLines.push(`・法杖魔法：無視怪物 DEF ${cs.bypassMonsterDefPct}%`);
    }
    const mechanicLine = mechanicLines.length ? `\n武器搭配生效：\n${mechanicLines.join("\n")}` : "";

    // 職業技能只讀道具庫同步後的 jobSkills，避免面板內建舊資料蓋過最新設計。
    const jobSkills = Array.isArray(jobEq.jobSkills) ? jobEq.jobSkills : [];
    const skillLine = jobSkills.length > 0
      ? `\n主動技能：每回合約35%機率從可用技能中發動1個\n${jobSkills.map(formatJobSkillLine).join("\n")}`
      : "";
    jobTraitAreaLine = `職業：${jobDisplayName}${jobStatLine}${passiveLine}${mechanicLine}${skillLine}${bonusLine}`;
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
    title_eq: "🏅", job_eq: "📖", special_1: "✨", special_2: "✨", special_3: "✨", anchor: "⚓"
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

  // ── 稱號加成（獨立計算）──
  let titleBonusSection = "";
  const titleEqFinal = equipped.title_eq;
  if (titleEqFinal) {
    const titleBonusParts = [];
    for (const eff of (titleEqFinal.passiveEffects || [])) {
      const v = eff?.params?.value;
      if (!v) continue;
      if (eff.key === 'gold_gain_up')  titleBonusParts.push(`金幣 +${v}%`);
      if (eff.key === 'exp_gain_up')   titleBonusParts.push(`經驗 +${v}%`);
      if (eff.key === 'drop_rate_up')  titleBonusParts.push(`掉落 +${v}%`);
      if (eff.key === 'final_damage_up') {
        const zones = []
          .concat(eff?.condition?.zone || [])
          .map((z) => ({ dragon_realm: "龍族之領", dragon_king_lair: "龍王巢穴" }[z] || z));
        const zoneNote = zones.length ? `（${zones.join("／")}）` : "";
        titleBonusParts.push(`最終傷害 +${v}%${zoneNote}`);
      }
    }
    if (titleBonusParts.length) {
      titleBonusSection = `🏅 稱號加成：${titleBonusParts.join("、")}\n`;
    }
  }

  // ── 戒指特性說明（飾品欄有特性的戒指，穿上即顯示）──
  let ringTraitSection = "";
  const ringTraitLines = [];
  for (const slot of ["accessory_l", "accessory_r"]) {
    const ring = equipped[slot];
    if (!ring || !Array.isArray(ring.passiveEffects) || ring.passiveEffects.length === 0) continue;
    const ringName = ring.itemName || ring.name || "戒指";
    const desc = (typeof ring.description === "string" && ring.description.trim())
      ? ring.description.trim()
      : (ring.passiveEffects || [])
          .map((eff) => formatPassiveEffect(eff, { equipped, inventory: p.inventory || [], providerStats: cs }))
          .filter(Boolean)
          .join("、");
    if (desc) ringTraitLines.push(`💍 ${ringName}：${desc}`);
  }
  if (ringTraitLines.length) {
    ringTraitSection = `【戒指特性】\n${ringTraitLines.join("\n")}\n`;
  }

  // ── 組合獨立區域 ──
  const cardSection = cardEffectLine ? `${cardEffectLine}\n==============\n` : "";
  const npcBuffSection = npcBuffAreaLine ? `${npcBuffAreaLine}\n==============\n` : "";

  const displayName = result?.player?.displayName || interaction.user.displayName || interaction.user.username;
  const wallet = result?.wallet || { gold: 0, diamond: 0 };

  // 2+1 制：有未分配的自主點 → 顯示提示行＋分配入口按鈕
  const _freePts = Math.max(0, Number(p.statusPoints) || 0);
  const _allocComponents = _freePts > 0
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("attr_allocate_open").setLabel(`📊 分配自主屬性點（剩 ${_freePts} 點）`).setStyle(ButtonStyle.Primary)
      )]
    : null;

  await replyAndAutoDelete(interaction,
    `🧧 **${displayName} 的冒險者履歷**${fallbackUsed ? "（資料已降級顯示）" : ""}\n` +
    `==============\n` +
    `${expLine}\n` +
    `==============\n` +
    `【基本素質】\n` +
    `STR: ${fmt(attrs.str,"str")} | AGI: ${fmt(attrs.agi,"agi")} | VIT: ${fmt(attrs.vit,"vit")}\n` +
    `INT: ${fmt(attrs.int,"int")} | DEX: ${fmt(attrs.dex,"dex")} | LUK: ${fmt(attrs.luk,"luk")}\n` +
    (_freePts > 0 ? `🎯 可分配自主點：**${_freePts}**（每級升等獲得 1 點，按下方按鈕分配）\n` : "") +
    `※ 數字後 (+N) 為裝備加成。STR/INT→攻擊力、DEX→命中、AGI→迴避＆連擊、LUK→暴擊、VIT→減傷（只計基礎值，裝備 VIT 不加減傷）\n` +
    `==============\n` +
    `【戰鬥能力】\n` +
    `❤️ HP: ${calcHp}　⚔️ ATK: ${calcAtk}　🛡️ DEF(減傷): ${calcDef}%\n` +
    `🎯 命中: ${calcHit}%　🟢 迴避: ${calcDodge}%　🪨 格擋: ${calcBlock}%　💥 暴擊: ${calcCrit}%　⚡ 連擊: ${calcCombo}%` +
    tierSummaryLine +
    effectLine + "\n" +
    namedSetLine + (namedSetLine ? "\n" : "") +
    enchantTotalLine + (enchantTotalLine ? "\n" : "") +
    tierSetLine + (tierSetLine ? "\n" : "") +
    `【裝備清單】\n` +
    equipLine + "\n" +
    (titleBonusSection ? titleBonusSection : "") +
    (ringTraitSection || "") +
    `==============\n` +
    `【職業徽章】\n` +
    `${jobTraitAreaLine}\n` +
    `==============\n` +
    `${cardSection}` +
    `${npcBuffSection}` +
    `【資產】\n` +
    `💰 金幣: ${Number(wallet.gold || 0)}\n` +
    `💎 鑽石: ${Number(wallet.diamond || 0)}`,
    _allocComponents
  );
}

// ────────────────────────────────────────────────
// 自主屬性點分配（2+1 制：每級隨機 2 點＋自主 1 點）
// ────────────────────────────────────────────────
const ATTR_ALLOC_OPTIONS = [
  { label: "STR 力量 +1（攻擊力）",       value: "str", emoji: "⚔️" },
  { label: "AGI 敏捷 +1（迴避＆連擊）",   value: "agi", emoji: "💨" },
  { label: "VIT 體力 +1（血量＆減傷）",   value: "vit", emoji: "❤️" },
  { label: "INT 智力 +1（法系攻擊力）",   value: "int", emoji: "🔮" },
  { label: "DEX 靈巧 +1（命中）",         value: "dex", emoji: "🎯" },
  { label: "LUK 幸運 +1（暴擊）",         value: "luk", emoji: "🍀" },
];

async function renderAttrAllocate(interaction, note = "") {
  const sc = getServiceContext();
  const progress = await sc.progressRepository.findByPlayerId(interaction.user.id).catch(() => null);
  const pts = Math.max(0, Number(progress?.statusPoints) || 0);
  const a = progress?.attributes || {};
  const alloc = progress?.allocatedAttrs || {};
  const line = ["str", "agi", "vit", "int", "dex", "luk"]
    .map((k) => `${k.toUpperCase()} ${Number(a[k]) || 1}${(Number(alloc[k]) || 0) > 0 ? `（自主${alloc[k]}）` : ""}`)
    .join(" | ");
  const content =
    `📊 **自主屬性點分配**${note ? `\n${note}` : ""}\n` +
    `==============\n${line}\n==============\n` +
    (pts > 0
      ? `🎯 可分配：**${pts} 點**　從下方選單挑一項 +1（可連續分配）`
      : `🎯 自主點已全部分配完畢！（每升 1 級獲得 1 點）`);
  const components = pts > 0
    ? [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("attr_allocate_pick").setPlaceholder("選擇要 +1 的屬性").addOptions(ATTR_ALLOC_OPTIONS)
      )]
    : [];
  await safeEditReply(interaction, { content, components });
}

async function handleAttrAllocatePick(interaction) {
  await interaction.deferUpdate();
  const attribute = String(interaction.values?.[0] || "");
  try {
    const sc = getServiceContext();
    const result = await sc.progressService.allocateAttribute({ discordId: interaction.user.id, attribute, amount: 1 });
    const label = (ATTR_ALLOC_OPTIONS.find((o) => o.value === attribute)?.label || attribute).split("（")[0];
    await renderAttrAllocate(interaction, `✅ ${label}！目前 ${attribute.toUpperCase()} ＝ ${result.attributes?.[attribute]}`);
  } catch (err) {
    await renderAttrAllocate(interaction, `❌ 分配失敗：${err?.message || "請稍後再試"}`);
  }
}

// ────────────────────────────────────────────────
// 怪物圖鑑（Bestiary）
// ────────────────────────────────────────────────
function _bestiaryKey(m) {
  return String(m?.id || m?._id || m?.name || "");
}
function _bestiaryBar(ratio) {
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}
async function _loadBestiaryData(interaction) {
  const sc = getServiceContext();
  const [monsters, progress] = await Promise.all([
    sc.monsterService.listMonsters({ includeDisabled: false }).catch(() => []),
    sc.progressRepository.findByPlayerId(interaction.user.id).catch(() => null)
  ]);
  const bestiary = progress?.bestiary || {};
  const byZone = new Map();
  for (const m of monsters) {
    const z = m.zone || "normal";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(m);
  }
  return { byZone, bestiary };
}
function _bestiaryZoneOrder(byZone) {
  const known = ALL_ZONE_KEYS.filter(z => byZone.has(z));
  const extra = [...byZone.keys()].filter(z => !ALL_ZONE_KEYS.includes(z));
  return [...known, ...extra];
}
function _buildBestiaryZoneSelect(byZone, bestiary, activeZone) {
  const order = _bestiaryZoneOrder(byZone);
  const options = order.slice(0, 25).map(z => {
    const label = ZONE_BY_KEY[z]?.label || z;
    const list = byZone.get(z) || [];
    const isWB = isWorldBossZone(z);
    const maxed = list.filter(m => (Number(bestiary[_bestiaryKey(m)]) || 0) >= bestiaryRequirement(m, isWB)).length;
    return { label: String(label).slice(0, 25), value: z, description: `${list.length} 種怪 · 已收集滿 ${maxed}`, default: z === activeZone };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("bestiary_zone").setPlaceholder("選擇地圖查看圖鑑").addOptions(options)
  );
}
function _buildBestiaryZoneContent(byZone, bestiary, zoneKey) {
  const label = ZONE_BY_KEY[zoneKey]?.label || zoneKey;
  const isWB = isWorldBossZone(zoneKey);
  const list = (byZone.get(zoneKey) || []).slice().sort((a, b) => (a.calc?.level || a.level || 0) - (b.calc?.level || b.level || 0));
  const header = `📖 **怪物圖鑑 — ${label}**\n` +
    `打越多，對該怪傷害越高（一般 100｜BOSS 50｜世界王 10 隻 ＝ 滿 +25%）\n` +
    `每場依造成傷害比例累積：打掉該怪 100% 血 ＝ 1 隻，可累積。\n` +
    `==============\n`;
  const lines = [];
  let truncated = 0;
  for (const m of list) {
    if (lines.join("\n").length > 1700) { truncated = list.length - lines.length; break; }
    const req = bestiaryRequirement(m, isWB);
    const kills = Number(bestiary[_bestiaryKey(m)]) || 0;
    const ratio = req > 0 ? Math.min(1, kills / req) : 0;
    const bonus = bestiaryBonusPct(kills, req);
    const tag = isWB ? "🌟" : (m.isBoss ? "👑" : "・");
    const done = kills >= req ? " ✅滿" : "";
    lines.push(
      `${tag} **${m.name}**（Lv.${m.calc?.level || m.level || "?"}）${done}\n` +
      `　${_bestiaryBar(ratio)} ${Math.round(kills * 10) / 10}/${req}｜傷害 +${Math.round(bonus * 10) / 10}%`
    );
  }
  if (truncated > 0) lines.push(`…還有 ${truncated} 種怪未列出`);
  return header + (lines.length ? lines.join("\n") : "（此地圖暫無怪物）");
}
async function handleBestiary(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const { byZone, bestiary } = await _loadBestiaryData(interaction);
  const order = _bestiaryZoneOrder(byZone);
  if (!order.length) {
    await safeEditReply(interaction, { content: "目前沒有任何怪物資料。", components: [] });
    return;
  }
  const activeZone = order[0];
  await safeEditReply(interaction, {
    content: _buildBestiaryZoneContent(byZone, bestiary, activeZone),
    components: [_buildBestiaryZoneSelect(byZone, bestiary, activeZone)]
  });
}
async function handleBestiaryZoneSelect(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => {});
  }
  const zoneKey = interaction.values?.[0];
  const { byZone, bestiary } = await _loadBestiaryData(interaction);
  if (!byZone.has(zoneKey)) {
    await safeEditReply(interaction, { content: "找不到該地圖。", components: [] });
    return;
  }
  await safeEditReply(interaction, {
    content: _buildBestiaryZoneContent(byZone, bestiary, zoneKey),
    components: [_buildBestiaryZoneSelect(byZone, bestiary, zoneKey)]
  });
}

// ────────────────────────────────────────────────
// 卡片圖鑑（Card Dex）— 收集狀態 + 領獎（目前限管理員預覽，未對外）
// ────────────────────────────────────────────────
async function _loadCardDexData(discordId) {
  const sc = getServiceContext();
  const cardDex = require("../shared/cardDex");
  const { getMongoDb } = require("../adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const registry = await cardDex.getCardRegistry(db);
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (progress) {
    const changed = cardDex.syncCardDexFromInventory(progress, registry);
    if (changed) { progress.updatedAt = new Date().toISOString(); await sc.progressRepository.save(progress).catch(() => {}); }
  }
  const state = cardDex.computeCardDexState(progress?.cardDex || {}, progress?.cardDexClaims || {}, registry);
  return { registry, state };
}
function _cardDexOverviewText(state) {
  const bar = (c, t) => { const f = t ? Math.round((c / t) * 10) : 0; return "▰".repeat(f) + "▱".repeat(10 - f); };
  const lines = [
    `🃏 **卡片圖鑑** — ${state.totalCollected}/${state.totalCards}（${state.pct}%）`,
    `${bar(state.totalCollected, state.totalCards)}`,
    `──────────────`,
  ];
  for (const z of state.zones) {
    const tag = z.complete ? "✅" : (z.claimable ? "🎁" : "");
    lines.push(`${z.label}：${z.collected}/${z.total} ${z.claimed ? "（已領）" : tag}`);
  }
  const npc = state.npc;
  lines.push(`👤 ${npc.label}：${npc.collected}/${npc.total} ${npc.claimed ? "（已領）" : (npc.complete ? "🎁" : "")}`);
  lines.push(`──────────────`);
  const msDone = state.milestones.filter(m => m.reached).map(m => m.label);
  lines.push(`🏁 里程碑達成：${msDone.length ? msDone.join("、") : "尚無"}`);
  const claimable = [...state.zones, npc, ...state.milestones].filter(x => x.claimable);
  if (claimable.length) lines.push(`\n🎁 **有 ${claimable.length} 項獎勵可領取**（下方按鈕）`);
  return lines.join("\n");
}
function _cardDexComponents(state, activeZone = null) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
  const rows = [];
  // 區域選單（含 NPC）
  const opts = [
    ...state.zones.map(z => ({ label: `${z.label} (${z.collected}/${z.total})`.slice(0, 25), value: `zone:${z.key}`, default: activeZone === `zone:${z.key}` })),
    { label: `${state.npc.label} (${state.npc.collected}/${state.npc.total})`.slice(0, 25), value: "npc", default: activeZone === "npc" },
  ].slice(0, 25);
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("carddex_zone").setPlaceholder("選擇區域查看卡片明細").addOptions(opts)
  ));
  // 領獎按鈕（僅可領取項，最多 2 列 × 5）
  const claimable = [...state.zones, state.npc, ...state.milestones].filter(x => x.claimable).slice(0, 10);
  for (let i = 0; i < claimable.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const c of claimable.slice(i, i + 5)) {
      const r = c.reward || {};
      const parts = [];
      if (r.gold) parts.push(`+${r.gold}💰`);
      for (const it of (r.items || [])) parts.push(`${it.name || "道具"}${it.qty > 1 ? "×" + it.qty : ""}`);
      if (r.title) parts.push(`稱號`);
      row.addComponents(new ButtonBuilder()
        .setCustomId(`carddex_claim:${c.claimKey}`)
        .setLabel(`領 ${(c.label || c.claimKey).slice(0, 12)} ${parts.join(" ")}`.slice(0, 80))
        .setStyle(ButtonStyle.Success));
    }
    rows.push(row);
  }
  return rows;
}
function _cardDexZoneDetail(state, activeZone) {
  const group = activeZone === "npc" ? state.npc : state.zones.find(z => `zone:${z.key}` === activeZone);
  if (!group) return null;
  const lines = [`🃏 **${group.label}** — ${group.collected}/${group.total}`];
  if (group.reward?.gold || (group.reward?.items || []).length || group.reward?.title) {
    const rw = [group.reward.gold ? `+${group.reward.gold}💰` : "", ...(group.reward.items || []).map((i) => `${i.name}${i.qty > 1 ? "×" + i.qty : ""}`), group.reward.title ? "稱號" : ""].filter(Boolean).join(" ");
    lines.push(group.claimed ? "（集滿獎勵已領）" : `集滿獎勵：${rw}`);
  }
  lines.push("──────────────");
  for (const c of group.cards) {
    const t = c.tier ? `[${c.tier}]` : "";
    lines.push(c.owned ? `✅ ${t} ${c.name}` : `🔒 ${t} ？？？`);
  }
  return lines.join("\n").slice(0, 1900);
}
async function handleCardDex(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const { state } = await _loadCardDexData(interaction.user.id);
  await safeEditReply(interaction, { content: _cardDexOverviewText(state), components: _cardDexComponents(state) });
}
async function handleCardDexZoneSelect(interaction) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});
  const activeZone = interaction.values?.[0];
  const { state } = await _loadCardDexData(interaction.user.id);
  const detail = _cardDexZoneDetail(state, activeZone) || _cardDexOverviewText(state);
  await safeEditReply(interaction, { content: detail, components: _cardDexComponents(state, activeZone) });
}
async function handleCardDexClaim(interaction) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});
  const sc = getServiceContext();
  const cardDex = require("../shared/cardDex");
  const { getMongoDb } = require("../adapters/mongo/createMongoClient");
  const { pushRewardItemsToInventory } = require("../shared/jobBadgeBonus");
  const claimKey = String(interaction.customId.split(":").slice(1).join(":") || "");
  const db = await getMongoDb();
  const registry = await cardDex.getCardRegistry(db);
  const discordId = interaction.user.id;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) { await safeEditReply(interaction, { content: "找不到玩家進度。", components: [] }); return; }
  const displayName = progress.displayName || progress.playerName || discordId;
  cardDex.syncCardDexFromInventory(progress, registry);
  const resolved = cardDex.resolveClaim(progress.cardDex || {}, progress.cardDexClaims || {}, registry, claimKey);
  if (!resolved.ok) {
    const { state } = await _loadCardDexData(discordId);
    await safeEditReply(interaction, { content: `⚠️ ${resolved.reason}\n\n` + _cardDexOverviewText(state), components: _cardDexComponents(state) });
    return;
  }
  const _rewardSrc = require("../shared/sources").CURRENCY_SOURCES.QUEST_REWARD;
  if (resolved.reward.gold > 0) {
    await sc.rewardService.grantCurrency({
      discordId, displayName, currencyType: "gold", amount: resolved.reward.gold,
      source: _rewardSrc, operator: `card-dex:${claimKey}`,
    }).catch(() => {});
  }
  const fresh = await sc.progressRepository.findByPlayerId(discordId);
  cardDex.syncCardDexFromInventory(fresh, registry);
  const rewardItems = [
    ...(resolved.reward.items || []).map((i) => ({ itemId: i.itemId, qty: i.qty || 1 })),
    ...(resolved.reward.title ? [{ itemId: resolved.reward.title, qty: 1 }] : []),
  ];
  let granted = [];
  if (rewardItems.length) granted = await pushRewardItemsToInventory({ progress: fresh, itemRepository: sc.itemRepository, rewardItems, source: "card_dex" }).catch(() => []);
  fresh.cardDexClaims = { ...(fresh.cardDexClaims || {}), [claimKey]: new Date().toISOString() };
  fresh.updatedAt = new Date().toISOString();
  await sc.progressRepository.save(fresh);
  const state = cardDex.computeCardDexState(fresh.cardDex || {}, fresh.cardDexClaims || {}, registry);
  const got = [];
  if (resolved.reward.gold) got.push(`+${resolved.reward.gold}💰`);
  for (const g of granted) got.push(g.name || g.itemName);
  await safeEditReply(interaction, { content: `🎉 領取成功：${got.join("、")}\n\n` + _cardDexOverviewText(state), components: _cardDexComponents(state) });
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
  const checkins = (await serviceContext.checkinService.listRecentByDiscordId(
    interaction.user.id,
    7
  )).sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0));

  const today = taipeiDateKey();
  const todayCheckin = checkins.find((c) => taipeiDateKey(c.occurredAt) === today);

  const statusLine = todayCheckin
    ? `✅ 今日已打卡！（${new Date(todayCheckin.occurredAt).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei" })} 獲得 ${todayCheckin.rewardDetail?.amount ?? 0} 金幣）`
    : `❌ 今日尚未打卡，在直播輸入 **!打卡** 可獲得 100 金幣！`;

  const historyLines = checkins.length
    ? checkins.map((c) => `${taipeiDateKey(c.occurredAt) || "-"}  +${c.rewardDetail?.amount ?? 0} 金幣`).join("\n")
    : "尚無打卡紀錄";

  await replyAndAutoDelete(interaction,
    `📅 **打卡狀態**\n${statusLine}\n\n` +
    `🗓️ **最近 7 天紀錄**\n${historyLines}`
  );
}

const TIER_SELL_PRICE = { D: 200, C: 500, B: 1000, A: 10000 };
// 強化寶石售價（與 shopService.GEM_SELL_PRICE 同步；獨立低價）
const GEM_SELL_PRICE = { D: 50, C: 150, B: 400, A: 1200, S: 3000 };

// 背包項目圖片快取(itemId → imageUrl)。inventory 快照沒帶 imageUrl，
// 在開背包時 warm 一次，buildInventoryRow 同步讀它補上「🖼️ 查看」按鈕(含圖片收藏品)。
const _itemImgMap = new Map();
let _itemImgMapReady = false;
async function ensureItemImgMap() {
  if (_itemImgMapReady) return;
  try {
    const all = await getServiceContext().itemRepository.getAll();
    for (const it of (all || [])) {
      const url = it.imageUrl || it.imageThumbnailUrl || "";
      if (it.id && url) _itemImgMap.set(it.id, url);
    }
    _itemImgMapReady = true;
  } catch (_) { /* warm 失敗就退回只用 entry.imageUrl */ }
}
function imgForEntry(e) {
  return e?.imageUrl || _itemImgMap.get(e?.itemId) || "";
}

/** 根據 itemType 產生背包 ActionRow，idx 為顯示編號（0-based） */
function buildInventoryRow(e, idx) {
  const itemType = e.itemType || "consumable";
  const prefix = ["①","②","③","④","⑤"][idx] ?? `${idx+1}.`;
  const btns = [];

  // 強化寶石：不能使用/強化/分解/販售（含 D/C/B/A/S，用共用 isGemEntry 單一真相）
  const isEnhanceGem = isGemEntryForSell(e);

  if (isEnhanceGem) {
    // 強化寶石只能「丟棄」多餘的；一定要至少一個按鈕，否則會產生空的 ActionRow 讓整頁渲染失敗
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel(`${prefix} 丟棄`)
        .setStyle(ButtonStyle.Danger)
    );
  } else if (itemType === "consumable") {
    // 附魔重骰藥水不可直接使用(會浪費)：只能從裝備端重骰，不給「使用」鈕
    const isEnchantPotion = e.itemId === "enchant_reroll_potion"
      || String(e.itemEffect?.type || e.effect?.type || "") === "reroll_enchant";
    // 普通消耗品：使用、丟棄；附魔藥水：只丟棄
    if (!isEnchantPotion) {
      btns.push(
        new ButtonBuilder()
          .setCustomId(`backpack_use:${e.uuid}`)
          .setLabel(`${prefix} 使用`)
          .setStyle(ButtonStyle.Success)
      );
    }
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${e.uuid}`)
        .setLabel("丟棄")
        .setStyle(ButtonStyle.Danger)
    );
  }
  // 怪物卡不可分解；其餘裝備：分解（50% 機率拆成同階強化寶石）
  const isMonsterCard = e.itemType === "monster_card" || e.monsterCardOf || /^special/.test(String(e.equipSlot || ""));
  // 可分解＝一般裝備（非寶石、非消耗品、非怪物卡）
  const isDismantleable = !isEnhanceGem && itemType !== "consumable" && !isMonsterCard;
  if (!isEnhanceGem && itemType !== "consumable") {
    if (isDismantleable) {
      btns.push(
        new ButtonBuilder()
          .setCustomId(`backpack_discard:${e.uuid}`)
          .setLabel(`${prefix} 分解`)
          .setStyle(ButtonStyle.Danger)
      );
    }
  }
  // 販售按鈕：只給「不能分解」但有 tier 的道具（怪物卡）；
  // 一般裝備一律走分解、強化寶石不可販售(只能強化)、皆不提供販售鈕。
  const _isGem = isGemEntryForSell(e);
  const _tierU = String(e.tier || "").toUpperCase();
  const sellPrice = _isGem ? (GEM_SELL_PRICE[_tierU] ?? null) : (e.tier ? TIER_SELL_PRICE[_tierU] : null);
  if (sellPrice != null && !isDismantleable) {
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
  if (imgForEntry(e)) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_view:${e.uuid}`)
        .setLabel("🖼️ 查看")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  // 防呆：任何情況都不能回傳空按鈕列（Discord 會拒絕空 ActionRow → 整頁渲染失敗）
  if (btns.length === 0) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_noop:${e.uuid}`)
        .setLabel("—")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
  }
  return new ActionRowBuilder().addComponents(btns);
}

const EQ_SPECIAL_SLOTS = new Set(EQ_COL3_SLOTS);
const EQ_STANDARD_SLOTS = new Set([...EQ_LEFT_SLOTS, ...EQ_RIGHT_SLOTS]);
const EQ_WEAPON_LIKE_SLOTS = new Set(["weapon", "shield"]);
const EQ_SORT_ORDER = ["weapon","shield","head_top","head_mid","head_low","armor","garment","shoes","accessory_l","accessory_r","special_1","special_2","special_3","anchor"];
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
  if (wt === "bow" || wt === "dice") return "ranged";
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

    // 裝備分頁：階級高 → +值高 優先（最強裝備排前面），同強度再照槽位/名稱
    const TIER_RANK = { SS: 7, S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
    const aTier = TIER_RANK[String(a.tier || "").toUpperCase()] || 0;
    const bTier = TIER_RANK[String(b.tier || "").toUpperCase()] || 0;
    if (aTier !== bTier) return bTier - aTier;

    const aEnh = Number(a.enhanceLevel || 0);
    const bEnh = Number(b.enhanceLevel || 0);
    if (aEnh !== bEnh) return bEnh - aEnh;

    const aSlot = a.equipSlot || "";
    const bSlot = b.equipSlot || "";
    const aOrd = EQ_SORT_ORDER_MAP[aSlot] ?? 999;
    const bOrd = EQ_SORT_ORDER_MAP[bSlot] ?? 999;
    if (aOrd !== bOrd) return aOrd - bOrd;

    const an = normalizeName(a.itemName);
    const bn = normalizeName(b.itemName);
    if (an !== bn) return an.localeCompare(bn, "zh-Hant");

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
      const _isGemGrp = isGemEntryForSell(entry);
      const sellPrice = _isGemGrp ? (GEM_SELL_PRICE[tier] ?? null) : (tier ? TIER_SELL_PRICE[tier] : null);
      groups.set(key, {
        key,
        repUuid: entry.uuid,
        itemName: entry.itemName,
        equipSlot: slot,
        tier,
        enhanceLevel: enh,
        equipStats: entry.equipStats || null,
        passiveEffects: Array.isArray(entry.passiveEffects) ? entry.passiveEffects : [],
        monsterCardSkill: entry.monsterCardSkill || null, // 保留卡片技能,供背包列表顯示效果說明
        sellPrice,
        imageUrl: imgForEntry(entry),
        count: 0,
      });
    }
    const g = groups.get(key);
    g.count += 1;
    if (!g.imageUrl) g.imageUrl = imgForEntry(entry);
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

  // 分類：一般裝備走「分解」、怪物卡走「販售」、職業徽章/稱號「不可」
  const slot = String(group.equipSlot || "");
  const isMonsterCard = /^special/.test(slot);
  const isJobBadge = slot === "job_eq";
  const isTitle = slot === "title_eq";
  const hasValidTierForSplit = group.tier && ["D", "C", "B", "A"].includes(String(group.tier || "").toUpperCase());
  const isDismantleable = hasValidTierForSplit && !isMonsterCard && !isJobBadge && !isTitle;

  if (isDismantleable) {
    // 一般裝備：只給分解（50% 機率拆成同階強化寶石），不再販售
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_discard:${group.repUuid}:${tab}:${subTab}:${page}`)
        .setLabel("🔨 分解")
        .setStyle(ButtonStyle.Danger)
    );
    // 同款且未強化（enhanceLevel 0）的疊加 → 提供批量分解
    if (group.count > 1 && Number(group.enhanceLevel || 0) === 0) {
      btns.push(
        new ButtonBuilder()
          .setCustomId(`backpack_discard_bulk:${group.repUuid}:${tab}:${subTab}:${page}`)
          .setLabel(`🔨 批量分解 (共${group.count})`)
          .setStyle(ButtonStyle.Danger)
      );
    }
  } else if (group.sellPrice != null) {
    // 可賣道具：堆疊型(count>1)以「輸入數量」為主要販售方式，避免誤賣整疊
    if (group.count > 1) {
      btns.push(
        new ButtonBuilder()
          .setCustomId(`backpack_sell_bulk:${group.repUuid}:${tab}:${subTab}:${page}`)
          .setLabel(`💰 賣出(輸入數量) 共${group.count}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    btns.push(
      new ButtonBuilder()
        .setCustomId(`backpack_sell:${group.repUuid}:${tab}:${subTab}:${page}`)
        .setLabel(`售 1件 (${group.sellPrice}💰)`)
        .setStyle(ButtonStyle.Secondary)
    );
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
  if (tab === "badge") return inventory.filter(e => e.itemType === "job_badge" || e.equipSlot === "job_eq");
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
  const showSectionSubTabs = sectionMode && (tab === "weapon" || tab === "armor");
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
  const subTabRows = (!sectionMode || showSectionSubTabs) ? buildSubTabRows(tab, subTab) : [];

  if (!filtered.length) {
    const components = sectionMode
      ? [...subTabRows, buildBackpackHomeRow()]
      : [...tabRows, ...subTabRows];
    return { content: header + `🎒 **背包 — ${tabLabel}**\n\n此分類目前為空。`, components };
  }

  const pageSize = showSectionSubTabs
    ? 3
    : sectionMode && isEquipTab
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
      const tierPart = e.tier ? ` [${String(e.tier).toUpperCase()}階]` : "";
      const traitNames = (e.passiveEffects || []).map((pe) => EFFECT_NAME_ZH[pe?.key]).filter(Boolean);
      const traitPart = traitNames.length ? `｜✨${traitNames.slice(0, 3).join("、")}` : "";
      // 卡片：附上技能效果簡易說明(跟龍族卡一樣)
      const cardSkill = e.monsterCardSkill || (Array.isArray(e.items) && e.items[0]?.monsterCardSkill) || null;
      const cardDesc = cardSkill ? String(cardSkill.description || cardSkill.name || "") : "";
      const cardPart = cardDesc ? `｜🎴 ${cardDesc.length > 60 ? cardDesc.slice(0, 59) + "…" : cardDesc}` : "";
      const overMax = enhLv > MAX_ENHANCE_LEVEL ? ` ⚠️超過上限(+${MAX_ENHANCE_LEVEL})` : "";
      const price = e.sellPrice != null ? `售 ${e.sellPrice}💰/件` : "不可販售";
      lines.push(`${offset + i + 1}. **${baseName}**${enh}${tierPart}${slot}${statsPart}${traitPart}${cardPart}｜${price}${overMax} ×${e.count}`);
      return;
    }

    const slot = e.equipSlot ? ` (${EQ_SLOT_LABELS[e.equipSlot] || e.equipSlot})` : "";
    const stackDisplay = e.stackCount ? ` ×${e.stackCount}` : "";
    lines.push(`${offset + i + 1}. **${e.itemName}**${slot}${stackDisplay}　${e.source === "monster_drop" ? `掉落自 ${e.sourceRef || "怪物"}` : `購於 ${(e.purchasedAt || "").slice(0, 10)}`}`);
  });

  const rows = sectionMode ? [...subTabRows] : [...tabRows, ...subTabRows];
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

async function handleMyInviteCode(interaction) {
  const serviceContext = getServiceContext();
  await serviceContext.playerService.ensurePlayer(interaction.user.id, interaction.user.username);
  const doc = await serviceContext.inviteService.getOrCreateCode(interaction.user.id);
  const useCount = (doc.uses || []).length;
  await replyAndAutoDelete(interaction,
    `🎟️ **你的專屬邀請碼**\n` +
    `==============\n` +
    `\`${doc.code}\`\n\n` +
    `已邀請人數：${useCount} 人\n\n` +
    `📌 邀請方式：把這組碼給新朋友，讓他們在加入後 **24 小時內** 點「🎁 輸入邀請碼」貼上。\n` +
    `雙方都會獲得：💰 金幣 50,000、D階寶石 ×20、C階寶石 ×5`
  );
}

async function handleUseInviteCodeModal(interaction) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
  const modal = new ModalBuilder()
    .setCustomId("invite_code_submit")
    .setTitle("輸入邀請碼");
  const input = new TextInputBuilder()
    .setCustomId("invite_code_input")
    .setLabel("邀請碼（8碼大寫英數）")
    .setStyle(TextInputStyle.Short)
    .setMinLength(8)
    .setMaxLength(8)
    .setPlaceholder("例：A1B2C3D4")
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleInviteCodeSubmit(interaction) {
  const serviceContext = getServiceContext();
  await serviceContext.playerService.ensurePlayer(interaction.user.id, interaction.user.username);
  const code = (interaction.fields.getTextInputValue("invite_code_input") || "").trim().toUpperCase();
  const result = await serviceContext.inviteService.useCode(code, interaction.user.id);
  if (!result.ok) {
    await replyAndAutoDelete(interaction, `❌ ${result.reason}`);
    return;
  }
  await replyAndAutoDelete(interaction,
    `🎉 **邀請碼兌換成功！**\n` +
    `==============\n` +
    `邀請人：${result.inviterName}\n\n` +
    `🎁 獎勵已發放給雙方：\n` +
    `・💰 金幣 50,000\n` +
    `・D階寶石 ×20\n` +
    `・C階寶石 ×5`
  );
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
  await ensureItemImgMap();
  const msg = buildBackpackMessage(inventory, "item");
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
}

// ── 裝備槽畫面（原本 5 列，進入某分頁後顯示）──
function buildEquipmentViewPayload({ progress, player, wallet, imgBuffer, notice = "" }) {
  const equipped = progress?.equipment || {};
  const activePreset = progress?.activePreset || "A";

  const makeSlotBtn = (slot) => {
    const item = equipped[slot];
    const label = item ? (item.itemName || item.name || '').slice(0, 20) : (EQ_SLOT_LABELS[slot] || slot);
    return new ButtonBuilder()
      .setCustomId(`eq_btn:${slot}`)
      .setLabel(label)
      .setStyle(item ? ButtonStyle.Success : ButtonStyle.Secondary);
  };
  const rows = EQ_LEFT_SLOTS.map((leftSlot, i) => new ActionRowBuilder().addComponents(
    makeSlotBtn(leftSlot), makeSlotBtn(EQ_RIGHT_SLOTS[i]), makeSlotBtn(EQ_COL3_SLOTS[i])
  ));
  // COL3 超出列數的槽位(如錨點,第6個)塞進最後一列當額外按鈕——
  // Discord 一則訊息最多 5 個 ActionRow,不能再開新列,故併入最後一列(單列最多 5 顆)。
  for (let i = EQ_LEFT_SLOTS.length; i < EQ_COL3_SLOTS.length; i++) {
    rows[rows.length - 1].addComponents(makeSlotBtn(EQ_COL3_SLOTS[i]));
  }

  const payload = { components: rows, flags: MessageFlags.Ephemeral };
  if (imgBuffer) {
    const attachment = new AttachmentBuilder(imgBuffer, { name: "equipment.png" });
    payload.files = [attachment];
    payload.content = `${notice ? `${notice}\n\n` : ""}【裝備方案 ${activePreset}】`;
  } else {
    const SLOT_ORDER = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r"];
    const lines = SLOT_ORDER.map(s => {
      const item = equipped[s];
      return `　${EQ_SLOT_LABELS[s]}：${item ? `**${item.itemName}**` : "空"}`;
    });
    payload.content = `${notice ? `${notice}\n\n` : ""}⚔️ **裝備欄【裝備方案 ${activePreset}】**\n\n${lines.join("\n")}`;
  }
  return payload;
}

async function buildFreshEquipmentViewPayload(interaction, notice = "") {
  const serviceContext = getServiceContext();
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
    imgBuffer = await renderEquipmentCardCached({ equipped, avatarUrl, publicDir, progress, player, wallet });
  } catch { /* 退回文字 */ }
  return buildEquipmentViewPayload({ progress, player, wallet, imgBuffer, notice });
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
    imgBuffer = await renderEquipmentCardCached({ equipped, avatarUrl, publicDir, progress, player, wallet });
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
    imgBuffer = await renderEquipmentCardCached({ equipped, avatarUrl, publicDir, progress: freshProgress, player, wallet });
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
    imgBuffer = await renderEquipmentCardCached({ equipped, avatarUrl, publicDir, progress: freshProgress, player, wallet });
  } catch { /* 退回文字 */ }

  await safeEditReply(interaction, buildEquipmentViewPayload({ progress: freshProgress, player, wallet, imgBuffer }));
}

async function handleEquipAction(interaction, action, value) {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    let result;
    let notice;
    if (action === "equip") {
      result = await serviceContext.shopService.equipItem(interaction.user.id, value);
      notice = `✅ 已裝備 **${result.itemName}**！`;
    } else {
      result = await serviceContext.shopService.unequipItem(interaction.user.id, value);
      notice = `✅ 已卸下 **${result.itemName}**，已放回背包。`;
    }
    await safeEditReply(interaction, await buildFreshEquipmentViewPayload(interaction, notice));
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
  await ensureItemImgMap();
  const resolvedImg = imgForEntry(entry);
  if (!entry || !resolvedImg) {
    await safeEditReply(interaction, { content: "此道具沒有圖片。" });
    return;
  }
  try {
    const imageUrl = String(resolvedImg).trim();
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
  await ensureItemImgMap();
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
  await ensureItemImgMap();
  const msg = buildBackpackMessage(inventory, selectedTab, undefined, 0, activeSubTab, BACKPACK_SECTION_TABS.has(selectedTab) ? { sectionMode: true } : {});
  await safeEditReply(interaction, msg);
}

async function openBackpackSection(interaction, tab, page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  await ensureItemImgMap();
  const msg = buildBackpackMessage(inventory, tab, undefined, page, subTab, { sectionMode: true });
  await safeEditReply(interaction, msg); // 就地更新，避免每次切分頁/分類都另開一個背包面板
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

// 開箱/卡包公告：恭喜 X 使用 Y 開到了 Z（發到通知頻道）
// 只公告 S 級以上：A/B 階在世界王寶箱裡佔絕大多數(大史王獎池 A 68 件 vs S 11 件)，
// 每開必公告會把頻道洗掉，S 才有「稀有值得恭喜」的份量。D/C 階與無階級藥水本來就不公告。
const _ANNOUNCE_TIERS = new Set(["S", "SS"]);
async function _announceChestOpen(displayName, chestReward) {
  try {
    if (!chestReward) return;
    // 傳說錨點（大史王寶箱 3% 唯一）已有專屬廣播「📦✨…得來不易！」，不再發通用開箱公告，避免同一件洗頻。
    if (chestReward.legendary) return;
    const tier = String(chestReward.rewardTier || "").toUpperCase();
    if (!_ANNOUNCE_TIERS.has(tier)) return; // 未達 B 級 → 不公告
    const { getBotClient } = require("./runtimeContext");
    const client = getBotClient();
    if (!client?.isReady?.()) return;
    const channel = await client.channels.fetch("1498608950671839263").catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send(`🎉 恭喜 **${displayName}** 使用 **${chestReward.chestName}** 開到了 **${chestReward.rewardItemName}**！`).catch(() => {});
    }
  } catch (_) { /* 公告失敗不影響開箱 */ }
}

async function handleBackpackAction(interaction, action, uuid, tab = "item", page = 0, subTab = "all") {
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
          ? `⚠️ 確定要使用 **${entry.itemName}** 嗎？\n使用後會**降低 1 級**，並收回該級所發的點數：**隨機下降 2 點屬性＋自主點 -1**（隨機下降不會吃到你自主分配的點），此操作不可逆！`
          : `⚠️ 確定要使用 **${entry.itemName}** 嗎？\n你的**隨機成長屬性**將會**完全重新隨機分配**（你自主分配的點與未使用的自主點都會保留），此操作不可逆！`,
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

  // 丟棄：先顯示確認
  if (action === "discard") {
    await interaction.deferUpdate();
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const entry = (progress?.inventory || []).find(e => e.uuid === uuid);
    if (!entry) {
      await safeEditReply(interaction, { content: "❌ 找不到該道具。", components: [], embeds: [], files: [] });
      return;
    }
    const enh = entry.enhanceLevel > 0 ? ` +${entry.enhanceLevel}` : "";
    const stack = entry.stackCount > 1 ? ` ×${entry.stackCount}` : "";
    // 貴重物警告：有 +值 / 特效 / 徽章 / 稱號 → 加強提示，避免手滑丟掉
    const slot = String(entry.equipSlot || "");
    const isMonsterCard = entry.itemType === "monster_card" || entry.monsterCardOf || /^special/.test(slot);
    // 怪物卡不可分解，直接擋下（按鈕已不顯示，這裡再保險一層）
    if (isMonsterCard) {
      await safeEditReply(interaction, { content: "❌ 怪物卡無法分解。", components: [], embeds: [], files: [] });
      return;
    }
    const hasFx = (Array.isArray(entry.passiveEffects) && entry.passiveEffects.length)
      || (Array.isArray(entry.procEffects) && entry.procEffects.length)
      || (Array.isArray(entry.combatEffects) && entry.combatEffects.length);
    const warns = [];
    if (Number(entry.enhanceLevel) > 0) warns.push(`已強化 **+${entry.enhanceLevel}**`);
    if (slot === "job_eq") warns.push("這是**職業徽章**");
    if (slot === "title_eq") warns.push("這是**稱號**");
    if (hasFx) warns.push("帶有**特效**");
    const warnLine = warns.length ? `\n\n🚨 **注意：${warns.join("、")}**，分解後就沒了！` : "";
    // 分解產物預告（裝備才有；50% 機率產出，產物階級依 shopService.DISMANTLE_YIELD 為準：同階 D→D/C→C/B→B/A→A/S→S）
    const tierU = String(entry.tier || "").toUpperCase();
    const isEquip = entry.itemType === "equipment";
    const _dY = DISMANTLE_YIELD[tierU];
    const canDismantle = isEquip && !!_dY;
    const yieldLine = canDismantle
      ? `\n\n🔨 有 **${Math.round(DISMANTLE_SUCCESS_RATE * 100)}%** 機率分解出：**${_dY.count} 顆 ${_dY.tier} 階寶石**（失敗則無產物，裝備一樣消失）`
      : "";
    // 屬性石預告（只有帶屬性的裝備才有；機率依階級而異，獨立於上面的寶石判定）
    const _stoneRatePct = Math.round(getElementStoneRate(tierU) * 100);
    const _elLabel = entry.element ? (getElementLabel(entry.element) || entry.element) : "";
    const stoneLine = (canDismantle && entry.element && _stoneRatePct > 0)
      ? `\n💠 另有 **${_stoneRatePct}%** 機率分解出：**${Math.max(1, Number(entry.elementLevel) || 1)} 顆 ${_elLabel}屬性石**（${tierU} 階；與寶石分開判定）`
      : "";
    const verb = canDismantle ? "分解" : "丟棄";
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`backpack_discard_confirm:${uuid}:${tab}:${subTab}:${page}`)
        .setLabel(warns.length ? `我確定要${verb}（貴重物）` : `確定${verb}`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`backpack_view:${uuid}`)
        .setLabel("取消")
        .setStyle(ButtonStyle.Secondary),
    );
    await safeEditReply(interaction, {
      content: `⚠️ 確定要${verb} **${entry.itemName}${enh}${stack}** 嗎？此操作**無法復原**！${yieldLine}${stoneLine}${warnLine}`,
      components: [row],
      embeds: [],
      files: [],
    });
    return;
  }

  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username);
    if (result.chestReward) {
      _announceChestOpen(interaction.user.displayName || interaction.user.username, result.chestReward).catch(() => {});
    }
    const extra = result.effectDesc ? `\n${result.effectDesc}` : "";
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const msg = buildBackpackMessage(progress?.inventory || [], "item", `✅ 已使用 **${result.itemName}**。${extra}`);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 操作失敗：${err.message}`, components: [] });
  }
}

async function handleBackpackDiscardConfirm(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.discardItem(interaction.user.id, uuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    let gemMsg;
    if (result.gems) {
      gemMsg = `🔨 分解 **${result.itemName}** 成功 → 獲得 **${result.gems.count} 顆 ${result.gems.tier} 階寶石**！`;
    } else if (result.dismantled) {
      gemMsg = `💢 分解 **${result.itemName}** 失敗，未取得任何寶石…（裝備已消失）`;
    } else {
      gemMsg = `✅ 已丟棄 **${result.itemName}**。`;
    }
    // 屬性石是獨立判定，可能「寶石槓龜但屬性石中了」，所以另起一行接在後面而不是併進上面的三選一
    if (result.elementStones) {
      const el = getElementLabel(result.elementStones.element) || result.elementStones.element;
      gemMsg += `\n💠 另外獲得 **${result.elementStones.count} 顆 ${el}屬性石**！`;
    }
    const opts = BACKPACK_SECTION_TABS.has(tab) ? { sectionMode: true } : {};
    const msg = buildBackpackMessage(progress?.inventory || [], tab, gemMsg, page, subTab, opts);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 操作失敗：${err.message}`, components: [] });
  }
}

/** 批量分解：同款且未強化的裝備一起分解（確認） */
async function handleBackpackDiscardBulk(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inv = progress?.inventory || [];
  const ref = inv.find((e) => e.uuid === uuid) || inv.find((e) => e.itemId === uuid);
  if (!ref) {
    await safeEditReply(interaction, { content: "❌ 背包中找不到此物品。", components: [], embeds: [], files: [] });
    return;
  }
  const isCard = (e) => e.itemType === "monster_card" || e.monsterCardOf || /^special/.test(String(e.equipSlot || ""));
  // 預覽數量必須與 ShopService.discardItemBulk 的真正刪除條件一致。
  // 否則鎖定件雖然後端會保留，確認視窗卻仍顯示在「共 N 件」中，
  // 會讓玩家誤以為鎖定保護沒有生效。
  const matching = inv.filter((e) => e && e.itemType === "equipment" && e.itemId === ref.itemId
    && Number(e.enhanceLevel || 0) === 0 && !isCard(e));
  const lockedCount = matching.filter((e) => e.locked).length;
  const count = matching.filter((e) => !e.locked).length;
  if (count <= 0) {
    await safeEditReply(interaction, { content: "❌ 沒有可批量分解的同款未強化裝備。", components: [], embeds: [], files: [] });
    return;
  }
  // 產物一律以 shopService.DISMANTLE_YIELD 為準（同階 D→D/C→C/B→B/A→A/S→S，各 1 顆），
  // 跟單件分解預告走同一份來源。**不要在這裡另寫一張表**——舊版寫死成 S→A/A→B 2 顆…
  // 與實際產物完全不符，玩家看到的預覽是錯的。
  const tierU = String(ref.tier || "").toUpperCase();
  const _dY = DISMANTLE_YIELD[tierU];
  const _ratePct = Math.round(DISMANTLE_SUCCESS_RATE * 100);
  const yieldLine = _dY
    ? `\n🔨 每件有 **${_ratePct}%** 機率分解出：**${_dY.count} 顆 ${_dY.tier} 階寶石**（失敗則無產物）`
    : "";
  // 屬性石預告：屬性是逐件實例的（同款可能只有幾件帶屬性），所以要數這批裡實際帶屬性的件數
  const _stoneRatePct = Math.round(getElementStoneRate(tierU) * 100);
  const _withElement = matching.filter((e) => !e.locked && e.element);
  const _elSummary = [...new Set(_withElement.map((e) => `${getElementLabel(e.element) || e.element}${Math.max(1, Number(e.elementLevel) || 1)}`))].join("、");
  const stoneLine = (_withElement.length > 0 && _stoneRatePct > 0)
    ? `\n💠 其中 **${_withElement.length} 件帶屬性**（${_elSummary}），每件另有 **${_stoneRatePct}%** 機率分解出屬性石（顆數＝屬性濃度）`
    : "";
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`backpack_discard_bulk_confirm:${ref.uuid}:${tab}:${subTab}:${page}`)
      .setLabel(`確定批量分解 ${count} 件`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`backpack_view:${ref.uuid}`)
      .setLabel("取消")
      .setStyle(ButtonStyle.Secondary),
  );
  await safeEditReply(interaction, {
    content: `⚠️ 確定要把 **${ref.itemName}** 的 **${count} 件（未強化、未鎖定）** 一起分解嗎？此操作**無法復原**！${lockedCount ? `\n🛡️ 已排除 **${lockedCount} 件鎖定裝備**，不會分解。` : ""}${yieldLine}${stoneLine}`,
    components: [row], embeds: [], files: [],
  });
}

/** 批量分解（執行） */
async function handleBackpackDiscardBulkExecute(interaction, uuid, tab = "item", page = 0, subTab = "all") {
  const serviceContext = getServiceContext();
  await interaction.deferUpdate();
  try {
    const result = await serviceContext.shopService.discardItemBulk(interaction.user.id, uuid);
    const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
    const msgText = result.gems
      ? `🔨 批量分解 **${result.itemName}** ×${result.dismantledCount} → 成功 ${result.successCount} 件，共獲得 **${result.gems.count} 顆 ${result.gems.tier} 階寶石**！`
      : `🔨 批量分解 **${result.itemName}** ×${result.dismantledCount} 完成，這次都沒分解出寶石…（裝備已消失）`;
    // 批量時每件的屬性可能不同（同款劍有的水1有的沒屬性），所以是 element→顆數 的表
    const stoneText = result.elementStones
      ? Object.entries(result.elementStones)
        .map(([el, n]) => `${n} 顆 ${getElementLabel(el) || el}屬性石`).join("、")
      : "";
    const msgText2 = stoneText ? `${msgText}\n💠 另外獲得 **${stoneText}**！` : msgText;
    const opts = BACKPACK_SECTION_TABS.has(tab) ? { sectionMode: true } : {};
    const msg = buildBackpackMessage(progress?.inventory || [], tab, msgText2, page, subTab, opts);
    await safeEditReply(interaction, msg);
  } catch (err) {
    await safeEditReply(interaction, { content: `❌ 批量分解失敗：${err.message}`, components: [] });
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
    const inventory = Array.isArray(result.inventory) ? result.inventory : [];
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
    const inventory = Array.isArray(result.inventory) ? result.inventory : [];
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
    const canUseGambleMode = curLevel >= GAMBLE_MIN_ENHANCE_LEVEL;
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
        .setLabel(!canUseGambleMode && enhanceMode !== ENHANCE_MODE_GAMBLE ? "+1 後開放賭鬼" : getEnhanceModeToggleLabel(enhanceMode))
        .setStyle(enhanceMode === ENHANCE_MODE_GAMBLE ? ButtonStyle.Secondary : ButtonStyle.Danger)
        .setDisabled(!canUseGambleMode && enhanceMode !== ENHANCE_MODE_GAMBLE),
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
  weekly: { label: "每週任務", emoji: "📅", resetText: "台灣時間每週一 00:00 重置" },
  season: { label: "賽季成就", emoji: "🏆", resetText: "賽季期間累積，完成後可領取一次" }
};

function formatRewardWeaponSummary(item) {
  if (!item?.weaponType) return "";
  const cfg = getWeaponConfig(item.weaponType) || {};
  const parts = [];
  const baseStat = BASE_STAT_LABELS[cfg.baseStat || "str"] || String(cfg.baseStat || "str").toUpperCase();
  parts.push(`${WEAPON_TYPE_LABELS[item.weaponType] || item.weaponType}：主屬性 ${baseStat}`);
  if (Number(cfg.stunChance || 0) > 0) parts.push(`擊暈率 ${cfg.stunChance}%`);
  if (Number(cfg.armorBreak || 0) > 0) parts.push(`破防率 ${cfg.armorBreak}%`);
  if (Number(cfg.critBonus || 0) > 0) parts.push(`暴擊率 ${formatSignedPct(cfg.critBonus)}`);
  if (Number(cfg.comboBonus || 0) > 0) parts.push(`連擊率 ${formatSignedPct(cfg.comboBonus)}`);
  if (Number(cfg.bypassDefPct || 0) > 0) parts.push(`無視怪物 DEF ${cfg.bypassDefPct}%`);
  if (Number(cfg.dodgeBonus || 0) > 0) parts.push(`迴避 ${formatSignedPct(cfg.dodgeBonus)}`);
  if (cfg.isTwoHanded) parts.push("雙手武器");
  const statText = formatEquipStats(item.equipStats);
  if (statText) parts.push(statText);
  return parts.join("，");
}

function formatRewardItemLabel(item) {
  if (!item) return "＋道具";
  const itemName = item.name || item.itemName || "未命名道具";
  const parts = [`${itemName}`];
  if (item.itemType === "equipment" || item.itemType === "job_badge" || item.equipSlot === "job_eq") {
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
      .setStyle(activeCadence === "weekly" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("quest_tab:season")
      .setLabel("🏆 賽季")
      .setStyle(activeCadence === "season" ? ButtonStyle.Primary : ButtonStyle.Secondary)
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
    // 解析不到道具名稱(資料中該道具已不存在)就不顯示幽靈「道具」
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
        const rewardItemType = item.equipSlot === "job_eq" ? "job_badge" : (item.itemType || "consumable");
        const badgeEntry = {
          uuid: crypto.randomUUID(),
          itemId: item.id,
          itemName: item.name,
          itemEffect: item.effect || { type: "none", value: 0 },
          useEffects: item.useEffects || [],
          passiveEffects: item.passiveEffects || [],
          procEffects: item.procEffects || [],
          combatEffects: item.combatEffects || [],
          itemType: rewardItemType,
          imageUrl: item.imageUrl || null,
          imageThumbnailUrl: item.imageThumbnailUrl || null,
          equipSlot: item.equipSlot || null,
          equipStats: item.equipStats || null,
          weaponType: item.weaponType || null,
          isTwoHanded: item.isTwoHanded || false,
          tier: item.tier || null,
          source: "quest",
          obtainedAt: new Date().toISOString()
        };
        prog.inventory.push(badgeEntry);

        // 領取職業徽章時，附送對應職業的 C 階武器
        const bonusWeapon = await pushBonusWeaponToInventory({
          progress: prog,
          itemRepository: serviceContext.itemRepository,
          badge: badgeEntry,
        }).catch((err) => { console.warn("[grantQuestReward] bonus weapon grant failed:", err?.message); return null; });
        if (bonusWeapon) {
          reward.bonusWeaponName = bonusWeapon.name;
        }

        prog.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(prog);
      }
      reward.rewardItemName = item.name;
      reward.rewardItemSummary = formatRewardItemLabel(item);
    }
  }
  // 多道具＋數量獎勵（rewardItems: [{itemId, qty}]）— 獨立於 rewardItemId，任一皆可
  if (Array.isArray(reward.rewardItems) && reward.rewardItems.length) {
    const prog = await serviceContext.progressRepository.findByPlayerId(discordId);
    if (prog) {
      const granted = await pushRewardItemsToInventory({
        progress: prog, itemRepository: serviceContext.itemRepository,
        rewardItems: reward.rewardItems, source: "quest",
      });
      if (granted.length) {
        prog.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(prog);
        reward.rewardItemsGranted = granted;
      }
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
    // 發獎在 claimReward 鎖內、標記 claimed 之前執行；失敗則不標記，玩家可重領
    const reward = await questService.claimReward(discordId, questId, (rw) =>
      grantQuestRewardDiscord(serviceContext, discordId, displayName, rw)
    );

    const rewardParts = [];
    if (reward.gold > 0) rewardParts.push(`${reward.gold} 🪙`);
    if (reward.exp > 0) rewardParts.push(`${reward.exp} ⭐`);
    if (reward.rewardItemSummary) rewardParts.push(reward.rewardItemSummary);
    else if (reward.rewardItemName) rewardParts.push(`「${reward.rewardItemName}」`);
    if (reward.bonusWeaponName) rewardParts.push(`🎁 加贈「${reward.bonusWeaponName}」`);
    const rewardDesc = rewardParts.length ? rewardParts.join(" ＋ ") : "（無獎勵）";

    const nextCadence = reward.cadence || cadenceHint || "weekly";
    await renderQuestCenter(interaction, nextCadence, `✅ 已領取「${reward.questTitle}」獎勵：${rewardDesc}`);
  } catch (err) {
    const msg = err.message || "領取失敗";
    await interaction.editReply({ content: `❌ ${msg}`, embeds: [], components: [] }).catch(() => {});
  }
}

function buildProgressBar(current, target, width = 10) {
  const filled = Math.round((Math.min(current, target) / Math.max(target, 1)) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

// 世界王鬧鐘：切換訂閱身分組（已有→取消、未有→訂閱）。開戰通知會 TAG 此身分組。
async function handleWorldBossAlarmToggle(interaction) {
  const roleId = config.discord?.worldBossAlarmRoleId;
  if (!roleId) {
    await interaction.reply({ content: "⚠️ 尚未設定世界王鬧鐘身分組，請聯絡管理員。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ 此功能只能在伺服器內使用。", flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({
        content: "🔕 已關閉 **世界王鬧鐘**，之後世界王開戰不會再 tag 你。再次點擊可重新開啟。",
        flags: MessageFlags.Ephemeral
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({
        content: "⏰ 已開啟 **世界王鬧鐘**！之後有人發起世界王挑戰，開戰通知會 tag 你。再次點擊可關閉。",
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (err) {
    console.warn("[worldBossAlarm] 切換身分組失敗:", err?.message || err);
    await interaction.reply({
      content: "❌ 設定失敗，可能是機器人權限不足（需要「管理身分組」，且機器人最高身分組要排在該身分組之上）。請聯絡管理員。",
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}

async function handleButton(interaction) {
  const id = interaction.customId;

  // 每週任務領取
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
    await safeEditReply(interaction, msg); // 就地更新，避免「返回背包」每次另開一個背包面板
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
  if (id.startsWith("backpack_discard_confirm:")) {
    const parts = id.split(":");
    await handleBackpackDiscardConfirm(interaction, parts[1], parts[2] || "item", parseInt(parts[4] ?? "0", 10) || 0, parts[3] || "all");
    return;
  }
  if (id.startsWith("backpack_discard_bulk_confirm:")) {
    const parts = id.split(":");
    await handleBackpackDiscardBulkExecute(interaction, parts[1], parts[2] || "item", parseInt(parts[4] ?? "0", 10) || 0, parts[3] || "all");
    return;
  }
  if (id.startsWith("backpack_discard_bulk:")) {
    const parts = id.split(":");
    await handleBackpackDiscardBulk(interaction, parts[1], parts[2] || "item", parseInt(parts[4] ?? "0", 10) || 0, parts[3] || "all");
    return;
  }
  if (id.startsWith("backpack_use:") || id.startsWith("backpack_discard:")) {
    const action = id.startsWith("backpack_use:") ? "use" : "discard";
    const parts = id.split(":");
    const uuid = parts[1];
    const tab = parts[2] || "item";
    const subTab = parts[3] || "all";
    const page = parseInt(parts[4] ?? "0", 10) || 0;
    await handleBackpackAction(interaction, action, uuid, tab, page, subTab);
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
  if (id === "attr_allocate_open") {
    await interaction.deferUpdate();
    await renderAttrAllocate(interaction);
    return;
  }
  if (id === "attr_allocate_pick") {
    await handleAttrAllocatePick(interaction);
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

  // 換裝選單分頁（道具多時翻頁）
  if (id.startsWith("eq_slot_page:")) {
    const rest = id.slice("eq_slot_page:".length);
    const lastColon = rest.lastIndexOf(":");
    const slot = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
    const page = lastColon >= 0 ? parseInt(rest.slice(lastColon + 1), 10) || 0 : 0;
    await handleEquipSlotButton(interaction, slot, page);
    return;
  }

  // 換裝候選排序切換（階級 ⇄ 穿脫時間，記住偏好後重排，回第一頁）
  if (id.startsWith("eq_slot_sort:")) {
    const slot = id.slice("eq_slot_sort:".length);
    const cur = equipSortPref.get(interaction.user.id) || "tier";
    equipSortPref.set(interaction.user.id, cur === "tier" ? "equip" : "tier");
    await handleEquipSlotButton(interaction, slot, 0);
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

  // 世界王鬧鐘訂閱：純通知 opt-in，不需玩家權限即可使用
  if (id === BUTTON_IDS.worldBossAlarm) {
    await handleWorldBossAlarmToggle(interaction);
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

  if (id === BUTTON_IDS.bestiary) {
    await handleBestiary(interaction);
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

  if (id === BUTTON_IDS.invite) {
    await handleMyInviteCode(interaction);
    return;
  }

  if (id === BUTTON_IDS.useInvite) {
    await handleUseInviteCodeModal(interaction);
    return;
  }
}

// 換裝候選清單排序偏好（每人記住，重啟後回預設「階級」）
const equipSortPref = new Map(); // discordId -> "tier" | "equip"
const EQUIP_SORT_TIER_RANK = { SS: 7, S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
function _lastEquipTouchMs(it) {
  const e = Date.parse(it?.equippedAt || "") || 0;
  const u = Date.parse(it?.unequippedAt || "") || 0;
  return Math.max(e, u);
}
function sortEquipCandidates(items, mode) {
  const arr = [...items];
  const byTier = (a, b) => {
    const at = EQUIP_SORT_TIER_RANK[String(a?.tier || "").toUpperCase()] || 0;
    const bt = EQUIP_SORT_TIER_RANK[String(b?.tier || "").toUpperCase()] || 0;
    if (at !== bt) return bt - at;                       // 階級高 → 前
    const ae = Number(a?.enhanceLevel || 0), be = Number(b?.enhanceLevel || 0);
    if (ae !== be) return be - ae;                       // 強化高 → 前
    return String(a?.itemName || a?.name || "").localeCompare(String(b?.itemName || b?.name || ""), "zh-Hant");
  };
  if (mode === "equip") {
    arr.sort((a, b) => {
      const at = _lastEquipTouchMs(a), bt = _lastEquipTouchMs(b);
      if (at !== bt) return bt - at;                     // 最近穿/脫 → 前
      return byTier(a, b);                               // 無穿脫紀錄 → 退回階級
    });
  } else {
    arr.sort(byTier);
  }
  return arr;
}

async function handleEquipSlotButton(interaction, slot, page = 0) {
  const serviceContext = getServiceContext();
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const equipped = progress?.equipment || {};
  let inventory = (progress?.inventory || []).filter((e) => {
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

  // 依玩家排序偏好排列候選裝備（階級 / 穿脫時間）
  const sortMode = equipSortPref.get(interaction.user.id) || "tier";
  inventory = sortEquipCandidates(inventory, sortMode);

  // 同款裝備/卡片合併成一項顯示(×N),裝備時用代表 uuid 只裝一張(尤其重複卡片)
  {
    const seen = new Map();
    const grouped = [];
    for (const e of inventory) {
      const key = canonicalEquipmentKey(e);
      const g = seen.get(key);
      if (g) { g._stackCount += 1; continue; }
      const ng = { ...e, _stackCount: 1 };
      seen.set(key, ng);
      grouped.push(ng);
    }
    inventory = grouped;
  }

  const getItemLabel = (item) => String(item?.itemName || item?.name || item?.itemId || item?.uuid || "未知道具");

  // Discord 單一下拉選單上限 25 項；保留 1 給「卸下」，其餘分頁顯示，避免道具多時被截掉（卡片/特殊尤其常見）
  const PER_PAGE = 24;
  const totalPages = Math.max(1, Math.ceil(inventory.length / PER_PAGE));
  const safePage = Math.max(0, Math.min(totalPages - 1, Number(page) || 0));
  const pageItems = inventory.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  const options = [];
  if (equipped[slot]) {
    const item = equipped[slot];
    options.push({
      label: `↩️ 卸下`.slice(0, 25),
      description: getItemLabel(item).slice(0, 50),
      value: `unequip:${slot}`
    });
  }
  pageItems.forEach(e => {
    const stats = e.equipStats || {};
    const statStr = Object.entries(stats).filter(([,v])=>v).map(([k,v])=>`${k.toUpperCase()}${v>0?"+":""}${v}`).join(" ");
    // 卡片：顯示技能效果簡易說明（跟已裝備區一樣），讓選裝時就看得到效果
    const skill = e.monsterCardSkill || null;
    const cardStr = skill
      ? (skill.description ? `🎴 ${skill.description}` : (skill.name ? `🎴 ${skill.name}` : ""))
      : "";
    const countSuffix = e._stackCount > 1 ? ` ×${e._stackCount}` : "";
    options.push({
      label: (getItemLabel(e) + countSuffix).slice(0, 40),
      description: (statStr || cardStr || "點此裝備").slice(0, 95),
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

  const components = [new ActionRowBuilder().addComponents(picker)];
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`eq_slot_page:${slot}:${safePage - 1}`)
        .setLabel("◀ 上一頁").setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`eq_slot_page:${slot}:${safePage}`)
        .setLabel(`${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`eq_slot_page:${slot}:${safePage + 1}`)
        .setLabel("下一頁 ▶").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1)
    ));
  }

  // 排序切換鈕（階級 ⇄ 穿脫時間），點一下切換並重排
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`eq_slot_sort:${slot}`)
      .setLabel(`🔃 排序：${sortMode === "equip" ? "穿脫時間" : "階級"}（點切換）`)
      .setStyle(ButtonStyle.Secondary)
  ));

  const pageNote = totalPages > 1 ? `（第 ${safePage + 1}/${totalPages} 頁，共 ${inventory.length} 件）` : "";
  await safeEditReply(interaction, {
    content: `⚔️ **${EQ_SLOT_LABELS[slot]}** — 選擇裝備或卸下：${pageNote}`,
    components,
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
      await safeEditReply(interaction, await buildFreshEquipmentViewPayload(interaction, `✅ 已卸下 **${result.itemName}**，放回背包。`));
    } else {
      const uuid = value.slice("equip:".length);

      // 檢查是否是怪物卡片，自動穿上第一個空槽位
      const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
      const item = progress?.inventory?.find(i => i.uuid === uuid);
      let targetSlot = null;

      if (item?.equipSlot === "special" || item?.itemType === "monster_card") {
        const SPECIAL_SLOTS = ["special_1", "special_2", "special_3"];
        const equipped = progress?.equipment || {};
        // 玩家從特定卡槽（eq_pick:special_N）切換 → 直接換到「該槽」，
        // equipItem 會把該槽原本的卡換回背包；否則才找第一個空槽。
        if (SPECIAL_SLOTS.includes(slot)) {
          targetSlot = slot;
        } else {
          targetSlot = SPECIAL_SLOTS.find(s => !equipped[s]) || SPECIAL_SLOTS[0];
        }
      }

      result = await serviceContext.shopService.equipItem(interaction.user.id, uuid, targetSlot);
      await safeEditReply(interaction, await buildFreshEquipmentViewPayload(interaction, `✅ 已裝備 **${result.itemName}**！`));
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
        const r = await serviceContext.shopService.useItem(interaction.user.id, uuid, interaction.user.displayName || interaction.user.username);
        if (r?.chestReward) {
          _announceChestOpen(interaction.user.displayName || interaction.user.username, r.chestReward).catch(() => {});
        }
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

  if (interaction.customId === "invite_code_submit") {
    await handleInviteCodeSubmit(interaction);
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

  // 就地編輯原背包訊息（modal 由按鈕開啟，屬於 message component，可用 deferUpdate）
  await interaction.deferUpdate();
  const serviceContext = getServiceContext();
  const progress = await serviceContext.progressRepository.findByPlayerId(interaction.user.id);
  const inventory = progress?.inventory || [];
  const opts = BACKPACK_SECTION_TABS.has(tab) ? { sectionMode: true } : {};
  const msg = buildBackpackMessage(inventory, tab, undefined, targetPage, subTab, opts);
  await safeEditReply(interaction, msg);
  return true;
}

module.exports = {
  createPlayerPanelMessage,
  handleButton,
  handleEquipmentSelect,
  handlePresetSwitchSelect,
  handleBackpackTabSelect,
  handleBestiaryZoneSelect,
  handleWeeklyQuests,
  handleWeeklyQuestClaim,
  handleEnhanceEntry,
  handleEnhanceSelect,
  handleModal,
  _announceChestOpen, // 供網頁開箱路由共用，與 DC 端發同一則開箱公告
};
