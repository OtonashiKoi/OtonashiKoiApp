#!/usr/bin/env node
const { isEffectConditionMet } = require('../src/shared/effectEngine');

function test(name, condition, equipped) {
  const effectRef = { condition };
  const ok = isEffectConditionMet(effectRef, { equipped });
  console.log(`${name}: ${ok}`);
}

// CONDITION_PRESET: 1h_sword_with_shield
const cond1 = {
  all: [
    { weaponType: 'sword_1h' },
    { equippedSlot: 'shield' },
    { notWeaponType: ['offhand_sword', 'offhand_dagger', 'offhand_mace'] }
  ]
};

// case A: main sword_1h + shield (no offhand weapon)
const eqA = { weapon: { weaponType: 'sword_1h' }, shield: { itemId: 'shield_1', equipSlot: 'shield' } };

// case B: main sword_1h + offhand_sword in shield slot
const eqB = { weapon: { weaponType: 'sword_1h' }, shield: { weaponType: 'offhand_sword', itemId: 'off1' } };

// case C: main sword_2h + shield
const eqC = { weapon: { weaponType: 'sword_2h' }, shield: { itemId: 'shield_1', equipSlot: 'shield' } };

console.log('Testing condition: 1h_sword_with_shield');
test('A (1h sword + shield)', cond1, eqA);
test('B (1h sword + offhand_sword)', cond1, eqB);
test('C (2h sword + shield)', cond1, eqC);

// Also test a condition combining top-level weaponType + notWeaponType directly
const cond2 = { weaponType: 'sword_1h', notWeaponType: ['offhand_sword'] };
console.log('\nTesting condition: weaponType + notWeaponType');
test('A', cond2, eqA);
test('B', cond2, eqB);
