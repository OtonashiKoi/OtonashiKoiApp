const MONSTERS = [
  { id: "slime", name: "Green Slime", basePower: 20, rewards: { gold: 30, exp: 20 } },
  { id: "wolf", name: "Shadow Wolf", basePower: 45, rewards: { gold: 55, exp: 40 } },
  { id: "golem", name: "Stone Golem", basePower: 80, rewards: { gold: 100, exp: 75 } },
  { id: "dragon", name: "Ash Dragon", basePower: 140, rewards: { gold: 180, exp: 120 } }
];

function getMonster(monsterId) {
  return MONSTERS.find((m) => m.id === monsterId) || MONSTERS[0];
}

function playerPower(player, equipmentBonus) {
  return (
    player.stats.str + player.stats.dex + player.stats.int +
    equipmentBonus.atk * 1.3 +
    equipmentBonus.def * 1.1 +
    equipmentBonus.hp * 0.3
  );
}

function fight(player, equipmentBonus, monsterId) {
  const monster = getMonster(monsterId);
  const pPower = playerPower(player, equipmentBonus);
  const variance = 0.85 + Math.random() * 0.3;
  const finalPlayer = pPower * variance;
  const win = finalPlayer >= monster.basePower;

  return {
    monster,
    pPower: Math.floor(finalPlayer),
    win,
    rewards: win ? monster.rewards : { gold: 8, exp: 5 }
  };
}

module.exports = {
  MONSTERS,
  fight
};
