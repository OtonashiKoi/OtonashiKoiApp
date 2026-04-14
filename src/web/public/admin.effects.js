(function () {
  const TARGETS = [
    ["self", "自己"],
    ["enemy", "敵方單體"],
    ["ally", "友方單體"],
    ["all_enemies", "敵方全體"],
    ["all_allies", "友方全體"]
  ];

  const TRIGGERS = [
    ["passive", "被動常駐"],
    ["on_battle_start", "戰鬥開始"],
    ["on_battle_end", "戰鬥結束"],
    ["on_attack", "發動攻擊"],
    ["on_hit", "命中後"],
    ["on_gain", "獲得時"],
    ["on_crit", "暴擊後"],
    ["on_kill", "擊殺後"],
    ["on_take_damage", "受傷時"],
    ["on_low_hp", "低血量時"],
    ["on_evade", "閃避時"],
    ["on_equip", "裝備時"],
    ["on_unequip", "卸下時"],
    ["on_npc_event", "NPC 事件"],
    ["on_round_start", "回合開始"],
    ["on_round_end", "回合結束"]
  ];

  const DURATION_MODES = [
    ["turns", "回合"],
    ["battle", "整場戰鬥"],
    ["seconds", "秒數"],
    ["count", "次數"],
    ["permanent", "永久"]
  ];

  const STACK_MODES = [
    ["refresh", "刷新時間"],
    ["stack", "可疊加"],
    ["replace", "新值覆蓋"],
    ["ignore", "若已存在則忽略"]
  ];

  const NPC_EFFECT_TYPES = [
    ["grant_currency", "發放貨幣"],
    ["grant_item", "發放道具"],
    ["grant_equipment", "發放裝備"],
    ["take_item", "消耗道具（交換）"],
    ["grant_temporary_quest", "發放限時任務"],
    ["grant_buff", "給予 Buff"]
  ];

  const EFFECT_NAME_ZH = {
    max_hp_up: "最大 HP 提升",
    max_hp_down: "最大 HP 降低",
    atk_up: "攻擊提升",
    atk_down: "攻擊降低",
    def_up: "防禦提升",
    def_down: "防禦降低",
    mdef_up: "魔防提升",
    mdef_down: "魔防降低",
    hit_up: "命中提升",
    hit_down: "命中降低",
    dodge_up: "閃避提升",
    dodge_down: "閃避降低",
    crit_rate_up: "暴擊率提升",
    crit_rate_down: "暴擊率降低",
    crit_damage_up: "暴擊傷害提升",
    crit_damage_down: "暴擊傷害降低",
    speed_up: "速度提升",
    speed_down: "速度降低",
    final_damage_up: "最終傷害提升",
    final_damage_down: "最終傷害降低",
    heal_over_time: "持續回血",
    poison: "中毒",
    burn: "燃燒",
    bleed: "流血",
    shock_dot: "感電",
    curse_dot: "詛咒",
    life_regen: "生命回復",
    mana_regen: "魔力回復",
    stun: "暈眩",
    freeze: "冰凍",
    sleep: "睡眠",
    silence: "沉默",
    root: "定身",
    slow: "緩速",
    blind: "致盲",
    taunt: "嘲諷",
    fear: "恐懼",
    confuse: "混亂",
    disarm: "繳械",
    shield: "護盾",
    barrier: "屏障",
    damage_reduction: "傷害減免",
    physical_damage_reduction: "物理減免",
    magic_damage_reduction: "魔法減免",
    invincible_short: "短暫無敵",
    death_prevent_once: "免死一次",
    last_stand: "背水一戰",
    cleanse: "淨化",
    debuff_immunity: "Debuff 免疫",
    control_immunity: "控制免疫",
    lifesteal: "吸血",
    manasteal: "吸魔",
    thorns: "反傷",
    counter_attack: "反擊",
    reflect_magic: "魔法反射",
    damage_to_heal: "受傷轉治療",
    on_hit_heal: "命中回血",
    on_crit_heal: "暴擊回血",
    combo_up: "連擊率提升",
    stun_chance_up: "擊暈機率提升",
    counter_on_dodge: "迴避後反擊",
    proc_weak_spot: "弱點打擊",
    party_damage_up: "隊伍傷害提升",
    bonus_vs_boss: "對 Boss 增傷",
    bonus_vs_poisoned: "對中毒目標增傷",
    bonus_vs_burning: "對燃燒目標增傷",
    bonus_vs_stunned: "對暈眩目標增傷",
    bonus_vs_debuffed: "對減益目標增傷",
    bonus_when_hp_high: "高血量增傷",
    bonus_when_hp_low: "低血量增傷",
    bonus_first_hit: "首擊增傷",
    bonus_counter_damage: "反擊傷害提升",
    execute_under_hp_pct: "斬殺",
    gold_gain_up: "金幣加成",
    exp_gain_up: "經驗加成",
    drop_rate_up: "掉落率提升",
    rare_drop_rate_up: "稀有掉落率提升",
    checkin_bonus_up: "打卡獎勵提升",
    enhance_success_up: "強化成功率提升",
    event_trigger_rate_up: "事件觸發率提升",
    monster_reward_up: "怪物獎勵提升",
    proc_stun: "機率暈眩",
    proc_poison: "機率中毒",
    proc_burn: "機率燃燒",
    proc_bleed: "機率流血",
    proc_slow: "機率緩速",
    proc_def_down: "機率降防",
    proc_atk_down: "機率降攻",
    proc_extra_hit: "機率追加攻擊",
    proc_chain_hit: "機率連鎖攻擊",
    proc_execute: "機率斬殺",
    proc_heal: "機率回血",
    proc_shield: "機率護盾",
    proc_cleanse: "機率淨化",
    proc_dispel: "機率驅散",
    proc_gain_buff: "機率獲得增益"
  };

  const LABEL_MAP = {
    target: Object.fromEntries(TARGETS),
    trigger: Object.fromEntries(TRIGGERS),
    durationMode: Object.fromEntries(DURATION_MODES),
    stackMode: Object.fromEntries(STACK_MODES)
  };

  const CONDITION_PRESETS = [
    { id: "", label: "選擇條件範本..." },
    { id: "weapon_1h_sword", label: "主武器：單手劍", value: { weaponType: "sword_1h" } },
    { id: "weapon_2h_sword", label: "主武器：雙手劍", value: { weaponType: "sword_2h" } },
    {
      id: "1h_sword_with_shield",
      label: "單手劍 + 盾牌（非副手武器）",
      value: {
        all: [
          { weaponType: "sword_1h" },
          { equippedSlot: "shield" },
          { notWeaponType: ["offhand_sword", "offhand_dagger", "offhand_mace"] }
        ]
      }
    },
    {
      id: "1h_sword_with_offhand_weapon",
      label: "單手劍 + 副手武器",
      value: {
        all: [
          { weaponType: "sword_1h" },
          { any: [{ weaponType: "offhand_sword" }, { weaponType: "offhand_dagger" }, { weaponType: "offhand_mace" }] }
        ]
      }
    },
    { id: "has_inventory_item", label: "背包持有道具（未裝備）", value: { hasUnequippedItemId: "ITEM_ID" } },
    { id: "equipped_item", label: "已裝備指定道具", value: { equippedItemId: "ITEM_ID" } },
    { id: "equipped_slot", label: "已裝備指定欄位", value: { equippedSlot: "shield" } }
  ];

  let effectDefinitions = null;
  let itemOptions = null;
  let questOptions = null;
  let effectModules = null;
  let modal = null;

  function authHeaders(json = true) {
    const headers = { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: authHeaders(false) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
    return payload.data;
  }

  async function ensureLookups() {
    if (!effectDefinitions) effectDefinitions = await fetchJson("/admin/effect-definitions");
    if (!itemOptions) itemOptions = await fetchJson("/admin/items");
    if (!questOptions) questOptions = await fetchJson("/admin/weekly-quests").catch(() => []);
    if (!effectModules) effectModules = await fetchJson("/admin/effect-modules").catch(() => []);
  }

  function esc(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function encodeState(value) {
    return encodeURIComponent(JSON.stringify(value || null));
  }

  function decodeState(value, fallback) {
    try {
      if (!value) return fallback;
      const parsed = JSON.parse(decodeURIComponent(value));
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function optionHtml(options, selected, placeholder = "") {
    const head = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
    return head + options.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
  }

  function conditionPresetOptionHtml(selected = "") {
    return CONDITION_PRESETS
      .map((preset) => `<option value="${esc(preset.id)}"${preset.id === selected ? " selected" : ""}>${esc(preset.label)}</option>`)
      .join("");
  }

  function getDefinitionByKey(key) {
    return (effectDefinitions || []).find((item) => item.key === key) || null;
  }

  function getEffectLabel(definitionOrKey) {
    const key = typeof definitionOrKey === "string" ? definitionOrKey : definitionOrKey?.key;
    if (!key) return "";
    const definition = typeof definitionOrKey === "string" ? getDefinitionByKey(key) : definitionOrKey;
    return EFFECT_NAME_ZH[key] || definition?.name || key;
  }

  function effectOptionsBySource(sourceType) {
    return (effectDefinitions || [])
      .filter((definition) => !sourceType || (definition.sourceTypes || []).includes(sourceType))
      .map((definition) => [definition.key, `${getEffectLabel(definition)} (${definition.key})`]);
  }

  function formatDuration(duration) {
    const mode = duration?.mode || "turns";
    const value = Number(duration?.value);
    if (mode === "battle") return "整場戰鬥";
    if (mode === "permanent") return "永久";
    const label = LABEL_MAP.durationMode[mode] || mode;
    if (!Number.isFinite(value) || value <= 0) return label;
    return `${value} ${label}`;
  }

  function normalizeConditionObject(input) {
    if (!input || typeof input !== "object") return null;
    try {
      return JSON.parse(JSON.stringify(input));
    } catch {
      return null;
    }
  }

  function conditionToJsonText(condition) {
    const normalized = normalizeConditionObject(condition);
    if (!normalized) return "";
    try {
      return JSON.stringify(normalized, null, 2);
    } catch {
      return "";
    }
  }

  function parseConditionJsonText(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("限制條件必須是 JSON 物件");
    }
    return normalizeConditionObject(parsed);
  }

  function summarizeCondition(condition) {
    const c = normalizeConditionObject(condition);
    if (!c) return "";
    if (Array.isArray(c.all) && c.all.length) return `條件 all:${c.all.length}`;
    if (Array.isArray(c.any) && c.any.length) return `條件 any:${c.any.length}`;
    const keys = Object.keys(c).filter(Boolean);
    if (!keys.length) return "";
    return `條件 ${keys.slice(0, 2).join("、")}${keys.length > 2 ? ` 等 ${keys.length} 項` : ""}`;
  }

  function describeEffect(effect) {
    if (!effect?.key) return "尚未選擇效果";
    const label = getEffectLabel(effect.key);
    const trigger = LABEL_MAP.trigger[effect.trigger || "passive"] || effect.trigger || "passive";
    const target = LABEL_MAP.target[effect.target || "self"] || effect.target || "self";
    const chance = Number(effect.chance);
    const value = Number(effect?.params?.value);
    const stacks = Number(effect.stacks) || 1;
    const stackMode = LABEL_MAP.stackMode[effect.stackMode || "refresh"] || effect.stackMode || "refresh";
    const parts = [
      `${trigger} -> ${target}`,
      label
    ];
    if (Number.isFinite(value) && value !== 0) parts.push(`數值 ${value}`);
    if (Number.isFinite(chance) && chance < 100) parts.push(`機率 ${chance}%`);
    parts.push(`持續 ${formatDuration(effect.duration)}`);
    if (stacks > 1 || effect.stackMode === "stack") parts.push(`疊層 ${stacks}（${stackMode}）`);
    const conditionText = summarizeCondition(effect?.condition);
    if (conditionText) parts.push(conditionText);
    return parts.join(" / ");
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "admin-effects-modal";
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.66);padding:20px;overflow:auto;";
    modal.innerHTML = `
      <style>
        #admin-effects-modal .sheet-input[type="number"] { min-width:96px; width:96px; padding:6px; box-sizing:border-box; text-align:center; }
        #admin-effects-modal .sheet-input[type="number"].small { min-width:80px; width:80px; }
        #admin-effects-modal .sheet-input { min-width:72px; }
        #admin-effects-modal select.sheet-input { min-width:120px; }
        #admin-effects-modal .mode-chip { border:1px solid var(--line); border-radius:999px; padding:4px 10px; cursor:pointer; user-select:none; font-size:12px; }
        #admin-effects-modal .mode-chip.active { border-color:var(--accent); background:rgba(255,255,255,0.06); }
        #admin-effects-modal .effect-preview { font-size:12px; color:var(--muted); line-height:1.5; word-break:break-word; }
        #admin-effects-modal .effect-advanced { display:none; }
        #admin-effects-modal [data-mode="advanced"] .effect-advanced { display:grid; }
      </style>
      <div style="max-width:1400px;width:calc(100% - 40px);margin:0 auto;background:var(--surface);border:1px solid var(--accent);border-radius:12px;padding:20px;display:grid;gap:12px;font-size:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <strong id="admin-effects-modal-title">效果編輯器</strong>
          <button type="button" class="button" data-role="close">關閉</button>
        </div>
        <div id="admin-effects-modal-body" style="display:grid;gap:12px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="button" data-role="cancel">取消</button>
          <button type="button" class="button primary" data-role="save">儲存</button>
        </div>
      </div>
    `;
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.dataset.role === "close" || event.target.dataset.role === "cancel") {
        closeModal();
      }
    });
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    const root = ensureModal();
    root.style.display = "none";
    root._onSave = null;
    root.querySelector("#admin-effects-modal-body").innerHTML = "";
  }

  function openModal(title, bodyBuilder, onSave) {
    const root = ensureModal();
    root.querySelector("#admin-effects-modal-title").textContent = title;
    const body = root.querySelector("#admin-effects-modal-body");
    body.innerHTML = "";
    bodyBuilder(body);
    root._onSave = onSave;
    root.style.display = "block";
    root.querySelector('[data-role="save"]').onclick = async () => {
      try {
        await onSave(body);
        closeModal();
      } catch (error) {
        alert(error.message || String(error));
      }
    };
  }

  function normalizedEffect(effect) {
    const value = Number(effect?.params?.value);
    return {
      key: effect?.key || "",
      trigger: effect?.trigger || "passive",
      target: effect?.target || "self",
      chance: Math.max(0, Math.min(100, Number(effect?.chance) || 100)),
      stacks: Math.max(1, Number(effect?.stacks) || 1),
      stackMode: effect?.stackMode || "refresh",
      duration: {
        mode: effect?.duration?.mode || "turns",
        value: Math.max(0, Number(effect?.duration?.value) || 1)
      },
      params: Number.isFinite(value) ? { value } : {},
      notes: effect?.notes || "",
      condition: normalizeConditionObject(effect?.condition)
    };
  }

  function readEffectRow(row) {
    const key = row.querySelector('[data-field="key"]')?.value || "";
    if (!key) return null;
    const value = Number(row.querySelector('[data-field="value"]')?.value);
    const condition = parseConditionJsonText(row.querySelector('[data-field="conditionJson"]')?.value || "");
    return {
      key,
      trigger: row.querySelector('[data-field="trigger"]')?.value || "passive",
      target: row.querySelector('[data-field="target"]')?.value || "self",
      chance: Math.max(0, Math.min(100, Number(row.querySelector('[data-field="chance"]')?.value) || 100)),
      stacks: Math.max(1, Number(row.querySelector('[data-field="stacks"]')?.value) || 1),
      stackMode: row.querySelector('[data-field="stackMode"]')?.value || "refresh",
      duration: {
        mode: row.querySelector('[data-field="durationMode"]')?.value || "turns",
        value: Math.max(0, Number(row.querySelector('[data-field="durationValue"]')?.value) || 1)
      },
      params: Number.isFinite(value) ? { value } : {},
      notes: row.querySelector('[data-field="notes"]')?.value || "",
      condition
    };
  }

  function refreshRowPreview(row) {
    const preview = row.querySelector(".effect-preview");
    if (!preview) return;
    try {
      const effect = readEffectRow(row);
      preview.style.color = "";
      preview.textContent = describeEffect(effect || { key: "" });
    } catch (error) {
      preview.style.color = "var(--danger)";
      preview.textContent = `條件格式錯誤：${error.message || String(error)}`;
    }
  }

  function buildEffectRow(effect, sourceType) {
    const data = normalizedEffect(effect);
    const row = document.createElement("div");
    row.className = "effect-row";
    row.style.cssText = "display:grid;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--line);";
    row.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
        <select class="sheet-input" data-field="key" style="width:100%;">${optionHtml(effectOptionsBySource(sourceType), data.key, "請選擇效果")}</select>
        <button type="button" class="button danger" data-role="delete-effect">刪除</button>
      </div>
      <div class="effect-preview"></div>
      <div style="display:grid;grid-template-columns:120px 120px 130px 120px;gap:8px;align-items:center;">
        <label style="display:grid;gap:4px;"><span class="hint">機率 %</span><input class="sheet-input" data-field="chance" type="number" min="0" max="100" value="${data.chance}" /></label>
        <label style="display:grid;gap:4px;"><span class="hint">數值 value</span><input class="sheet-input" data-field="value" type="number" value="${Number(data.params.value) || 0}" /></label>
        <label style="display:grid;gap:4px;"><span class="hint">持續類型</span><select class="sheet-input" data-field="durationMode">${optionHtml(DURATION_MODES, data.duration.mode)}</select></label>
        <label style="display:grid;gap:4px;"><span class="hint">持續值</span><input class="sheet-input" data-field="durationValue" type="number" min="0" value="${data.duration.value}" /></label>
      </div>
      <div class="effect-advanced" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;align-items:end;">
        <label style="display:grid;gap:4px;"><span class="hint">觸發時機</span><select class="sheet-input" data-field="trigger">${optionHtml(TRIGGERS, data.trigger)}</select></label>
        <label style="display:grid;gap:4px;"><span class="hint">目標</span><select class="sheet-input" data-field="target">${optionHtml(TARGETS, data.target)}</select></label>
        <label style="display:grid;gap:4px;"><span class="hint">疊層值</span><input class="sheet-input" data-field="stacks" type="number" min="1" value="${data.stacks}" /></label>
        <label style="display:grid;gap:4px;"><span class="hint">疊層規則</span><select class="sheet-input" data-field="stackMode">${optionHtml(STACK_MODES, data.stackMode)}</select></label>
        <label style="display:grid;gap:4px;grid-column:span 2;"><span class="hint">備註</span><input class="sheet-input" data-field="notes" placeholder="例如：只對王生效" value="${esc(data.notes)}" /></label>
        <label style="display:grid;gap:4px;grid-column:1 / -1;">
          <span class="hint">限制條件 JSON（選填）</span>
          <textarea class="sheet-input" data-field="conditionJson" rows="5" placeholder='例如：{ "weaponType": "sword_2h" }'>${esc(conditionToJsonText(data.condition))}</textarea>
        </label>
        <div style="grid-column:1 / -1;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select class="sheet-input" data-field="conditionPreset" style="min-width:260px;">${conditionPresetOptionHtml("")}</select>
          <button type="button" class="button" data-role="apply-condition-preset">套用範本</button>
          <button type="button" class="button" data-role="copy-condition-json">複製條件</button>
          <button type="button" class="button" data-role="clear-condition-json">清空條件</button>
          <span class="hint">可先套範本，再改 ITEM_ID 等欄位。</span>
        </div>
      </div>
    `;
    row.querySelectorAll("input,select").forEach((el) => {
      el.addEventListener("input", () => refreshRowPreview(row));
      el.addEventListener("change", () => refreshRowPreview(row));
    });
    const conditionTextarea = row.querySelector('[data-field="conditionJson"]');
    row.querySelector('[data-role="apply-condition-preset"]')?.addEventListener("click", () => {
      const presetId = row.querySelector('[data-field="conditionPreset"]')?.value || "";
      const preset = CONDITION_PRESETS.find((entry) => entry.id === presetId);
      if (!preset || !preset.value || !conditionTextarea) return;
      conditionTextarea.value = conditionToJsonText(preset.value);
      refreshRowPreview(row);
    });
    row.querySelector('[data-role="copy-condition-json"]')?.addEventListener("click", async () => {
      if (!conditionTextarea) return;
      const text = String(conditionTextarea.value || "").trim();
      if (!text) return alert("目前沒有條件可複製");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        conditionTextarea.focus();
        conditionTextarea.select();
      }
    });
    row.querySelector('[data-role="clear-condition-json"]')?.addEventListener("click", () => {
      if (!conditionTextarea) return;
      conditionTextarea.value = "";
      refreshRowPreview(row);
    });
    refreshRowPreview(row);
    return row;
  }

  function buildEffectSection(host, title, effectList, sourceType, defaultMode = "basic") {
    const wrap = document.createElement("section");
    wrap.style.cssText = "display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:10px;";
    wrap.dataset.mode = defaultMode;
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong>${esc(title)}</strong>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="hint">編寫模式</span>
          <span class="mode-chip" data-role="mode" data-mode="basic">基礎</span>
          <span class="mode-chip" data-role="mode" data-mode="advanced">進階</span>
          <button type="button" class="button" data-role="add-effect">+ 新增效果</button>
        </div>
      </div>
      <div class="effect-help hint">基礎模式：填關鍵欄位即可。進階模式：可調觸發、目標、疊層與備註。</div>
      <div class="effect-list" style="display:grid;gap:8px;"></div>
    `;
    const list = wrap.querySelector(".effect-list");

    function syncModeUI() {
      const mode = wrap.dataset.mode || "basic";
      wrap.querySelectorAll('[data-role="mode"]').forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.mode === mode);
      });
    }

    function ensureEmptyHint() {
      if (list.querySelector(".effect-row")) return;
      if (list.querySelector(".effect-empty")) return;
      const empty = document.createElement("p");
      empty.className = "hint effect-empty";
      empty.textContent = "尚未設定效果";
      list.appendChild(empty);
    }

    function addEffect(effect) {
      list.querySelector(".effect-empty")?.remove();
      list.appendChild(buildEffectRow(effect, sourceType));
    }

    (Array.isArray(effectList) ? effectList : []).forEach(addEffect);
    ensureEmptyHint();
    syncModeUI();

    wrap.querySelector('[data-role="add-effect"]').onclick = () => addEffect(null);
    wrap.querySelectorAll('[data-role="mode"]').forEach((chip) => {
      chip.onclick = () => {
        wrap.dataset.mode = chip.dataset.mode;
        syncModeUI();
      };
    });

    list.addEventListener("click", (event) => {
      if (!event.target.matches('[data-role="delete-effect"]')) return;
      event.target.closest(".effect-row")?.remove();
      ensureEmptyHint();
    });

    host.appendChild(wrap);
    return {
      read() {
        return [...list.querySelectorAll(".effect-row")].map(readEffectRow).filter(Boolean);
      },
      addEffects(effects) {
        if (!Array.isArray(effects) || !effects.length) return;
        effects.forEach((effect) => addEffect(effect));
      }
    };
  }

  function summarizeEffectRefs(list) {
    const rows = (Array.isArray(list) ? list : []).slice(0, 3).map((entry) => getEffectLabel(entry?.key)).filter(Boolean);
    if (!rows.length) return "未設定";
    return rows.join("、") + ((list.length || 0) > 3 ? ` 等 ${list.length} 項` : "");
  }

  function buildModuleControl(targetOptions) {
    const node = document.createElement("div");
    node.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;";
    node.innerHTML = `
      <select class="sheet-input" data-field="moduleSelect"><option value="">套用效果模板...</option></select>
      <select class="sheet-input" data-field="moduleTarget">${optionHtml(targetOptions, targetOptions[0][0])}</select>
      <button class="button" data-role="apply-module">套用模板</button>
    `;
    const moduleSelect = node.querySelector('[data-field="moduleSelect"]');
    ensureLookups().then(() => {
      const opts = (effectModules || []).map((m) => [m.id, `${m.name} (${m.category || "module"})`]);
      moduleSelect.innerHTML = optionHtml(opts, "", "請選擇模板");
    }).catch(() => {
      moduleSelect.innerHTML = '<option value="">無法載入模板</option>';
    });
    return node;
  }

  function openItemEditor(initialValue, onSave) {
    openModal("道具效果編輯", (body) => {
      const state = initialValue || {};
      const moduleControl = buildModuleControl([
        ["useEffects", "使用時效果"],
        ["passiveEffects", "裝備被動效果"],
        ["procEffects", "機率觸發效果"],
        ["combatEffects", "戰鬥效果"]
      ]);
      body.appendChild(moduleControl);

      const useSection = buildEffectSection(body, "使用時效果", state.useEffects || [], "item", "basic");
      const passiveSection = buildEffectSection(body, "裝備被動效果", state.passiveEffects || [], "equipment", "basic");
      const procSection = buildEffectSection(body, "機率觸發效果", state.procEffects || [], "equipment", "advanced");
      const combatSection = buildEffectSection(body, "戰鬥效果", state.combatEffects || [], "equipment", "basic");

      moduleControl.querySelector('[data-role="apply-module"]').onclick = () => {
        const selected = moduleControl.querySelector('[data-field="moduleSelect"]').value;
        if (!selected) return alert("請先選擇效果模板");
        const mod = (effectModules || []).find((m) => m.id === selected);
        if (!mod) return alert("找不到指定模板");
        const target = moduleControl.querySelector('[data-field="moduleTarget"]').value || "useEffects";
        const sectionMap = {
          useEffects: useSection,
          passiveEffects: passiveSection,
          procEffects: procSection,
          combatEffects: combatSection
        };
        const section = sectionMap[target];
        if (!section) return alert("套用目標不存在");
        section.addEffects(Array.isArray(mod.effects) ? mod.effects : []);
      };

      body._read = () => ({
        useEffects: useSection.read(),
        passiveEffects: passiveSection.read(),
        procEffects: procSection.read(),
        combatEffects: combatSection.read()
      });
    }, async (body) => onSave(body._read()));
  }

  function buildSkillCard(skill) {
    const card = document.createElement("div");
    card.className = "monster-skill-card";
    card.style.cssText = "display:grid;gap:8px;border:1px dashed var(--line-strong);border-radius:8px;padding:10px;";
    card.innerHTML = `
      <div style="display:grid;grid-template-columns:1.4fr 1fr 90px 100px 100px 1fr auto;gap:6px;align-items:center;">
        <input class="sheet-input" data-field="name" value="${esc(skill?.name || "")}" placeholder="技能名稱" />
        <select class="sheet-input" data-field="trigger">${optionHtml(TRIGGERS, skill?.trigger || "on_attack")}</select>
        <input class="sheet-input" data-field="chance" type="number" min="0" max="100" value="${Number(skill?.chance) || 100}" />
        <input class="sheet-input" data-field="cooldownTurns" type="number" min="0" value="${Number(skill?.cooldownTurns) || 0}" />
        <input class="sheet-input" data-field="priority" type="number" min="0" value="${Number(skill?.priority) || 0}" />
        <select class="sheet-input" data-field="target">${optionHtml(TARGETS, skill?.target || "enemy")}</select>
        <button type="button" class="button danger" data-role="delete-skill">刪除技能</button>
      </div>
      <div class="monster-skill-effects"></div>
    `;
    const section = buildEffectSection(card.querySelector(".monster-skill-effects"), "技能效果", skill?.effects || [], "monster_skill", "advanced");
    card._read = () => ({
      id: skill?.id || "",
      name: card.querySelector('[data-field="name"]')?.value || "",
      trigger: card.querySelector('[data-field="trigger"]')?.value || "on_attack",
      chance: Math.max(0, Math.min(100, Number(card.querySelector('[data-field="chance"]')?.value) || 100)),
      cooldownTurns: Math.max(0, Number(card.querySelector('[data-field="cooldownTurns"]')?.value) || 0),
      priority: Math.max(0, Number(card.querySelector('[data-field="priority"]')?.value) || 0),
      target: card.querySelector('[data-field="target"]')?.value || "enemy",
      effects: section.read()
    });
    return card;
  }

  function openMonsterEditor(initialValue, onSave) {
    openModal("怪物效果與技能", (body) => {
      const state = initialValue || {};
      const moduleControl = buildModuleControl([
        ["passiveEffects", "常駐被動"],
        ["procEffects", "命中觸發效果"],
        ["battleStartEffects", "戰鬥開場效果"],
        ["skills", "新增技能（整包效果）"]
      ]);
      body.appendChild(moduleControl);

      const passiveSection = buildEffectSection(body, "常駐被動", state.passiveEffects || [], "monster_skill", "basic");
      const procSection = buildEffectSection(body, "命中觸發效果", state.procEffects || [], "monster_skill", "advanced");
      const battleSection = buildEffectSection(body, "戰鬥開場效果", state.battleStartEffects || [], "monster_skill", "basic");

      const skillWrap = document.createElement("section");
      skillWrap.style.cssText = "display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:10px;";
      skillWrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>怪物技能</strong>
          <button type="button" class="button" data-role="add-skill">+ 新增技能</button>
        </div>
        <div class="monster-skill-list" style="display:grid;gap:8px;"></div>
      `;
      body.appendChild(skillWrap);
      const skillList = skillWrap.querySelector(".monster-skill-list");
      (Array.isArray(state.skills) ? state.skills : []).forEach((skill) => skillList.appendChild(buildSkillCard(skill)));
      if (!skillList.children.length) {
        const empty = document.createElement("p");
        empty.className = "hint skill-empty";
        empty.textContent = "尚未設定技能";
        skillList.appendChild(empty);
      }

      function addSkill(skillData) {
        skillList.querySelector(".skill-empty")?.remove();
        skillList.appendChild(buildSkillCard(skillData || null));
      }

      skillWrap.querySelector('[data-role="add-skill"]').onclick = () => addSkill(null);
      skillList.addEventListener("click", (event) => {
        if (!event.target.matches('[data-role="delete-skill"]')) return;
        event.target.closest(".monster-skill-card")?.remove();
        if (!skillList.querySelector(".monster-skill-card")) {
          const empty = document.createElement("p");
          empty.className = "hint skill-empty";
          empty.textContent = "尚未設定技能";
          skillList.appendChild(empty);
        }
      });

      moduleControl.querySelector('[data-role="apply-module"]').onclick = () => {
        const selected = moduleControl.querySelector('[data-field="moduleSelect"]').value;
        if (!selected) return alert("請先選擇效果模板");
        const mod = (effectModules || []).find((m) => m.id === selected);
        if (!mod) return alert("找不到指定模板");
        const target = moduleControl.querySelector('[data-field="moduleTarget"]').value || "passiveEffects";
        if (target === "skills") {
          addSkill({
            name: mod.name || "Module Skill",
            trigger: "on_attack",
            chance: 100,
            cooldownTurns: 0,
            priority: 0,
            target: "enemy",
            effects: Array.isArray(mod.effects) ? mod.effects : []
          });
          return;
        }
        const sectionMap = {
          passiveEffects: passiveSection,
          procEffects: procSection,
          battleStartEffects: battleSection
        };
        const section = sectionMap[target];
        if (!section) return alert("套用目標不存在");
        section.addEffects(Array.isArray(mod.effects) ? mod.effects : []);
      };

      body._read = () => ({
        passiveEffects: passiveSection.read(),
        procEffects: procSection.read(),
        battleStartEffects: battleSection.read(),
        skills: [...skillList.querySelectorAll(".monster-skill-card")].map((card, index) => {
          const data = card._read();
          data.id = data.id || `monster_skill_${index + 1}`;
          data.name = data.name || `Monster Skill ${index + 1}`;
          return data;
        })
      });
    }, async (body) => onSave(body._read()));
  }

  function buildNpcEffectRow(effect) {
    const type = effect?.type || "grant_currency";
    const payload = effect?.payload || {};
    const row = document.createElement("div");
    row.className = "npc-effect-row";
    row.style.cssText = "display:grid;gap:8px;border:1px dashed var(--line-strong);border-radius:8px;padding:10px;";
    row.innerHTML = `
      <div style="display:grid;grid-template-columns:220px 1fr auto;gap:8px;align-items:center;">
        <select class="sheet-input" data-field="type">${optionHtml(NPC_EFFECT_TYPES, type)}</select>
        <div class="npc-effect-fields" style="display:grid;gap:8px;"></div>
        <button type="button" class="button danger" data-role="delete-npc-effect">刪除</button>
      </div>
      <div class="hint npc-effect-preview"></div>
    `;

    const fields = row.querySelector(".npc-effect-fields");
    const preview = row.querySelector(".npc-effect-preview");

    function summarizeCurrent() {
      let data = null;
      if (typeof row._read === 'function') {
        data = row._read();
      } else {
        data = { type, payload };
      }
      if (!data) return "未設定";
      if (data.type === "grant_currency") return `發放 ${data.payload.currencyType || "gold"} x ${data.payload.amount || 0}`;
      if (data.type === "grant_item") return `發放道具 ${data.payload.itemId || "未選擇"} x ${data.payload.amount || 1}`;
      if (data.type === "grant_equipment") return `發放裝備 ${data.payload.itemId || "未選擇"} +${data.payload.enhanceLevel || 0}`;
      if (data.type === "take_item") return `消耗道具 ${data.payload.itemId || "未選擇"} +${data.payload.enhanceLevel || 0}`;
      if (data.type === "grant_temporary_quest") return `發放任務 ${data.payload.questId || "未選擇"}（${data.payload.expiresInSec || 0} 秒）`;
      if (data.type === "grant_buff") return describeEffect(data?.payload?.effect || {});
      return data.type;
    }

    function renderFields() {
      const currentType = row.querySelector('[data-field="type"]').value;
      if (currentType === "grant_currency") {
        fields.innerHTML = `
          <div style="display:grid;grid-template-columns:140px 120px;gap:8px;">
            <select class="sheet-input" data-field="currencyType">${optionHtml([["gold", "金幣"], ["diamond", "鑽石"]], payload.currencyType || "gold")}</select>
            <input class="sheet-input" data-field="amount" type="number" value="${Number(payload.amount) || 0}" />
          </div>`;
      } else if (currentType === "grant_item" || currentType === "grant_equipment") {
        const itemSelect = optionHtml((itemOptions || []).map((item) => [item.id, item.name]), payload.itemId || "", "請選擇道具");
        fields.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 120px 120px;gap:8px;">
            <select class="sheet-input" data-field="itemId">${itemSelect}</select>
            <input class="sheet-input" data-field="amount" type="number" min="1" value="${Number(payload.amount) || 1}" />
            <input class="sheet-input" data-field="enhanceLevel" type="number" min="0" value="${Number(payload.enhanceLevel) || 0}" />
          </div>`;
      } else if (currentType === "take_item") {
        const itemSelect = optionHtml((itemOptions || []).map((item) => [item.id, item.name]), payload.itemId || "", "請選擇道具");
        fields.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 120px;gap:8px;">
            <select class="sheet-input" data-field="itemId">${itemSelect}</select>
            <input class="sheet-input" data-field="enhanceLevel" type="number" min="0" value="${Number(payload.enhanceLevel) || 0}" />
          </div>`;
      } else if (currentType === "grant_temporary_quest") {
        const questSelect = optionHtml((questOptions || []).map((quest) => [quest.id, quest.title || quest.name || quest.id]), payload.questId || "", "請選擇任務");
        fields.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 160px;gap:8px;">
            <select class="sheet-input" data-field="questId">${questSelect}</select>
            <input class="sheet-input" data-field="expiresInSec" type="number" min="1" value="${Number(payload.expiresInSec) || 3600}" />
          </div>`;
      } else {
        const effectSelect = optionHtml(effectOptionsBySource("npc_event"), payload.effect?.key || "", "請選擇效果");
        fields.innerHTML = `
          <div style="display:grid;grid-template-columns:1.6fr 1fr 120px 120px 120px;gap:8px;">
            <select class="sheet-input" data-field="effectKey">${effectSelect}</select>
            <select class="sheet-input" data-field="durationMode">${optionHtml(DURATION_MODES, payload.effect?.duration?.mode || "battle")}</select>
            <input class="sheet-input" data-field="durationValue" type="number" min="0" value="${Number(payload.effect?.duration?.value) || 1}" />
            <input class="sheet-input" data-field="stacks" type="number" min="1" value="${Number(payload.effect?.stacks) || 1}" />
            <input class="sheet-input" data-field="value" type="number" value="${Number(payload.effect?.params?.value) || 0}" />
          </div>`;
      }

      fields.querySelectorAll("input,select").forEach((el) => {
        el.addEventListener("input", () => {
          preview.textContent = summarizeCurrent();
        });
        el.addEventListener("change", () => {
          preview.textContent = summarizeCurrent();
        });
      });
      preview.textContent = summarizeCurrent();
    }

    row.querySelector('[data-field="type"]').addEventListener("change", renderFields);
    renderFields();

    row._read = () => {
      const currentType = row.querySelector('[data-field="type"]').value;
      if (currentType === "grant_currency") {
        return {
          type: currentType,
          payload: {
            currencyType: row.querySelector('[data-field="currencyType"]').value || "gold",
            amount: Number(row.querySelector('[data-field="amount"]').value) || 0
          }
        };
      }
      if (currentType === "grant_item" || currentType === "grant_equipment") {
        return {
          type: currentType,
          payload: {
            itemId: row.querySelector('[data-field="itemId"]').value || "",
            amount: Math.max(1, Number(row.querySelector('[data-field="amount"]').value) || 1),
            enhanceLevel: Math.max(0, Number(row.querySelector('[data-field="enhanceLevel"]').value) || 0)
          }
        };
      }
      if (currentType === "take_item") {
        return {
          type: currentType,
          payload: {
            itemId: row.querySelector('[data-field="itemId"]').value || "",
            enhanceLevel: Math.max(0, Number(row.querySelector('[data-field="enhanceLevel"]').value) || 0)
          }
        };
      }
      if (currentType === "grant_temporary_quest") {
        return {
          type: currentType,
          payload: {
            questId: row.querySelector('[data-field="questId"]').value || "",
            expiresInSec: Math.max(1, Number(row.querySelector('[data-field="expiresInSec"]').value) || 3600)
          }
        };
      }
      return {
        type: currentType,
        payload: {
          effect: {
            key: row.querySelector('[data-field="effectKey"]').value || "",
            target: "self",
            trigger: "on_npc_event",
            chance: 100,
            stacks: Math.max(1, Number(row.querySelector('[data-field="stacks"]').value) || 1),
            stackMode: "refresh",
            duration: {
              mode: row.querySelector('[data-field="durationMode"]').value || "battle",
              value: Math.max(0, Number(row.querySelector('[data-field="durationValue"]').value) || 1)
            },
            params: { value: Number(row.querySelector('[data-field="value"]').value) || 0 }
          }
        }
      };
    };
    return row;
  }

  function summarizeNpcEffects(list) {
    const labels = (Array.isArray(list) ? list : []).slice(0, 3).map((entry) => {
      if (entry.type === "grant_currency") return "貨幣";
      if (entry.type === "grant_item") return "道具";
      if (entry.type === "take_item") return "消耗道具";
      if (entry.type === "grant_equipment") return "裝備";
      if (entry.type === "grant_temporary_quest") return "任務";
      if (entry.type === "grant_buff") return getEffectLabel(entry?.payload?.effect?.key) || "Buff";
      return entry.type;
    }).filter(Boolean);
    if (!labels.length) return "未設定";
    return labels.join("、") + ((list.length || 0) > 3 ? ` 等 ${list.length} 項` : "");
  }

  // --- NPC 分類功能 -------------------------------------------------------
  const NPC_CATEGORIES = [
    { key: 'grant_buff', label: '給予 Buff' },
    { key: 'grant_currency', label: '發放貨幣' },
    { key: 'grant_item', label: '發放道具' },
    { key: 'grant_equipment', label: '發放裝備' },
    { key: 'take_item', label: '消耗道具（交換）' },
    { key: 'grant_temporary_quest', label: '發放限時任務' }
  ];

  function classifyNpcEffects(effects) {
    const found = new Set();
    (Array.isArray(effects) ? effects : []).forEach((e) => {
      if (!e || !e.type) return;
      // map direct types
      if (NPC_CATEGORIES.some((c) => c.key === e.type)) {
        found.add(e.type);
        return;
      }
      // grant_buff can appear as payload.effect when type is grant_buff
      if (e.type === 'grant_buff') found.add('grant_buff');
    });
    return [...found];
  }

  function classifyNpcEvent(event) {
    const found = new Set();
    if (!event || !Array.isArray(event.nodes)) return [];
    event.nodes.forEach((node) => {
      if (!node || !Array.isArray(node.options)) return;
      node.options.forEach((opt) => {
        if (!opt) return;
        const effects = opt.effects || [];
        classifyNpcEffects(effects).forEach((k) => found.add(k));
      });
    });
    return [...found];
  }

  function buildCategoryTagsFromKeys(keys) {
    if (!Array.isArray(keys) || !keys.length) return '';
    const labels = keys.map((k) => {
      const cat = NPC_CATEGORIES.find((c) => c.key === k);
      return cat ? `<span class="mode-chip" style="margin-right:6px;">${esc(cat.label)}</span>` : '';
    }).filter(Boolean);
    return labels.join(' ');
  }


  function openNpcOptionEditor(initialValue, onSave) {
    openModal("NPC 選項效果", (body) => {
      const section = document.createElement("section");
      section.style.cssText = "display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:10px;";
      section.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>效果列表</strong>
          <button type="button" class="button" data-role="add-npc-effect">+ 新增效果</button>
        </div>
        <div class="npc-effect-list" style="display:grid;gap:8px;"></div>
      `;
      body.appendChild(section);
      // 顯示分類標籤（根據 initialValue）
      const categoryBar = document.createElement('div');
      categoryBar.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
      categoryBar.innerHTML = `<strong>分類：</strong><span class="npc-category-tags">${buildCategoryTagsFromKeys(classifyNpcEvent(initialValue).map(k=>k))}</span>`;
      body.insertBefore(categoryBar, section);
      const list = section.querySelector(".npc-effect-list");
      (Array.isArray(initialValue) ? initialValue : []).forEach((entry) => list.appendChild(buildNpcEffectRow(entry)));
      if (!list.children.length) {
        const empty = document.createElement("p");
        empty.className = "hint npc-effect-empty";
        empty.textContent = "尚未設定效果";
        list.appendChild(empty);
      }
      // 當效果變動時更新分類標籤
      function refreshCategoryTags() {
        const effects = [...list.querySelectorAll('.npc-effect-row')].map(r => r._read()).filter(Boolean);
        const keys = classifyNpcEffects(effects);
        categoryBar.querySelector('.npc-category-tags').innerHTML = buildCategoryTagsFromKeys(keys);
      }
      list.addEventListener('input', refreshCategoryTags);
      list.addEventListener('change', refreshCategoryTags);
      section.querySelector('[data-role="add-npc-effect"]').onclick = () => {
        list.querySelector(".npc-effect-empty")?.remove();
        list.appendChild(buildNpcEffectRow(null));
      };
      list.addEventListener("click", (event) => {
        if (!event.target.matches('[data-role="delete-npc-effect"]')) return;
        event.target.closest(".npc-effect-row")?.remove();
        if (!list.querySelector(".npc-effect-row")) {
          const empty = document.createElement("p");
          empty.className = "hint npc-effect-empty";
          empty.textContent = "尚未設定效果";
          list.appendChild(empty);
        }
      });
      body._read = () => [...list.querySelectorAll(".npc-effect-row")].map((row) => row._read()).filter((entry) => entry?.type);
    }, async (body) => onSave(body._read()));
  }

  function summarizeItemDraft(draft) {
    const groups = [];
    if (draft?.useEffects?.length) groups.push(`使用 ${summarizeEffectRefs(draft.useEffects)}`);
    if (draft?.passiveEffects?.length) groups.push(`被動 ${summarizeEffectRefs(draft.passiveEffects)}`);
    if (draft?.procEffects?.length) groups.push(`觸發 ${summarizeEffectRefs(draft.procEffects)}`);
    if (draft?.combatEffects?.length) groups.push(`戰鬥 ${summarizeEffectRefs(draft.combatEffects)}`);
    return groups.join(" / ") || "未設定";
  }

  function summarizeMonsterDraft(draft) {
    const groups = [];
    if (draft?.passiveEffects?.length) groups.push(`被動 ${draft.passiveEffects.length}`);
    if (draft?.procEffects?.length) groups.push(`觸發 ${draft.procEffects.length}`);
    if (draft?.battleStartEffects?.length) groups.push(`開場 ${draft.battleStartEffects.length}`);
    if (draft?.skills?.length) groups.push(`技能 ${draft.skills.length}`);
    return groups.join(" / ") || "未設定";
  }

  window.adminEffects = {
    ensureLookups,
    encodeState,
    decodeState,
    summarizeEffectRefs,
    summarizeItemDraft,
    summarizeMonsterDraft,
    summarizeNpcEffects,
    classifyNpcEffects,
    classifyNpcEvent,
    openItemEditor,
    openMonsterEditor,
    openNpcOptionEditor
  };

  window.adminEffects.buildEffectRowElement = function (effect, sourceType) {
    return buildEffectRow(effect, sourceType);
  };

  window.adminEffects.readEffectRowElement = function (rowElement) {
    return readEffectRow(rowElement);
  };
})();
