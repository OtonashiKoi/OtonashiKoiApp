// 5 人共鬥模擬（改為從資料讀取基礎區怪物），包含職業道具 NPC 計數與技能觸發檢查
// 執行：node scripts/simulate-newbie-1000-battles.js

const fs = require('fs');
const path = require('path');

const INIT_GOLD = 300;
const INIT_EXP = 0;
const INIT_LEVEL = 1;
const INIT_GEMS = 0;
const INIT_WEAPON_LEVEL = 0;
const BATTLES = 1000;

const PARTY_SIZE = 5;
const JOBS = ["warrior", "mage", "archer", "priest", "rogue"];
const EXP_TABLE = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000];

function getLevel(exp) {
  for (let i = EXP_TABLE.length - 1; i >= 1; i--) {
    if (exp >= EXP_TABLE[i]) return i;
  }
  return 1;
}

const GEM_DROP_RATE = 0.13;
const NPC_ENCOUNTER_RATE = 0.04;
const NPC_JOB_ITEM_CHANCE = 0.2; // 遇到 NPC 時，有 20% 機率帶職業道具
const ENHANCE_COST = [1, 2, 4];
const ENHANCE_SUCCESS = [1.0, 0.8, 0.6];
const ENHANCE_MAX = 3;
const NPC_GOLD = 200;
const NPC_EXP_MULT = 2.25;

// 讀取資料檔
function loadJson(relPath) {
  const p = path.join(__dirname, '..', relPath);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const monstersDb = loadJson('data/monsters-db-merged.json').monsters || [];
const cardList = loadJson('data/all-monster-cards-final.json') || [];

// 建立卡片 map: name -> { effect, proc }
const cardsByName = {};
for (const c of cardList) {
  if (c.name && c.monsterCardSkill) {
    cardsByName[c.name] = { effect: c.monsterCardSkill.key, proc: (c.monsterCardSkill.procRate || 30) / 100 };
  }
}

// 簡單的裝備部位推斷（沒有完全對齊 DB）
function inferSlot(itemName) {
  if (!itemName) return 'misc';
  if (/(劍|斧|弓|法杖|劍\)|長劍|鐵劍|大木劍|大鐵劍|短匕|匕首)/.test(itemName)) return 'weapon';
  if (/(帽|頭)/.test(itemName)) return 'head';
  if (/(衣|甲|披風)/.test(itemName)) return 'armor';
  if (/(盾)/.test(itemName)) return 'shield';
  if (/(鞋)/.test(itemName)) return 'shoes';
  return 'misc';
}

// 從 monstersDb 建立模擬用 MONSTERS（只取 zone === 'normal'）
const MONSTERS = monstersDb.filter(m => (m.zone === 'normal' || m.zone === 'basic' || m.zone === 'starter' || !m.zone) && m.enabled !== false).map(m => {
  const drops = (m.drops || []).map(d => {
    const name = d.itemName || d.name || '';
    if (cardsByName[name]) {
      return { type: 'card', name, effect: cardsByName[name].effect, proc: cardsByName[name].proc };
    }
    return { type: 'equip', name, slot: inferSlot(name), stat: d.chance || 1, chance: (d.chance? d.chance/100 : 0.1) };
  });

  // 若有對應怪物卡片，加入該怪物掉自己的卡片（使用 10% 掉率作為預設）
  const ownCard = cardsByName[m.name];
  if (ownCard) {
    drops.push({ type: 'card', name: m.name, effect: ownCard.effect, proc: ownCard.proc, chance: 0.1 });
  }

  // 若卡片有定義技能，視為怪物也可能放技能（用卡片的 proc 當作怪物技能機率）
  let skill = null;
  const cardSkill = cardList.find(c => c.name === m.name && c.monsterCardSkill);
  if (cardSkill) skill = { key: cardSkill.monsterCardSkill.key, name: cardSkill.monsterCardSkill.name, proc: (cardSkill.monsterCardSkill.procRate || 30) / 100 };

  return {
    name: m.name,
    exp: m.expReward || m.exp || 0,
    gold: (m.participantGoldReward ? m.participantGoldReward * PARTY_SIZE : m.goldReward) || 0,
    drops,
    skill
  };
});

function createPlayer(id, job) {
  return {
    id,
    job,
    gold: INIT_GOLD,
    exp: INIT_EXP,
    level: INIT_LEVEL,
    gems: INIT_GEMS,
    weaponEnhance: INIT_WEAPON_LEVEL,
    equip: { weapon: { name: "木劍", stat: 3 }, head: null, armor: null },
    cards: [],
    monsterSkillCount: {},
    cardEffectCount: {},
    dropEquip: []
  };
}

function giveEquipToPlayer(player, drop) {
  const slot = drop.slot;
  if (!player.equip[slot] || drop.stat > player.equip[slot].stat) {
    player.equip[slot] = { name: drop.name, stat: drop.stat };
    player.dropEquip.push(drop.name);
  }
}

function simulate() {
  // 建立隊伍
  const players = JOBS.slice(0, PARTY_SIZE).map((job, idx) => createPlayer(idx + 1, job));
  let totalNpcWithJobItems = 0;
  let totalNpcEncounters = 0;

  for (let i = 1; i <= BATTLES; i++) {
    const monster = MONSTERS[Math.floor(Math.random() * MONSTERS.length)];

    // 分配經驗與金錢（平均分配）
    const perPlayerGold = Math.floor(monster.gold / PARTY_SIZE);
    const perPlayerExp = Math.floor(monster.exp / PARTY_SIZE);
    players.forEach(p => { p.gold += perPlayerGold; p.exp += perPlayerExp; });

    // 怪物技能隨機發動（若有 skill 定義）
    if (monster.skill && monster.skill.proc && Math.random() < monster.skill.proc) {
      players.forEach(p => { p.monsterSkillCount[monster.skill.key] = (p.monsterSkillCount[monster.skill.key] || 0) + 1; });
    }

    // 掉落分配：使用 drop.chance 或預設 10% 掉落率
    monster.drops.forEach(drop => {
      const dropRate = (typeof drop.chance === 'number') ? drop.chance : 0.1;
      if (Math.random() < dropRate) {
        if (drop.type === 'equip') {
          if (drop.job) {
            const target = players.find(p => p.job === drop.job);
            if (target) giveEquipToPlayer(target, drop);
          } else {
            // 非職業裝，給裝備該部位最弱者（stat 最小）
            let worst = players[0];
            for (const p of players) {
              const cur = p.equip[drop.slot] ? p.equip[drop.slot].stat : 0;
              const worstStat = worst.equip[drop.slot] ? worst.equip[drop.slot].stat : 0;
              if (cur < worstStat) worst = p;
            }
            giveEquipToPlayer(worst, drop);
          }
        } else if (drop.type === 'card') {
          const target = players.find(p => !p.cards.find(c => c.name === drop.name));
          if (target) {
            target.cards.push({ name: drop.name, effect: drop.effect, proc: drop.proc });
            // 掉落就裝上：若卡片立即發動，立刻計數
            if (drop.proc && Math.random() < drop.proc) {
              target.cardEffectCount[drop.effect] = (target.cardEffectCount[drop.effect] || 0) + 1;
            }
          }
        }
      }
    });

    // 卡片效果發動
    players.forEach(p => {
      p.cards.forEach(card => {
        if (card.proc && Math.random() < card.proc) {
          p.cardEffectCount[card.effect] = (p.cardEffectCount[card.effect] || 0) + 1;
        }
      });
    });

    // 寶石掉落
    players.forEach(p => { if (Math.random() < GEM_DROP_RATE) p.gems++; });

    // NPC 事件（有機率為帶職業道具的 NPC）
    if (Math.random() < NPC_ENCOUNTER_RATE) {
      totalNpcEncounters++;
      players.forEach(p => { p.gold += Math.floor(NPC_GOLD / PARTY_SIZE); p.exp += Math.floor(monster.exp * NPC_EXP_MULT / PARTY_SIZE); });

      if (Math.random() < NPC_JOB_ITEM_CHANCE) {
        totalNpcWithJobItems++;
        const job = JOBS[Math.floor(Math.random() * JOBS.length)];
        const jobItem = { type: 'equip', name: `${job}_職業武器`, slot: 'weapon', stat: 6 };
        const target = players.find(p => p.job === job);
        if (target) giveEquipToPlayer(target, jobItem);
      }
    }

    // 強化（每個玩家依序嘗試強化武器）
    players.forEach(p => {
      while (p.weaponEnhance < ENHANCE_MAX) {
        const need = ENHANCE_COST[p.weaponEnhance];
        if (p.gems >= need) {
          p.gems -= need;
          if (Math.random() < ENHANCE_SUCCESS[p.weaponEnhance]) {
            p.weaponEnhance++;
          } else break;
        } else break;
      }
    });
  }

  // 等級計算
  players.forEach(p => { p.level = getLevel(p.exp); });

  return { players, totalNpcEncounters, totalNpcWithJobItems };
}

const result = simulate();
console.log('--- 5 人共鬥 1000 場模擬結果 ---');
result.players.forEach(p => {
  console.log(`玩家${p.id} (${p.job}) 等級:${p.level} 經驗:${p.exp} 金錢:${p.gold} 寶石:${p.gems} 強化:+${p.weaponEnhance}`);
  console.log(`  裝備: ${Object.entries(p.equip).filter(([,v])=>v).map(([k,v])=>`${k}:${v.name}( ${v.stat} )`).join(' | ')}`);
  console.log(`  卡片: ${p.cards.map(c=>c.name).join(', ') || '無'}`);
  console.log(`  怪物技能觸發:`, p.monsterSkillCount);
  console.log(`  卡片效果觸發:`, p.cardEffectCount);
  console.log(`  換過的裝備: ${p.dropEquip.join('、') || '無'}`);
});
console.log(`總 NPC 遭遇次數: ${result.totalNpcEncounters}`);
console.log(`帶職業道具的 NPC 次數: ${result.totalNpcWithJobItems}`);
