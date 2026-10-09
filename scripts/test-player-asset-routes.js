"use strict";
const assert = require('node:assert/strict');
const express = require('express'),jwt=require('jsonwebtoken');
const {createPlayerAssetRoutes}=require('../src/api/routes/playerAssetRoutes');
(async()=>{
 process.env.JWT_SECRET='asset-route-isolated-test-secret-only';
 let calls=0;
 const app=express();app.use(createPlayerAssetRoutes({}, {getManifest:async()=>{calls++;return{version:'a'.repeat(64),assets:[],excludedCollections:true}}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 try{const url=`http://127.0.0.1:${server.address().port}/api/me/assets/manifest`;
 assert.equal((await fetch(url)).status,401);assert.equal(calls,0);
 assert.equal((await fetch(url,{headers:{Authorization:'Bearer invalid'}})).status,401);assert.equal(calls,0);
 const token=jwt.sign({discordId:'asset-route-test'},process.env.JWT_SECRET,{expiresIn:'1m'});
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await response.json()).data.excludedCollections,true);assert.equal(calls,1);
 console.log('PASS: manifest route requires valid JWT, uses no-store and standard response envelope');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
