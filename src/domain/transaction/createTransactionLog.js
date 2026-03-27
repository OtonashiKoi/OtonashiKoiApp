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
  return {
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
}

module.exports = {
  createTransactionLog
};