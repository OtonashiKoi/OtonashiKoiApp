const playerProgressLocks = new Map();

async function withPlayerProgressLock(playerId, fn) {
  const currentLock = playerProgressLocks.get(playerId) || Promise.resolve();
  let releaseNext;
  const nextLock = new Promise((resolve) => {
    releaseNext = resolve;
  });
  const chainedLock = currentLock.then(() => nextLock);
  playerProgressLocks.set(playerId, chainedLock);

  try {
    await currentLock;
    return await fn();
  } finally {
    releaseNext();
    if (playerProgressLocks.get(playerId) === chainedLock) {
      playerProgressLocks.delete(playerId);
    }
  }
}

module.exports = {
  withPlayerProgressLock
};
