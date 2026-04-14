#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createServiceContext } = require('../src/services/createServiceContext');

function rand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function rnd(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function randName(){
  // 中文 / 奇幻風格名字列表（不含數字）
  const names = [
    '艾蓮娜','卡蘭','瑪瑞','索倫','菲雅','雷恩','布洛克','希爾達','米洛','露娜',
    '維爾','娜婕','奧菲','葛瑞','賽恩','伊莉','霍恩','瑟利亞','凱洛','琳恩'
  ];
  return rand(names);
  function randName(){
    // 日式奇幻風格名字（純中文/日式音譯）
    const names = [
      '有栖','真央','綾音','隼人','蒼','美緒','蓮','紬','雪乃','大和',
      '響','若葉','風間','瑞希','宗介','織姬','泉','朱音','時雨','雪村'
    ];
    return rand(names);
  }
}

(async function main(){
  try {
    const sc = createServiceContext();
    const dir = path.resolve(__dirname, 'npc-templates');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const effects = await sc.effectDefinitionService.listDefinitions().catch(()=>[]);
    const allItems = await sc.itemService.listItems().catch(()=>[]);
    // 只使用 D 階裝備作為發放目標
    const equipments = allItems.filter(i=>i.itemType==='equipment' && String(i.tier||'').toUpperCase()==='D');

    const out = [];
    for (let i=0;i<10;i++){
      const name = randName();
      const tpl = {
        id: `random_npc_${name}_${i}`,
        zone: 'normal',
        name: name,
        message: `${name} 在路邊練習動作，似乎有話要說。`,
        triggerMonsterSeq: null,
        durationSec: rnd(20,60),
        priority: 40 + rnd(0,20),
        enabled: true,
        npc: { name, imageUrl: null, imageThumbnailUrl: null },
        nodes: [{ id: 'start', text: `${name} 對你點頭：『要不要試試看這個？』`, options: [] }]
      };

      const optCount = rnd(2,4);
      for (let o=0;o<optCount;o++){
        const optId = `opt_${o}`;
        const choice = rnd(1,3);
        let effectsArr = [];
        if (choice === 1) {
          const gold = -rnd(20,500);
          // 更敘事化的選項文字將在下方組合
          effectsArr.push({ type: 'grant_currency', payload: { currencyType: 'gold', amount: gold } });
        } else if (choice === 2) {
          // pick random buff definition key if available
          const buffDef = effects.filter(e=>e.key && e.category && String(e.category).toLowerCase().includes('buff'));
          const pick = buffDef.length ? rand(buffDef) : null;
          if (pick) {
            effectsArr.push({ type: 'grant_buff', payload: { effect: { key: pick.key, params: { value: 1.05 }, duration: { mode: 'battle', value: 1 }, stackMode: 'refresh' } } });
          } else {
            effectsArr.push({ type: 'grant_currency', payload: { currencyType: 'gold', amount: -50 } });
          }
        } else {
          const eq = equipments.length ? rand(equipments) : null;
          if (eq) effectsArr.push({ type: 'grant_equipment', payload: { itemId: eq.id, enhanceLevel: rnd(0,3) } });
          else effectsArr.push({ type: 'grant_currency', payload: { currencyType: 'gold', amount: -100 } });
        }

        tpl.nodes[0].options.push({ id: optId, label: rand(['試試看','要嗎','看看','交換一下']), npcReply: rand(['好','來吧','就這樣','祝你好運']), nextNodeId: null, effects: effectsArr });
        // richer labels aligned with story
        const labelChoices = [
          '在月下聽我說一段舊事',
          '與我較量一番，證明你的工夫',
          '你可願替我試用此物？',
          '若你有興趣，可交換些稀罕玩意'
        ];
        const replyChoices = [
          '他低語道：這事說來話長。',
          '他竟然收起笑容，目光認真。',
          '他將物品推向你，眼角含著期待。',
          '他嘆了口氣，像是在等待一個答案。'
        ];
        tpl.nodes[0].options.push({ id: optId, label: rand(labelChoices), npcReply: rand(replyChoices), nextNodeId: null, effects: effectsArr });
      }

      // 使用名字作為檔名，避免英文字母+數字組合
      let fileName = `random-npc-${name}.json`;
      let counter = 1;
      while (fs.existsSync(path.resolve(dir, fileName))) {
        fileName = `random-npc-${name}-${counter}.json`;
        counter++;
      }
      const outPath = path.resolve(dir, fileName);
      fs.writeFileSync(outPath, JSON.stringify(tpl, null, 2), 'utf8');
      out.push(outPath);
      console.log('Wrote', outPath);
    }

    console.log('Done. Wrote', out.length, 'random NPC templates');
    process.exit(0);
  } catch (e){
    console.error(e && e.message || e);
    process.exit(1);
  }
})();
