import "./style.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5566";
const DEV_DISCORD_ID = import.meta.env.VITE_DEV_DISCORD_ID || "1450019975031951370";

const zoneLabels = {
  beginner: "新手區",
  normal: "一般區",
  mid: "中級區",
  hard: "高級區",
  elite: "精英區",
};

const navItems = [
  { id: "home", label: "首頁", icon: "城" },
  { id: "battle", label: "討伐", icon: "獸" },
  { id: "equip", label: "裝備", icon: "劍" },
  { id: "bag", label: "背包", icon: "袋" },
  { id: "quest", label: "任務", icon: "旗" },
  { id: "shop", label: "商店", icon: "店" },
];

const state = {
  loading: true,
  error: "",
  token: localStorage.getItem("equipment-game-token") || "",
  activeNav: "home",
  activeZone: "beginner",
  profile: null,
  inventory: [],
  equipped: {},
  zones: [],
  battleMessage: "讀取討伐資料中...",
};

const fallbackData = {
  profile: {
    player: { displayName: "音無醬" },
    wallet: { gold: 0, diamond: 0 },
    progress: {
      level: 1,
      job: "Novice",
      exp: 0,
      nextLevelExp: 100,
      playerTier: "E",
      attributes: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
      equipment: {},
    },
  },
  inventory: [],
  equipped: {},
  zones: [{
    zone: "beginner",
    monsterName: "未連線",
    monsterLevel: 0,
    goldReward: 0,
    expReward: 0,
    drops: [],
    currentHp: 0,
    maxHp: 1,
    participantCount: 0,
    damageLeaderboard: [],
  }],
};

function formatNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("zh-TW") : "0";
}

function unwrap(response) {
  return response?.data ?? response;
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === "error") {
    throw new Error(json.message || `API ${res.status}`);
  }
  return unwrap(json);
}

async function ensureToken() {
  if (state.token) return;
  const auth = await request("/api/auth/discord", {
    method: "POST",
    body: JSON.stringify({ code: `mock:${DEV_DISCORD_ID}` }),
  });
  state.token = auth.token;
  localStorage.setItem("equipment-game-token", state.token);
}

async function loadGameData() {
  state.loading = true;
  state.error = "";
  render();

  try {
    await ensureToken();
    const [profile, inventory, zones] = await Promise.all([
      request("/api/me/profile"),
      request("/api/me/inventory"),
      request("/api/combat/zones"),
    ]);

    state.profile = profile;
    state.inventory = inventory.inventory || [];
    state.equipped = inventory.equipped || {};
    state.zones = Array.isArray(zones) ? zones : [];
    state.activeZone = state.zones[0]?.zone || "beginner";
    state.battleMessage = "討伐資料已同步";
  } catch (error) {
    state.error = error.message;
    state.profile = fallbackData.profile;
    state.inventory = fallbackData.inventory;
    state.equipped = fallbackData.equipped;
    state.zones = fallbackData.zones;
    state.activeZone = "beginner";
    state.battleMessage = "離線預覽模式";
  } finally {
    state.loading = false;
    render();
  }
}

function getActiveZone() {
  return state.zones.find((zone) => zone.zone === state.activeZone) || state.zones[0] || fallbackData.zones[0];
}

function getHpPercent(zone) {
  const current = Number(zone.currentHp ?? zone.maxHp ?? 0);
  const max = Number(zone.maxHp || current || 1);
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function calcPower(progress) {
  const attrs = progress?.attributes || {};
  const attrPower = Object.values(attrs).reduce((sum, value) => sum + Number(value || 0), 0) * 120;
  const levelPower = Number(progress?.level || 1) * 280;
  const equipmentPower = Object.keys(progress?.equipment || {}).length * 420;
  return attrPower + levelPower + equipmentPower;
}

function countEquipped(equipped) {
  return Object.values(equipped || {}).filter(Boolean).length;
}

function renderTopResources(profile) {
  const wallet = profile.wallet || {};
  const progress = profile.progress || {};
  const stamina = progress.stamina ?? "120/120";
  return `
    <div class="resource-bar" aria-label="玩家資源">
      <div class="resource-chip coin"><i>金</i><strong>${formatNumber(wallet.gold)}</strong><span>+</span></div>
      <div class="resource-chip gem"><i>鑽</i><strong>${formatNumber(wallet.diamond)}</strong><span>+</span></div>
      <div class="resource-chip energy"><i>體</i><strong>${stamina}</strong><span>+</span></div>
    </div>
  `;
}

function renderProfile(profile) {
  const player = profile.player || {};
  const progress = profile.progress || {};
  const expPercent = progress.nextLevelExp
    ? Math.max(0, Math.min(100, Math.round((Number(progress.exp || 0) / Number(progress.nextLevelExp)) * 100)))
    : 100;

  return `
    <section class="profile-hud" aria-label="玩家狀態">
      <div class="avatar-frame">
        ${player.avatarUrl ? `<img src="${player.avatarUrl}" alt="">` : `<span>${String(player.displayName || "月").slice(0, 1)}</span>`}
      </div>
      <div class="level-medal">${progress.level || 1}</div>
      <div class="profile-plate">
        <strong>${player.displayName || "未登入"}</strong>
        <small>${progress.job || "Novice"} / Tier ${progress.playerTier || "E"}</small>
        <div class="exp-line"><i style="width:${expPercent}%"></i></div>
      </div>
    </section>
  `;
}

function renderBossPanel(zone) {
  const hpPercent = getHpPercent(zone);
  const drops = (zone.drops || []).slice(0, 5);
  const leader = zone.damageLeaderboard?.[0];
  const monsterArt = zone.monsterImageUrl
    ? `style="--monster-art: url('${zone.monsterImageUrl}')"`
    : "";

  return `
    <section class="boss-panel" ${monsterArt} aria-label="討伐目標">
      <div class="boss-art"></div>
      <div class="boss-emblem">王</div>
      <div class="boss-data">
        <span>${zoneLabels[zone.zone] || zone.zone}</span>
        <h2>${zone.monsterName || "未設定"}</h2>
        <p>Lv.${zone.monsterLevel || 0} / ${zone.participantCount || 0} 人參戰</p>
      </div>
      <div class="boss-bars">
        <div class="boss-row"><span>HP</span><i><b style="width:${hpPercent}%"></b></i><strong>${formatNumber(zone.currentHp)}/${formatNumber(zone.maxHp)}</strong></div>
        <div class="boss-row"><span>獎</span><i><b class="reward-fill" style="width:82%"></b></i><strong>${formatNumber(zone.goldReward)}G / ${formatNumber(zone.expReward)}EXP</strong></div>
      </div>
      <div class="drop-row">
        ${drops.length ? drops.map((item) => `<span title="${item}">${item}</span>`).join("") : "<span>尚無掉落設定</span>"}
      </div>
      <div class="leader-note">${leader ? `最高傷害：${leader.name || "玩家"} ${formatNumber(leader.damage)}` : "等待玩家打出第一筆傷害"}</div>
    </section>
  `;
}

function renderParty(profile) {
  const progress = profile.progress || {};
  const attrs = progress.attributes || {};
  const party = [
    { name: profile.player?.displayName || "玩家", level: progress.level || 1, type: "主" },
    { name: `STR ${attrs.str || 0}`, level: attrs.str || 0, type: "力" },
    { name: `AGI ${attrs.agi || 0}`, level: attrs.agi || 0, type: "速" },
    { name: `LUK ${attrs.luk || 0}`, level: attrs.luk || 0, type: "運" },
  ];

  return `
    <section class="party-strip" aria-label="角色狀態列">
      ${party.map((member) => `
        <div class="party-card">
          <div class="party-face">${member.type}</div>
          <strong>${member.name}</strong>
          <span>Lv.${member.level}</span>
        </div>
      `).join("")}
      <button class="party-add" type="button" data-action="shortcut" data-label="隊伍">隊</button>
    </section>
  `;
}

function renderBottomNav() {
  return `
    <nav class="dock" aria-label="主選單">
      ${navItems.map((item) => `
        <button class="${state.activeNav === item.id ? "active" : ""}" type="button" data-nav="${item.id}">
          <i>${item.icon}</i>
          <span>${item.label}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function renderQuickButtons(profile, zone) {
  const equippedCount = countEquipped(profile.progress?.equipment);
  return `
    <div class="quick-buttons" aria-label="快捷操作">
      <button type="button" data-action="shortcut" data-label="寶箱"><i>箱</i><span>${zone.drops?.length || 0} 掉落</span></button>
      <button type="button" data-action="shortcut" data-label="背包"><i>袋</i><span>${state.inventory.length} 道具</span></button>
      <button type="button" data-action="shortcut" data-label="藥水"><i>藥</i><span>${equippedCount} 裝備</span></button>
    </div>
  `;
}

function renderZoneTabs() {
  return `
    <div class="zone-tabs" aria-label="怪物區">
      ${state.zones.map((zone) => `
        <button class="${state.activeZone === zone.zone ? "active" : ""}" type="button" data-zone="${zone.zone}">
          ${zoneLabels[zone.zone] || zone.zone}
        </button>
      `).join("")}
    </div>
  `;
}

function render() {
  const profile = state.profile || fallbackData.profile;
  const progress = profile.progress || {};
  const zone = getActiveZone();
  const power = calcPower(progress);

  document.querySelector("#app").innerHTML = `
    <main class="game-screen" aria-label="月影星花橫向首頁">
      <div class="screen-shade"></div>
      ${renderProfile(profile)}
      ${renderTopResources(profile)}
      <div class="top-icons" aria-label="系統選單">
        <button type="button" data-action="shortcut" data-label="好友">友</button>
        <button type="button" data-action="shortcut" data-label="信箱">信</button>
        <button type="button" data-action="shortcut" data-label="Discord">DC</button>
        <button type="button" data-action="shortcut" data-label="設定">設</button>
      </div>

      <aside class="left-rail" aria-label="活動入口">
        <button type="button" data-action="shortcut" data-label="公告">告</button>
        <button type="button" data-action="shortcut" data-label="獎勵">禮</button>
      </aside>

      <section class="hero-caption" aria-live="polite">
        <span>${state.loading ? "同步中" : (state.error ? "離線模式" : "資料同步完成")}</span>
        <h1>${zone.monsterName || "討伐準備"}</h1>
        <p>${state.battleMessage} / 戰力 ${formatNumber(power)}</p>
      </section>

      <section class="right-stack">
        ${renderBossPanel(zone)}
        ${renderParty(profile)}
      </section>

      ${renderZoneTabs()}
      ${renderBottomNav()}

      <section class="battle-cluster" aria-label="戰鬥操作">
        <button class="mode-button" type="button" data-action="shortcut" data-label="戰鬥模式">雙劍</button>
        <button class="battle-button" type="button" data-action="battle">
          <span>出戰</span>
        </button>
        ${renderQuickButtons(profile, zone)}
      </section>
    </main>
  `;
}

async function runBattle() {
  const zone = getActiveZone();
  state.battleMessage = "戰鬥結算中...";
  render();

  try {
    const result = await request("/api/combat/quick-battle", {
      method: "POST",
      body: JSON.stringify({ zone: zone.zone }),
    });
    state.battleMessage = `${result.monsterName}：造成 ${formatNumber(result.totalDamage)} 傷害`;
    await loadGameData();
  } catch (error) {
    state.battleMessage = error.message;
    render();
  }
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  const zone = event.target.closest("[data-zone]");
  const battle = event.target.closest("[data-action='battle']");
  const shortcut = event.target.closest("[data-action='shortcut']");

  if (nav) {
    state.activeNav = nav.dataset.nav;
    state.battleMessage = `開啟 ${nav.textContent.trim()}`;
    render();
    return;
  }

  if (zone) {
    state.activeZone = zone.dataset.zone;
    state.battleMessage = `切換到 ${zone.textContent.trim()}`;
    render();
    return;
  }

  if (battle) {
    runBattle();
    return;
  }

  if (shortcut) {
    state.battleMessage = `開啟 ${shortcut.dataset.label}`;
    render();
  }
});

render();
loadGameData();
