const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'exports', 'db-backup-2026-04-21T03-44-46-667Z');
const itemsPath = path.join(base, 'items.json');
const monstersPath = path.join(base, 'monsters.json');

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('failed to read', p, e.message);
    process.exit(1);
  }
}

const items = loadJson(itemsPath);
const monsters = loadJson(monstersPath);

const dropIds = new Set();
for (const m of monsters) {
  if (!m || !m.drops) continue;
  for (const d of m.drops) {
    if (d && d.itemId) dropIds.add(String(d.itemId));
  }
}

function isRelevantEquipment(item) {
  if (!item) return false;
  if (item.itemType !== 'equipment') return false;
  const equipSlot = item.equipSlot || '';
  const weaponLike = Boolean(item.weaponType) || /weapon|sword|axe|mace|staff|dagger|bow/i.test(equipSlot);
  const defensiveSlots = new Set(['shield','armor','head_top','head_mid','head_low','garment','shoes']);
  const accessorySlots = new Set(['accessory_l','accessory_r','accessory']);
  return weaponLike || defensiveSlots.has(equipSlot) || accessorySlots.has(equipSlot);
}

const undropped = [];
for (const it of items) {
  if (!isRelevantEquipment(it)) continue;
  const id = it.id || it.itemId || it._id || '';
  if (!dropIds.has(String(id))) {
    undropped.push({ id, name: it.name, equipSlot: it.equipSlot || null, weaponType: it.weaponType || null, tier: it.tier || null });
  }
}

const outDir = path.join(__dirname, '..', 'exports', 'analysis');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'undropped-items.json'), JSON.stringify(undropped, null, 2));
console.log('Found', undropped.length, 'undropped equipment items. Output:', path.join('exports','analysis','undropped-items.json'));
