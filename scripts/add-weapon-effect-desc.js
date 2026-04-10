const fs = require('fs');
const path = require('path');

const GAME_JSON = path.resolve(__dirname, '..', 'data', 'game.json');

const WEAPON_CONFIG = {
  sword_1h: { mult: 3 },
  sword_2h: { mult: 6, isTwoHanded: true },
  mace_1h:  { mult: 3, stunChance: 5 },
  mace_2h:  { mult: 4, isTwoHanded: true, stunChance: 10 },
  axe_1h:   { mult: 3, armorBreak: 15 },
  axe_2h:   { mult: 5, isTwoHanded: true, armorBreak: 15 },
  dagger:   { mult: 2, comboBonus: 20 },
  staff_1h: { mult: 4, baseStat: 'int', monsterAtk: 2, bypassDef: true },
  staff_2h: { mult: 6, baseStat: 'int', isTwoHanded: true, monsterAtk: 2, bypassDef: true },
  bow:      { mult: 5, baseStat: 'dex', isTwoHanded: true, dodgeBonus: 30 },
};

function describeWeapon(cfg) {
  if (!cfg) return '';
  const parts = [];
  const base = cfg.baseStat || 'str';
  parts.push(`主屬性：${base.toUpperCase()}`);
  if (cfg.mult) parts.push(`倍率：×${cfg.mult}`);
  if (cfg.isTwoHanded) parts.push('雙手武器（不可配副手）');
  if (cfg.comboBonus) parts.push(`連擊率 +${cfg.comboBonus}%`);
  if (cfg.stunChance) parts.push(`擊暈機率 ${cfg.stunChance}%（擊暈後怪物 3 回合無法攻擊）`);
  if (cfg.armorBreak) parts.push(`破防機率 ${cfg.armorBreak}%（觸發時無視怪物 DEF%）`);
  if (cfg.bypassDef) parts.push('無視怪物 DEF%（但怪物攻擊次數增加）');
  if (cfg.monsterAtk) parts.push(`怪物攻擊次數 ×${cfg.monsterAtk}`);
  if (cfg.dodgeBonus) parts.push(`閃避 +${cfg.dodgeBonus}%`);
  return parts.join('；');
}

function main() {
  const raw = fs.readFileSync(GAME_JSON, 'utf8');
  const data = JSON.parse(raw);
  // backup
  const bak = GAME_JSON + '.bak.' + Date.now();
  fs.writeFileSync(bak, raw, 'utf8');
  console.log('backup written to', bak);

  if (!Array.isArray(data.items)) {
    console.error('no items array found in', GAME_JSON);
    process.exit(1);
  }

  let modified = 0;
  for (const it of data.items) {
    if (it.itemType === 'equipment' && it.equipSlot === 'weapon') {
      const wt = it.weaponType || null;
      const cfg = WEAPON_CONFIG[wt] || null;
      const desc = describeWeapon(cfg) || '無特殊武器特效';
      if (it.weaponEffectDescription !== desc) {
        it.weaponEffectDescription = desc;
        modified++;
      }
    }
  }

  if (modified === 0) console.log('no weapon items modified');
  else console.log('modified', modified, 'weapon items');

  fs.writeFileSync(GAME_JSON, JSON.stringify(data, null, 2), 'utf8');
  console.log('game.json updated');
}

main();
