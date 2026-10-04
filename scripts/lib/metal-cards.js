"use strict";
const { skillForMetalMonster } = require('../../src/shared/metalCards');
function buildMetalCards(monsters) {
  return monsters.filter(m => ['metal_mine', 'metal_throne'].includes(m.zone)).map(m => {
    const seq = m.zone === 'metal_throne' ? 8 : m.seq;
    const skill = skillForMetalMonster(seq);
    return {
      id: `monster-card-${m.id}`, name: `${m.name}卡`, itemType: 'equipment', equipSlot: 'special', tier: 'A',
      description: skill.description, equipStats: {}, effect: { type: 'none', value: 0 },
      passiveEffects: [], procEffects: [], combatEffects: [], useEffects: [],
      monsterCardOf: m.id, monsterCardMeta: { monsterName: m.name, zone: m.zone },
      monsterCardSkill: skill, imageUrl: m.imageUrl, imageThumbnailUrl: m.imageThumbnailUrl,
      price: 0, sellPrice: 1000, contentRevision: 'metal-cards-20261002-v2',
    };
  });
}
function buildMetalChest(monsters) {
  const boss = monsters.find(m => m.id === 'metal-steel-crown');
  if (!boss) throw new Error('Steel crown missing');
  return { id: 'chest-steel-crown', name: '鎧冕王寶箱', itemType: 'consumable',
    description: '依鎧冕王現行掉落表權重抽出一項：鋼冕S主手武器、金屬性石或鎧冕王卡。S防具、副手、飾品不在開放獎池；無保底。',
    effect: { type: 'open_world_boss_chest', monsterId: boss.id, bossName: boss.name },
    imageUrl: boss.imageUrl, imageThumbnailUrl: boss.imageThumbnailUrl,
    contentRevision: 'metal-cards-20261002-v2' };
}
module.exports = { buildMetalCards, buildMetalChest };
