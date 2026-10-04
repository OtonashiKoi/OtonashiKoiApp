'use strict';
// One-shot completion step for a launched full simulation, not a recurring job.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.argv.find(a=>a.startsWith('--root='))?.slice(7);
if(!root)throw Error('--root required');
const start=Date.now();
async function main(){
 while(Date.now()-start<24*3600000){
  let finished=0;
  for(let n=1;n<=4;n++){
   const dir=path.join(root,'full-100-'+n);
   finished+=fs.readdirSync(dir).filter(f=>f.endsWith('.summary.json')).length;
   const log=fs.readFileSync(path.join(root,'full-100-'+n+'.log'),'utf8');
   if(/\n(?:Error|AssertionError|TypeError|RangeError|ReferenceError|SyntaxError):/.test(log))throw Error('Worker '+n+' failed; preserve all traces and inspect its log');
  }
  fs.writeFileSync(root+'/run-progress.json',JSON.stringify({finished,expected:1100,updatedAt:new Date().toISOString(),status:finished===1100?'complete':'running'},null,2));
  if(finished===1100){
   const report=spawnSync(process.execPath,[path.join(__dirname,'report-normal-player-journey.js'),'--root='+root],{encoding:'utf8',env:process.env});
   process.stdout.write(report.stdout);process.stderr.write(report.stderr);
   if(report.status!==0)throw Error('Final report validation failed');
   return;
  }
  await new Promise(resolve=>setTimeout(resolve,30000));
 }
 throw Error('Completion wait exceeded24h; do not mark simulation complete');
}
main().catch(e=>{fs.writeFileSync(root+'/completion-error.txt',e.stack);console.error(e.stack);process.exitCode=1});
