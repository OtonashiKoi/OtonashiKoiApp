const { MonsterService, calcStats } = require('../src/services/monster/monsterService');
const config = require('../src/config');

console.log('config.game.monsterExpectedPlayers =', config.game.monsterExpectedPlayers);

const samples = [
  { name: '弱小怪', stats: { str:2, agi:2, vit:2, int:1, dex:2 } },
  { name: '中等怪', stats: { str:5, agi:4, vit:8, int:2, dex:3 } },
  { name: '王級怪', stats: { str:20, agi:10, vit:30, int:5, dex:8 } }
];

for (const s of samples) {
  console.log('---', s.name, '---');
  console.log(calcStats(s.stats));
}
