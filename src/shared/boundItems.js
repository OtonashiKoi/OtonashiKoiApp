// 靈魂綁定道具：不可交易（拍賣上架）、不可丟棄（分解）。
// 需要綁定的道具把其 item.id 加進這個集合即可（交易與分解入口都會擋）。
const BOUND_ITEM_IDS = new Set([
  "s-legend-resonance", // 繫・初鳴之晶（第一章劇情錨點，音無恋的結晶）
]);

function isBoundItemId(itemId) {
  return BOUND_ITEM_IDS.has(String(itemId || ""));
}

module.exports = { BOUND_ITEM_IDS, isBoundItemId };
