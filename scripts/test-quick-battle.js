(async()=>{
  try {
    const r = await fetch('http://127.0.0.1:5566/api/auth/discord',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'mock:tester1'})});
    const t = await r.json();
    const token = t.data.token;
    console.log('got token');
    const r2 = await fetch('http://127.0.0.1:5566/api/combat/quick-battle',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({zone:'normal'})});
    const j2 = await r2.json();
    console.log(JSON.stringify(j2,null,2));
  } catch (e) { console.error(e); process.exit(1); }
})();