function createGameProgress(playerId) {
  return {
    playerId,
    level: 1,
    exp: 0,
    flags: {},
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  createGameProgress
};