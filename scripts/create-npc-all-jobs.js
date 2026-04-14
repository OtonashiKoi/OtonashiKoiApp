#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const allItems = await sc.itemService.listItems().catch(()=>[]);
    const jobItems = allItems.filter(i => String(i.id||'').startsWith('job_'));
    if (!jobItems.length) {
      console.log('No job items found.');
      process.exit(0);
    }

    const weaponPreference = {
      warrior: ['axe_1h','axe_2h'],
      dwarf: ['axe_1h','mace_1h'],
      swordsman: ['sword_1h','sword_2h'],
      rogue: ['dagger'],
      mage: ['staff_1h','staff_2h'],
      healer: ['staff_1h','staff_2h'],
      default: ['sword_1h']
    };

    function pickWeaponTypeForJob(jobName, jobId) {
      const name = String(jobName || '').toLowerCase();
      if (/戰士|warrior/.test(name)) return weaponPreference.warrior;
      if (/矮人/.test(name)) return weaponPreference.dwarf;
      if (/劍|swordsman/.test(name)) return weaponPreference.swordsman;
      if (/盜|rogue/.test(name)) return weaponPreference.rogue;
      if (/法|mage/.test(name)) return weaponPreference.mage;
      if (/治療|healer|醫/.test(name)) return weaponPreference.healer;
      return weaponPreference.default;
    }

    function findWeaponByTypes(types) {
      for (const t of types) {
        // prefer lowest tier (D) first
        const candidates = allItems.filter(it => it.weaponType === t && it.itemType === 'equipment');
        if (candidates.length) {
          // choose one with lowest tier string order D<C<B<A
          const order = { 'D': 0, 'C':1, 'B':2, 'A':3 };
          candidates.sort((a,b)=> (order[a.tier]||9) - (order[b.tier]||9));
          return candidates[0];
        }
      }
      return null;
    }

    const created = [];
    for (const job of jobItems) {
      const jobId = job.id;
      const jobName = job.name || jobId;
      const types = pickWeaponTypeForJob(jobName, jobId);
      const weapon = findWeaponByTypes(types) || allItems.find(i=>i.itemType==='equipment') || null;
      const weaponId = weapon ? weapon.id : null;
      const weaponLabel = weapon ? weapon.name : '指定武器';

      const tpl = {
        id: `流浪${jobName}`,
        zone: 'normal',
        name: `流浪${jobName}`,
        message: `你看起來像個${jobName}的潛力股，要不要跟我交換職業道具？`,
        triggerMonsterSeq: null,
        durationSec: 30,
        priority: 50,
        enabled: true,
        npc: { name: `流浪${jobName}`, imageUrl: null, imageThumbnailUrl: null },
        nodes: [
          {
            id: 'start',
            text: `你看起來像個能幹的傢伙——想喝一杯、切磋、學點技巧，還是交換職業道具？`,
            options: [
              {
                id: 'opt_talk', label: '喝酒聊天（100 金幣）', npcReply: '好酒不貴，交個朋友吧。', nextNodeId: null,
                effects: [ { type: 'grant_currency', payload: { currencyType: 'gold', amount: -100 } } ]
              },
              {
                id: 'opt_duel', label: '真刀實槍切磋（無消耗）', npcReply: '小心點，我可不是在開玩笑。', nextNodeId: null,
                effects: [ { type: 'grant_buff', payload: { effect: { key: 'final_damage_up', params: { value: 1.12 }, duration: { mode: 'battle', value: 1 }, stackMode: 'refresh' } } } ]
              },
              {
                id: 'opt_train', label: '請教技巧（50 金幣）', npcReply: '學了不負責任，可別太驕傲。', nextNodeId: null,
                effects: [ { type: 'grant_currency', payload: { currencyType: 'gold', amount: -50 } }, { type: 'grant_buff', payload: { effect: { key: 'minor_training_atk', params: { value: 1.05 }, duration: { mode: 'battle', value: 1 }, stackMode: 'refresh' } } } ]
              },
              {
                id: 'opt_trade', label: `以 +3 ${weaponLabel} 交換 ${jobName}`, npcReply: `這是${jobName}的職業道具，保重。`, nextNodeId: null,
                condition: { any: types.map(t=>({ weaponType: t })) },
                effects: [
                  { type: 'take_item', payload: { itemId: weaponId || '', enhanceLevel: 3 } },
                  { type: 'grant_item', payload: { itemId: jobId } }
                ]
              }
            ]
          }
        ]
      };

      try {
        const createdEvent = await sc.monsterEventService.createEvent(tpl).catch(()=>null);
        if (createdEvent && createdEvent.id) {
          console.log('Created event for', jobName, createdEvent.id);
          created.push({ jobId, jobName, eventId: createdEvent.id });
        } else {
          console.warn('Could not create event via service for', jobName, '— writing template to disk.');
          const outPath = path.resolve(__dirname, `npc-templates/wandering-${jobId}.json`);
          fs.writeFileSync(outPath, JSON.stringify(tpl, null, 2), 'utf8');
          console.log('Wrote template to', outPath);
        }
      } catch (e) {
        console.error('Error creating event for', jobName, e && e.message ? e.message : e);
      }
    }

    console.log('Done. Created:', created);
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();