const RARITIES = [
  { key: "common", weight: 600, multiplier: 1, color: "gray" },
  { key: "uncommon", weight: 250, multiplier: 1.35, color: "green" },
  { key: "rare", weight: 110, multiplier: 1.8, color: "blue" },
  { key: "epic", weight: 35, multiplier: 2.6, color: "purple" },
  { key: "legendary", weight: 5, multiplier: 3.6, color: "orange" }
];

const EQUIPMENT_TEMPLATES = [
  { id: "w_iron_sword", slot: "weapon", name: "Iron Sword", base: { atk: 12, def: 0, hp: 0 } },
  { id: "w_arc_blade", slot: "weapon", name: "Arc Blade", base: { atk: 18, def: 0, hp: 0 } },
  { id: "a_hunter_coat", slot: "armor", name: "Hunter Coat", base: { atk: 0, def: 10, hp: 20 } },
  { id: "a_guardian_plate", slot: "armor", name: "Guardian Plate", base: { atk: 0, def: 16, hp: 40 } },
  { id: "ac_ruby_ring", slot: "accessory", name: "Ruby Ring", base: { atk: 6, def: 2, hp: 8 } },
  { id: "ac_moon_charm", slot: "accessory", name: "Moon Charm", base: { atk: 3, def: 5, hp: 20 } }
];

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;

  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function rollRarity() {
  return pickWeighted(RARITIES);
}

function rollTemplate() {
  return EQUIPMENT_TEMPLATES[Math.floor(Math.random() * EQUIPMENT_TEMPLATES.length)];
}

module.exports = {
  RARITIES,
  EQUIPMENT_TEMPLATES,
  rollRarity,
  rollTemplate
};
