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

    const dir = path.resolve(__dirname, 'npc-templates');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 日式奇幻風格名字（短姓+名）
    const namePool = [
      '有栖','真央','綾音','隼人','蒼','美緒','蓮','紬','雪乃','大和',
      '響','若葉','風間','瑞希','宗介','織姬','泉','朱音','時雨','雪村'
    ];

    function chooseSuffix(jobId) {
      // 以職業關鍵字挑一個名字作為 NPC 名（避免明顯職業標示）
      const key = String(jobId||'').toLowerCase();
      if (/swordsman|劍/.test(key)) return '真央';
      if (/warrior|戰士/.test(key)) return '隼人';
      if (/dwarf|矮人/.test(key)) return '蒼';
      if (/rogue|盜/.test(key)) return '紬';
      if (/mage|法/.test(key)) return '響';
      if (/healer|治療|醫/.test(key)) return '美緒';
      return namePool[Math.floor(Math.random()*namePool.length)];
    }

    function pickWeaponTypeForJob(name) {
      const n = String(name||'').toLowerCase();
      if (/戰士|warrior/.test(n)) return ['axe_1h','axe_2h'];
      if (/矮人/.test(n)) return ['axe_1h','mace_1h'];
      if (/劍|swordsman/.test(n)) return ['sword_1h','sword_2h'];
      if (/盜|rogue/.test(n)) return ['dagger'];
      if (/法|mage/.test(n)) return ['staff_1h','staff_2h'];
      if (/治療|healer|醫/.test(n)) return ['staff_1h','staff_2h'];
      return ['sword_1h'];
    }

    function findWeaponByTypes(types) {
      for (const t of types) {
        const candidates = allItems.filter(it => it.weaponType === t && it.itemType === 'equipment');
        if (candidates.length) {
          const order = { 'D': 0, 'C':1, 'B':2, 'A':3 };
          candidates.sort((a,b)=> (order[a.tier]||9) - (order[b.tier]||9));
          return candidates[0];
        }
      }
      return null;
    }

    const createdFiles = [];
    for (const job of jobItems) {
      const jobId = job.id;
      const jobName = job.name || jobId;
      const suffix = chooseSuffix(jobId);
      const npcName = `行旅·${jobName}${suffix ? '·'+suffix : ''}`;
      const types = pickWeaponTypeForJob(jobName);
      const weapon = findWeaponByTypes(types) || allItems.find(i=>i.itemType==='equipment') || null;
      const weaponLabel = weapon ? weapon.name : '指定武器';

      const tpl = {
        id: `流浪_${jobId}`,
        zone: 'normal',
        name: npcName,
        message: `${npcName}坐在路旁的石階上，語氣平靜但眼裡閃着往日的光景。從他微微頹色的裝束看來，曾在戰場與集市間遊走。`,
        triggerMonsterSeq: null,
        durationSec: 30,
        priority: 50,
        enabled: true,
        npc: { name: npcName, imageUrl: null, imageThumbnailUrl: null },
        nodes: [
          {
            id: 'start',
            text: `${npcName}望向你：『路途遙遠，若你願聽，我有往事可說；若你想學，亦可教上一招。』`,
            options: [
              {
                id: 'opt_talk', label: '在茶香邊傾聽他的舊日戰記', npcReply: '他緩緩說起邊境一役中微小而堅定的溫柔。', nextNodeId: null,
                effects: [ { type: 'grant_currency', payload: { currencyType: 'gold', amount: -100 } } ]
              },
              {
                id: 'opt_duel', label: '在月影下與他較量，以試煉自我', npcReply: '他收起笑容，眼中有著認真的光。', nextNodeId: null,
                effects: [ { type: 'grant_buff', payload: { effect: { key: 'final_damage_up', params: { value: 1.12 }, duration: { mode: 'battle', value: 1 }, stackMode: 'refresh' } } } ]
              },
              {
                id: 'opt_train', label: '請求他示範一本難得的招式', npcReply: '他耐心地分解動作，每一步都帶著歷練的痕跡。', nextNodeId: null,
                effects: [ { type: 'grant_currency', payload: { currencyType: 'gold', amount: -50 } }, { type: 'grant_buff', payload: { effect: { key: 'minor_training_atk', params: { value: 1.05 }, duration: { mode: 'battle', value: 1 }, stackMode: 'refresh' } } } ]
              },
              {
                id: 'opt_trade', label: `暗中交換一件久經沙場的兵器`, npcReply: `他低語：『拿去好好用吧。』`, nextNodeId: null,
                condition: { any: types.map(t=>({ weaponType: t })) },
                effects: [ { type: 'take_item', payload: { itemId: weapon ? weapon.id : '', enhanceLevel: 3 } }, { type: 'grant_equipment', payload: { itemId: weapon ? weapon.id : '', enhanceLevel: 3 } } ]
              }
            ]
          }
        ]
      };

      const outPath = path.resolve(dir, `wandering-${jobId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(tpl, null, 2), 'utf8');
      createdFiles.push(outPath);
      console.log('Wrote template for', jobName, '->', outPath);
    }

    console.log('Done. Wrote', createdFiles.length, 'templates.');
    process.exit(0);
  } catch (e) {
    console.error('fatal:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
