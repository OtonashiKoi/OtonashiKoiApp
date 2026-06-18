/* admin.players.js - player list, detail and actions */
(function () {
  const { request, log, escapeHtml, formatDateTime, togglePlayerDetail, setPlayerActionEnabled, splitLines, showSection } = window.adminCore;
  const state = window.state;
  const elements = window.elements;

  function calcCombatStats(attrs, equipment) {
    const str = attrs.str ?? 1;
    const agi = attrs.agi ?? 1;
    const vit = attrs.vit ?? 1;
    const int_ = attrs.int ?? 1;
    const dex = attrs.dex ?? 1;
    const luk = attrs.luk ?? 1;
    let eqStr = 0, eqAgi = 0, eqVit = 0, eqInt = 0, eqDex = 0, eqLuk = 0, eqDef = 0, eqAtk = 0;
    for (const slot of Object.values(equipment || {})) {
      if (!slot?.equipStats) continue;
      const s = slot.equipStats;
      eqStr += s.str || 0; eqAgi += s.agi || 0; eqVit += s.vit || 0;
      eqInt += s.int || 0; eqDex += s.dex || 0; eqLuk += s.luk || 0;
      eqDef += s.def || 0; eqAtk += s.atk || 0;
    }
    const tStr = str + eqStr, tAgi = agi + eqAgi, tVit = vit + eqVit;
    const tInt = int_ + eqInt, tDex = dex + eqDex, tLuk = luk + eqLuk;
    const weapon = (equipment || {}).weapon || null;
    let atkBase;
    if (weapon?.weaponType === "staff_1h" || weapon?.weaponType === "staff_2h") atkBase = tInt;
    else if (weapon?.weaponType === "bow") atkBase = tDex;
    else atkBase = tStr;
    const wt = weapon?.weaponType;
    const WEAPON_MULTS = { dagger: 2, axe_2h: 4, staff_1h: 4, staff_2h: 5 };
    const atkMult = WEAPON_MULTS[wt] ?? 3;
    return {
      hp: tVit * 15 + 50,
      atk: Math.round(atkBase * atkMult) + eqAtk,
      def: Math.max(0, tVit * 2 + eqDef),
      hit: 80 + tDex,
      dodge: parseFloat((tAgi * 0.5).toFixed(1)),
      crit: parseFloat((tLuk * 0.3).toFixed(1)),
    };
  }

  function renderCombatStats(attrs, equipment) {
    const cs = calcCombatStats(attrs, equipment);
    const grid = document.getElementById("combat-stats-grid");
    if (!grid) return;
    const rows = [
      ["HP", cs.hp],
      ["ATK", cs.atk],
      ["DEF", cs.def],
      ["命中", cs.hit],
      ["閃避", cs.dodge + "%"],
      ["暴擊", cs.crit + "%"],
    ];
    grid.innerHTML = rows.map(([label, val]) =>
      `<div class="combat-stat-row"><span>${label}</span><strong>${val}</strong></div>`
    ).join("");
  }

  const SLOT_LABELS = {
    weapon: "武器", shield: "副手", head_top: "頭頂", head_mid: "頭中", head_low: "頭低",
    armor: "盔甲", garment: "披風", shoes: "鞋子", accessory_l: "戒指L", accessory_r: "戒指R",
  };
  const SLOT_ORDER = ["weapon","shield","head_top","head_mid","head_low","armor","garment","shoes","accessory_l","accessory_r"];

  function renderEquipment(equipment) {
    const grid = document.getElementById("equipment-slots-grid");
    if (!grid) return;
    grid.innerHTML = SLOT_ORDER.map(slotKey => {
      const item = (equipment || {})[slotKey];
      const hasItem = !!item;
      return `<div class="equip-slot${hasItem ? " has-item" : ""}">
        <span class="equip-slot-label">${SLOT_LABELS[slotKey] || slotKey}</span>
        ${hasItem
          ? `<span class="equip-slot-name">${escapeHtml(item.itemName || "?")}</span>`
          : `<span class="equip-slot-empty">—</span>`}
      </div>`;
    }).join("");
  }

  function renderInventory(inventory) {
    const list = document.getElementById("inventory-list");
    const countEl = document.getElementById("inventory-count");
    if (!list) return;
    const items = Array.isArray(inventory) ? inventory : [];
    if (countEl) countEl.textContent = items.length;
    if (items.length === 0) {
      list.innerHTML = '<div class="inventory-empty">背包是空的</div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const type = item.itemType || "consumable";
      const statsText = item.equipStats
        ? Object.entries(item.equipStats).filter(([,v]) => v).map(([k, v]) => `${k.toUpperCase()}+${v}`).join(" ")
        : "";
      return `<div class="inventory-row">
        <span class="item-name">${escapeHtml(item.itemName || "未知道具")}</span>
        <span class="item-meta">
          ${statsText ? `<span style="font-size:11px;color:var(--muted)">${escapeHtml(statsText)}</span>` : ""}
          <span class="item-type-badge ${type}">${type === "consumable" ? "消耗" : type === "equipment" ? "裝備" : "圖片"}</span>
        </span>
      </div>`;
    }).join("");
  }

  function renderTransactions(items) {
    if (!items || items.length === 0) {
      elements.playerTransactionList.innerHTML = '<div class="transaction-row"><span>尚無交易</span><small>等待第一筆遊戲紀錄</small><span>-</span></div>';
      return;
    }

    elements.playerTransactionList.innerHTML = items
      .map((item) => {
        const sign = item.direction === "debit" ? "-" : "+";
        return `
        <div class="transaction-row ${escapeHtml(item.direction)}">
          <strong>${escapeHtml(item.currencyType)} ${sign}${Math.abs(item.amount)}</strong>
          <small>${escapeHtml(item.source)}<br>${escapeHtml(formatDateTime(item.createdAt || item.occurredAt))}</small>
          <span>餘額 ${escapeHtml(item.balanceAfter)}</span>
        </div>
      `;
      })
      .join("");
  }

  function renderPlayerDetail(data) {
    state.selectedPlayerData = data;
    togglePlayerDetail(true);
    setPlayerActionEnabled(true);

    elements.playerNameHeading.textContent = data.player.displayName || "unknown";
    elements.playerIdLine.textContent = `Discord ID: ${data.player.discordId}`;
    elements.playerStatusBadge.textContent = data.player.status || "unknown";
    elements.playerLevelValue.textContent = data.progress.level;
    elements.playerExpValue.textContent = data.progress.exp;
    const tierEl = document.getElementById("player-tier-value");
    if (tierEl) tierEl.textContent = data.progress.playerTier || "-";
    elements.playerGoldValue.textContent = data.wallet.gold;
    elements.playerDiamondValue.textContent = data.wallet.diamond;

    // 屬性點顯示
    const spEl = document.getElementById("player-status-points");
    if (spEl) spEl.textContent = data.progress.statusPoints || 0;
    const attrs = data.progress.attributes || {};
    const attrGrid = document.getElementById("attributes-grid");
    if (attrGrid) {
      const ATTR_LABELS = { str: "STR 力量", agi: "AGI 敏捷", vit: "VIT 體力", int: "INT 智力", dex: "DEX 靈巧", luk: "LUK 幸運" };
      attrGrid.innerHTML = Object.entries(ATTR_LABELS).map(([k, label]) =>
        `<div class="attribute-row"><span>${label}</span><strong>${attrs[k] ?? 1}</strong></div>`
      ).join("");
    }
    const equipment = data.progress.equipment || {};
    renderCombatStats(attrs, equipment);
    renderEquipment(equipment);
    renderInventory(data.progress.inventory);
    elements.playerCreatedAt.textContent = formatDateTime(data.player.createdAt);
    elements.playerUpdatedAt.textContent = formatDateTime(data.player.updatedAt);
    elements.playerWalletUpdatedAt.textContent = formatDateTime(data.wallet.updatedAt);
    elements.playerProgressUpdatedAt.textContent = formatDateTime(data.progress.updatedAt);
    renderTransactions(data.transactions);

    const pickedPreview = document.getElementById("player-ops-picked-preview");
    if (pickedPreview) {
      pickedPreview.textContent = `已選擇：${data.player.displayName || "Unknown"} (${data.player.discordId})`;
    }
    // 更新該玩家的網頁封鎖狀態(非同步,不阻塞)
    if (typeof refreshWebBanStatus === "function") refreshWebBanStatus();
  }

  function renderPlayerList() {
    elements.playerList.innerHTML = "";

    const keyword = state.playerSearchKeyword.trim().toLowerCase();
    const visiblePlayers = state.players.filter((player) => {
      if (!keyword) return true;
      return `${player.displayName || ""} ${player.discordId}`.toLowerCase().includes(keyword);
    });

    elements.playerListSummary.textContent = `共 ${state.players.length} 位玩家，目前顯示 ${visiblePlayers.length} 位`;

    if (visiblePlayers.length === 0) {
      elements.playerList.textContent = "目前還沒有玩家資料。";
      return;
    }

    for (const player of visiblePlayers) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "player-row";
      row.dataset.discordId = player.discordId;
      row.dataset.name = player.displayName || "-";
      if (player.discordId === state.selectedPlayerId) {
        row.classList.add("active");
      }
      const initial = escapeHtml((player.displayName || "?").trim().charAt(0).toUpperCase() || "?");
      row.innerHTML = `
      <span class="player-avatar">${initial}</span>
      <div class="player-meta"><strong>${escapeHtml(player.displayName || "unknown")}</strong><small>${escapeHtml(player.discordId)}</small></div>
    `;
      elements.playerList.appendChild(row);
    }
  }

  /* Resizable splitters for shell and player list are provided by admin.players.init.js */

  async function loadPlayers() {
    const rows = await request("/admin/console/players?limit=1000");
    loadItemsForSelect();
    state.players = rows;

    if (!state.selectedPlayerId && rows.length > 0) {
      state.selectedPlayerId = rows[0].discordId;
    }

    renderPlayerList();

    if (state.selectedPlayerId) {
      await loadPlayerDetail(state.selectedPlayerId);
    } else {
      state.selectedPlayerData = null;
      togglePlayerDetail(false);
      setPlayerActionEnabled(false);
      elements.playerDetail.textContent = "請先建立玩家資料後再查看。";
    }

    log(`玩家列表載入完成，共 ${rows.length} 位玩家`);
  }

  function formatTransaction(item) {
    const sign = item.direction === "debit" ? "-" : "+";
    return `${item.currencyType} ${sign}${Math.abs(item.amount)} | ${item.source} | ${item.balanceAfter}`;
  }

  async function loadPlayerDetail(discordId) {
    const data = await request(`/admin/console/players/${encodeURIComponent(discordId)}`);
    state.selectedPlayerId = discordId;
    renderPlayerList();
    renderPlayerDetail(data);
  }

  async function saveAccessControl(url, body, successMessage) {
    const data = await request(url, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    const accessControl = data?.accessControl || data;
    const syncReport = data?.syncReport;

    state.accessControl = accessControl;
    if (window.adminBindings && typeof window.adminBindings.renderAccessControl === 'function') {
      window.adminBindings.renderAccessControl();
    }
    log(successMessage);

    if (syncReport) {
      log(
        `玩家資料同步：處理 ${syncReport.ensured} 人，新增玩家 ${syncReport.createdPlayers}、錢包 ${syncReport.createdWallets}、進度 ${syncReport.createdProgress}，略過 ${syncReport.skipped}（${syncReport.reason}）`
      );
    }
  }

  async function submitCurrencyAction() {
    if (!state.selectedPlayerData) {
      throw new Error("請先選擇一位玩家");
    }

    const rawAmount = Number(elements.currencyAmountInput.value);
    if (!Number.isInteger(rawAmount) || rawAmount <= 0) {
      throw new Error("資源數量必須是正整數");
    }

    const amount = elements.currencyOperationInput.value === "deduct" ? -rawAmount : rawAmount;
    const reason = elements.currencyReasonInput.value.trim() || "admin console currency adjustment";
    const player = state.selectedPlayerData.player;

    await request(`/admin/players/${encodeURIComponent(player.discordId)}/grant`, {
      method: "POST",
      body: JSON.stringify({
        displayName: player.displayName,
        currencyType: elements.currencyTypeInput.value,
        amount,
        reason,
        adminId: "admin-console"
      })
    });

    await loadPlayerDetail(player.discordId);
    log(`已對 ${player.displayName} ${amount > 0 ? "增加" : "扣除"} ${Math.abs(amount)} ${elements.currencyTypeInput.value}`);
  }

  async function submitExpAction() {
    if (!state.selectedPlayerData) {
      throw new Error("請先選擇一位玩家");
    }

    const amount = Number(elements.expAmountInput.value);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("經驗值必須是正整數");
    }

    const player = state.selectedPlayerData.player;
    const reason = elements.expReasonInput.value.trim() || "admin console exp adjustment";

    await request(`/admin/players/${encodeURIComponent(player.discordId)}/grant-exp`, {
      method: "POST",
      body: JSON.stringify({
        displayName: player.displayName,
        amount,
        reason,
        adminId: "admin-console"
      })
    });

    await loadPlayerDetail(player.discordId);
    log(`已對 ${player.displayName} 發放 ${amount} 經驗`);
  }

  // bindEvents and splitters moved to admin.players.init.js to keep file sizes small

  async function loadItemsForSelect() {
    const sel = document.getElementById("grant-item-select");
    if (!sel) return;
    try {
      const items = await request("/admin/items");
      const sorted = [...items].sort((a, b) => {
        const typeOrder = { equipment: 0, consumable: 1, collectible: 2 };
        const td = (typeOrder[a.itemType] ?? 3) - (typeOrder[b.itemType] ?? 3);
        if (td !== 0) return td;
        return (a.name || "").localeCompare(b.name || "");
      });
      sel.innerHTML = sorted.map(item => {
        const typeLabel = item.itemType === "equipment" ? "⚔️" : item.itemType === "consumable" ? "🧪" : "🖼️";
        const slotLabel = item.equipSlot ? ` [${item.equipSlot}]` : "";
        return `<option value="${escapeHtml(item.id)}">${typeLabel} ${escapeHtml(item.name)}${slotLabel}</option>`;
      }).join("");
    } catch (e) {
      sel.innerHTML = `<option value="">載入失敗: ${escapeHtml(e.message)}</option>`;
    }
  }

  async function submitGrantItem() {
    if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");
    const hidden = document.getElementById("grant-item-id");
    const sel = document.getElementById("grant-item-select");
    const itemId = (hidden?.value || "").trim() || sel?.value || "";
    if (!itemId) throw new Error("請選擇道具");
    const player = state.selectedPlayerData.player;
    await request(`/admin/console/players/${encodeURIComponent(player.discordId)}/grant-item`, {
      method: "POST",
      body: JSON.stringify({ itemId })
    });
    await loadPlayerDetail(player.discordId);
    const pickedPreview = document.getElementById("grant-item-picked-preview");
    const itemName = pickedPreview?.textContent?.replace(/^已選擇：/, "").trim() || sel?.options?.[sel.selectedIndex]?.text || itemId;
    log(`已發放「${itemName}」給 ${player.displayName}`);
  }

  // ── 網頁管控:強制登出 / 重整 / 封鎖 / 解封 ──
  async function refreshWebBanStatus() {
    const el = document.getElementById("web-ban-status");
    if (!el || !state.selectedPlayerData) return;
    const player = state.selectedPlayerData.player;
    try {
      const data = await request("/admin/web-bans");
      const blockedIds = ((data && data.blocked) || []).map(String);
      const blocked = blockedIds.includes(String(player.discordId));
      el.textContent = `封鎖狀態：${blocked ? "🚫 已封鎖網頁" : "✅ 正常"}`;
      el.style.color = blocked ? "#f87171" : "";
    } catch (e) {
      el.textContent = `封鎖狀態：讀取失敗 (${e.message})`;
    }
  }

  async function submitForceLogout() {
    if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");
    const player = state.selectedPlayerData.player;
    await request(`/admin/players/${encodeURIComponent(player.discordId)}/force-logout`, { method: "POST", body: JSON.stringify({ reason: "admin_action" }) });
    log(`已要求 ${player.displayName} 網頁強制登出`);
  }

  async function submitForceReload() {
    if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");
    const player = state.selectedPlayerData.player;
    await request(`/admin/players/${encodeURIComponent(player.discordId)}/force-reload`, { method: "POST", body: JSON.stringify({ reason: "admin_action" }) });
    log(`已要求 ${player.displayName} 網頁重新整理`);
  }

  async function submitBlockWeb() {
    if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");
    const player = state.selectedPlayerData.player;
    if (!window.confirm(`確定要封鎖 ${player.displayName} 的網頁使用權？對方會立即被登出。`)) return;
    await request(`/admin/players/${encodeURIComponent(player.discordId)}/block-web`, { method: "POST", body: "{}" });
    await refreshWebBanStatus();
    log(`已封鎖 ${player.displayName} 的網頁使用權`);
  }

  async function submitUnblockWeb() {
    if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");
    const player = state.selectedPlayerData.player;
    await request(`/admin/players/${encodeURIComponent(player.discordId)}/unblock-web`, { method: "POST", body: "{}" });
    await refreshWebBanStatus();
    log(`已解除 ${player.displayName} 的網頁封鎖`);
  }

  // ── 目前在線網頁玩家清單(可直接登出/重整/封鎖)──
  async function loadWebOnline() {
    const box = document.getElementById("web-online-list");
    if (!box) return;
    box.textContent = "載入中…";
    try {
      const data = await request("/admin/web-online");
      const players = (data && data.players) || [];
      if (!players.length) {
        box.innerHTML = '<div style="opacity:.7;padding:6px 0;">目前沒有人在線上使用網頁。</div>';
        return;
      }
      box.innerHTML = players.map((p) => {
        const id = escapeHtml(p.discordId);
        const name = escapeHtml(p.displayName || p.discordId);
        const blockedTag = p.blocked ? '<span style="color:#f87171;"> · 已封鎖</span>' : '';
        const conn = p.connections > 1 ? ` · ${p.connections} 連線` : '';
        const blockBtn = p.blocked
          ? `<button type="button" class="button" data-act="unblock" data-id="${id}" style="padding:2px 8px;">解封</button>`
          : `<button type="button" class="button" data-act="block" data-id="${id}" style="padding:2px 8px;background:#7f1d1d;border-color:#b91c1c;color:#fff;">封鎖</button>`;
        return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07);">
          <div style="flex:1;min-width:0;">
            <strong>${name}</strong>${blockedTag}<br><small style="opacity:.6;">${id}${conn}</small>
          </div>
          <button type="button" class="button" data-act="logout" data-id="${id}" style="padding:2px 8px;">登出</button>
          <button type="button" class="button" data-act="reload" data-id="${id}" style="padding:2px 8px;">重整</button>
          ${blockBtn}
        </div>`;
      }).join("");
    } catch (e) {
      box.innerHTML = `<div style="color:#f87171;">載入失敗：${escapeHtml(e.message)}</div>`;
    }
  }

  // ── 全體公告 / 熱更新提示 ──
  async function submitBroadcast(mode) {
    const resultBox = document.getElementById("broadcast-result");
    const message = (document.getElementById("broadcast-message")?.value || "").trim();
    const promptMessage = (document.getElementById("broadcast-prompt-message")?.value || "").trim();
    if (mode === "force" && !window.confirm("確定要強制所有在線玩家「立即重新整理」？對方畫面會馬上刷新。")) return;
    if (resultBox) resultBox.textContent = "發送中…";
    try {
      const data = await request("/admin/broadcast/announce-and-reload", {
        method: "POST",
        body: JSON.stringify({ mode, message, promptMessage })
      });
      const n = (data && data.notified) || 0;
      const modeLabel = mode === "force" ? "強制重整" : "重整提示";
      const msg = `已對 ${n} 位在線玩家發送「${modeLabel}」${message ? "，並公告到聊天大廳" : ""}`;
      if (resultBox) resultBox.textContent = `✅ ${msg}`;
      log(msg);
    } catch (e) {
      if (resultBox) resultBox.textContent = `❌ 發送失敗：${e.message}`;
      log(`全體公告發送失敗：${e.message}`);
    }
  }

  async function webOnlineAction(act, discordId) {
    const map = { logout: "force-logout", reload: "force-reload", block: "block-web", unblock: "unblock-web" };
    const path = map[act];
    if (!path || !discordId) return;
    if (act === "block" && !window.confirm(`確定封鎖此玩家（${discordId}）的網頁使用權？對方會立即被登出。`)) return;
    await request(`/admin/players/${encodeURIComponent(discordId)}/${path}`, { method: "POST", body: "{}" });
    const label = { logout: "強制登出", reload: "強制重整", block: "封鎖網頁", unblock: "解除封鎖" }[act];
    log(`已對 ${discordId} 執行「${label}」`);
    await loadWebOnline();
  }

  // 全體回歸賽季重製(所有帳號):需輸入確認字串
  async function submitSeasonResetAll() {
    const box = document.getElementById("season-reset-all-result");
    const pv = await request("/admin/season-reset-all/preview").catch(() => ({ total: "?" }));
    const total = pv.total;
    const ans = window.prompt(`☢️ 全體回歸賽季重製\n\n將對「全部 ${total} 位玩家」執行重製（保留鑽石/稱號/收藏，其餘全清，含拍賣與交易）。\n此操作不可復原、影響全服，執行前會自動備份。\n\n確定請輸入：RESET-ALL`);
    if (ans !== "RESET-ALL") { if (box) box.textContent = "已取消（確認字串不符）"; return; }
    if (box) box.textContent = "執行中…（玩家多時需稍候）";
    const sum = await request("/admin/season-reset-all", { method: "POST", body: JSON.stringify({ confirm: "RESET-ALL" }) });
    const msg = `✅ 全體重製完成：成功 ${sum.succeeded}/${sum.total}、失敗 ${sum.failed}；移除拍賣 ${sum.removedAuctions} 筆、交易 ${sum.removedTransactions} 筆、背包 ${sum.removedInventoryItems} 件`;
    if (box) box.textContent = msg;
    log(msg);
  }

  // 回歸賽季重製(固定方案):只留鑽石/稱號/收藏,其餘全部重置
  async function submitSeasonReset() {
    if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");
    const player = state.selectedPlayerData.player;
    const p = await request(`/admin/players/${encodeURIComponent(player.discordId)}/season-reset/preview`);
    const titles = (Number(p.keptTitlesInBag) || 0) + (Number(p.keptTitleEquipped) || 0);
    const msg = `確定要對「${player.displayName}」執行回歸賽季重製？\n\n`
      + `保留：鑽石 ${p.keptDiamond}、稱號 ${titles} 個、收藏 ${p.keptCollectibles} 個\n`
      + `移除：背包 ${p.removedInventoryItems} 件、金幣 ${p.goldBefore} → 0、等級 ${p.levelBefore} → 1\n`
      + `拍賣上架 ${p.removedAuctions || 0} 筆、交易紀錄 ${p.removedTransactions || 0} 筆\n\n`
      + `此操作不可復原（系統會先自動備份）。`;
    if (!window.confirm(msg)) return;
    const sum = await request(`/admin/players/${encodeURIComponent(player.discordId)}/season-reset`, { method: "POST", body: "{}" });
    const t2 = (Number(sum.keptTitlesInBag) || 0) + (Number(sum.keptTitleEquipped) || 0);
    log(`✅ 已對 ${player.displayName} 回歸賽季重製：保留鑽石 ${sum.keptDiamond}/稱號 ${t2}/收藏 ${sum.keptCollectibles}，移除背包 ${sum.removedInventoryItems} 件、拍賣 ${sum.removedAuctions || 0} 筆、交易 ${sum.removedTransactions || 0} 筆`);
    await loadPlayerDetail(player.discordId);
  }

  // expose players API used by bindings
  window.adminPlayers = {
    loadWebOnline,
    webOnlineAction,
    submitBroadcast,
    submitSeasonReset,
    submitSeasonResetAll,
    loadPlayers,
    renderPlayerList,
    loadPlayerDetail,
    saveAccessControl,
    submitCurrencyAction,
    submitExpAction,
    loadItemsForSelect,
    submitGrantItem,
    refreshWebBanStatus,
    submitForceLogout,
    submitForceReload,
    submitBlockWeb,
    submitUnblockWeb
  };

})();
