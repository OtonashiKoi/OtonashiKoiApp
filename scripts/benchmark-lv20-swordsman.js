require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS_PER_MONSTER = 50;

// ── Lv.20 雙手劍士配置 ───────────────────────────────────────
// 升等 1→20 共 19 級，每級 +2 屬性 = 38 點 + 起始 1×6 = 44 點
// 集中投資（假設玩家用 reroll 重置過）：
const PLAYER = {
  level: 20,
  attributes: { str: 25, agi: 3, vit: 10, int: 1, dex: 3, luk: 2 },
};

// 裝備 ID（C 階全套 + 鐵製雙手劍 + 劍士徽章）
const EQUIPMENT_IDS = {
  weapon:      { weaponType: "sword_2h", needName: "鐵製雙手劍" },
  armor:       { needName: "皮甲" },
  garment:     { needName: "皮披風" },
  shoes:       { needName: "皮靴" },
  head_top:    { needName: "皮帽" },
  head_mid:    { needName: "迅紋皮護目" },
  head_low:    { needName: "皮口罩" },
  accessory_l: { needName: "迅紋鐵戒指(左)" },
  accessory_r: { needName: "迅紋鐵戒指(右)" },
  job_eq:      { needName: "劍士徽章" },
};

async function main() {
  const db = await getMongoDb();
  const items = await db.collection("items").find({}).toArray();
  const monsters = (await db.collection("monsters").find({}).sort({ zone: 1, level: 1, seq: 1 }).toArray())
    .filter((m) => !String(m._id || "").startsWith("monsterState:"))
    .filter((m) => m.enabled !== false);

  const itemByName = new Map(items.map((it) => [it.name, it]));
  const equipped = {};
  for (const [slot, spec] of Object.entries(EQUIPMENT_IDS)) {
    const it = itemByName.get(spec.needName);
    if (!it) {
      console.error(`找不到裝備：${spec.needName}`);
      process.exit(1);
    }
    equipped[slot] = { ...it, itemId: it.id, itemName: it.name };
  }

  // 把怪物 calc 結構建好（仿 monsterService.effectiveCalc）
  const { calcStats } = require("../src/services/monster/monsterService.js");
  // monsterService.js 沒 export calcStats，我們直接呼叫服務或重建。改 require 完整服務太麻煩，乾脆直接寫 mock
  // → 直接從 DB 取怪後用 effectiveCalc 邏輯。簡化：直接組 mCalc。
  const buildMonsterCalc = (m) => {
    const level = Math.max(1, m.level || 1);
    const str = m.str || 1, agi = m.agi || 1, vit = m.vit || 1, dex = m.dex || 1;
    return {
      maxHp: m.maxHp || 100,
      atk: str * 3,
      def: Math.min(75, Math.max(0, Number(m.def) || 0)),
      flatDef: (typeof m.flatDef === 'number') ? Math.max(0, m.flatDef) : level * 1,
      level,
      agi,
      dodge: Math.min(50, agi * 0.5),
      hit: Math.min(100, 80 + dex),
      critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
      comboChance: Math.min(80, Math.round(3 + agi * 0.5)),
      defIgnorePct: m.defIgnorePct || 0,
      isBoss: Boolean(m.isBoss),
    };
  };

  // 算玩家 pStats
  const pStats = calcPlayerStats(PLAYER.attributes, equipped, [], [], {});

  console.log("═══ Lv.20 雙手劍士 ═══");
  console.log("基礎屬性：", PLAYER.attributes);
  console.log("裝備配置：");
  for (const [slot, item] of Object.entries(equipped)) {
    const s = item.equipStats || {};
    const stat = ["str","agi","vit","int","dex","luk"].map((k) => s[k] ? `${k.toUpperCase()}+${s[k]}` : "").filter(Boolean).join(" ");
    console.log(`  ${slot.padEnd(12)} ${item.name.padEnd(20)} ${stat}`);
  }
  console.log("計算數值：");
  console.log(`  HP=${pStats.maxHp}  ATK=${pStats.atk}  flatDef=${pStats.flatDef}  pctDef=${pStats.def}%`);
  console.log(`  HIT=${pStats.hit}%  DODGE=${pStats.dodge}%  CRIT=${pStats.crit}%  COMBO=${pStats.combo}%`);
  console.log(`  baseVit=${pStats.baseVit}  equipVit=${pStats.equipVit}`);
  console.log("");

  // 跑分
  console.log("═══ 跑分（每隻怪 50 場）═══");
  const headers = ["Zone", "Lv", "怪物", "勝率", "平均回合", "我方DPR", "怪DPR", "結果"];
  console.log(headers.join(" | "));
  console.log("─".repeat(110));

  for (const m of monsters) {
    const mCalc = buildMonsterCalc(m);
    let wins = 0, totalRounds = 0, totalMyDmg = 0, totalMonsterDmg = 0;
    for (let i = 0; i < RUNS_PER_MONSTER; i++) {
      const result = runCombatLoop(pStats, mCalc, m.name, mCalc.maxHp, 15, {
        playerLevel: PLAYER.level,
        equipped,
        inventory: [],
        monsterIsBoss: Boolean(m.isBoss),
      });
      if (result.outcome === "win") wins++;
      const rounds = result.roundLogs?.length || 0;
      totalRounds += rounds;
      totalMyDmg += result.totalDamage || 0;
      const playerHpStart = pStats.maxHp;
      const playerHpEnd = result.finalPlayerHp ?? 0;
      totalMonsterDmg += Math.max(0, playerHpStart - playerHpEnd);
    }
    const winRate = ((wins / RUNS_PER_MONSTER) * 100).toFixed(0);
    const avgRounds = (totalRounds / RUNS_PER_MONSTER).toFixed(1);
    const myDpr = (totalMyDmg / totalRounds || 0).toFixed(0);
    const mDpr = (totalMonsterDmg / totalRounds || 0).toFixed(0);
    const verdict = wins === RUNS_PER_MONSTER
      ? "✅ 穩贏"
      : wins === 0
        ? "💀 完敗"
        : wins >= RUNS_PER_MONSTER * 0.8
          ? "👍 順風"
          : wins >= RUNS_PER_MONSTER * 0.4
            ? "⚖️ 五五波"
            : "⚠️ 危險";
    const zoneLabel = `${m.zone}${m.isBoss ? "·BOSS" : ""}`;
    console.log(
      [
        zoneLabel.padEnd(12),
        String(m.level).padEnd(3),
        m.name.padEnd(14),
        `${winRate}%`.padEnd(5),
        avgRounds.padEnd(6),
        myDpr.padEnd(6),
        mDpr.padEnd(6),
        verdict,
      ].join(" | ")
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
