"use strict";
/**
 * 期間限定活動區(event_1) 7 隻水屬性小怪的「怪物卡」seed。
 *
 * ── 設計主軸：水系＝控制 → 加成 → 續戰 的循環（7 張互相咬合，不是各自為政）──
 *
 *   【施加控制】潮鳴咒師(緩速+破防) / 寒淵騎士(凍結) / 溺影潛伏者(溺水DOT)
 *         ↓ 敵人身上帶著負面狀態
 *   【收割加成】碧波弓手(對負面狀態敵人增傷) / 珊瑚劍士(對負面狀態敵人追擊)
 *         ↓ 打得動也要活得久
 *   【反制續戰】潮汐守衛(水盾反彈) / 鎧鱗龍人(吸血續戰)
 *
 *   單張都能用，湊越多張綜效越強 → 給玩家「集齊水系卡組」的動機。
 *
 * 規格對齊古城深處那 10 張：A 階、equipStats 全 0（純技能取勝）、發動率 15~25%、
 * 強效果掛 cooldownTurns。
 *
 * ⚠️ 只使用 combatLoop 確實有處理的 effect key（已逐一比對驗證）。
 * ⚠️ on_dodge 卡先前因引擎缺陷完全失效（見 combatLoop.js 的 requireHpGate 註解），已修復。
 *
 * 用法：
 *   node scripts/seed-event1-water-cards.js            # dry-run
 *   node scripts/seed-event1-water-cards.js --apply    # 實際寫入
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZONE = "event_1";
const APPLY = process.argv.includes("--apply");
const CARD_DROP_CHANCE = 0.1;

const turns = (v) => ({ mode: "turns", value: v });
const self = (key, params, trigger = "on_hit") =>
  ({ key, target: "self", trigger, chance: 100, sourcePhase: "proc", params });
const foe = (key, params, trigger = "on_hit") =>
  ({ key, target: "enemy", trigger, chance: 100, sourcePhase: "proc", params });

/** seq → 卡片設計 */
const CARDS = {
  // ── 反制續戰組 ──
  1: {
    cardName: "潮汐守衛卡",
    role: "【反制】水盾",
    skill: {
      key: "tide_bulwark", name: "潮汐壁壘", chance: 25, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率25%：受擊時張開水幕，受到傷害-15%並反彈所受傷害的30%，持續2回合。",
    },
    procEffects: [
      self("damage_reduction", { value: 15, duration: turns(2) }),
      self("thorns", { value: 30, duration: turns(2) }),
    ],
  },
  5: {
    cardName: "鎧鱗龍人卡",
    role: "【續戰】吸取",
    skill: {
      key: "scale_siphon", name: "鱗潮汲取", chance: 25, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率25%：命中時汲取水氣，吸血+12%；血量低於50%時額外攻擊力+20%，持續2回合。",
    },
    procEffects: [
      self("lifesteal", { value: 12, duration: turns(2) }),
      self("atk_up", { value: 20, duration: turns(2), ownerHpBelowPct: 50 }),
    ],
  },

  // ── 施加控制組 ──
  4: {
    cardName: "潮鳴咒師卡",
    role: "【控制】緩速破防",
    skill: {
      key: "tide_hex", name: "潮鳴咒縛", chance: 20, trigger: "on_hit", cooldownTurns: 2,
      description: "發動率20%：命中時以潮流纏縛敵人，使其緩速並DEF-10（可疊加，上限-40），持續3回合；冷卻2回合。",
    },
    procEffects: [
      foe("proc_slow", { duration: turns(3) }),
      foe("proc_def_down", { value: 10, duration: turns(3), stackMode: "stack_value", stackAdd: 10, maxValue: 40 }),
    ],
  },
  7: {
    cardName: "寒淵騎士卡",
    role: "【控制】凍結",
    skill: {
      key: "abyss_frost", name: "寒淵凍縛", chance: 20, trigger: "on_hit", cooldownTurns: 3,
      description: "發動率20%：命中時凍結敵人；血量高於70%時自身格擋率+15%，持續2回合；冷卻3回合。",
    },
    procEffects: [
      foe("freeze", { duration: turns(1), bossImmune: true }),
      self("block_chance_up", { value: 15, duration: turns(2), ownerHpAbovePct: 70 }),
    ],
  },
  2: {
    cardName: "溺影潛伏者卡",
    role: "【控制】溺水DOT",
    skill: {
      key: "drown_shadow", name: "溺影纏身", chance: 25, trigger: "on_dodge", cooldownTurns: 0,
      description: "發動率25%：成功迴避後反手施加溺水（持續傷害），並使自身迴避+15，持續3回合。",
    },
    procEffects: [
      foe("proc_poison", { value: 0.7, mode: "pct", duration: turns(3) }, "on_dodge"),
      self("dodge_up", { value: 15, duration: turns(3) }, "on_dodge"),
    ],
  },

  // ── 收割加成組（吃上面施加的負面狀態）──
  6: {
    cardName: "碧波弓手卡",
    role: "【收割】對負面狀態增傷",
    skill: {
      key: "azure_volley", name: "碧波追潮", chance: 20, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率20%：命中時使敵方流血，持續3回合。常駐：對已中負面狀態的敵人傷害+18%。",
    },
    procEffects: [
      foe("proc_bleed", { value: 0.6, mode: "pct", duration: turns(3) }),
    ],
    passiveEffects: [
      { key: "bonus_vs_debuffed", target: "self", trigger: "passive", chance: 100, sourcePhase: "passive",
        params: { value: 18 } },
    ],
  },
  3: {
    cardName: "珊瑚劍士卡",
    role: "【收割】追擊",
    skill: {
      key: "coral_edge", name: "珊瑚亂刃", chance: 25, trigger: "on_hit", cooldownTurns: 0,
      description: "發動率25%：命中時追加一次造成55%攻擊力的斬擊（獨立傷害、不吃連擊率）。常駐：對中毒的敵人傷害+15%。",
    },
    procEffects: [
      foe("proc_extra_hit", { damageMultiplier: 0.55 }),
    ],
    passiveEffects: [
      { key: "bonus_vs_poisoned", target: "self", trigger: "passive", chance: 100, sourcePhase: "passive",
        params: { value: 15 } },
    ],
  },
};

function buildCard(monster, def) {
  return {
    itemId: `monster-card-${monster.id}`,
    itemName: def.cardName,
    itemType: "equipment",
    itemEffect: { type: "none", value: 0 },
    useEffects: [],
    passiveEffects: def.passiveEffects || [],
    procEffects: def.procEffects || [],
    combatEffects: [],
    imageUrl: monster.imageUrl,                  // 佔位：沿用怪物立繪，美術後補
    imageThumbnailUrl: monster.imageThumbnailUrl,
    equipSlot: "special",
    equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: "A",
    element: "water",
    monsterCardOf: monster.id,
    monsterCardSkill: { ...def.skill, procEffects: def.procEffects || [] },
  };
}

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");
  const monsters = await col.find({ zone: ZONE, _event1Seed: true }).sort({ seq: 1 }).toArray();

  if (monsters.length !== 7) {
    console.error(`❌ 預期 7 隻 event_1 seed 怪，實際 ${monsters.length} 隻。請先跑 seed-event1-water-zone.js`);
    process.exit(1);
  }

  console.log("═══ 水系卡組設計（控制 → 收割 → 續戰）═══\n");
  const ops = [];
  const order = [4, 7, 2, 6, 3, 1, 5];   // 依角色分組印出，方便檢視綜效
  for (const seq of order) {
    const m = monsters.find((x) => x.seq === seq);
    const def = CARDS[seq];
    if (!m || !def) continue;
    const card = buildCard(m, def);
    const sk = card.monsterCardSkill;
    console.log(`${def.role}  【${card.itemName}】← ${m.name}`);
    console.log(`   「${sk.name}」${sk.chance}% / ${sk.trigger}${sk.cooldownTurns ? ` / CD${sk.cooldownTurns}` : ""}`);
    console.log(`   ${sk.description}`);
    console.log(`   key: ${[...(card.procEffects || []), ...(card.passiveEffects || [])].map((e) => e.key).join(", ")}\n`);

    const drops = (m.drops || []).filter((d) => d.itemId !== card.itemId);
    drops.unshift({ itemId: card.itemId, itemName: card.itemName, chance: CARD_DROP_CHANCE });
    ops.push({
      updateOne: {
        filter: { id: m.id },
        update: { $set: { "equipment.special_1": card, drops, updatedAt: new Date().toISOString() } },
      },
    });
  }

  if (!APPLY) {
    console.log(`(dry-run，未寫入。加 --apply 才會實際寫進 DB／共 ${ops.length} 張)`);
    process.exit(0);
  }
  const r = await col.bulkWrite(ops);
  console.log(`✅ 已寫入 ${r.modifiedCount} 隻怪的卡片與掉落表。`);
  console.log("   怪物仍為 enabled:false，玩家看不到、也拿不到這些卡。");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
