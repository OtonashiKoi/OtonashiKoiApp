"use strict";
/**
 * 戰意集氣（狂戰士二轉）。
 *
 * 規則（使用者定案）：
 *   - 戰鬥畫面血條下方一條同款小一號的集氣條
 *   - 每打完一場 +1 格（勝敗都算；DC 與網頁共用同一份狀態）
 *   - 集滿後的下一場「戰意全開」：該場追加爆擊率，打完清空重新集
 *   - 滿氣自動觸發，不需要按按鈕
 *
 * 與 zoneCombo 不同：集氣不因換區/陣亡/閒置歸零——「先去小怪區集氣、
 * 滿氣去打王」是刻意設計的循環，狂戰士的節奏感就在這裡。
 *
 * 存放位置：progress.berserkGauge = { count, updatedAt }
 * 設定來源：jobAdvancement.T2_BRANCHES.warrior[].gauge = { max, critRateBonus }
 */

/** 讀出目前集氣格數（沒有狀態 → 0） */
function read(progress, cfg) {
  const s = progress?.berserkGauge;
  const max = Math.max(1, Number(cfg?.max) || 5);
  if (!s || typeof s !== "object") return 0;
  return Math.max(0, Math.min(max, Number(s.count) || 0));
}

/** 這個格數是不是已經集滿（＝這場戰意全開） */
function isFull(count, cfg) {
  return Number(count) >= Math.max(1, Number(cfg?.max) || 5);
}

/**
 * 打完一場之後要存回去的狀態。
 * consumed = 這場有沒有以滿氣狀態開打（戰意全開後清空；這場本身也算 1 格）。
 */
function next(count, cfg, { consumed = false } = {}, now = Date.now()) {
  const max = Math.max(1, Number(cfg?.max) || 5);
  const cur = Math.max(0, Number(count) || 0);
  return {
    count: consumed ? 1 : Math.min(max, cur + 1),
    updatedAt: now,
  };
}

/** 滿氣那一場的加成效果（丟給 runCombatLoop 的 playerActiveEffects） */
function buffs(cfg) {
  const value = Math.max(0, Number(cfg?.critRateBonus) || 0);
  if (!value) return [];
  return [{
    key: "crit_rate_up",
    target: "self",
    trigger: "passive",
    chance: 100,
    params: { value },
    duration: { mode: "battle", value: 1 },
    appliedAt: 1,
    sourceType: "berserk_gauge",
    notes: "戰意全開",
  }];
}

/** 血祭那一場的攻擊加成（設定來源 jobAdvancement 的 sacrifice） */
function sacrificeBuffs(sacrificeCfg) {
  const value = Math.max(0, Number(sacrificeCfg?.atkUpPct) || 0);
  if (!value) return [];
  return [{
    key: "atk_up",
    target: "self",
    trigger: "passive",
    chance: 100,
    params: { value },
    duration: { mode: "battle", value: 1 },
    appliedAt: 1,
    sourceType: "blood_sacrifice",
    notes: "血祭",
  }];
}

/** 給前端／面板的顯示狀態 */
function view(progress, cfg) {
  if (!cfg) return null;
  const max = Math.max(1, Number(cfg.max) || 5);
  const count = read(progress, cfg);
  return {
    count,
    max,
    full: count >= max,
    critRateBonus: Math.max(0, Number(cfg.critRateBonus) || 0),
  };
}

module.exports = { read, isFull, next, buffs, sacrificeBuffs, view };
