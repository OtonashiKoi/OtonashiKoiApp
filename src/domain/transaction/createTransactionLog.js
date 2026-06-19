// 高頻、無冪等用途的紀錄(放怪區打怪獎勵/入場費)只保留數天即可,
// 掛上 expireAt(Date)讓 MongoDB TTL 索引自動過期清理,避免 transactions 無限膨脹。
// 其他有意義的交易(賭場/商店/拍賣/捐贈…)不掛 expireAt → 永久保留。
const EPHEMERAL_SOURCE_PREFIX = "monster:";
const EPHEMERAL_RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 天

function createTransactionLog({
  playerId,
  currencyType,
  amount,
  direction,
  source,
  sourceRef,
  balanceAfter,
  operator
}) {
  const log = {
    playerId,
    currencyType,
    amount,
    direction,
    source,
    sourceRef: sourceRef || "",
    balanceAfter,
    operator: operator || "system",
    createdAt: new Date().toISOString()
  };
  // 打怪相關紀錄掛 TTL 過期時間(Date 型別,TTL 索引才吃得到)
  if (typeof source === "string" && source.startsWith(EPHEMERAL_SOURCE_PREFIX)) {
    log.expireAt = new Date(Date.now() + EPHEMERAL_RETENTION_MS);
  }
  return log;
}

module.exports = {
  createTransactionLog
};