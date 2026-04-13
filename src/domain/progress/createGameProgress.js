const { randomUUID } = require("crypto");

function createGameProgress(playerId) {
  const now = new Date().toISOString();

  const woodenSword = {
    uuid: randomUUID(),
    itemId: "a56bd609-cf0b-4924-b724-891f221fc0b9",
    itemName: "木劍",
    itemEffect: { type: "none", value: 0 },
    useEffects: [],
    passiveEffects: [],
    procEffects: [],
    combatEffects: [],
    itemType: "equipment",
    imageUrl: null,
    imageThumbnailUrl: null,
    equipSlot: "weapon",
    equipStats: { str: 3 },
    weaponType: "sword_1h",
    isTwoHanded: false,
    grantedAt: now,
    grantedBy: "createGameProgress",
    atkStat: "str",
    tier: "D",
    enhanceLevel: 0
  };

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
      weapon: woodenSword,
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
    activeEffects: [],
    flags: {},
    updatedAt: now
  };
}

module.exports = {
  createGameProgress
};
