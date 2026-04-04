function createPlayer(discordId, displayName) {
  const now = new Date().toISOString();

  return {
    discordId,
    displayName,
    status: "active",
    externalIds: {},
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now
  }; 
}

module.exports = {
  createPlayer
};