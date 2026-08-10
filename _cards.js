require("dotenv").config();
const { getMongoDb } = require("./src/adapters/mongo/createMongoClient");
(async () => {
  const db = await getMongoDb();
  const ref = await db.collection("monsters").find({ zone: "ancient_city_deep", isBoss:{$ne:true} }).sort({seq:1}).toArray();
  console.log("=== 古城深處 10 張怪物卡的技能設計(對照組) ===\n");
  for (const m of ref) {
    const c = m.equipment?.special_1;
    if (!c) { console.log(`${m.name}: (無卡)`); continue; }
    const sk = c.monsterCardSkill;
    console.log(`【${c.itemName}】 tier=${c.tier} stats=${JSON.stringify(c.equipStats)}`);
    if (sk) console.log(`   技能「${sk.name}」發動${sk.chance}% trigger=${sk.trigger} cd=${sk.cooldownTurns}\n   ${sk.description}`);
    const eff = [...(c.procEffects||[]),...(c.passiveEffects||[]),...(c.combatEffects||[])];
    console.log(`   效果: ${eff.map(e=>`${e.key}(${JSON.stringify(e.params||{})})`).join(" / ")||"-"}\n`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
