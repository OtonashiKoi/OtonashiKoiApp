const MongoClient = require('mongodb').MongoClient;

// Copy the functions from playerPanel.js
function normalizeName(name) {
  return String(name || "").replace(/\s*\+\d+$/, "").trim();
}

function canonicalStatsKey(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  const keys = Object.keys(s).sort();
  return keys.map((k) => `${k}:${s[k]}`).join("|");
}

const EQ_SORT_ORDER = ["weapon","shield","head_top","head_mid","head_low","armor","garment","shoes","accessory_l","accessory_r","special_1","special_2","special_3"];
const EQ_SORT_ORDER_MAP = EQ_SORT_ORDER.reduce((acc, slot, idx) => ({ ...acc, [slot]: idx }), {});
const TIER_SELL_PRICE = { D: 100, C: 500, B: 2000, A: 8000 };

function sortBackpackItems(items, tab) {
  const arr = [...items];
  return arr.sort((a, b) => {
    if (tab === "item") {
      return String(a.itemName || "").localeCompare(String(b.itemName || ""), "zh-Hant");
    }
    const aSlot = a.equipSlot || "";
    const bSlot = b.equipSlot || "";
    const aOrd = EQ_SORT_ORDER_MAP[aSlot] ?? 999;
    const bOrd = EQ_SORT_ORDER_MAP[bSlot] ?? 999;
    if (aOrd !== bOrd) return aOrd - bOrd;
    const an = normalizeName(a.itemName);
    const bn = normalizeName(b.itemName);
    if (an !== bn) return an.localeCompare(bn, "zh-Hant");
    const aEnh = Number(a.enhanceLevel || 0);
    const bEnh = Number(b.enhanceLevel || 0);
    if (aEnh !== bEnh) return bEnh - aEnh;
    return String(a.uuid || "").localeCompare(String(b.uuid || ""));
  });
}

function groupEquipmentItems(items, tab) {
  const list = sortBackpackItems(items, tab);
  const groups = new Map();
  for (const entry of list) {
    const slot = entry.equipSlot || "";
    const enh = Number(entry.enhanceLevel || 0);
    const tier = entry.tier || "";
    const statsKey = canonicalStatsKey(entry.equipStats);
    const key = `${normalizeName(entry.itemName)}|${slot}|${tier}|${enh}|${statsKey}`;
    
    if (!groups.has(key)) {
      const sellPrice = tier ? TIER_SELL_PRICE[tier] : null;
      groups.set(key, {
        key,
        repUuid: entry.uuid,
        itemName: entry.itemName,
        equipSlot: slot,
        tier,
        enhanceLevel: enh,
        equipStats: entry.equipStats || null,
        sellPrice,
        imageUrl: entry.imageUrl || "",
        count: 0,
      });
    }
    const g = groups.get(key);
    g.count += 1;
    if (!g.imageUrl && entry.imageUrl) g.imageUrl = entry.imageUrl;
  }
  return [...groups.values()];
}

(async () => {
  const client = new MongoClient('mongodb://localhost:27017');
  try {
    await client.connect();
    const db = client.db('equipment_game');
    
    const player = await db.collection('progress').findOne({
      'inventory': { $elemMatch: { equipSlot: 'special' } }
    });
    
    if (!player) {
      console.log('No player with cards');
      return;
    }
    
    const items = player.inventory.filter(e => 
      e.itemType === 'equipment' && (
        ['title_eq', 'job_eq', 'special_1', 'special_2', 'special_3'].includes(e.equipSlot) || 
        e.equipSlot === 'special'
      )
    );
    
    console.log('Filtered items:', items.length);
    
    const grouped = groupEquipmentItems(items, 'special');
    console.log('Grouped items:', grouped.length);
    
    grouped.forEach((g, idx) => {
      console.log(`${idx + 1}. ${g.itemName}`);
      console.log(`   equipSlot: ${g.equipSlot}`);
      console.log(`   count: ${g.count}`);
      console.log(`   tier: ${g.tier}`);
      console.log(`   sellPrice: ${g.sellPrice}`);
    });
    
  } finally {
    await client.close();
  }
})();
