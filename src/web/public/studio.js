(function () {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v) => Number(v || 0).toLocaleString("zh-TW");
  const when = (v) => v ? new Date(v).toLocaleString("zh-TW", { hour12: false }) : "—";
  const VIEW_NAMES = new Set(["dashboard", "audience", "revenue", "interaction", "worldboss", "settings", "obs", "integrations"]);
  const hashView = String(location.hash || "").replace(/^#/, "");
  let currentView = VIEW_NAMES.has(hashView) ? hashView : "dashboard";
  let lastStats = null;
  let refreshTimer = null;

  function toast(message, bad = false) {
    const node = $("#studio-toast");
    node.textContent = message;
    node.style.borderColor = bad ? "#ff657f88" : "#a78bfa66";
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    return payload.data;
  }

  async function login(password) {
    await api("/api/admin/session/login", { method: "POST", body: JSON.stringify({ password }) });
    await enterStudio();
  }

  async function enterStudio() {
    $("#studio-login-status").textContent = "";
    $("#studio-login").hidden = true;
    $("#studio-shell").hidden = false;
    showView(currentView, { updateHash: false, load: false });
    await refreshAll();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => refreshDashboard().catch(() => {}), 10_000);
  }

  function showView(name, { updateHash = true, load = true } = {}) {
    if (!VIEW_NAMES.has(name)) name = "dashboard";
    currentView = name;
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    $$(".nav[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
    if (updateHash && location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    if (!load) return;
    Promise.resolve(viewLoader(name)?.()).catch((e) => toast(e.message, true));
  }

  function viewLoader(name) {
    return {
      audience: refreshAudience,
      revenue: refreshRevenue,
      interaction: refreshInteraction,
      worldboss: refreshWorldBosses,
      settings: refreshSettings,
      obs: renderOverlays,
      integrations: refreshIntegrations
    }[name];
  }

  function metric(label, value, sub = "", tone = "") {
    return `<div class="metric"><span>${esc(label)}</span><strong class="${tone}">${esc(value)}</strong><em>${esc(sub)}</em></div>`;
  }

  async function refreshDashboard() {
    const [stats, buffs] = await Promise.all([api("/admin/live/stats"), api("/admin/stream-events/buffs")]);
    lastStats = stats;
    const live = stats.stream || {};
    $("#studio-clock").textContent = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    $("#top-live-dot").classList.toggle("live", live.isLive === true);
    $("#top-live-text").textContent = live.isLive ? "直播中" : "目前離線";
    $("#studio-metrics").innerHTML = [
      metric("直播狀態", live.isLive ? "LIVE" : "OFFLINE", "OneComme 實際直播枠", live.isLive ? "good" : ""),
      metric("即時觀看", fmt(live.viewerCount), `本季尖峰 ${fmt(live.viewerPeak)}`),
      metric("活躍留言者", fmt(stats.chatActivity?.activeChatters), "最近五分鐘不重複帳號"),
      metric("今日斗內", `NT$ ${fmt(stats.today?.donationTotal)}`, `${fmt(stats.today?.donationCount)} 筆`, "good"),
      metric("今日新會員", fmt(stats.today?.newMembers), "加入／回歸／升級"),
      metric("網頁在線", fmt(stats.webOnlinePlayers), "目前遊戲網頁玩家")
    ].join("");
    $("#studio-world-bosses").innerHTML = (stats.worldBosses || []).map((boss) => {
      const pct = Math.max(0, Math.min(100, Number(boss.currentHp) / Math.max(1, Number(boss.maxHp)) * 100));
      return `<div class="boss-row"><div class="boss-meta"><b>${esc(boss.name)}</b><span>${fmt(boss.currentHp)} / ${fmt(boss.maxHp)}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
    }).join("") || '<p class="status">目前沒有可監看的世界王。</p>';
    renderBuffs("#studio-active-buffs", buffs);
  }

  function renderBuffs(selector, data) {
    const list = data?.active || [];
    const mods = data?.modifiers || {};
    const head = `<div class="buff-row"><div><b>目前合計</b><small>永久底盤＋短期＋觀看</small></div><strong>EXP +${fmt(mods.expPct)}%・金幣 +${fmt(mods.goldPct)}%・掉寶 +${fmt(mods.dropPct)}%</strong></div>`;
    $(selector).innerHTML = head + (list.length ? list.map((b) => `<div class="buff-row"><div><b>${esc(b.label || b.source)}</b><small>${esc(b.source || "event")}・至 ${when(b.endsAt)}</small></div><span>EXP +${fmt(b.expPct)}% / 金幣 +${fmt(b.goldPct)}% / 掉寶 +${fmt(b.dropPct)}%</span></div>`).join("") : '<p class="status">目前沒有短期加成。</p>');
  }

  async function refreshAudience() {
    const data = await api("/admin/stream-records/membership-status?limit=1000");
    const stats = lastStats || await api("/admin/live/stats");
    $("#audience-metrics").innerHTML = [metric("真實觀看", fmt(stats.stream?.viewerCount), "OneComme meta"), metric("活躍留言者", fmt(stats.chatActivity?.activeChatters), "最近五分鐘"), metric("有效會員", fmt(data.activeCount), `名錄共 ${fmt(data.total)} 人`), metric("今日會員事件", fmt(stats.today?.newMembers), "加入／回歸／升級")].join("");
    $("#membership-summary").textContent = `有效 ${fmt(data.activeCount)}／名錄 ${fmt(data.total)}`;
    $("#membership-table").innerHTML = (data.statuses || []).map((row) => `<tr><td>${esc(row.displayName || row.discordId)}</td><td>${esc(row.currentLabel || row.currentTier || "—")}</td><td>${esc(row.source || "—")}</td><td>${esc((row.bindingPlatforms || []).join("、") || "—")}</td><td>${when(row.lastConfirmedAt || row.lastChangedAt)}</td></tr>`).join("") || '<tr><td colspan="5">沒有會員資料</td></tr>';
  }

  async function refreshRevenue() {
    const donations = await api("/admin/stream-records/donations?limit=100");
    const summary = donations.summary || {};
    const monthly = summary.month || {};
    const monthlySources = monthly.bySource || {};
    const monthLabel = monthly.key ? monthly.key.replace("-", "/") : "本月";
    const unboundCount = Math.max(0, Number(summary.totalEvents || 0) - Number(summary.boundEvents || 0));
    $("#revenue-metrics").innerHTML = [
      metric(`${monthLabel} YouTube`, `NT$ ${fmt(monthlySources.youtube?.totalTwd)}`, `${fmt(monthlySources.youtube?.totalEvents)} 筆`),
      metric(`${monthLabel} 綠界`, `NT$ ${fmt(monthlySources.ecpay?.totalTwd)}`, `${fmt(monthlySources.ecpay?.totalEvents)} 筆`),
      metric(`${monthLabel} 全部合計`, `NT$ ${fmt(monthly.totalTwd)}`, `${fmt(monthly.totalEvents)} 筆`, "good"),
      metric("未綁定", fmt(unboundCount), "需要人工確認", unboundCount ? "warning" : "good")
    ].join("");
    $("#donation-table").innerHTML = (donations.events || []).map((row) => {
      const raw = row.originalAmount != null && (Number(row.originalAmount) !== Number(row.twdAmount) || (row.currency && !["TWD", "NTD", "NT$"].includes(String(row.currency).toUpperCase())))
        ? `<small class="donation-raw">平台：${esc(row.currency || "?")} ${fmt(row.originalAmount)}</small>` : "";
      return `<tr><td>${when(row.createdAt)}</td><td>${esc(row.displayName || row.patronName || "—")}</td><td>NT$ ${fmt(row.twdAmount)}${raw}</td><td class="${row.bound ? "good" : "warning"}">${row.bound ? "已綁定" : "未綁定"}</td><td>${esc(row.note || row.status || "—")}</td></tr>`;
    }).join("") || '<tr><td colspan="5">目前沒有斗內紀錄</td></tr>';
  }

  async function refreshInteraction() {
    const buffs = await api("/admin/stream-events/buffs");
    renderBuffs("#interaction-buffs", buffs);
    await window.adminWheel?.load?.();
  }

  async function refreshWorldBosses() {
    const stats = await api("/admin/live/stats");
    lastStats = stats;
    $("#worldboss-monitor").innerHTML = (stats.worldBosses || []).map((boss) => {
      const current = Math.max(0, Number(boss.currentHp) || 0);
      const maximum = Math.max(1, Number(boss.maxHp) || 1);
      const pct = Math.max(0, Math.min(100, current / maximum * 100));
      const state = current <= 0 ? "已擊破／等待輪替" : pct <= 20 ? "瀕危" : "攻略中";
      return `<article class="boss-monitor-card"><div class="boss-monitor-head"><div><span>${esc(boss.zone)}</span><h2>${esc(boss.name)}</h2></div><strong class="${current <= 0 ? "warning" : "good"}">${state}</strong></div><div class="bar large"><i style="width:${pct}%"></i></div><div class="boss-monitor-value"><b>${fmt(current)}</b><span>/ ${fmt(maximum)} HP</span><em>${pct.toFixed(1)}%</em></div></article>`;
    }).join("") || '<article class="panel"><p class="status">目前沒有可監看的世界王。</p></article>';
  }

  function refreshSettings() {
    return window.adminStreamRecords?.open?.("events");
  }

  const field = (key, label, type, options = {}) => ({ key, label, type, ...options });
  const OVERLAYS = [
    {
      id: "chat", name: "聊天室", path: "chat.html", size: "420 × 900", summary: "完整 OBS 聊天室，包含會員階級與遊戲綁定樣式。",
      fields: [field("key", "聊天室 Overlay 金鑰", "password", { sensitive: true, placeholder: "輸入 CHAT_OVERLAY_PASSWORD" })],
      preview: { preview: "1" }, previewHint: "預覽會使用示範留言，不需要輸入金鑰。"
    },
    {
      id: "chat-danmaku", name: "聊天彈幕", path: "chat-danmaku.html", size: "1920 × 1080", summary: "由右向左飛過畫面的遊戲聊天室彈幕。",
      fields: [field("key", "聊天室 Overlay 金鑰", "password", { sensitive: true, placeholder: "輸入 CHAT_OVERLAY_PASSWORD" })]
    },
    {
      id: "chat-marquee", name: "聊天跑馬燈", path: "chat-marquee.html", size: "1920 × 140", summary: "每有新留言就向左推進一格的橫向留言列。",
      fields: [field("key", "聊天室 Overlay 金鑰", "password", { sensitive: true, placeholder: "輸入 CHAT_OVERLAY_PASSWORD" })]
    },
    { id: "danmaku", name: "彈幕強化版", path: "danmaku.html", size: "1920 × 1080", summary: "直接連接同一台電腦上的 OneComme，依會員身分替彈幕上色。", fixed: true, fixedNote: "此來源使用固定樣式，並需在 OBS 電腦上啟動 OneComme。" },
    {
      id: "mahjong", name: "麻將排隊框", path: "mahjong.html", size: "420 × 900", summary: "直播麻將排隊名單；一般顯示不需密碼。",
      fields: [field("key", "主持操作密碼（選填）", "password", { sensitive: true, placeholder: "需要拖曳或移除名單時才填" })],
      previewHint: "不填密碼仍可正常顯示；只有主持操作需要密碼。"
    },
    {
      id: "sc-bar", name: "SC＋會員累積", path: "sc-bar-overlay.html", size: "720 × 340", summary: "顯示 SC、會員與直播觀看人數的累積進度。",
      fields: [
        field("show", "顯示內容", "select", { default: "both", choices: [["both", "SC 與會員"], ["sc", "只顯示 SC"], ["members", "只顯示會員"]] }),
        field("scale", "整體縮放", "number", { default: 1, min: 0.3, max: 4, step: 0.1 }),
        field("memberGoal", "固定會員目標（0 為自動）", "number", { default: 0, min: 0, step: 1, omitDefault: true }),
        field("memberStep", "自動會員目標級距", "number", { default: 10, min: 1, step: 1 }),
        field("poll", "更新間隔（毫秒）", "number", { default: 4000, min: 2000, step: 500 }),
        field("viewers", "顯示觀看人數", "checkbox", { default: true, falseValue: "0" }),
        field("sc1", "SC 起始色", "color", { default: "#7b5cff" }), field("sc2", "SC 結束色", "color", { default: "#ff5ea8" }),
        field("mem1", "會員起始色", "color", { default: "#29c7a8" }), field("mem2", "會員結束色", "color", { default: "#5fd0ff" })
      ]
    },
    {
      id: "emotion", name: "互動值條", path: "emotion-sc-meter-obs.html", size: "900 × 220", summary: "OneComme 留言與 SC 驅動的互動值特效條。",
      fields: [field("test", "開啟時播放一次特效測試", "checkbox", { default: false, trueValue: "1", previewOnly: true })],
      preview: { test: "1" }, previewHint: "正式來源不會帶入測試參數；預覽會自動播放一次特效。"
    },
    { id: "combat", name: "戰鬥監視", path: "combat-monitor.html", size: "960 × 900", summary: "每五秒顯示全區戰鬥人數、怪物血量與輸出排行。", fixed: true, fixedNote: "資料與更新週期由伺服器統一管理，沒有 OBS 端參數。" },
    {
      id: "loading", name: "載入頁", path: "loading.html", size: "1920 × 1080", summary: "紫藤風格的轉場與等待畫面。",
      fields: [
        field("text", "主標題", "text", { placeholder: "預設：LOADING" }),
        field("sub", "副標題", "text", { placeholder: "預設：please wait a moment" }),
        field("bg", "顯示內建背景", "checkbox", { default: true, falseValue: "0" })
      ]
    },
    {
      id: "filter", name: "柔光濾鏡", path: "filter.html?mode=add", size: "1920 × 1080", summary: "覆蓋在遊戲畫面上的光斑、星芒與角落光暈。",
      fields: [
        field("level", "光效強度", "select", { default: "2", choices: [["1", "柔和"], ["2", "標準"], ["3", "明亮"]] }),
        field("tone", "色調", "select", { default: "mix", choices: [["mix", "混合"], ["gold", "金色"], ["lavender", "薰衣草"], ["blue", "淡藍"]] }),
        field("rays", "顯示斜向光束", "checkbox", { default: true, falseValue: "0" }),
        field("corners", "顯示角落光暈", "checkbox", { default: true, falseValue: "0" })
      ], preview: { bg: "1" }, previewHint: "預覽會加深色測試底；複製到 OBS 的正式網址不含測試背景。"
    },
    {
      id: "thanks", name: "感謝名單", path: "thanks.html", size: "520 × 760", summary: "輪播今日斗內與新加入會員。",
      fields: [
        field("title", "標題", "text", { placeholder: "使用預設標題" }),
        field("per", "每頁筆數", "number", { default: 5, min: 3, max: 8, step: 1 }),
        field("interval", "輪播秒數", "number", { default: 7, min: 4, max: 30, step: 1 })
      ], preview: { bg: "1" }, previewHint: "預覽會加深色測試底；正式來源維持透明背景。"
    },
    {
      id: "alert", name: "直播警報", path: "alert.html", size: "720 × 480", summary: "斗內、會員、訂閱、Raid 與里程碑的共用警報。",
      fields: [
        field("types", "要播放的警報", "checks", { default: ["donation", "member", "sub", "raid", "milestone"], choices: [["donation", "斗內"], ["member", "會員"], ["sub", "訂閱"], ["raid", "Raid"], ["milestone", "里程碑"]] }),
        field("hold", "每則停留秒數", "number", { default: 7, min: 3, max: 20, step: 1 }),
        field("minamount", "最低斗內金額", "number", { default: 0, min: 0, step: 10 }),
        field("sound", "播放通知音", "checkbox", { default: true, trueValue: "1" }),
        field("vol", "音量（0～1）", "number", { default: 0.8, min: 0, max: 1, step: 0.1 })
      ], preview: { demo: "1", bg: "1" }, previewHint: "預覽會輪播示範事件並加測試底色；正式來源只接收真實警報。"
    }
  ];
  let activeOverlayId = null;

  function overlayById(id) { return OVERLAYS.find((item) => item.id === id); }
  function overlayStorageKey(id) { return `studio_obs_settings_${id}_v1`; }
  function loadOverlayValues(def) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(overlayStorageKey(def.id)) || "{}"); } catch (_) {}
    return Object.fromEntries((def.fields || []).map((item) => [item.key, item.sensitive ? item.default ?? "" : saved[item.key] ?? item.default ?? (item.type === "checkbox" ? false : "")]));
  }
  function saveOverlayValues(def, values) {
    const safe = {};
    (def.fields || []).forEach((item) => { if (!item.sensitive && !item.previewOnly) safe[item.key] = values[item.key]; });
    localStorage.setItem(overlayStorageKey(def.id), JSON.stringify(safe));
  }
  function buildOverlayUrl(def, values = {}, preview = false) {
    const url = new URL(`/static/${def.path}`, location.origin);
    (def.fields || []).forEach((item) => {
      if (item.previewOnly && !preview) return;
      const value = values[item.key];
      if (item.type === "checkbox") {
        if (value && item.trueValue != null) url.searchParams.set(item.key, item.trueValue);
        if (!value && item.falseValue != null) url.searchParams.set(item.key, item.falseValue);
        return;
      }
      if (item.type === "checks") {
        if (Array.isArray(value) && value.length) url.searchParams.set(item.key, value.join(","));
        return;
      }
      if (value === "" || value == null || (item.omitDefault && String(value) === String(item.default))) return;
      url.searchParams.set(item.key, String(value));
    });
    if (preview) Object.entries(def.preview || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }
  function readOverlayForm(def) {
    const values = {};
    (def.fields || []).forEach((item) => {
      if (item.type === "checks") values[item.key] = $$(`[data-obs-check="${item.key}"]:checked`, $("#obs-setting-grid")).map((node) => node.value);
      else {
        const node = $(`[data-obs-field="${item.key}"]`, $("#obs-setting-grid"));
        values[item.key] = item.type === "checkbox" ? Boolean(node?.checked) : node?.value ?? "";
      }
    });
    return values;
  }
  function renderOverlayField(item, value) {
    if (item.type === "select") return `<label>${esc(item.label)}<select data-obs-field="${esc(item.key)}">${item.choices.map(([key, label]) => `<option value="${esc(key)}"${String(value) === String(key) ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`;
    if (item.type === "checkbox") return `<label class="obs-toggle"><input type="checkbox" data-obs-field="${esc(item.key)}"${value ? " checked" : ""}><span>${esc(item.label)}</span></label>`;
    if (item.type === "checks") return `<fieldset class="obs-check-group"><legend>${esc(item.label)}</legend>${item.choices.map(([key, label]) => `<label><input type="checkbox" data-obs-check="${esc(item.key)}" value="${esc(key)}"${Array.isArray(value) && value.includes(key) ? " checked" : ""}> ${esc(label)}</label>`).join("")}</fieldset>`;
    const attrs = [`type="${item.type === "password" ? "password" : item.type}"`, `data-obs-field="${esc(item.key)}"`];
    if (item.placeholder) attrs.push(`placeholder="${esc(item.placeholder)}"`);
    if (item.min != null) attrs.push(`min="${esc(item.min)}"`);
    if (item.max != null) attrs.push(`max="${esc(item.max)}"`);
    if (item.step != null) attrs.push(`step="${esc(item.step)}"`);
    return `<label>${esc(item.label)}<input ${attrs.join(" ")} value="${esc(value)}" autocomplete="off"></label>`;
  }
  function updateOverlayOutput() {
    const def = overlayById(activeOverlayId);
    if (!def) return;
    const values = readOverlayForm(def);
    saveOverlayValues(def, values);
    const url = buildOverlayUrl(def, values, false);
    $("#obs-configured-url").textContent = url;
    $("#obs-copy-configured").dataset.copy = url;
    $("#obs-preview-configured").dataset.previewUrl = buildOverlayUrl(def, values, true);
    const card = $(`.overlay-card[data-overlay-id="${def.id}"]`);
    if (card) $(".overlay-url", card).textContent = url;
  }
  function openOverlaySettings(id) {
    const def = overlayById(id);
    if (!def) return;
    activeOverlayId = id;
    const values = loadOverlayValues(def);
    $("#obs-editor-title").textContent = `${def.name}設定`;
    $("#obs-editor-summary").textContent = def.summary;
    $("#obs-editor-size").textContent = def.size;
    $("#obs-preview-hint").textContent = def.fixedNote || def.previewHint || "調整後可直接預覽或複製到 OBS 瀏覽器來源。";
    $("#obs-security-note").hidden = !(def.fields || []).some((item) => item.sensitive);
    $("#obs-setting-grid").innerHTML = def.fixed
      ? `<div class="obs-fixed-note"><b>固定來源</b><span>${esc(def.fixedNote)}</span></div>`
      : (def.fields || []).map((item) => renderOverlayField(item, values[item.key])).join("");
    $("#obs-source-editor").hidden = false;
    $$(".overlay-card").forEach((card) => card.classList.toggle("active", card.dataset.overlayId === id));
    updateOverlayOutput();
    $("#obs-source-editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function closeOverlaySettings() {
    activeOverlayId = null;
    $("#obs-source-editor").hidden = true;
    $$(".overlay-card").forEach((card) => card.classList.remove("active"));
  }
  function renderOverlays() {
    $("#overlay-grid").innerHTML = OVERLAYS.map((def) => {
      const values = loadOverlayValues(def);
      const url = buildOverlayUrl(def, values);
      const state = def.fixed ? "固定來源" : `可設定 ${(def.fields || []).length} 項`;
      return `<article class="overlay-card" data-overlay-id="${esc(def.id)}"><div class="overlay-title"><span>${esc(def.name)}</span><span class="overlay-status">未檢查</span></div><p class="overlay-summary">${esc(def.summary)}</p><div class="overlay-meta"><span>${esc(def.size)}</span><span>${esc(state)}</span></div><code class="overlay-url">${esc(url)}</code><div class="button-row"><button class="btn small primary" data-obs-config="${esc(def.id)}">${def.fixed ? "來源說明" : "設定"}</button><button class="btn small ghost" data-copy="${esc(url)}">複製</button><a class="btn small ghost" href="${esc(buildOverlayUrl(def, values, true))}" target="_blank" rel="noopener">預覽</a></div></article>`;
    }).join("");
  }
  async function checkOverlays() {
    const cards = $$(".overlay-card");
    await Promise.all(cards.map(async (card, i) => {
      const status = $(".overlay-status", card); status.textContent = "檢查中";
      try { const response = await fetch(`/static/${OVERLAYS[i].path}`, { cache: "no-store" }); status.textContent = response.ok ? "正常" : `HTTP ${response.status}`; status.classList.toggle("ok", response.ok); }
      catch (_) { status.textContent = "無法連線"; }
    }));
    toast("OBS 頁面健康檢查完成");
  }

  async function refreshIntegrations() {
    const status = await api("/admin/creator-auth/status");
    $("#creator-auth-status").innerHTML = ["youtube", "twitch"].map((key) => { const row = status?.[key] || {}; const active = row.status === "active" && row.accessTokenValid !== false; return `<div class="buff-row"><div><b>${key === "youtube" ? "YouTube" : "Twitch"}</b><small>${esc(row.status || "未設定")}</small></div><strong class="${active ? "good" : "warning"}">${active ? "正常" : "需要授權"}</strong></div>`; }).join("");
  }

  async function refreshAll() {
    await refreshDashboard();
    await viewLoader(currentView)?.();
  }

  function bind() {
    $("#studio-login-btn").addEventListener("click", async () => {
      const button = $("#studio-login-btn");
      try {
        button.disabled = true;
        $("#studio-login-status").textContent = "登入中…";
        await login($("#studio-password").value);
      } catch (e) {
        $("#studio-login-status").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    });
    $("#studio-password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#studio-login-btn").click(); });
    $$("[data-view]").forEach((n) => n.addEventListener("click", () => showView(n.dataset.view)));
    $$("[data-view-jump]").forEach((n) => n.addEventListener("click", () => showView(n.dataset.viewJump)));
    $("#studio-refresh").addEventListener("click", () => refreshAll().then(() => toast("資料已更新")).catch((e) => toast(e.message, true)));
    $("#dashboard-refresh").addEventListener("click", () => refreshDashboard().then(() => toast("即時狀態已更新")).catch((e) => toast(e.message, true)));
    $("#worldboss-refresh").addEventListener("click", () => refreshWorldBosses().then(() => toast("世界王狀態已更新")).catch((e) => toast(e.message, true)));
    $("#studio-logout").addEventListener("click", async () => { await api("/api/admin/session", { method: "DELETE" }); location.reload(); });
    $$("[data-alert]").forEach((button) => button.addEventListener("click", async () => { try { await api("/admin/live/test-alert", { method: "POST", body: JSON.stringify({ type: button.dataset.alert }) }); toast(`已發送 ${button.textContent.trim()}`); } catch (e) { toast(e.message, true); } }));
    $("#studio-announce").addEventListener("click", async () => { const message = $("#studio-announcement").value.trim(); if (!message) return toast("請先輸入公告內容", true); if (!confirm(`確定發送公告？\n\n${message}`)) return; try { await api("/admin/broadcast/announce", { method: "POST", body: JSON.stringify({ message }) }); $("#studio-announcement").value = ""; toast("公告已送出"); } catch (e) { toast(e.message, true); } });
    $("#studio-sync-members").addEventListener("click", async () => { if (!confirm("立即同步 Discord 與直播會員名單？")) return; try { await api("/admin/stream-records/reconcile", { method: "POST" }); await refreshAudience(); toast("會員名單同步完成"); } catch (e) { toast(e.message, true); } });
    $("#buff-apply").addEventListener("click", async () => { const body = { label: $("#buff-label").value.trim(), durationMinutes: Number($("#buff-duration").value), expPct: Number($("#buff-exp").value), goldPct: Number($("#buff-gold").value), dropPct: Number($("#buff-drop").value), announce: $("#buff-announce").checked }; if (!body.label || body.durationMinutes < 1 || !(body.expPct || body.goldPct || body.dropPct)) return toast("請填名稱、時間與至少一種加成", true); if (!confirm(`套用「${body.label}」${body.durationMinutes} 分鐘？`)) return; try { await api("/admin/stream-events/buff", { method: "POST", body: JSON.stringify(body) }); await refreshInteraction(); toast("全服加成已套用"); } catch (e) { toast(e.message, true); } });
    $("#buff-clear-all").addEventListener("click", async () => { if (!confirm("確定結束全部短期全服加成？永久里程碑不受影響。")) return; try { await api("/admin/stream-events/buff/clear", { method: "POST", body: "{}" }); await refreshInteraction(); toast("短期加成已全部結束"); } catch (e) { toast(e.message, true); } });
    $("#obs-check-all").addEventListener("click", checkOverlays);
    $("#obs-editor-close").addEventListener("click", closeOverlaySettings);
    $("#obs-setting-grid").addEventListener("input", updateOverlayOutput);
    $("#obs-setting-grid").addEventListener("change", updateOverlayOutput);
    $("#obs-preview-configured").addEventListener("click", () => { const url = $("#obs-preview-configured").dataset.previewUrl; if (url) window.open(url, "_blank", "noopener"); });
    document.addEventListener("click", (e) => { const copy = e.target.closest("[data-copy]"); if (copy) navigator.clipboard.writeText(copy.dataset.copy).then(() => toast("OBS 網址已複製")); });
    document.addEventListener("click", (e) => { const config = e.target.closest("[data-obs-config]"); if (config) openOverlaySettings(config.dataset.obsConfig); });
    $$("[data-reauth]").forEach((button) => button.addEventListener("click", async () => { const popup = window.open("about:blank", "_blank"); try { const data = await api("/admin/creator-auth/start", { method: "POST", body: JSON.stringify({ provider: button.dataset.reauth }) }); if (popup) popup.location = data.url; } catch (e) { popup?.close(); toast(e.message, true); } }));
  }

  bind();
  window.addEventListener("hashchange", () => showView(String(location.hash || "").replace(/^#/, ""), { updateHash: false }));
  renderOverlays();
})();
