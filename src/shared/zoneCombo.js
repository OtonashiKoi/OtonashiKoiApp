"use strict";
/**
 * 區域連段（Zone COMBO）。
 *
 * 規則（使用者定案）：
 *   - 在同一個區域每打完一場 +1
 *   - **換區、陣亡、10 分鐘沒打** → 歸零
 *   - 計數上限 999；但加成到 **99 就吃滿**（99 之後只是數字繼續累積）
 *   - 每位玩家都有計數器（UI 看得到），但**目前只有劍鬼把它換成戰力**
 *   - 世界王的各部位算同一個區域（同 zone），部位切換不中斷
 *
 * 為什麼不需要偵測「離開區域」：
 *   每次出戰都會帶 zone，下一場的 zone 不同就自動歸零。玩家關掉網頁、
 *   切分頁、跑去別區，都不需要額外事件——換區＝斷連天然成立。
 */

/** 計數上限（加成在 99 就吃滿，之後只是數字好看／給日後內容用） */
const COMBO_COUNT_MAX = 999;

/** 加成吃滿的門檻（2026-07-22 使用者定案：30 段封頂；計數本身仍可累到 999） */
const COMBO_BUFF_MAX_AT = 30;

/** 多久沒打就斷（與靈氣一致） */
const COMBO_IDLE_MS = 10 * 60 * 1000;

/** 斬（2026-07-22 改版）：不再手動消耗連段，改為戰鬥內「氣力 3 格自動施放」（見 combatLoop）。
 *  倍率＝1 + 0.1 × min(當前連段, 30) → 連段決定斬多痛、氣力決定何時斬。 */
const ONI_GAUGE_MAX = 3;
const BURST_MIN_COMBO = 30;        // 舊制殘留：僅供舊客戶端相容檢查
const BURST_MULT_PER_COMBO = 0.1;

/** 斬的倍率：吃「當前連段」，30 段封頂 ×4 */
function oniBurstMult(comboCount) {
  return 1 + BURST_MULT_PER_COMBO * Math.max(0, Math.min(COMBO_BUFF_MAX_AT, Number(comboCount) || 0));
}

/**
 * 階梯：兩輪制——第一輪四個屬性各給一半，第二輪補滿。
 * 同一個 key 出現多次時取「已達成的最高階」，不是累加。
 */
// 2026-07-22 改版：舊階梯 5~99 太慢熱（第一口甜頭要 5 場、45 段以後多數玩家沒體驗過）。
// 新階梯 1~30：第 1 場就有感、30 場吃滿；吸血放壓軸（滿段獎勵——
// 狂戰士教訓：吸血在打不死你的場合是死詞條，放前面沒意義）。
// 數值經穩態掃描定案（連段30滿・世界王實測）：本組＝41.5k，
// 比第二名影舞者(33.5k)高一檔——ramp 職業付出 30 場爬坡＋高陣亡的代價，峰值理應最高；
// 初版(30/25/30/15)會到 54k 全表翻倍 → 砍到本組。斬保留 ×4（爽感核心不動）。
const COMBO_TIERS = [
  { at: 1,  key: "atk_up",         value: 10, label: "攻擊力 +10%" },
  { at: 3,  key: "crit_rate_up",   value: 10, label: "爆擊率 +10" },
  { at: 5,  key: "atk_up",         value: 15, label: "攻擊力 +15%" },
  { at: 10, key: "crit_damage_up", value: 10, label: "爆擊傷害 +10%" },
  { at: 15, key: "atk_up",         value: 20, label: "攻擊力 +20%（滿）" },
  { at: 20, key: "crit_rate_up",   value: 15, label: "爆擊率 +15（滿）" },
  { at: 25, key: "crit_damage_up", value: 20, label: "爆擊傷害 +20%（滿）" },
  { at: 30, key: "lifesteal",      value: 10, label: "吸血 +10%（滿段獎勵）" },
];

/** 哪些二轉徽章吃 COMBO 加成（之後有別的職業要吃就加進來） */
const COMBO_BADGE_IDS = new Set(["job_swordoni_t2_v1"]);  // 劍鬼

/** 這個職業徽章吃不吃 COMBO 加成 */
function benefitsFromCombo(jobEq) {
  if (!jobEq) return false;
  return COMBO_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/**
 * 讀出「現在這一刻」的有效連段：套用換區與逾時歸零。
 * @param {object} progress 玩家 progress 文件
 * @param {string} zone     這次要打的區域
 * @param {number} now      時間戳（可注入，方便測試）
 * @returns {number} 目前有效連段數（0 = 斷了或沒有）
 */
function readCombo(progress, zone, now = Date.now()) {
  const s = progress?.zoneCombo;
  if (!s || typeof s !== "object") return 0;
  if (String(s.zone || "") !== String(zone || "")) return 0;          // 換區
  if (now - Number(s.updatedAt || 0) > COMBO_IDLE_MS) return 0;        // 逾時
  return Math.max(0, Math.min(COMBO_COUNT_MAX, Number(s.count) || 0));
}

/**
 * 算出「這場打完之後」要存回去的狀態。
 * @param {number} current  這場開打前的有效連段（readCombo 的結果）
 * @param {string} zone
 * @param {string} outcome  runCombatLoop 的 outcome（"lose" = 陣亡歸零）
 * @param {number} now
 */
function nextCombo(current, zone, outcome, now = Date.now(), opts = {}) {
  const { hasDeathGuard = false, diedOnce = false, consumed = false, spend = 0 } = opts;
  const died = String(outcome || "") === "lose";
  // spend：固定扣點（職業技能的 combo cost；與劍鬼「斬」的 consumed=全部消耗不同）
  const cur = Math.max(0, (Number(current) || 0) - Math.max(0, Number(spend) || 0));

  // 「斬」已消耗掉全部連段 → 這場結束直接歸零（沒死的話下一場從 0 重新累）
  if (consumed) {
    return { zone: String(zone || ""), count: died ? 0 : 1, updatedAt: now, diedOnce: false };
  }

  if (!died) {
    // 贏或殘血撤退 → +1，並解除「連續死亡」的記號
    return {
      zone: String(zone || ""),
      count: Math.min(COMBO_COUNT_MAX, cur + 1),
      updatedAt: now,
      diedOnce: false,
    };
  }

  // 陣亡。劍鬼的「死鬥」（2026-07-22 使用者定案 A 案）：**打完就 +1，不論生死**——
  // 被王打死是修羅的修行。只有換區/10 分鐘閒置歸零。
  // （「死了只保留不+1」的版本在世界王陣亡率 99% 下連段永遠卡 0~2，
  //   滿檔 41.8k 只存在理論上；改成陣亡也+1 後世界王 30 場約 8 分鐘爬滿。）
  if (hasDeathGuard) {
    return {
      zone: String(zone || ""),
      count: Math.min(COMBO_COUNT_MAX, cur + 1),
      updatedAt: now,
      diedOnce: false,
    };
  }
  return { zone: String(zone || ""), count: 0, updatedAt: now, diedOnce: false };
}

/** 讀出「連續死亡」記號（配合 nextCombo 的 opts.diedOnce） */
function readDiedOnce(progress, zone, now = Date.now()) {
  const s = progress?.zoneCombo;
  if (!s || typeof s !== "object") return false;
  if (String(s.zone || "") !== String(zone || "")) return false;
  if (now - Number(s.updatedAt || 0) > COMBO_IDLE_MS) return false;
  return Boolean(s.diedOnce);
}

/** 「斬」：這個連段數可不可以施放、倍率多少 */
function burstInfo(count) {
  const n = Math.max(0, Number(count) || 0);
  const ready = n >= BURST_MIN_COMBO;
  return {
    ready,
    minCombo: BURST_MIN_COMBO,
    multiplier: ready ? 1 + n * BURST_MULT_PER_COMBO : 1,
  };
}

/**
 * 連段對應的加成效果（可直接當 playerActiveEffects 丟給 runCombatLoop）。
 * 同 key 取已達成的最高階；未達 5 段回空陣列。
 */
function comboBuffs(count) {
  const n = Math.max(0, Number(count) || 0);
  const best = new Map();
  for (const t of COMBO_TIERS) {
    if (n < t.at) continue;
    const prev = best.get(t.key);
    if (!prev || t.value > prev) best.set(t.key, t.value);
  }
  return [...best.entries()].map(([key, value]) => ({
    key,
    target: "self",
    trigger: "passive",
    chance: 100,
    params: { value },
    duration: { mode: "battle", value: 1 },
    appliedAt: 1,
    sourceType: "zone_combo",
    notes: "區域連段加成",
  }));
}

/** 目前已解鎖的階梯說明（給面板／戰報顯示用） */
function comboUnlockedLabels(count) {
  const n = Math.max(0, Number(count) || 0);
  const best = new Map();
  for (const t of COMBO_TIERS) {
    if (n < t.at) continue;
    best.set(t.key, t.label);
  }
  return [...best.values()];
}

/** 下一個里程碑（給 UI 顯示「再 N 場解鎖…」）；已吃滿回 null */
function nextMilestone(count) {
  const n = Math.max(0, Number(count) || 0);
  for (const t of COMBO_TIERS) {
    if (n < t.at) return { at: t.at, remain: t.at - n, label: t.label };
  }
  return null;
}

module.exports = {
  ONI_GAUGE_MAX,
  oniBurstMult,
  COMBO_COUNT_MAX,
  BURST_MIN_COMBO,
  BURST_MULT_PER_COMBO,
  readDiedOnce,
  burstInfo,
  COMBO_BUFF_MAX_AT,
  COMBO_IDLE_MS,
  COMBO_TIERS,
  COMBO_BADGE_IDS,
  benefitsFromCombo,
  readCombo,
  nextCombo,
  comboBuffs,
  comboUnlockedLabels,
  nextMilestone,
};
