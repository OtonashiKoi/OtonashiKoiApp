"use strict";
const assert=require('node:assert/strict');
const {NORMAL_LEVEL_BANDS,normalZoneExpMultiplier:mult}=require('../src/shared/normalZoneExp');
for(const [z,[lo,hi]] of Object.entries(NORMAL_LEVEL_BANDS)){
  assert.equal(mult(z,lo),1);assert.equal(mult(z,hi),1);
  assert.equal(mult(z,hi+1),0.95);assert.equal(mult(z,hi+5),0.75);
  assert.equal(mult(z,hi+10),0.5);assert.equal(mult(z,hi+30),0.1);
  if(lo>5)assert.equal(mult(z,lo-5),0.75);
}
for(const z of ['elite','dragon_king_lair','hellfire_depths','event_1','tower'])assert.equal(mult(z,100),1);
assert.equal(mult('normal',undefined),1);
console.log('PASS: normal map bands, both directions, floor, non-training exclusions');
