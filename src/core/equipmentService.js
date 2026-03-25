const { randomUUID } = require("crypto");
const { rollRarity, rollTemplate } = require("./dropTable");

function createItem({ userLevel }) {
  const rarity = rollRarity();
  const template = rollTemplate();
  const levelBonus = 1 + Math.max(0, userLevel - 1) * 0.05;

  const stats = {
    atk: Math.floor(template.base.atk * rarity.multiplier * levelBonus),
    def: Math.floor(template.base.def * rarity.multiplier * levelBonus),
    hp: Math.floor(template.base.hp * rarity.multiplier * levelBonus)
  };

  return {
    id: randomUUID(),
    templateId: template.id,
    name: template.name,
    slot: template.slot,
    rarity: rarity.key,
    rarityColor: rarity.color,
    levelReq: Math.max(1, Math.floor(userLevel * 0.8)),
    stats,
    createdAt: new Date().toISOString()
  };
}

function totalStats(equippedItems) {
  return equippedItems.reduce(
    (acc, item) => {
      if (!item) return acc;
      acc.atk += item.stats.atk;
      acc.def += item.stats.def;
      acc.hp += item.stats.hp;
      return acc;
    },
    { atk: 0, def: 0, hp: 0 }
  );
}

module.exports = {
  createItem,
  totalStats
};
