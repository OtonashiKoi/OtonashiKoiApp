(function () {
  const WEAPON_OPTIONS = [
    ["", "未綁定武器"],
    ["sword_1h", "單手劍"],
    ["sword_2h", "雙手劍"],
    ["dagger", "匕首"],
    ["mace_1h", "單手鎚"],
    ["mace_2h", "雙手鎚"],
    ["axe_1h", "單手斧"],
    ["axe_2h", "雙手斧"],
    ["staff_1h", "單手杖"],
    ["staff_2h", "雙手杖"],
    ["bow", "弓"]
  ];

  const OFFHAND_MODE_OPTIONS = [
    ["any", "副手不限"],
    ["none", "必須無副手"],
    ["specific", "指定副手類型"]
  ];

  const OFFHAND_TYPE_OPTIONS = [
    ["", "未指定副手類型"],
    ["offhand_sword", "副手劍"],
    ["offhand_dagger", "副手匕首"],
    ["offhand_mace", "副手鎚"]
  ];

  const CHARACTER_ACTIONS = [
    { key: "idle", label: "站立不動", frameCount: 2, fps: 6, loop: true },
    { key: "prepare_attack", label: "準備攻擊動作", frameCount: 2, fps: 8, loop: false },
    { key: "run", label: "跑步", frameCount: 4, fps: 10, loop: true },
    { key: "attack_1", label: "戰鬥1 / 攻擊1", frameCount: 4, fps: 10, loop: false },
    { key: "attack_2", label: "戰鬥2 / 攻擊2", frameCount: 4, fps: 10, loop: false },
    { key: "attack_3", label: "戰鬥3 / 攻擊3", frameCount: 4, fps: 10, loop: false },
    { key: "critical_1", label: "爆擊1", frameCount: 4, fps: 10, loop: false },
    { key: "critical_2", label: "爆擊2", frameCount: 4, fps: 10, loop: false },
    { key: "walk", label: "走路", frameCount: 4, fps: 8, loop: true }
  ];

  const MONSTER_ACTIONS = [
    { key: "idle", label: "待機", frameCount: 6, fps: 8, loop: true },
    { key: "move", label: "移動", frameCount: 6, fps: 8, loop: true },
    { key: "attack_melee", label: "近戰攻擊", frameCount: 8, fps: 10, loop: false },
    { key: "attack_range", label: "遠程攻擊", frameCount: 8, fps: 10, loop: false },
    { key: "skill_cast", label: "施法/蓄力", frameCount: 6, fps: 8, loop: false },
    { key: "skill_release", label: "技能施放", frameCount: 8, fps: 10, loop: false },
    { key: "summon", label: "召喚", frameCount: 8, fps: 10, loop: false },
    { key: "roar", label: "吼叫", frameCount: 6, fps: 8, loop: false },
    { key: "hit", label: "受擊", frameCount: 4, fps: 10, loop: false },
    { key: "stun", label: "暈眩", frameCount: 4, fps: 6, loop: false },
    { key: "enraged", label: "狂暴", frameCount: 6, fps: 10, loop: true },
    { key: "death", label: "死亡", frameCount: 8, fps: 8, loop: false }
  ];

  const state = {
    templates: [],
    monsters: [],
    selectedTemplateId: null,
    preview: {
      actionKey: "",
      image: null,
      rafId: null,
      frame: 0,
      elapsedMs: 0,
      lastTs: 0
    }
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function optionHtml(options, selected) {
    return options
      .map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(selected || "") ? "selected" : ""}>${esc(label)}</option>`)
      .join("");
  }

  function getActionDefs(templateType) {
    return templateType === "monster" ? MONSTER_ACTIONS : CHARACTER_ACTIONS;
  }

  function buildDefaultActions(templateType) {
    const actions = {};
    for (const def of getActionDefs(templateType)) {
      actions[def.key] = { imageUrl: null, frameCount: def.frameCount, fps: def.fps, loop: def.loop };
    }
    return actions;
  }

  function newTemplate(templateType = "character") {
    const id = `tpl_${Date.now()}`;
    return {
      id,
      name: `新模板_${id.slice(-4)}`,
      templateType,
      bindWeaponType: null,
      bindOffhandMode: "any",
      bindOffhandType: null,
      bindMonsterId: null,
      note: "",
      actions: buildDefaultActions(templateType)
    };
  }

  function getSelectedTemplate() {
    return state.templates.find((t) => t.id === state.selectedTemplateId) || null;
  }

  function log(msg) {
    if (window.logActivity) window.logActivity(msg);
  }

  function stopPreviewLoop() {
    if (state.preview.rafId) cancelAnimationFrame(state.preview.rafId);
    state.preview.rafId = null;
    state.preview.lastTs = 0;
    state.preview.elapsedMs = 0;
    state.preview.frame = 0;
  }

  function loadPreviewImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function drawPreviewFrame() {
    const canvas = byId("animation-preview-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const template = getSelectedTemplate();
    if (!template) return;
    const slot = template.actions?.[state.preview.actionKey];
    const img = state.preview.image;
    if (!slot || !img) return;

    const frameCount = Math.max(1, Number(slot.frameCount) || 1);
    const frameWidth = Math.max(1, Math.floor(img.width / frameCount));
    const frameHeight = img.height;
    const frameIndex = Math.min(frameCount - 1, Math.max(0, state.preview.frame));
    const sx = frameIndex * frameWidth;

    const scale = Math.min(canvas.width / frameWidth, canvas.height / frameHeight) * 0.88;
    const dw = frameWidth * scale;
    const dh = frameHeight * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, 0, frameWidth, frameHeight, dx, dy, dw, dh);
  }

  function tickPreview(ts) {
    const template = getSelectedTemplate();
    if (!template) return;
    const slot = template.actions?.[state.preview.actionKey];
    if (!slot || !state.preview.image) return;

    if (!state.preview.lastTs) state.preview.lastTs = ts;
    const dt = ts - state.preview.lastTs;
    state.preview.lastTs = ts;
    state.preview.elapsedMs += dt;

    const frameCount = Math.max(1, Number(slot.frameCount) || 1);
    const fps = Math.max(1, Number(slot.fps) || 10);
    const frameMs = 1000 / fps;

    while (state.preview.elapsedMs >= frameMs) {
      state.preview.elapsedMs -= frameMs;
      if (state.preview.frame < frameCount - 1) {
        state.preview.frame += 1;
      } else if (slot.loop) {
        state.preview.frame = 0;
      }
    }

    drawPreviewFrame();
    state.preview.rafId = requestAnimationFrame(tickPreview);
  }

  async function refreshPreview() {
    stopPreviewLoop();
    const template = getSelectedTemplate();
    const meta = byId("animation-preview-meta");
    if (!template) {
      if (meta) meta.textContent = "尚未選擇模板";
      drawPreviewFrame();
      return;
    }

    const actionKey = byId("animation-preview-action")?.value || "";
    state.preview.actionKey = actionKey;
    const slot = template.actions?.[actionKey];
    if (!slot || !slot.imageUrl) {
      state.preview.image = null;
      if (meta) meta.textContent = "此動作尚未設定圖片";
      drawPreviewFrame();
      return;
    }

    const image = await loadPreviewImage(slot.imageUrl);
    state.preview.image = image;
    if (!image) {
      if (meta) meta.textContent = "圖片載入失敗";
      drawPreviewFrame();
      return;
    }

    if (meta) {
      meta.textContent = `${actionKey} | ${slot.frameCount} 幀 | ${slot.fps} FPS | ${slot.loop ? "循環" : "單次"}`;
    }
    state.preview.frame = 0;
    drawPreviewFrame();
    state.preview.rafId = requestAnimationFrame(tickPreview);
  }

  function renderTemplateList() {
    const root = byId("animation-template-list");
    if (!root) return;
    if (!state.templates.length) {
      root.innerHTML = `<p class="hint">目前沒有模板，請按「新增模板」。</p>`;
      return;
    }

    root.innerHTML = state.templates
      .map((tpl) => {
        const active = tpl.id === state.selectedTemplateId;
        return `
          <button class="button ${active ? "primary" : ""} anim-template-btn" data-template-id="${esc(tpl.id)}" style="width:100%;text-align:left;margin-bottom:6px;">
            <div style="font-weight:700;">${esc(tpl.name)}</div>
            <div style="font-size:12px;opacity:0.85;">${esc(tpl.templateType)} | ${esc(tpl.id)}</div>
          </button>
        `;
      })
      .join("");
  }

  function renderPreviewActionSelect(template) {
    const sel = byId("animation-preview-action");
    if (!sel) return;
    const defs = getActionDefs(template?.templateType || "character");
    sel.innerHTML = defs.map((def) => `<option value="${esc(def.key)}">${esc(def.label)}</option>`).join("");
    if (!sel.value && defs[0]) sel.value = defs[0].key;
  }

  function renderActionSlots(template) {
    const root = byId("animation-action-slots");
    if (!root) return;
    const defs = getActionDefs(template.templateType);
    root.innerHTML = defs
      .map((def) => {
        const slot = template.actions?.[def.key] || { imageUrl: "", frameCount: def.frameCount, fps: def.fps, loop: def.loop };
        return `
          <div class="access-card" data-action-row="${esc(def.key)}" style="padding:10px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong>${esc(def.label)}</strong>
              <small style="opacity:0.75;">${esc(def.key)}</small>
            </div>
            <input class="sheet-input" data-field="imageUrl" value="${esc(slot.imageUrl || "")}" placeholder="Sprite Sheet URL (橫向)" />
            <div style="display:flex;gap:8px;margin-top:8px;">
              <input class="sheet-input" data-field="frameCount" type="number" min="1" value="${Number(slot.frameCount) || 1}" placeholder="幀數" />
              <input class="sheet-input" data-field="fps" type="number" min="1" value="${Number(slot.fps) || 10}" placeholder="FPS" />
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
                <input data-field="loop" type="checkbox" ${slot.loop ? "checked" : ""} />
                循環
              </label>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button class="button anim-upload-btn" data-action-key="${esc(def.key)}">上傳圖片</button>
              <button class="button anim-clear-btn" data-action-key="${esc(def.key)}">清空</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderEditor() {
    const template = getSelectedTemplate();
    const empty = byId("animation-editor-empty");
    const editor = byId("animation-editor");
    if (!empty || !editor) return;

    if (!template) {
      empty.style.display = "";
      editor.style.display = "none";
      renderPreviewActionSelect(null);
      refreshPreview();
      return;
    }

    empty.style.display = "none";
    editor.style.display = "";

    byId("anim-template-id").value = template.id || "";
    byId("anim-template-name").value = template.name || "";
    byId("anim-template-type").value = template.templateType || "character";
    byId("anim-template-note").value = template.note || "";

    byId("anim-bind-weapon").innerHTML = optionHtml(WEAPON_OPTIONS, template.bindWeaponType || "");
    byId("anim-bind-offhand-mode").innerHTML = optionHtml(OFFHAND_MODE_OPTIONS, template.bindOffhandMode || "any");
    byId("anim-bind-offhand-type").innerHTML = optionHtml(OFFHAND_TYPE_OPTIONS, template.bindOffhandType || "");

    const monsterOptions = [["", "未綁定怪物"], ...state.monsters.map((m) => [m.id, m.name])];
    byId("anim-bind-monster-id").innerHTML = optionHtml(monsterOptions, template.bindMonsterId || "");

    const bindCharacter = byId("anim-bind-character");
    const bindMonster = byId("anim-bind-monster");
    const isMonster = template.templateType === "monster";
    bindCharacter.style.display = isMonster ? "none" : "grid";
    bindMonster.style.display = isMonster ? "block" : "none";

    renderActionSlots(template);
    renderPreviewActionSelect(template);
    refreshPreview();
  }

  function renderAll() {
    renderTemplateList();
    renderEditor();
  }

  async function loadBootstrap() {
    const data = await window.adminCore.request("/admin/animation-studio/bootstrap");
    state.templates = Array.isArray(data.templates) ? data.templates : [];
    state.monsters = Array.isArray(data.monsters) ? data.monsters : [];
    if (!state.templates.find((tpl) => tpl.id === state.selectedTemplateId)) {
      state.selectedTemplateId = state.templates[0]?.id || null;
    }
    renderAll();
  }

  async function saveAllTemplates() {
    const payload = { templates: state.templates };
    await window.adminCore.request("/admin/animation-studio/templates", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    log("已儲存動畫模板");
  }

  function updateTemplateFromHeaderFields() {
    const template = getSelectedTemplate();
    if (!template) return;
    template.id = byId("anim-template-id").value.trim() || template.id;
    template.name = byId("anim-template-name").value.trim() || template.name;
    template.templateType = byId("anim-template-type").value === "monster" ? "monster" : "character";
    template.note = byId("anim-template-note").value || "";
    template.bindWeaponType = byId("anim-bind-weapon").value || null;
    template.bindOffhandMode = byId("anim-bind-offhand-mode").value || "any";
    template.bindOffhandType = byId("anim-bind-offhand-type").value || null;
    template.bindMonsterId = byId("anim-bind-monster-id").value || null;

    const defs = getActionDefs(template.templateType);
    if (!template.actions || typeof template.actions !== "object") template.actions = {};
    for (const def of defs) {
      if (!template.actions[def.key]) template.actions[def.key] = { imageUrl: null, frameCount: def.frameCount, fps: def.fps, loop: def.loop };
    }
  }

  async function uploadActionImage(actionKey, file) {
    const form = new FormData();
    form.append("image", file);
    const response = await fetch("/admin/animation-studio/template-image", {
      method: "POST",
      headers: { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` },
      body: form
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.status !== "ok") {
      throw new Error(json?.error?.message || json?.message || `Upload failed: ${response.status}`);
    }
    const template = getSelectedTemplate();
    if (!template || !template.actions?.[actionKey]) return;
    template.actions[actionKey].imageUrl = json.data?.imageUrl || null;
    renderEditor();
  }

  function bindEvents() {
    byId("animation-reload")?.addEventListener("click", async () => {
      await loadBootstrap();
      log("已重新載入動畫工坊資料");
    });

    byId("animation-new-template")?.addEventListener("click", () => {
      const template = newTemplate("character");
      state.templates.push(template);
      state.selectedTemplateId = template.id;
      renderAll();
      log("已新增模板");
    });

    byId("animation-save-all")?.addEventListener("click", saveAllTemplates);

    byId("animation-template-list")?.addEventListener("click", (event) => {
      const btn = event.target.closest(".anim-template-btn");
      if (!btn) return;
      state.selectedTemplateId = btn.dataset.templateId;
      renderAll();
    });

    ["anim-template-id", "anim-template-name", "anim-template-type", "anim-template-note", "anim-bind-weapon", "anim-bind-offhand-mode", "anim-bind-offhand-type", "anim-bind-monster-id"].forEach((id) => {
      const el = byId(id);
      if (!el) return;
      el.addEventListener("change", () => {
        updateTemplateFromHeaderFields();
        renderAll();
      });
      el.addEventListener("input", () => {
        if (id === "anim-template-name" || id === "anim-template-id" || id === "anim-template-note") {
          updateTemplateFromHeaderFields();
          renderTemplateList();
        }
      });
    });

    byId("animation-action-slots")?.addEventListener("input", (event) => {
      const row = event.target.closest("[data-action-row]");
      if (!row) return;
      const template = getSelectedTemplate();
      if (!template) return;
      const key = row.dataset.actionRow;
      const slot = template.actions?.[key];
      if (!slot) return;
      slot.imageUrl = row.querySelector('[data-field="imageUrl"]')?.value?.trim() || null;
      slot.frameCount = Math.max(1, Number(row.querySelector('[data-field="frameCount"]')?.value || 1));
      slot.fps = Math.max(1, Number(row.querySelector('[data-field="fps"]')?.value || 10));
      slot.loop = !!row.querySelector('[data-field="loop"]')?.checked;
      refreshPreview();
    });

    byId("animation-action-slots")?.addEventListener("click", async (event) => {
      const uploadBtn = event.target.closest(".anim-upload-btn");
      if (uploadBtn) {
        const actionKey = uploadBtn.dataset.actionKey;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            uploadBtn.disabled = true;
            uploadBtn.textContent = "上傳中...";
            await uploadActionImage(actionKey, file);
          } catch (err) {
            log(`上傳失敗：${err.message}`);
          } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = "上傳圖片";
          }
        };
        input.click();
        return;
      }

      const clearBtn = event.target.closest(".anim-clear-btn");
      if (clearBtn) {
        const template = getSelectedTemplate();
        if (!template) return;
        const actionKey = clearBtn.dataset.actionKey;
        if (template.actions?.[actionKey]) {
          template.actions[actionKey].imageUrl = null;
          renderEditor();
        }
      }
    });

    byId("animation-preview-action")?.addEventListener("change", refreshPreview);
  }

  document.addEventListener("adminConnected", () => {
    loadBootstrap().catch((err) => log(`動畫工坊載入失敗：${err.message}`));
  });

  bindEvents();
})();
