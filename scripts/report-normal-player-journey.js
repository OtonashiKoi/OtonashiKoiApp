'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
const root=arg('--root');assert.ok(root,'--root required');
const partial=process.argv.includes('--partial');
const directories=[1,2,3,4].map(n=>path.join(root,'full-100-'+n));
const manifests=directories.map(d=>JSON.parse(fs.readFileSync(d+'/manifest.json')));
for(const m of manifests)assert.deepEqual(m.sourceHashes,manifests[0].sourceHashes,'source hashes differ');
const runs=directories.flatMap(d=>fs.readdirSync(d).filter(f=>f.endsWith('.summary.json')).map(f=>JSON.parse(fs.readFileSync(d+'/'+f))));
const expected=manifests.flatMap(m=>m.seeds);
const key=r=>r.route.baseKey+':'+r.seed;
assert.equal(new Set(runs.map(key)).size,runs.length,'duplicate runs');
for(const r of runs)assert.ok(expected.some(s=>s.job===r.route.baseKey&&s.seed===r.seed),'unexpected seed');
if(!partial)assert.equal(runs.length,1100,'not all 1100 attempts have finished');
const percentile=(values,p)=>{if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return a[lo]+(a[hi]-a[lo])*(i-lo);};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const milestone=(r,t)=>r.milestones.find(m=>m.type===t)?.seconds/3600;
const threshold=(r,lv)=>lv===1?0:r.levels.find(x=>x.level>=lv)?.seconds/3600;
function ordinaryTiers(r){
 const first={D:{seconds:0,level:1,name:'初始木製單手劍',slot:'weapon'}};
 for(const u of r.upgrades)for(const [slot,i]of Object.entries(u.after)){
  if(slot.startsWith('special')||['job_eq','title_eq','anchor'].includes(slot)||!i.tier)continue;
  if(!first[i.tier])first[i.tier]={seconds:u.seconds,level:u.level,name:i.name,slot};
 }
 return first;
}
const routes=manifests[0].matrix.included;
const rows=routes.map(route=>{
 const a=runs.filter(r=>r.route.baseKey===route.baseKey),ok=a.filter(r=>r.complete),times=ok.map(r=>r.hours);
 const stages=[[1,10],[10,20],[20,30],[30,40],[40,50]].map(([lo,hi])=>mean(ok.map(r=>threshold(r,hi)-threshold(r,lo))));
 return{job:route.baseName,t2:route.t2Name,key:route.baseKey,attempts:a.length,completed:ok.length,failures:a.filter(r=>!r.complete).map(r=>({seed:r.seed,level:r.level,reason:r.blocked,hours:r.hours})),
  median:percentile(times,.5),p10:percentile(times,.1),p90:percentile(times,.9),max:times.length?Math.max(...times):null,mean:mean(times),stages,
  t1:mean(a.map(r=>milestone(r,'t1')).filter(Number.isFinite)),t2Hours:mean(a.map(r=>milestone(r,'t2')).filter(Number.isFinite)),
  deaths:mean(a.map(r=>r.deaths)),gold:mean(a.map(r=>r.finalGold)),combatHours:mean(ok.map(r=>r.combatHours)),restHours:mean(ok.map(r=>r.restHours)),managementHours:mean(ok.map(r=>r.managementHours)),
  enhancementGold:mean(a.map(r=>-(r.currency['enhance:cost']||0))),currency:aggregateCurrency(a),zones:aggregateZones(a),
  firstTiers:Object.fromEntries(['D','C','B','A'].map(t=>[t,{count:a.filter(r=>ordinaryTiers(r)[t]).length,hours:mean(a.map(r=>ordinaryTiers(r)[t]?.seconds/3600).filter(Number.isFinite)),level:mean(a.map(r=>ordinaryTiers(r)[t]?.level).filter(Number.isFinite))}]))};
});
function aggregateCurrency(a){const keys=[...new Set(a.flatMap(r=>Object.keys(r.currency)))];return Object.fromEntries(keys.map(k=>[k,mean(a.map(r=>r.currency[k]||0))]));}
function aggregateZones(a){const keys=[...new Set(a.flatMap(r=>Object.keys(r.zones)))];return Object.fromEntries(keys.map(k=>[k,Object.fromEntries(['battles','kills','deaths','seconds','gold','exp'].map(field=>[field,mean(a.map(r=>r.zones[k]?.[field]||0))]))]));}
const report={status:partial?'running':'all-attempts-finished',expected:expected.length,finished:runs.length,successful:runs.filter(r=>r.complete).length,totalBattles:runs.reduce((n,r)=>n+r.battles,0),rows,excluded:manifests[0].matrix.excluded,rules:manifests[0].rules,sourceHashes:manifests[0].sourceHashes};
fs.writeFileSync(root+'/journey-report.json',JSON.stringify(report,null,2));
const f=v=>v==null?'—':v.toFixed(2);
const lines=['# 全職業逐場養成模擬',`狀態：${report.status}；已完成 ${report.finished}/${report.expected} 次嘗試，其中 ${report.successful} 次達成50等及一轉／二轉。共 ${report.totalBattles.toLocaleString()} 場戰鬥。`,
 '','純普攻55小時是已配好當階+3裝的校準基準。本表包含技能、掉落／任務取得裝備、傷害卡、分解、強化失敗、死亡與疲勞休息，不能視為純普攻結果。',
 '','| 一轉→二轉 | 到50等及二轉 | 中位h | P10h | P90h | 最慢h | 一轉h | 二轉h | 平均死亡 | 平均強化花費 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const r of rows)lines.push(`| ${r.job}→${r.t2} | ${r.completed}/${r.attempts} | ${f(r.median)} | ${f(r.p10)} | ${f(r.p90)} | ${f(r.max)} | ${f(r.t1)} | ${f(r.t2Hours)} | ${f(r.deaths)} | ${f(r.enhancementGold)} |`);
lines.push('','| 職業 | 1→10h | 10→20h | 20→30h | 30→40h | 40→50h | 戰鬥h | 休息h | 整理h |','|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for(const r of rows)lines.push(`| ${r.job} | ${r.stages.map(f).join(' | ')} | ${f(r.combatHours)} | ${f(r.restHours)} | ${f(r.managementHours)} |`);
lines.push('','每個角色的完整換裝、升級、死亡、掉落、分解、強化、任務及轉職紀錄保存在同目錄的 *.jsonl.gz；*.summary.json 包含換装時點、当時穿装、各區收益與卡關原因。報表首次品階只計武器／防具，排除卡片、徽章、稱號；D為真實初始木劍。首次換上不代表首次掉落，逐次掉落可查完整事件。原始summary.firstTiers包含卡片，不作一般裝備進度使用。',
 '','未開放路線：'+report.excluded.map(r=>r.baseName+'→'+r.t2Name+'（'+r.reason+'）').join('、'),
 '','政策與限制：',...Object.entries(report.rules).map(([k,v])=>`- ${k}：${Array.isArray(v)?v.join('；'):v}`),
 '','模擬使用隔離資料，不寫正式玩家DB。Web/DC普通戰每次出戰依目前路由恢復玩家HP，怪物HP保留；選圖退回亦保留各區怪物HP。模型不代表真人操作或跨玩家生態驗收。',
 '','失敗：',...rows.flatMap(r=>r.failures.map(x=>`- ${r.job} seed${x.seed}：Lv${x.level}，${f(x.hours)}h，${x.reason}`)));
fs.writeFileSync(root+'/JOURNEY_REPORT.md',lines.join('\n')+'\n');
const csv=[['job','t2','seed','complete','reason','level','hours','combatHours','restHours','managementHours','battles','kills','deaths','t1Hours','t2Hours','finalGold'],...runs.map(r=>[r.route.baseName,r.route.t2Name,r.seed,r.complete,r.blocked||'',r.level,r.hours,r.combatHours,r.restHours,r.managementHours,r.battles,r.kills,r.deaths,milestone(r,'t1')??'',milestone(r,'t2')??'',r.finalGold])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
fs.writeFileSync(root+'/journey-runs.csv',csv+'\n');
console.log(JSON.stringify({finished:report.finished,expected:report.expected,successful:report.successful,totalBattles:report.totalBattles,report:root+'/JOURNEY_REPORT.md'}));
