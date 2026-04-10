/**
 * rebuild-equipment.js
 *
 * 重建裝備庫：
 * 1. 刪除所有舊的 【D/C/B/A】 前綴裝備
 * 2. 刪除所有現有武器（weaponType 未設定）
 * 3. 新增 10 種武器 × D/C/B/A 四階 = 40 件武器
 * 4. 更新非武器裝備的屬性值
 * 5. 同步至 MongoDB
 *
 * Usage: node scripts/rebuild-equipment.js [--yes]
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const DATA_PATH  = path.join(__dirname, "../data/game.json");
const MONGO_URI  = process.env.MONGODB_URI;
const DB_NAME    = process.env.MONGODB_DB || "equipmentGame";
const DRY_RUN    = !process.argv.includes("--yes");

// ─── 武器設計 ──────────────────────────────────────────────────────────────
// 主屬 D=3, C=6, B=9, A=13
// 副屬 B+1, A+2 (相關性屬性)
const WEAPONS = [
  // 單手劍 STR ×3
  { tier:'D', name:'木製單手劍',    slot:'weapon', weaponType:'sword_1h', stats:{ str:3 } },
  { tier:'C', name:'鐵製單手劍',    slot:'weapon', weaponType:'sword_1h', stats:{ str:6 } },
  { tier:'B', name:'精鋼單手劍',    slot:'weapon', weaponType:'sword_1h', stats:{ str:9, luk:1 } },
  { tier:'A', name:'秘銀單手劍',    slot:'weapon', weaponType:'sword_1h', stats:{ str:13, luk:2 } },
  // 雙手劍 STR ×6
  { tier:'D', name:'木製雙手劍',    slot:'weapon', weaponType:'sword_2h', stats:{ str:3 } },
  { tier:'C', name:'鐵製雙手劍',    slot:'weapon', weaponType:'sword_2h', stats:{ str:6 } },
  { tier:'B', name:'精鋼雙手劍',    slot:'weapon', weaponType:'sword_2h', stats:{ str:9, agi:1 } },
  { tier:'A', name:'秘銀雙手劍',    slot:'weapon', weaponType:'sword_2h', stats:{ str:13, agi:2 } },
  // 單手槌 STR ×3 +擊暈
  { tier:'D', name:'木製單手槌',    slot:'weapon', weaponType:'mace_1h',  stats:{ str:3 } },
  { tier:'C', name:'鐵製單手槌',    slot:'weapon', weaponType:'mace_1h',  stats:{ str:6 } },
  { tier:'B', name:'精鋼單手槌',    slot:'weapon', weaponType:'mace_1h',  stats:{ str:9, vit:1 } },
  { tier:'A', name:'秘銀單手槌',    slot:'weapon', weaponType:'mace_1h',  stats:{ str:13, vit:2 } },
  // 雙手槌 STR ×4 +擊暈10%
  { tier:'D', name:'木製雙手槌',    slot:'weapon', weaponType:'mace_2h',  stats:{ str:3 } },
  { tier:'C', name:'鐵製雙手槌',    slot:'weapon', weaponType:'mace_2h',  stats:{ str:6 } },
  { tier:'B', name:'精鋼雙手槌',    slot:'weapon', weaponType:'mace_2h',  stats:{ str:9, vit:1 } },
  { tier:'A', name:'秘銀雙手槌',    slot:'weapon', weaponType:'mace_2h',  stats:{ str:13, vit:2 } },
  // 單手斧 STR ×3 +破防15%
  { tier:'D', name:'木製單手斧',    slot:'weapon', weaponType:'axe_1h',   stats:{ str:3 } },
  { tier:'C', name:'鐵製單手斧',    slot:'weapon', weaponType:'axe_1h',   stats:{ str:6 } },
  { tier:'B', name:'精鋼單手斧',    slot:'weapon', weaponType:'axe_1h',   stats:{ str:9, luk:1 } },
  { tier:'A', name:'秘銀單手斧',    slot:'weapon', weaponType:'axe_1h',   stats:{ str:13, luk:2 } },
  // 雙手斧 STR ×5 +破防15%
  { tier:'D', name:'木製雙手斧',    slot:'weapon', weaponType:'axe_2h',   stats:{ str:3 } },
  { tier:'C', name:'鐵製雙手斧',    slot:'weapon', weaponType:'axe_2h',   stats:{ str:6 } },
  { tier:'B', name:'精鋼雙手斧',    slot:'weapon', weaponType:'axe_2h',   stats:{ str:9, agi:1 } },
  { tier:'A', name:'秘銀雙手斧',    slot:'weapon', weaponType:'axe_2h',   stats:{ str:13, agi:2 } },
  // 匕首 STR ×2 +連擊20%
  { tier:'D', name:'木製匕首',      slot:'weapon', weaponType:'dagger',   stats:{ str:3 } },
  { tier:'C', name:'鐵製匕首',      slot:'weapon', weaponType:'dagger',   stats:{ str:6 } },
  { tier:'B', name:'精鋼匕首',      slot:'weapon', weaponType:'dagger',   stats:{ str:9, agi:1 } },
  { tier:'A', name:'秘銀匕首',      slot:'weapon', weaponType:'dagger',   stats:{ str:13, agi:2 } },
  // 單手法杖 INT ×4 +無視怪物DEF 怪物攻×2
  { tier:'D', name:'初級單手法杖',  slot:'weapon', weaponType:'staff_1h', stats:{ int:3 } },
  { tier:'C', name:'中級單手法杖',  slot:'weapon', weaponType:'staff_1h', stats:{ int:6 } },
  { tier:'B', name:'高級單手法杖',  slot:'weapon', weaponType:'staff_1h', stats:{ int:9, luk:1 } },
  { tier:'A', name:'大師單手法杖',  slot:'weapon', weaponType:'staff_1h', stats:{ int:13, luk:2 } },
  // 雙手法杖 INT ×6 +無視怪物DEF 怪物攻×2
  { tier:'D', name:'初級雙手法杖',  slot:'weapon', weaponType:'staff_2h', stats:{ int:3 } },
  { tier:'C', name:'中級雙手法杖',  slot:'weapon', weaponType:'staff_2h', stats:{ int:6 } },
  { tier:'B', name:'高級雙手法杖',  slot:'weapon', weaponType:'staff_2h', stats:{ int:9, luk:1 } },
  { tier:'A', name:'大師雙手法杖',  slot:'weapon', weaponType:'staff_2h', stats:{ int:13, luk:2 } },
  // 弓 DEX ×5 +閃避30%
  { tier:'D', name:'木製弓',        slot:'weapon', weaponType:'bow',      stats:{ dex:3 } },
  { tier:'C', name:'鐵製弓',        slot:'weapon', weaponType:'bow',      stats:{ dex:6 } },
  { tier:'B', name:'精鋼弓',        slot:'weapon', weaponType:'bow',      stats:{ dex:9, agi:1 } },
  { tier:'A', name:'秘銀弓',        slot:'weapon', weaponType:'bow',      stats:{ dex:13, agi:2 } },
];

// 副手武器（盾）
const SHIELDS = [
  { tier:'D', name:'木盾',    slot:'shield', stats:{ vit:2 } },
  { tier:'C', name:'鐵盾',    slot:'shield', stats:{ vit:4 } },
  { tier:'B', name:'精鋼盾',  slot:'shield', stats:{ vit:6, str:1 } },
  { tier:'A', name:'秘銀盾',  slot:'shield', stats:{ vit:9, str:2 } },
];

// 防具
const ARMORS = [
  { tier:'D', name:'布衣',    slot:'armor', stats:{ vit:2 } },
  { tier:'C', name:'皮甲',    slot:'armor', stats:{ vit:4 } },
  { tier:'B', name:'鎖甲',    slot:'armor', stats:{ vit:6, str:1 } },
  { tier:'A', name:'板甲',    slot:'armor', stats:{ vit:9, str:2 } },
];

// 頭部上
const HEAD_TOP = [
  { tier:'D', name:'布帽',    slot:'head_top', stats:{ vit:1 } },
  { tier:'C', name:'皮帽',    slot:'head_top', stats:{ vit:2, agi:1 } },
  { tier:'B', name:'鐵盔',    slot:'head_top', stats:{ vit:3, agi:1, str:1 } },
  { tier:'A', name:'精鋼盔',  slot:'head_top', stats:{ vit:4, agi:2, str:2 } },
];

// 頭部中
const HEAD_MID = [
  { tier:'D', name:'木框護目鏡',  slot:'head_mid', stats:{ dex:1 } },
  { tier:'C', name:'鐵護目鏡',    slot:'head_mid', stats:{ dex:2, int:1 } },
  { tier:'B', name:'精鋼護目鏡',  slot:'head_mid', stats:{ dex:3, int:1, luk:1 } },
  { tier:'A', name:'秘銀護目鏡',  slot:'head_mid', stats:{ dex:4, int:2, luk:2 } },
];

// 頭部下
const HEAD_LOW = [
  { tier:'D', name:'布口罩',   slot:'head_low', stats:{ int:1 } },
  { tier:'C', name:'皮口罩',   slot:'head_low', stats:{ int:2, vit:1 } },
  { tier:'B', name:'鐵面罩',   slot:'head_low', stats:{ int:3, vit:1, dex:1 } },
  { tier:'A', name:'秘銀面罩', slot:'head_low', stats:{ int:4, vit:2, dex:2 } },
];

// 披風
const GARMENTS = [
  { tier:'D', name:'布披風',       slot:'garment', stats:{ agi:1 } },
  { tier:'C', name:'皮披風',       slot:'garment', stats:{ agi:2, vit:1 } },
  { tier:'B', name:'絲綢披風',     slot:'garment', stats:{ agi:3, vit:1, dex:1 } },
  { tier:'A', name:'天使翼披風',   slot:'garment', stats:{ agi:4, vit:2, dex:2 } },
];

// 鞋子
const SHOES = [
  { tier:'D', name:'草鞋',    slot:'shoes', stats:{ agi:1 } },
  { tier:'C', name:'皮靴',    slot:'shoes', stats:{ agi:2, dex:1 } },
  { tier:'B', name:'精鋼靴',  slot:'shoes', stats:{ agi:3, dex:1, str:1 } },
  { tier:'A', name:'秘銀靴',  slot:'shoes', stats:{ agi:4, dex:2, str:2 } },
];

// 飾品左
const ACC_L = [
  { tier:'D', name:'銅戒指(左)',      slot:'accessory_l', stats:{ luk:1 } },
  { tier:'C', name:'銀戒指(左)',      slot:'accessory_l', stats:{ luk:2, int:1 } },
  { tier:'B', name:'魔晶石戒(左)',    slot:'accessory_l', stats:{ luk:3, int:1, dex:1 } },
  { tier:'A', name:'龍晶戒指(左)',    slot:'accessory_l', stats:{ luk:4, int:2, dex:2 } },
];

// 飾品右
const ACC_R = [
  { tier:'D', name:'銅戒指(右)',      slot:'accessory_r', stats:{ luk:1 } },
  { tier:'C', name:'銀戒指(右)',      slot:'accessory_r', stats:{ luk:2, str:1 } },
  { tier:'B', name:'魔晶石戒(右)',    slot:'accessory_r', stats:{ luk:3, str:1, vit:1 } },
  { tier:'A', name:'龍晶戒指(右)',    slot:'accessory_r', stats:{ luk:4, str:2, vit:2 } },
];

const TIER_DESCS = { D:'D 級', C:'C 級', B:'B 級', A:'A 級' };

function makeItem(def) {
  const isTwoHanded = ['sword_2h','mace_2h','axe_2h','staff_2h','bow'].includes(def.weaponType);
  const WEAPON_ATK_STAT = {
    sword_1h:'str', sword_2h:'str', mace_1h:'str', mace_2h:'str',
    axe_1h:'str', axe_2h:'str', dagger:'str',
    staff_1h:'int', staff_2h:'int', bow:'dex'
  };
  return {
    id: crypto.randomUUID(),
    name: def.name,
    description: TIER_DESCS[def.tier] + ' ' + (def.slot === 'weapon' ? '武器' : def.slot === 'shield' ? '盾牌' : '裝備'),
    itemType: 'equipment',
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: 'none', value: 0 },
    equipSlot: def.slot,
    equipStats: def.stats && Object.keys(def.stats).length ? def.stats : null,
    weaponType: def.weaponType || null,
    isTwoHanded: def.weaponType ? isTwoHanded : false,
    atkStat: def.weaponType ? (WEAPON_ATK_STAT[def.weaponType] || 'str') : null,
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  const raw  = fs.readFileSync(DATA_PATH, "utf8");
  const data = JSON.parse(raw);
  const oldItems = data.items || [];

  // 1. 找出要刪除的 ID（所有舊的 【】 前綴 + 所有武器槽位）
  const toDelete = new Set(
    oldItems
      .filter(i => i.name.startsWith('【') || i.equipSlot === 'weapon')
      .map(i => i.id)
  );

  // 2. 保留的非武器裝備（無 【】 前綴，更新 equipStats）
  const NON_WEAPON_NEW = [
    ...SHIELDS, ...ARMORS, ...HEAD_TOP, ...HEAD_MID,
    ...HEAD_LOW, ...GARMENTS, ...SHOES, ...ACC_L, ...ACC_R
  ];
  const updateMap = {};
  NON_WEAPON_NEW.forEach(def => {
    // 用名稱匹配舊 item
    const existing = oldItems.find(i => !i.name.startsWith('【') && i.name === def.name);
    if (existing) updateMap[existing.id] = def;
  });

  // 3. 建立新武器
  const allDefs = [
    ...WEAPONS, ...SHIELDS, ...ARMORS, ...HEAD_TOP, ...HEAD_MID,
    ...HEAD_LOW, ...GARMENTS, ...SHOES, ...ACC_L, ...ACC_R
  ];

  // 只有武器需要新建（非武器的用更新已有 item）
  const newWeapons = WEAPONS.map(makeItem);

  // 4. 更新 game.json
  const kept = oldItems
    .filter(i => !toDelete.has(i.id))
    .map(i => {
      if (updateMap[i.id]) {
        const def = updateMap[i.id];
        return {
          ...i,
          equipStats: def.stats && Object.keys(def.stats).length ? def.stats : null,
          description: TIER_DESCS[def.tier] + ' ' + (i.equipSlot === 'shield' ? '盾牌' : '裝備'),
        };
      }
      return i;
    });

  const finalItems = [...kept, ...newWeapons];
  data.items = finalItems;

  console.log(`\n📦 裝備重建計畫：`);
  console.log(`  刪除：${toDelete.size} 件（舊【D/C/B/A】前綴 + 舊武器）`);
  console.log(`  保留更新：${kept.length} 件非武器裝備`);
  console.log(`  新增武器：${newWeapons.length} 件`);
  console.log(`  最終總計：${finalItems.length} 件`);
  console.log('\n新武器列表：');
  newWeapons.forEach(w => console.log(`  [${w.equipStats ? JSON.stringify(w.equipStats) : 'null'}] ${w.name} (${w.weaponType})`));

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — 加上 --yes 執行實際寫入');
    return;
  }

  // 寫入 game.json
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log('\n✅ game.json 已更新');

  // 同步 MongoDB
  if (!MONGO_URI) {
    console.log('⚠️  MONGODB_URI 未設定，跳過 DB 同步');
    return;
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const col = client.db(DB_NAME).collection("items");

  // 刪除舊 ID
  const deleteIds = [...toDelete];
  if (deleteIds.length) {
    const r = await col.deleteMany({ id: { $in: deleteIds } });
    console.log(`🗑️  MongoDB 已刪除：${r.deletedCount} 件`);
  }

  // Upsert 保留的（更新 equipStats）
  for (const item of kept) {
    await col.updateOne({ id: item.id }, { $set: { equipStats: item.equipStats, description: item.description } });
  }
  console.log(`✏️  MongoDB 已更新保留裝備：${kept.length} 件`);

  // 插入新武器
  if (newWeapons.length) {
    const r = await col.insertMany(newWeapons);
    console.log(`➕ MongoDB 已新增武器：${r.insertedCount} 件`);
  }

  await client.close();
  console.log('\n🎉 同步完成！');
}

main().catch(e => { console.error(e); process.exit(1); });
