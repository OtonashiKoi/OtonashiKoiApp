function createAdminActionLog({ adminId, targetPlayerId, actionType, payload }) {
  return {
    adminId,
    targetPlayerId,
    actionType,
    payload,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  createAdminActionLog
};