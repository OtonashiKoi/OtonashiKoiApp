// ════════════════ 區域配置 ════════════════
const ZONES = [
  {
    key: 'beginner',
    label: '新手區',
    emoji: '🌱',
    minLevel: 1,
    maxLevel: null,
    tagline: '踏出第一步'
  },
  {
    key: 'normal',
    label: '一般區',
    emoji: '⚔️',
    minLevel: 1,
    maxLevel: null,
    tagline: '新手試煉'
  },
  {
    key: 'mid',
    label: '中級區',
    emoji: '✦',
    minLevel: 10,
    maxLevel: null,
    tagline: '危險上升'
  },
  {
    key: 'ancient_city',
    label: '古城',
    emoji: '🏰',
    minLevel: 20,
    maxLevel: null,
    tagline: '千年城牆，邪物棲居'
  },
  {
    key: 'ancient_city_deep',
    label: '古城深處',
    emoji: '🕯️',
    minLevel: 25,
    maxLevel: null,
    tagline: '守將與密術；廢都魔王盤踞於此'
  },
  {
    key: 'elite',
    label: '精英區',
    emoji: '💀',
    minLevel: 20,
    maxLevel: null,
    tagline: '極限試煉'
  }
];

// ════════════════ 裝備槽位配置 ════════════════
const EQUIPMENT_SLOTS = [
  { key: 'weapon', label: '武器', emoji: '⚔️' },
  { key: 'armor', label: '盔甲', emoji: '⛑️' },
  { key: 'accessory', label: '飾品', emoji: '💍' },
  { key: 'shield', label: '盾牌', emoji: '🛡️' }
];

// ════════════════ 全域狀態 ════════════════
let gameState = {
  player: null,
  inventory: null,
  currentSlot: null,
  isModalOpen: false
};

// ════════════════ 初始化 ════════════════
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadPlayerData();
    renderPlayerInfo();
    renderCharacterStatus();
    renderZoneCards();
    renderEquipmentSlots();
    attachEventListeners();
  } catch (error) {
    console.error('初始化失敗:', error);
    showError('遊戲載入失敗，請重新整理頁面');
  }
});

// ════════════════ API 調用 ════════════════
async function loadPlayerData() {
  try {
    // 獲取玩家資訊
    const profileRes = await fetch('/api/me/profile');
    if (!profileRes.ok) throw new Error('無法載入玩家資訊');
    gameState.player = await profileRes.json();

    // 獲取庫存和裝備
    const inventoryRes = await fetch('/api/me/inventory');
    if (!inventoryRes.ok) throw new Error('無法載入庫存');
    gameState.inventory = await inventoryRes.json();

    console.log('玩家資訊:', gameState.player);
    console.log('庫存:', gameState.inventory);
  } catch (error) {
    console.error('載入資料失敗:', error);
    throw error;
  }
}

// ════════════════ 渲染玩家信息 ════════════════
function renderPlayerInfo() {
  const player = gameState.player;
  if (!player) return;

  // 頭像
  const avatarEl = document.getElementById('playerAvatar');
  if (player.discordAvatar) {
    avatarEl.src = player.discordAvatar;
  }

  // 名字和等級
  document.getElementById('playerName').textContent = player.name || 'Player';
  document.getElementById('playerLevel').textContent = player.level || 1;

  // 貨幣
  document.getElementById('playerGold').textContent = formatNumber(player.gold || 0);
  document.getElementById('playerGems').textContent = formatNumber(player.gems || 0);
}

// ════════════════ 渲染角色狀態 ════════════════
function renderCharacterStatus() {
  const player = gameState.player;
  if (!player) return;

  const maxHp = player.maxHp || 1000;
  const currentHp = player.hp || maxHp;
  const maxMp = player.maxMp || 100;
  const currentMp = player.mp || maxMp;

  // HP 條
  const hpPercent = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
  document.getElementById('hpFill').style.width = hpPercent + '%';
  document.getElementById('hpText').textContent = `${formatNumber(currentHp)}/${formatNumber(maxHp)}`;

  // MP 條
  const mpPercent = Math.max(0, Math.min(100, (currentMp / maxMp) * 100));
  document.getElementById('mpFill').style.width = mpPercent + '%';
  document.getElementById('mpText').textContent = `${formatNumber(currentMp)}/${formatNumber(maxMp)}`;
}

// ════════════════ 渲染區域卡片 ════════════════
function renderZoneCards() {
  const player = gameState.player;
  if (!player) return;

  const playerLevel = player.level || 1;
  const container = document.getElementById('zoneCards');
  container.innerHTML = '';

  ZONES.forEach(zone => {
    const canAccess = playerLevel >= zone.minLevel && (zone.maxLevel === null || playerLevel <= zone.maxLevel);
    const isRecommended = playerLevel >= zone.minLevel && (zone.maxLevel === null || playerLevel <= zone.maxLevel);

    const card = document.createElement('div');
    card.className = `zone-card ${isRecommended ? 'recommended' : ''}`;
    card.innerHTML = `
      <div class="zone-emoji">${zone.emoji}</div>
      <div class="zone-label">${zone.label}</div>
      <div class="zone-level">
        ${zone.maxLevel ? `Lv.${zone.minLevel}-${zone.maxLevel}` : `Lv.${zone.minLevel}+`}
      </div>
      ${!canAccess ? '<div class="zone-tag">等級不足</div>' : ''}
    `;

    if (canAccess) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => startBattle(zone.key));
    } else {
      card.style.opacity = '0.5';
      card.style.cursor = 'not-allowed';
    }

    container.appendChild(card);
  });
}

// ════════════════ 渲染裝備槽位 ════════════════
function renderEquipmentSlots() {
  const container = document.getElementById('equipmentSlots');
  container.innerHTML = '';

  EQUIPMENT_SLOTS.forEach(slot => {
    const equippedItem = gameState.inventory?.equipped?.[slot.key];
    const slotEl = document.createElement('div');
    slotEl.className = 'equipment-slot';
    slotEl.dataset.slot = slot.key;

    if (equippedItem) {
      slotEl.innerHTML = `
        <img src="${equippedItem.imageUrl || 'https://via.placeholder.com/100'}"
             alt="${equippedItem.name}"
             class="equipment-item-icon"
             title="${equippedItem.name}">
        <div class="equipment-item-rarity" style="background: ${getRarityColor(equippedItem.rarity)}"></div>
      `;
    } else {
      slotEl.innerHTML = `<div class="equipment-slot-empty">${slot.emoji}</div>`;
    }

    slotEl.addEventListener('click', () => openEquipmentModal(slot.key));
    container.appendChild(slotEl);
  });
}

// ════════════════ 裝備管理模態 ════════════════
function openEquipmentModal(slotKey) {
  const modal = document.getElementById('equipmentModal');
  modal.classList.add('active');
  gameState.currentSlot = slotKey;

  // 生成槽位標籤
  const slotTabs = document.getElementById('slotTabs');
  slotTabs.innerHTML = '';
  EQUIPMENT_SLOTS.forEach(slot => {
    const tab = document.createElement('button');
    tab.className = `slot-tab ${slot.key === slotKey ? 'active' : ''}`;
    tab.textContent = slot.label;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.slot-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      gameState.currentSlot = slot.key;
      renderEquipmentList();
    });
    slotTabs.appendChild(tab);
  });

  renderEquipmentList();
}

// ════════════════ 渲染可裝備物品列表 ════════════════
function renderEquipmentList() {
  const slotKey = gameState.currentSlot;
  const container = document.getElementById('equipmentList');
  container.innerHTML = '';

  if (!gameState.inventory?.items) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">沒有物品</p>';
    return;
  }

  // 篩選該槽位可裝備的物品
  const equippableItems = gameState.inventory.items.filter(item => {
    return item.equipmentSlot === slotKey;
  });

  if (equippableItems.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">此槽位無可用物品</p>';
    return;
  }

  equippableItems.forEach(item => {
    const itemCard = document.createElement('div');
    itemCard.className = 'equipment-item-card';
    const equippedItem = gameState.inventory.equipped?.[slotKey];
    if (equippedItem?.id === item.id) {
      itemCard.classList.add('selected');
    }

    itemCard.innerHTML = `
      <img src="${item.imageUrl || 'https://via.placeholder.com/100'}"
           alt="${item.name}"
           class="item-icon-small">
      <div class="item-name-small">${item.name}</div>
    `;

    itemCard.addEventListener('click', () => equipItem(item, slotKey));
    container.appendChild(itemCard);
  });
}

// ════════════════ 裝備物品 ════════════════
async function equipItem(item, slotKey) {
  try {
    const response = await fetch(`/api/me/inventory/equip/${item.id}`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('裝備失敗');
    }

    // 更新本地狀態
    gameState.inventory.equipped[slotKey] = item;

    // 更新 UI
    renderEquipmentSlots();
    renderEquipmentList();
  } catch (error) {
    console.error('裝備失敗:', error);
    showError('裝備失敗，請重試');
  }
}

// ════════════════ 事件監聽 ════════════════
function attachEventListeners() {
  // 關閉模態
  document.getElementById('btnCloseModal').addEventListener('click', () => {
    closeEquipmentModal();
  });

  // 點擊背景關閉模態
  document.getElementById('equipmentModal').addEventListener('click', (e) => {
    if (e.target.id === 'equipmentModal') {
      closeEquipmentModal();
    }
  });

  // 快速操作按鈕
  document.getElementById('btnBattle').addEventListener('click', () => {
    startBattle('normal'); // 預設開始一般區
  });

  document.getElementById('btnManageEquip').addEventListener('click', () => {
    openEquipmentModal('weapon');
  });

  document.getElementById('btnInventory').addEventListener('click', () => {
    // TODO: 導向背包頁面
    alert('背包功能開發中');
  });

  document.getElementById('btnShop').addEventListener('click', () => {
    // TODO: 導向商城頁面
    alert('商城功能開發中');
  });

  document.getElementById('btnQuest').addEventListener('click', () => {
    // TODO: 導向任務頁面
    alert('任務功能開發中');
  });

  document.getElementById('btnSettings').addEventListener('click', () => {
    // TODO: 導向設置頁面
    alert('設置功能開發中');
  });
}

function closeEquipmentModal() {
  const modal = document.getElementById('equipmentModal');
  modal.classList.remove('active');
  gameState.currentSlot = null;
}

// ════════════════ 戰鬥開始 ════════════════
function startBattle(zoneKey) {
  const player = gameState.player;
  if (!player) {
    showError('玩家資訊未加載');
    return;
  }

  const zone = ZONES.find(z => z.key === zoneKey);
  if (!zone) {
    showError('無效的區域');
    return;
  }

  const playerLevel = player.level || 1;
  if (playerLevel < zone.minLevel || (zone.maxLevel && playerLevel > zone.maxLevel)) {
    showError(`等級要求：Lv.${zone.minLevel}${zone.maxLevel ? `-${zone.maxLevel}` : '+'}`);
    return;
  }

  // 導向戰鬥頁面，帶上區域參數
  window.location.href = `/battle.html?zone=${zoneKey}`;
}

// ════════════════ 工具函式 ════════════════
function formatNumber(num) {
  return Math.floor(num).toLocaleString('zh-TW');
}

function getRarityColor(rarity) {
  const colors = {
    common: '#808080',
    uncommon: '#2ecc71',
    rare: '#3498db',
    epic: '#9b59b6',
    legendary: '#f39c12'
  };
  return colors[rarity] || '#808080';
}

function showError(message) {
  const container = document.querySelector('.game-container');
  const errorEl = document.createElement('div');
  errorEl.className = 'error-message';
  errorEl.textContent = message;
  container.insertBefore(errorEl, container.firstChild);

  setTimeout(() => {
    errorEl.remove();
  }, 5000);
}

// ════════════════ 定期刷新玩家狀態 ════════════════
setInterval(async () => {
  try {
    const response = await fetch('/api/me/profile');
    if (response.ok) {
      const newPlayer = await response.json();
      gameState.player = newPlayer;
      renderCharacterStatus();
    }
  } catch (error) {
    console.error('刷新玩家狀態失敗:', error);
  }
}, 5000); // 每 5 秒刷新一次
