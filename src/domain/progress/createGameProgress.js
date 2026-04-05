function createGameProgress(playerId) {
  const now = new Date().toISOString();
  return {
    playerId,
    level: 1,
    exp: 0,
    job: "Novice",
    jobLevel: 1,
    statusPoints: 0,
    attributes: {
      str: 1,
      agi: 1,
      vit: 1,
      int: 1,
      dex: 1,
      luk: 1
    },
    equipment: {
      head_top: null,
      head_mid: null,
      head_low: null,
      armor: null,
      weapon: null,
      shield: null,
      garment: null,
      shoes: null,
      accessory_l: null,
      accessory_r: null,
      title_eq: null,
      job_eq: null,
      special_1: null,
      special_2: null,
      special_3: null
    },
    inventory: [],
    flags: {},
    updatedAt: now
  };
}

module.exports = {
  createGameProgress
};