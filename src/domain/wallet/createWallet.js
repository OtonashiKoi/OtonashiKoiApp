function createWallet(playerId) {
  return {
    playerId,
    gold: 100,
    diamond: 0,
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  createWallet
};