"use strict";

// 交易紀錄來源 → 中文標籤 + icon（DC 玩家面板與網頁交易紀錄共用）
const TX_SOURCE_LABELS = {
  "admin:manual-grant": { label: "系統發放", icon: "🎁" },
  "auction:purchase":   { label: "拍賣購買", icon: "🏛️" },
  "auction:sale":       { label: "拍賣售出", icon: "🏛️" },
  "casino:bet":         { label: "賭場下注", icon: "🎰" },
  "casino:payout":      { label: "賭場彩金", icon: "🎰" },
  "discord:test-reward":{ label: "測試獎勵", icon: "🎁" },
  "donation:reward":    { label: "抖內回饋", icon: "💝" },
  "enhance:cost":       { label: "強化花費", icon: "⚒️" },
  "idle:reward":        { label: "掛機收益", icon: "💤" },
  "item:sell":          { label: "販售道具", icon: "🪙" },
  "item:use":           { label: "使用道具", icon: "🧪" },
  "monster:entry-fee":  { label: "入場費",   icon: "🎟️" },
  "monster:kill-reward":{ label: "擊殺獎勵", icon: "⚔️" },
  "quest:reward":       { label: "任務獎勵", icon: "📋" },
  "shop:purchase":      { label: "商店購買", icon: "🛒" },
  "tower:reward":       { label: "爬塔獎勵", icon: "🗼" },
};

// 來源前綴（: 之前）→ 中文，未知來源用前綴退回
const TX_PREFIX_LABELS = {
  monster: { label: "戰鬥",   icon: "⚔️" },
  shop:    { label: "商店",   icon: "🛒" },
  auction: { label: "拍賣行", icon: "🏛️" },
  casino:  { label: "賭場",   icon: "🎰" },
  quest:   { label: "任務",   icon: "📋" },
  tower:   { label: "爬塔",   icon: "🗼" },
  idle:    { label: "掛機",   icon: "💤" },
  enhance: { label: "強化",   icon: "⚒️" },
  item:    { label: "道具",   icon: "🧪" },
  donation:{ label: "抖內",   icon: "💝" },
  stream:  { label: "抖內",   icon: "💝" },
  admin:   { label: "系統發放", icon: "🎁" },
  discord: { label: "系統",   icon: "🎁" },
  system:  { label: "系統",   icon: "⚙️" },
};

/** 取得來源中文標籤 { label, icon } */
function transactionSourceLabel(source) {
  const key = String(source || "").trim();
  if (TX_SOURCE_LABELS[key]) return TX_SOURCE_LABELS[key];
  const prefix = key.split(":")[0];
  if (TX_PREFIX_LABELS[prefix]) return TX_PREFIX_LABELS[prefix];
  return { label: key || "其他", icon: "💰" };
}

/** 幣種中文 */
function currencyLabelZh(currencyType) {
  const c = String(currencyType || "").toLowerCase();
  if (c === "gold") return "金幣";
  if (c === "diamond" || c === "gem") return "鑽石";
  return currencyType || "金幣";
}

module.exports = { TX_SOURCE_LABELS, transactionSourceLabel, currencyLabelZh };
