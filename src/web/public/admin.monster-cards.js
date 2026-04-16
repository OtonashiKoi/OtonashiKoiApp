/**
 * 怪物卡片庫管理模組
 * 顯示、篩選、編輯怪物技能卡片
 */

(function() {
  'use strict';

  let monsterCards = [];
  let filteredCards = [];
  const zoneNames = {
    basic: '🟢 基礎區',
    mid: '🔥 中級區',
    forest: '🌲 森林區'
  };

  const effectCategoryIcon = {
    stat: '📊',
    buff: '⬆️',
    debuff: '⬇️',
    damage: '💥',
    heal: '💚',
    reactive: '🛡️',
    utility: '🔧'
  };

  /**
   * 載入怪物卡片數據
   */
  async function loadMonsterCards() {
    const grid = document.getElementById('monster-card-grid');
    grid.innerHTML = '<div class="monster-card-loading">載入卡片中...</div>';

    try {
      const response = await fetch('/admin/monster-cards', {
        method: 'GET',
        headers: getHeaders()
      });

      if (!response.ok) throw new Error('載入失敗: ' + response.statusText);

      const payload = await response.json();
      monsterCards = payload.data || payload || [];
      applyFilters();
      console.log(`✅ 已載入 ${monsterCards.length} 張怪物卡片`);
    } catch (err) {
      console.error('❌ 載入卡片失敗:', err);
      grid.innerHTML = `<div class="monster-card-loading">❌ 載入失敗: ${err.message}</div>`;
    }
  }

  /**
   * 應用篩選
   */
  function applyFilters() {
    const zoneFilter = document.getElementById('monster-card-zone-filter')?.value || '';
    filteredCards = monsterCards.filter(card => !zoneFilter || card.zone === zoneFilter);
    renderCards();
  }

  /**
   * 渲染卡片網格
   */
  function renderCards() {
    const grid = document.getElementById('monster-card-grid');

    if (filteredCards.length === 0) {
      grid.innerHTML = '<div class="monster-card-loading">無符合條件的卡片</div>';
      return;
    }

    grid.innerHTML = filteredCards.map(card => createCardHTML(card)).join('');

    // 添加事件監聽
    document.querySelectorAll('.monster-card').forEach(cardEl => {
      cardEl.addEventListener('click', () => showCardDetail(cardEl.dataset.cardId));
    });
  }

  /**
   * 生成卡片 HTML
   */
  function createCardHTML(card) {
    const skill = card.monsterCardSkill || {};
    const effects = skill.procEffects || [];
    const hp = card.hp || 0;
    const level = card.level || 0;

    // 提取效果信息
    const effectTags = effects
      .map(e => e.key)
      .filter(Boolean)
      .join(', ');

    // 計算平均傷害能力 (簡化)
    const str = card.attributes?.str || 0;
    const vit = card.attributes?.vit || 0;

    return `
      <div class="monster-card" data-card-id="${card.card_id}">
        <div class="monster-card-header">
          <div>
            <h3 class="monster-card-name">${card.name}</h3>
            <span class="monster-card-zone">${zoneNames[card.zone] || '未知'}</span>
          </div>
          <span class="monster-card-level">Lv ${level}</span>
        </div>

        <div class="monster-card-stats">
          <div class="monster-card-stat-item">
            <div class="monster-card-stat-label">HP</div>
            <div class="monster-card-stat-value">${hp}</div>
          </div>
          <div class="monster-card-stat-item">
            <div class="monster-card-stat-label">STR</div>
            <div class="monster-card-stat-value">${str}</div>
          </div>
          <div class="monster-card-stat-item">
            <div class="monster-card-stat-label">VIT</div>
            <div class="monster-card-stat-value">${vit}</div>
          </div>
        </div>

        <div class="monster-card-skill">
          <p class="monster-card-skill-name">${skill.name || '未命名技能'}</p>
          <p class="monster-card-skill-desc">${skill.description || '暫無說明'}</p>

          <div class="monster-card-effects">
            ${effects.map(e => `<span class="monster-card-effect-tag">${e.key}</span>`).join('')}
          </div>

          ${renderEffectParams(effects)}
        </div>
      </div>
    `;
  }

  /**
   * 渲染效果參數
   */
  function renderEffectParams(effects) {
    if (effects.length === 0) return '';

    const paramsList = effects
      .map(e => {
        const params = e.params || {};
        const parts = [];

        if (params.value) parts.push(`值: ${params.value}%`);
        if (params.duration?.value) parts.push(`持續: ${params.duration.value} 回合`);
        if (params.reflectPercent) parts.push(`反彈: ${params.reflectPercent}%`);
        if (params.stackMode) parts.push(`堆疊: ${params.stackMode}`);

        return parts.join(' • ');
      })
      .filter(Boolean)
      .join('\n');

    if (!paramsList) return '';

    return `
      <div class="monster-card-params">
        <dl>
          ${paramsList.split('\n').map(line => `
            <dt>⚙️</dt>
            <dd>${line}</dd>
          `).join('')}
        </dl>
      </div>
    `;
  }

  /**
   * 顯示卡片詳細信息
   */
  function showCardDetail(cardId) {
    const card = monsterCards.find(c => c.card_id == cardId);
    if (!card) return;

    console.log('卡片詳細:', card);
    // 可在此擴展為模態框或詳情頁面
  }

  /**
   * 初始化事件監聽
   */
  function initEventListeners() {
    const zoneFilter = document.getElementById('monster-card-zone-filter');
    const refreshBtn = document.getElementById('monster-card-refresh-btn');

    if (zoneFilter) {
      zoneFilter.addEventListener('change', applyFilters);
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadMonsterCards);
    }
  }

  /**
   * 初始化模組
   */
  function init() {
    // 監聽導航點擊
    const navLinks = document.querySelectorAll('button[data-target="section-monster-cards"]');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        // 確保只在第一次進入時載入
        if (monsterCards.length === 0) {
          loadMonsterCards();
        }
      });
    });

    initEventListeners();

    // 如果頁面已載入該部分則立即載入
    if (document.getElementById('section-monster-cards')?.offsetParent) {
      loadMonsterCards();
    }
  }

  // 頁面加載完成後初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露公共方法
  window.MonsterCardsAdmin = {
    loadCards: loadMonsterCards,
    applyFilters,
    renderCards
  };
})();
