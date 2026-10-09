const { requireAuth } = require('./requireAuth');
const { ok, fail } = require('../../shared/response');
const { normalizeZone, canPlayerAccessZone } = require('../../shared/zones');
const { zoneCombatScene: scene } = require('../../services/realtime/zoneCombatScene');
function mountZoneCombatSceneRoutes(router, serviceContext) {
  router.get('/api/combat/starter-companions',requireAuth,async(req,res,next)=>{
    try{
      const zone=normalizeZone(req.query.zone);
      if(!canPlayerAccessZone(zone,req.playerRecord.discordId))return res.status(403).json(fail('ZONE_FORBIDDEN','尚未開放此區域'));
      const roster=await require('../../services/realtime/starterCompanions').loadCompanions(serviceContext,zone);
      res.json(ok(roster.map(n=>({key:n.key,name:n.actorName,level:n.level,jobName:n.jobName,role:n.role,tier:n.tier,avatarUrl:n.avatarUrl,attributes:n.attributes,stats:n.stats,tickMs:n.tick,skill:n.skill,revision:n.revision}))));
    }catch(error){next(error);}
  });
  router.post('/api/combat/stance',requireAuth,async(req,res,next)=>{
    try {
      const {liveBattleId,stance}=req.body || {};
      if(typeof liveBattleId!=='string'||!liveBattleId||liveBattleId.length>100||typeof stance!=='string'||!stance||stance.length>40)
        return res.status(400).json(fail('INVALID_LIVE_STANCE','缺少有效的戰鬥或招式'));
      const engine=require('../../services/realtime/normalLiveCombat').normalLiveCombat;
      await engine.ready(serviceContext);
      res.json(ok(await engine.setStance(req.playerRecord.discordId,liveBattleId,stance)));
    }catch(error){if(error.statusCode || error.status)return res.status(error.statusCode || error.status).json(fail('LIVE_STANCE_REJECTED',error.message));next(error);}
  });
  router.post('/api/combat/leave',requireAuth,async(req,res,next)=>{
    try {
      const battleId=req.body?.liveBattleId;
      if(typeof battleId!=='string'||!battleId||battleId.length>100)return res.status(400).json(fail('INVALID_BATTLE_ID','缺少有效的戰鬥識別碼'));
      const engine=require('../../services/realtime/normalLiveCombat').normalLiveCombat;
      await engine.ready(serviceContext);
      res.json(ok(await engine.leave(req.playerRecord.discordId,battleId)));
    }catch(error){if(error.status===409)return res.status(409).json(fail('LIVE_LEAVE_BUSY',error.message));next(error);}
  });
  router.get('/api/combat/live-session',requireAuth,async(req,res,next)=>{
    try {await require("../../services/realtime/normalLiveCombat").normalLiveCombat.ready(serviceContext);res.json(ok(require('../../services/realtime/normalLiveCombat').normalLiveCombat.status(req.playerRecord.discordId)));}catch(error){next(error);}
  });
  router.get('/api/combat/scene', requireAuth, async (req,res,next) => {
    try {
      const zone=normalizeZone(req.query.zone);
      if(!canPlayerAccessZone(zone,req.playerRecord.discordId)||!scene.supports(zone))return res.json(ok(null));
      await require("../../services/realtime/normalLiveCombat").normalLiveCombat.ready(serviceContext);
      scene.watch(req.playerRecord.discordId,zone);
      const [state,monsters]=await Promise.all([serviceContext.monsterService.getState(zone),serviceContext.monsterService.listMonsters({includeDisabled:false,zone})]);
      const monster=monsters.find(m=>Number(m.seq)===Number(state.activeMonsterSeq));
      const current=scene.ensure(zone,state,monster);
      if(current && zone==='event_boss_hutao_preview') current.controlGauges=state.liveControlGauges || null;
      res.json(ok(scene.publicSnapshot(current)));
    } catch(error) {next(error);}
  });
}
module.exports={mountZoneCombatSceneRoutes};
