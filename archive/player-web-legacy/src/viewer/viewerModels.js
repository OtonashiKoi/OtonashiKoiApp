import { API_ORIGIN } from '../api.js';

export const VIEWER_BUFF_STEPS = [
  { min: 0, title: 'Standby', effect: '場地加乘 0%' },
  { min: 5, title: 'Campfire', effect: '場地加乘 5%' },
  { min: 12, title: 'Fever', effect: '場地加乘 12%' },
  { min: 24, title: 'Overdrive', effect: '場地加乘 20%' },
];

export function getAssetUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${API_ORIGIN}${path}`;
}

export function calcPlayerStats(attrs = {}, equipped = {}) {
  const { str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1, luk = 1 } = attrs;
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };

  Object.values(equipped).forEach((item) => {
    if (!item?.equipStats) return;
    Object.entries(item.equipStats).forEach(([key, value]) => {
      if (key in bonus) bonus[key] += value || 0;
    });
  });

  const S = str + bonus.str;
  const A = agi + bonus.agi;
  const V = vit + bonus.vit;
  const I = INT + bonus.int;
  const D = dex + bonus.dex;
  const L = luk + bonus.luk;
  const weaponType = equipped.weapon?.weaponType || '';
  const attackBase = weaponType.startsWith('staff') ? I : (weaponType === 'bow' ? D : S);

  return {
    maxHp: V * 15 + 50,
    atk: Math.round(attackBase * (weaponType === 'dagger' ? 2 : 3)),
    def: V,
    hit: Math.min(100, 80 + D),
    crit: Math.min(100, L * 0.3),
    dodge: Math.min(50, A * 0.5),
  };
}

export function weaponPresentation(weapon) {
  const weaponType = String(weapon?.weaponType || '').toLowerCase();
  const map = {
    sword: 'S',
    offhand_sword: 'S',
    dagger: 'D',
    offhand_dagger: 'D',
    bow: 'B',
    axe_2h: 'A',
    mace: 'M',
    offhand_mace: 'M',
    staff_1h: 'T',
    staff_2h: 'T',
    spear: 'P',
  };

  return {
    name: weapon?.itemName || 'Unarmed',
    glyph: map[weaponType] || 'W',
    imageUrl: getAssetUrl(weapon?.imageUrl),
  };
}

export function actorPresentation(player = {}) {
  return {
    avatarUrl: getAssetUrl(player?.avatarUrl),
  };
}

function buildLeaderboardActor(entry, index, battleScene) {
  const seed = hashString(`${entry?.name || 'fighter'}-${index}`);
  const maxHp = 120 + (seed % 45);
  const hpRatio = battleScene?.partyHpRatios?.[index] ?? (0.62 + ((seed % 18) / 100));
  const weaponType = String(entry?.weaponType || '');
  const glyphMap = {
    sword_1h: 'S',
    sword_2h: 'S',
    dagger: 'D',
    mace_1h: 'M',
    mace_2h: 'M',
    axe_1h: 'A',
    axe_2h: 'A',
    staff_1h: 'T',
    staff_2h: 'T',
    bow: 'B',
    offhand_sword: 'S',
    offhand_dagger: 'D',
    offhand_mace: 'M',
  };
  return {
    id: `${entry?.name || 'fighter'}-${index}`,
    name: entry?.name || `Fighter ${index + 1}`,
    hp: Math.max(1, Math.round(maxHp * Math.min(1, Math.max(0.2, hpRatio)))),
    maxHp,
    weapon: {
      name: 'Raid Weapon',
      glyph: glyphMap[weaponType] || ['S', 'B', 'A', 'T', 'M'][seed % 5],
      imageUrl: getAssetUrl(entry?.weaponImageUrl),
      weaponType,
    },
    avatarUrl: index === 0 ? getAssetUrl(entry?.avatarUrl) : null,
    isSelf: index === 0,
    damage: Number(entry?.damage || 0),
  };
}

export function hashString(input = '') {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getBuffState(viewerCount) {
  let current = VIEWER_BUFF_STEPS[0];
  VIEWER_BUFF_STEPS.forEach((step) => {
    if (viewerCount >= step.min) current = step;
  });
  return current;
}

export function buildViewerActors(count) {
  return Array.from({ length: count }).map((_, index) => {
    const id = `mock-viewer-${index + 1}`;
    const seed = hashString(id);
    return {
      id,
      name: `Viewer${index + 1}`,
      hp: 30 + (seed % 25),
      maxHp: 30 + (seed % 25),
      glyph: ['S', 'B', 'A', 'T', 'M'][seed % 5],
      tint: seed % 4,
    };
  });
}

export function buildBattlefieldSceneModel({
  zones,
  selectedZone,
  streamPresence,
  mockViewerCount,
  mode,
  battleScene,
}) {
  const zone = zones.find((entry) => entry.zone === selectedZone) || zones[0] || null;
  const topEntry = zone?.damageLeaderboard?.[0] || null;
  const player = {
    displayName: topEntry?.name || 'Raid Lead',
    avatarUrl: topEntry?.avatarUrl || null,
  };
  const stats = {
    maxHp: battleScene?.partyLeadMaxHp || 140,
    atk: Math.max(28, Math.round(((topEntry?.damage || 0) / 18) || 42)),
    def: 18,
    crit: 12,
  };

  const liveViewerCount = streamPresence?.viewerCount || 0;
  const viewerCount = mode === 'mock' ? mockViewerCount : liveViewerCount;
  const viewerActors = mode === 'mock'
    ? buildViewerActors(mockViewerCount)
    : (streamPresence?.actors || []).slice(0, 8).map((actor, index) => ({
      id: actor.id || `${actor.name}-${index}`,
      name: actor.name,
      hp: 35,
      maxHp: 35,
      glyph: ['S', 'B', 'A', 'T', 'M'][index % 5],
      tint: index % 4,
    }));

  const damageBoard = Array.isArray(zone?.damageLeaderboard) && zone.damageLeaderboard.length > 0
    ? zone.damageLeaderboard.slice(0, 6)
    : [{ name: player.displayName, damage: 0, avatarUrl: player.avatarUrl }];
  const playerActors = damageBoard.map((entry, index) => buildLeaderboardActor(entry, index, battleScene));

  return {
    zone,
    stats,
    player,
    monsterHp: battleScene?.monsterHp ?? zone?.currentHp ?? 1,
    monsterMaxHp: zone?.maxHp ?? 1,
    playerActors,
    viewerActors,
    buffState: getBuffState(viewerCount),
    viewerCount,
  };
}
