"use strict";
/**
 * 活動區 event_1 改主題：暗黑水系 → **海灘可愛風**（夏日限定活動）。
 *
 * 只換「主題」不換「平衡」：
 *   ✅ 換掉 怪物名 / 卡片名 / 技能名 / 技能說明
 *   ✅ 一處效果調整：玳瑁龜衛的「凍結」改「撞暈」(freeze→proc_stun)——海灘不該有冰凍
 *   ❌ 不動 HP/DEF/六屬性/EXP/金幣/出現率（已對齊古城深處，動了要重新平衡）
 *   ❌ 不動 element(water) / enabled(false) / 掉落裝備 / 掉落率
 *
 * 怪物 id 不變 → 卡片 itemId(monster-card-{id}) 也不變，不會產生孤兒資料。
 *
 * 用法：
 *   node scripts/retheme-event1-beach.js            # dry-run
 *   node scripts/retheme-event1-beach.js --apply    # 實際寫入
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZONE = "event_1";
const APPLY = process.argv.includes("--apply");
const turns = (v) => ({ mode: "turns", value: v });
const self = (key, params, trigger = "on_hit") =>
  ({ key, target: "self", trigger, chance: 100, sourcePhase: "proc", params });
const foe = (key, params, trigger = "on_hit") =>
  ({ key, target: "enemy", trigger, chance: 100, sourcePhase: "proc", params });

/** seq → 新主題（數值不動，只換皮） */
const RETHEME = {
  1: {
    name: "貝貝寄居蟹",
    flavor: "背著撿來的大貝殼走來走去，被嚇到就咻一下縮進去。",
    cardName: "貝貝寄居蟹卡",
    skill: {
      key: "shell_hideaway", name: "縮進殼殼", chance: 25, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率25%：咻一下縮進殼殼裡，受到傷害-15%，還會把撞上來的傷害反彈30%，持續2回合。",
    },
    procEffects: [
      self("damage_reduction", { value: 15, duration: turns(2) }),
      self("thorns", { value: 30, duration: turns(2) }),
    ],
  },
  2: {
    name: "溜溜沙蟹",
    flavor: "在沙灘上橫著咻咻跑，一眨眼就溜得不見蹤影。",
    cardName: "溜溜沙蟹卡",
    skill: {
      key: "sand_dash", name: "沙沙溜走", chance: 25, trigger: "on_dodge", cooldownTurns: 0,
      description: "發動率25%：閃過攻擊時踢起一陣沙沙迷住對手（持續傷害），自己溜得更快、迴避+15，持續3回合。",
    },
    procEffects: [
      foe("proc_poison", { value: 0.7, mode: "pct", duration: turns(3) }, "on_dodge"),
      self("dodge_up", { value: 15, duration: turns(3) }, "on_dodge"),
    ],
  },
  3: {
    name: "蝦蝦劍士",
    flavor: "撿到一片貝殼就當成劍，揮得可認真了的小蝦兵。",
    cardName: "蝦蝦劍士卡",
    skill: {
      key: "shrimp_flurry", name: "蝦蝦連刺", chance: 25, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率25%：命中時再補一記小突刺，造成55%攻擊力（獨立傷害、不吃連擊率）。常駐：對中毒的敵人傷害+15%。",
    },
    procEffects: [foe("proc_extra_hit", { damageMultiplier: 0.55 })],
    passiveEffects: [
      { key: "bonus_vs_poisoned", target: "self", trigger: "passive", chance: 100, sourcePhase: "passive",
        params: { value: 15 } },
    ],
  },
  4: {
    name: "墨墨章魚",
    flavor: "一生氣就噗噗噴墨汁，把整片海水弄得黑漆漆。",
    cardName: "墨墨章魚卡",
    skill: {
      key: "ink_splash", name: "噗噗墨汁", chance: 20, trigger: "on_hit", cooldownTurns: 2,
      description: "發動率20%：噗一聲噴墨汁糊住對手，使其緩速並DEF-10（可疊加，上限-40），持續3回合；冷卻2回合。",
    },
    procEffects: [
      foe("proc_slow", { duration: turns(3) }),
      foe("proc_def_down", { value: 10, duration: turns(3), stackMode: "stack_value", stackAdd: 10, maxValue: 40 }),
    ],
  },
  5: {
    name: "椰椰大蟹",
    flavor: "大螯咔嚓一下就把椰子夾成兩半，沙灘小小大力士。",
    cardName: "椰椰大蟹卡",
    skill: {
      key: "coconut_crush", name: "咔嚓大夾", chance: 25, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率25%：咔嚓一記大夾，吸血+12%；血量低於50%時會夾得更用力、攻擊力+20%，持續2回合。",
    },
    procEffects: [
      self("lifesteal", { value: 12, duration: turns(2) }),
      self("atk_up", { value: 20, duration: turns(2), ownerHpBelowPct: 50 }),
    ],
  },
  6: {
    name: "鼓鼓河豚",
    flavor: "一被嚇到就鼓成圓滾滾一顆，然後啵啵啵把刺射出去。",
    cardName: "鼓鼓河豚卡",
    skill: {
      key: "spine_volley", name: "啵啵毒刺", chance: 20, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率20%：啵啵射出小毒刺造成流血，持續3回合。常駐：對已中負面狀態的敵人傷害+18%。",
    },
    procEffects: [foe("proc_bleed", { value: 0.6, mode: "pct", duration: turns(3) })],
    passiveEffects: [
      { key: "bonus_vs_debuffed", target: "self", trigger: "passive", chance: 100, sourcePhase: "passive",
        params: { value: 18 } },
    ],
  },
  7: {
    name: "龜龜大將",
    flavor: "沙灘上最年長的居民，慢吞吞的，可是龜殼硬得連浪都推不動。",
    cardName: "龜龜大將卡",
    // 原本是 freeze(凍結)——海灘主題不該有冰凍，改成龜殼猛撞的「撞暈」
    skill: {
      key: "shell_bash", name: "龜龜衝撞", chance: 20, trigger: "on_hit", cooldownTurns: 3,
      description: "發動率20%：用硬邦邦的龜殼撞過去讓敵人暈頭轉向；血量高於70%時格擋率+15%，持續2回合；冷卻3回合。",
    },
    procEffects: [
      foe("proc_stun", { duration: turns(1), bossImmune: true }),
      self("block_chance_up", { value: 15, duration: turns(2), ownerHpAbovePct: 70 }),
    ],
  },
};

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");
  const monsters = await col.find({ zone: ZONE, _event1Seed: true }).sort({ seq: 1 }).toArray();
  if (monsters.length !== 7) {
    console.error(`❌ 預期 7 隻，實際 ${monsters.length} 隻`);
    process.exit(1);
  }

  console.log("═══ 海灘主題改版（數值完全不動）═══\n");
  const ops = [];
  for (const m of monsters) {
    const t = RETHEME[m.seq];
    if (!t) continue;
    const oldCard = m.equipment?.special_1 || {};
    const newCard = {
      ...oldCard,
      itemName: t.cardName,
      procEffects: t.procEffects || [],
      passiveEffects: t.passiveEffects || [],
      monsterCardSkill: { ...t.skill, procEffects: t.procEffects || [] },
    };
    // 掉落表裡那筆卡片的名字也要跟著改（itemId 不變）
    const drops = (m.drops || []).map((d) =>
      d.itemId === newCard.itemId ? { ...d, itemName: t.cardName } : d
    );

    console.log(`【${m.seq}】${m.name}  →  ${t.name}   (Lv.${m.level} HP${m.maxHp} 不變)`);
    console.log(`      ${t.flavor}`);
    console.log(`      卡片：${oldCard.itemName} → ${t.cardName}`);
    console.log(`      技能：「${oldCard.monsterCardSkill?.name}」→「${t.skill.name}」`);
    const oldKeys = (oldCard.procEffects || []).map((e) => e.key).join(",");
    const newKeys = (t.procEffects || []).map((e) => e.key).join(",");
    if (oldKeys !== newKeys) console.log(`      ⚠️ 效果調整：${oldKeys} → ${newKeys}`);
    console.log();

    ops.push({
      updateOne: {
        filter: { id: m.id },
        update: {
          $set: {
            name: t.name,
            description: t.flavor,
            drops,
            "equipment.special_1": newCard,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });
  }

  if (!APPLY) {
    console.log(`(dry-run，未寫入。加 --apply 實際套用／共 ${ops.length} 隻)`);
    process.exit(0);
  }
  const r = await col.bulkWrite(ops);
  console.log(`✅ 已改版 ${r.modifiedCount} 隻。數值/掉落/element/enabled 全部未動。`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
