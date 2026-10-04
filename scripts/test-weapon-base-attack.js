"use strict";
const assert=require('node:assert/strict');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {weaponBaseAttack}=require('../src/shared/weaponBaseAttack');
const attrs={str:90,agi:90,vit:10,int:90,dex:90,luk:90};
for(const [type,mult] of [['sword_1h',4],['sword_2h',5],['staff_2h',4],['bow',4],['dagger',3],['dice',1.5]]){
 let previous=0;
 for(const tier of ['D','C','B','A','S']){
  const weapon={weaponType:type,equipSlot:'weapon',tier};
  const stats=calcPlayerStats(attrs,{weapon});
  assert.ok(stats.atk>previous);previous=stats.atk;
  assert.equal(stats.baseWeaponAttack,weaponBaseAttack(weapon,mult));
  const buffed=calcPlayerStats(attrs,{weapon},[{key:'str_up',params:{value:10}}]);
  const allocated=calcPlayerStats({...attrs,str:100},{weapon});
  assert.equal(buffed.atk,allocated.atk,'屬性 buff 不應扣掉或重複武器基礎攻擊');
 }
}
assert.equal(weaponBaseAttack(null,4),0);
assert.equal(weaponBaseAttack({tier:'A'},4),0);
console.log('PASS: weapon grades, weapon-type ratios, stat buff equivalence, unarmed');
