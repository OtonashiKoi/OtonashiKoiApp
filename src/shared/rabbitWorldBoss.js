"use strict";
const ZONE="event_boss_rabbit_preview",BOSS_KEY="mantou_rabbit";
const CAST_MS=20000,RECOVERY_MS=30000,RAGE_MS=30000,TAUNT_TARGET=5;
function advance(state,hp,maxHp,players=1,now=Date.now()){
 const r=state.rabbit ||= {startedAt:now,marks:[],cast:null,recoveryUntil:0,pulse:null,taunt:0,rageUntil:0};
 r.taunt ||= 0;r.rageUntil ||= 0;
 if(r.cast&&!r.cast.pokes){r.cast.pokes={};r.cast.target=Math.min(5,Math.max(1,players));r.cast.id += ":poke";}
 if(r.cast&&now>=r.cast.endsAt){r.pulse={id:r.cast.id,at:now,crushed:{}};r.cast=null;r.recoveryUntil=now+RECOVERY_MS;r.rageUntil=0;r.taunt=0;}
 if(!r.cast&&now>=r.recoveryUntil&&hp>0){const mark=[70,30].find(m=>hp/Math.max(1,maxHp)*100<=m&&!r.marks.includes(m));if(mark){r.marks.push(mark);r.cast={id:`${r.startedAt}:${mark}`,mark,endsAt:now+CAST_MS,pokes:{},target:Math.min(5,Math.max(1,players))};r.pulse=null;}}
 return r;
}
function recordDamage(state,damage,now=Date.now()){
 const r=state.rabbit;if(!r||r.cast||now<r.recoveryUntil||now<r.rageUntil)return;
 r.taunt=Math.min(TAUNT_TARGET,(r.taunt||0)+1);if(r.taunt>=TAUNT_TARGET){r.rageUntil=now+RAGE_MS;r.taunt=0;}
}
function poke(state,playerId,castId,now=Date.now()){
 const r=state.rabbit;
 if(!r?.cast||r.cast.id!==castId||now>=r.cast.endsAt)return {ok:false,reason:"沒有可戳破的蒸氣詠唱"};
 const id=String(playerId);if(r.cast.pokes[id])return {ok:true,duplicate:true,interrupted:false};
 r.cast.pokes[id]=true;const interrupted=Object.keys(r.cast.pokes).length>=r.cast.target;
 if(interrupted){r.cast=null;r.pulse=null;r.recoveryUntil=now+RECOVERY_MS;r.rageUntil=0;r.taunt=0;}
 return {ok:true,duplicate:false,interrupted};
}
function view(state,now=Date.now()){
 const r=state.rabbit,base={taunt:r?.taunt||0,tauntTarget:TAUNT_TARGET};
 if(!r)return {...base,phase:"small",damageMult:.65,incomingMult:1,dodgeBonus:45};
 if(r.cast)return {...base,phase:"casting",castId:r.cast.id,remainingMs:Math.max(0,r.cast.endsAt-now),durationMs:CAST_MS,pokes:Object.keys(r.cast.pokes||{}).length,target:r.cast.target,damageMult:1,incomingMult:1,dodgeBonus:0};
 if(now<r.recoveryUntil)return {...base,phase:"recovery",remainingMs:r.recoveryUntil-now,durationMs:RECOVERY_MS,damageMult:.6,incomingMult:1.3,dodgeBonus:0};
 const rage=now<r.rageUntil;
 return {...base,phase:rage?"rage":"small",damageMult:rage?1.7:.65,incomingMult:rage?1.3:1,dodgeBonus:rage?0:45,...(rage?{remainingMs:r.rageUntil-now,durationMs:RAGE_MS}:{})};
}
function crushPending(state,playerId,now=Date.now()){const r=state.rabbit;return !!(r?.pulse&&now<r.recoveryUntil&&!r.pulse.crushed[String(playerId)]);}
function markCrushed(state,playerId){if(state.rabbit?.pulse)state.rabbit.pulse.crushed[String(playerId)]=true;}
module.exports={ZONE,BOSS_KEY,CAST_MS,RECOVERY_MS,TAUNT_TARGET,advance,recordDamage,poke,view,crushPending,markCrushed};
