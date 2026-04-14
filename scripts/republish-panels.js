#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try{
    const sc = createServiceContext();
    const layout = await sc.channelLayoutRepository.get();
    const bindings = (layout?.discord?.bindings) || [];
    if(!bindings.length){
      console.log('No discord bindings found.');
      process.exit(0);
    }
    // Publish panels via service call without cleaning channels to avoid deleting announcements
    for(const b of bindings){
      try{
        if(!b.channelId) continue;
        console.log('Publishing panel to', b.channelId);
        await sc.adminConsoleService.publishMonsterZonePanel(b.channelId, null, null, { cleanChannel: false });
        console.log('Published to', b.channelId);
      }catch(err){
        console.error('Publish failed for', b.channelId, err && err.stack ? err.stack : (err && err.message ? err.message : err));
      }
    }
    console.log('All done');
    process.exit(0);
  }catch(e){
    console.error('Error republishing panels', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
