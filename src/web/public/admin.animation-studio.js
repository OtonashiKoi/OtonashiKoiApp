(function () {
  const WEAPON_OPTIONS = [
    ["", "未指定武器"],
    ["sword_1h", "單手劍"],
    ["sword_2h", "雙手劍"],
    ["dagger", "匕首"],
    ["mace_1h", "單手鎚"],
    ["mace_2h", "雙手鎚"],
    ["axe_1h", "單手斧"],
    ["axe_2h", "雙手斧"],
    ["staff_1h", "單手杖"],
    ["staff_2h", "雙手杖"],
    ["bow", "弓"],
  ];

  const OFFHAND_MODE_OPTIONS = [
    ["any", "不限副手"],
    ["none", "必須無副手"],
    ["specific", "指定副手"],
  ];

  const OFFHAND_TYPE_OPTIONS = [
    ["", "未指定副手類型"],
    ["offhand_sword", "副手劍"],
    ["offhand_dagger", "副手匕首"],
    ["offhand_mace", "副手鎚"],
  ];

  const CHARACTER_ACTIONS = [
    { key: "idle", label: "站立不動", frameCount: 2, fps: 6, loop: true },
    { key: "prepare_attack", label: "準備攻擊", frameCount: 2, fps: 8, loop: false },
    { key: "run", label: "跑步", frameCount: 4, fps: 10, loop: true },
    { key: "attack_1", label: "攻擊1", frameCount: 4, fps: 10, loop: false },
    { key: "attack_2", label: "攻擊2", frameCount: 4, fps: 10, loop: false },
    { key: "attack_3", label: "攻擊3", frameCount: 4, fps: 10, loop: false },
    { key: "critical_1", label: "爆擊1", frameCount: 4, fps: 10, loop: false },
    { key: "critical_2", label: "爆擊2", frameCount: 4, fps: 10, loop: false },
    { key: "walk", label: "走路", frameCount: 4, fps: 8, loop: true },
  ];

  const MONSTER_ACTIONS = [
    { key: "idle", label: "待機", frameCount: 6, fps: 8, loop: true },
    { key: "move", label: "移動", frameCount: 6, fps: 8, loop: true },
    { key: "attack_melee", label: "近戰攻擊", frameCount: 8, fps: 10, loop: false },
    { key: "attack_range", label: "遠程攻擊", frameCount: 8, fps: 10, loop: false },
    { key: "skill_cast", label: "施法蓄力", frameCount: 6, fps: 8, loop: false },
    { key: "skill_release", label: "技能施放", frameCount: 8, fps: 10, loop: false },
    { key: "summon", label: "召喚", frameCount: 8, fps: 10, loop: false },
    { key: "roar", label: "吼叫", frameCount: 6, fps: 8, loop: false },
    { key: "hit", label: "受擊", frameCount: 4, fps: 10, loop: false },
    { key: "stun", label: "暈眩", frameCount: 4, fps: 6, loop: false },
    { key: "enraged", label: "狂暴", frameCount: 6, fps: 10, loop: true },
    { key: "death", label: "死亡", frameCount: 8, fps: 8, loop: false },
  ];

  const state = {
    templates: [],
    monsters: [],
    selectedTemplateId: null,
    preview: {
      actionKey: "",
      images: [],
      image: null,
      rafId: null,
      frame: 0,
      elapsedMs: 0,
      lastTs: 0,
    },
    isSaving: false,
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

  function log(message) {
    if (window.logActivity) window.logActivity(message);
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
      actions[def.key] = {
        imageUrl: null,
        frameImages: [],
        frameCount: def.frameCount,
        fps: def.fps,
        loop: def.loop,
      };
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
      actions: buildDefaultActions(templateType),
    };
  }

  function cloneTemplate(template) {
    const copied = JSON.parse(JSON.stringify(template || {}));
    copied.id = `tpl_${Date.now()}`;
    copied.name = `${template?.name || "模板"}_副本`;
    return copied;
  }

  function getSelectedTemplate() {
    if (!Array.isArray(state.templates) || state.templates.length === 0) {
      state.selectedTemplateId = null;
      return null;
    }
    const matched = state.templates.find((t) => t.id === state.selectedTemplateId) || null;
    if (matched) return matched;
    state.selectedTemplateId = state.templates[0].id;
    return state.templates[0];
  }

  function getFrameImages(slot) {
    if (!slot) return [];
    return Array.isArray(slot.frameImages)
      ? slot.frameImages.map((url) => String(url || "").trim()).filter(Boolean)
      : [];
  }

  function setFrameCount(template, actionKey, count) {
    const slot = template?.actions?.[actionKey];
    if (!slot) return;
    const nextCount = Math.max(1, Number(count) || 1);
    const old = Array.isArray(slot.frameImages) ? slot.frameImages : [];
    const next = new Array(nextCount).fill("");
    for (let i = 0; i < Math.min(old.length, nextCount); i += 1) {
      next[i] = old[i] || "";
    }
    slot.frameImages = next;
    slot.frameCount = nextCount;
  }

  async function loadPreviewImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function stopPreviewLoop() {
    if (state.preview.rafId) cancelAnimationFrame(state.preview.rafId);
    state.preview.rafId = null;
    state.preview.lastTs = 0;
    state.preview.elapsedMs = 0;
    state.preview.frame = 0;
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
    if (!slot) return;

    if (state.preview.images.length) {
      const index = Math.min(state.preview.images.length - 1, Math.max(0, state.preview.frame));
      const img = state.preview.images[index];
      if (!img) return;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.88;
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (canvas.width - dw) / 2;
      const dy = (canvas.height - dh) / 2;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, dx, dy, dw, dh);
      return;
    }

    if (!state.preview.image) return;
    const img = state.preview.image;
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
    if (!slot) return;

    if (!state.preview.lastTs) state.preview.lastTs = ts;
    const dt = ts - state.preview.lastTs;
    state.preview.lastTs = ts;
    state.preview.elapsedMs += dt;

    const frameImages = getFrameImages(slot);
    const frameCount = frameImages.length || Math.max(1, Number(slot.frameCount) || 1);
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
      state.preview.images = [];
      state.preview.image = null;
      if (meta) meta.textContent = "尚未選擇模板";
      drawPreviewFrame();
      return;
    }

    const actionKey = byId("animation-preview-action")?.value || "";
    state.preview.actionKey = actionKey;
    const slot = template.actions?.[actionKey];
    const frameImages = getFrameImages(slot);

    if (!slot || (!frameImages.length && !slot.imageUrl)) {
      state.preview.images = [];
      state.preview.image = null;
      if (meta) meta.textContent = "此動作尚未設定圖片";
      drawPreviewFrame();
      return;
    }

    if (frameImages.length) {
      const loaded = (await Promise.all(frameImages.map((url) => loadPreviewImage(url)))).filter(Boolean);
      state.preview.images = loaded;
      state.preview.image = null;
      if (!loaded.length) {
        if (meta) meta.textContent = "幀圖載入失敗";
        drawPreviewFrame();
        return;
      }
      if (meta) {
        meta.textContent = `${actionKey} | ${loaded.length} 張 | ${slot.fps} FPS | ${slot.loop ? "循環" : "單次"}`;
      }
      state.preview.frame = 0;
      drawPreviewFrame();
      state.preview.rafId = requestAnimationFrame(tickPreview);
      return;
    }

    const image = await loadPreviewImage(slot.imageUrl);
    state.preview.images = [];
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
      root.innerHTML = '<p class="hint">目前沒有模板，請按「新增模板」。</p>';
      return;
    }

    root.innerHTML = state.templates
      .map((tpl) => {
        const active = tpl.id === state.selectedTemplateId;
        const displayName = String(tpl.name || "").trim() || "(未命名模板)";
        const displayNote = String(tpl.note || "").trim();
        const shortType = tpl.templateType === "monster" ? "MONSTER" : "CHARACTER";
        const shortId = String(tpl.id || "").slice(-8);
        return `
          <button class="button ${active ? "primary" : ""} anim-template-btn" data-template-id="${esc(tpl.id)}" style="max-width:260px;text-align:left;margin-bottom:6px;">
            <div style="font-weight:700;">${esc(displayName)}</div>
            <div style="font-size:12px;opacity:0.85;">${esc(shortType)} | ${esc(shortId)}</div>
            <div style="font-size:12px;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">備註：${esc(displayNote || "（無）")}</div>
          </button>
        `;
      })
      .join("");
  }

  function renderPreviewActionSelect(template) {
    const sel = byId("animation-preview-action");
    if (!sel) return;
    const defs = getActionDefs(template?.templateType || "character");
    const previous = sel.value;
    sel.innerHTML = defs.map((def) => `<option value="${esc(def.key)}">${esc(def.label)}</option>`).join("");
    sel.value = defs.some((def) => def.key === previous) ? previous : defs[0]?.key || "";
  }

  function renderFrameGrid(actionKey, slot) {
    const frameCount = Math.max(1, Number(slot.frameCount) || 1);
    const frameImages = Array.isArray(slot.frameImages) ? slot.frameImages : [];
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:8px;">';
    for (let i = 0; i < frameCount; i += 1) {
      const url = frameImages[i] || "";
      html += `
        <div class="access-card" style="padding:8px;">
          <div style="font-size:12px;opacity:0.8;margin-bottom:6px;">第 ${i + 1} 幀</div>
          <div style="height:74px;border:1px solid rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#080d18;">
            ${url ? `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:contain;" />` : `<span class="hint">未上傳</span>`}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="button anim-upload-frame-btn" data-action-key="${esc(actionKey)}" data-frame-index="${i}">上傳</button>
            <button class="button anim-clear-frame-btn" data-action-key="${esc(actionKey)}" data-frame-index="${i}">清除</button>
          </div>
        </div>
      `;
    }
    html += "</div>";
    return html;
  }

  function renderActionSlots(template) {
    const root = byId("animation-action-slots");
    if (!root) return;
    const defs = getActionDefs(template.templateType);

    root.innerHTML = defs
      .map((def) => {
        const slot = template.actions?.[def.key] || {
          imageUrl: "",
          frameImages: [],
          frameCount: def.frameCount,
          fps: def.fps,
          loop: def.loop,
        };
        if (!Array.isArray(slot.frameImages)) slot.frameImages = [];
        if (!slot.frameImages.length && Number(slot.frameCount) > 0) {
          slot.frameImages = new Array(Number(slot.frameCount)).fill("");
        }

        return `
          <div class="access-card" data-action-row="${esc(def.key)}" style="padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong>${esc(def.label)}</strong>
              <small style="opacity:0.75;">${esc(def.key)}</small>
            </div>

            <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
              <label style="min-width:110px;">
                <span>幀數</span>
                <input class="sheet-input" data-field="frameCount" type="number" min="1" value="${Number(slot.frameCount) || 1}" />
              </label>
              <label style="min-width:110px;">
                <span>FPS</span>
                <input class="sheet-input" data-field="fps" type="number" min="1" value="${Number(slot.fps) || 10}" />
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;padding-bottom:8px;">
                <input data-field="loop" type="checkbox" ${slot.loop ? "checked" : ""} />
                循環
              </label>
              <button class="button anim-save-action-btn" data-action-key="${esc(def.key)}">存檔此動作</button>
              <button class="button anim-apply-preview-btn" data-action-key="${esc(def.key)}">套用到右側預覽</button>
              <button class="button anim-clear-action-btn" data-action-key="${esc(def.key)}">清空此動作</button>
            </div>

            ${renderFrameGrid(def.key, slot)}
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
    const nameInput = byId("anim-template-name");
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = template.name || "";
    }
    byId("anim-template-type").value = template.templateType || "character";
    byId("anim-template-note").value = template.note || "";

    byId("anim-bind-weapon").innerHTML = optionHtml(WEAPON_OPTIONS, template.bindWeaponType || "");
    byId("anim-bind-offhand-mode").innerHTML = optionHtml(OFFHAND_MODE_OPTIONS, template.bindOffhandMode || "any");
    byId("anim-bind-offhand-type").innerHTML = optionHtml(OFFHAND_TYPE_OPTIONS, template.bindOffhandType || "");

    const monsterOptions = [["", "未指定怪物"], ...state.monsters.map((m) => [m.id, m.name])];
    byId("anim-bind-monster-id").innerHTML = optionHtml(monsterOptions, template.bindMonsterId || "");

    const bindCharacter = byId("anim-bind-character");
    const bindMonster = byId("anim-bind-monster");
    const isMonster = template.templateType === "monster";
    bindCharacter.style.display = isMonster ? "none" : "block";
    bindMonster.style.display = isMonster ? "block" : "none";

    renderActionSlots(template);
    renderPreviewActionSelect(template);
    refreshPreview();
  }

  function renderAll() {
    renderTemplateList();
    renderEditor();
  }

  function normalizeTemplatesForSave() {
    const now = Date.now();
    state.templates = (Array.isArray(state.templates) ? state.templates : [])
      .map((tpl, index) => {
        const templateType = tpl?.templateType === "monster" ? "monster" : "character";
        const safeId = String(tpl?.id || "").trim() || `tpl_${now}_${index}`;
        const safeName = String(tpl?.name || "").trim() || `模板_${safeId.slice(-4)}`;
        const defs = getActionDefs(templateType);
        const actions = { ...(tpl?.actions || {}) };
        for (const def of defs) {
          const slot = actions[def.key] || {};
          const frameCount = Math.max(1, Number(slot.frameCount) || def.frameCount);
          const rawFrames = Array.isArray(slot.frameImages) ? slot.frameImages : [];
          const frameImages = new Array(frameCount).fill("");
          for (let i = 0; i < Math.min(frameCount, rawFrames.length); i += 1) {
            frameImages[i] = String(rawFrames[i] || "").trim();
          }
          actions[def.key] = {
            imageUrl: slot.imageUrl ? String(slot.imageUrl).trim() : null,
            frameImages,
            frameCount,
            fps: Math.max(1, Number(slot.fps) || def.fps),
            loop: typeof slot.loop === "boolean" ? slot.loop : def.loop,
          };
        }

        return {
          ...tpl,
          id: safeId,
          name: safeName,
          templateType,
          actions,
        };
      })
      .filter((tpl) => tpl && tpl.id && tpl.name);
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
    if (state.isSaving) return;
    state.isSaving = true;
    try {
      updateTemplateFromHeaderFields();
      normalizeTemplatesForSave();
      const payload = { templates: state.templates };
      const data = await window.adminCore.request("/admin/animation-studio/templates", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.templates = Array.isArray(data?.templates) ? data.templates : state.templates;
      if (!state.templates.find((tpl) => tpl.id === state.selectedTemplateId)) {
        state.selectedTemplateId = state.templates[0]?.id || null;
      }
      renderAll();
      log("已儲存動畫模板");
      return true;
    } catch (error) {
      log(`儲存失敗：${error.message}`);
      return false;
    } finally {
      state.isSaving = false;
    }
  }

  async function saveSingleAction(actionKey) {
    const template = getSelectedTemplate();
    if (!template) return;
    const slot = template.actions?.[actionKey];
    if (!slot) return;
    if (!Array.isArray(slot.frameImages)) slot.frameImages = [];
    slot.frameCount = Math.max(1, Number(slot.frameCount) || 1);
    if (slot.frameImages.length < slot.frameCount) {
      slot.frameImages = [...slot.frameImages, ...new Array(slot.frameCount - slot.frameImages.length).fill("")];
    }
    if (slot.frameImages.length > slot.frameCount) {
      slot.frameImages = slot.frameImages.slice(0, slot.frameCount);
    }
    const ok = await saveAllTemplates();
    if (ok) log(`已儲存動作：${actionKey}`);
  }

  function exportTemplatesJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      templates: state.templates,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `animation_templates_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log("已匯出動畫模板 JSON");
  }

  async function importTemplatesJson(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const source = Array.isArray(parsed) ? parsed : parsed?.templates;
    if (!Array.isArray(source)) throw new Error("JSON 格式錯誤，找不到 templates 陣列");

    state.templates = source.map((tpl) => {
      const t = {
        ...newTemplate(tpl?.templateType === "monster" ? "monster" : "character"),
        ...tpl,
      };
      if (!t.id) t.id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      if (!t.name) t.name = `模板_${t.id.slice(-4)}`;
      if (!t.actions || typeof t.actions !== "object") t.actions = buildDefaultActions(t.templateType);
      for (const def of getActionDefs(t.templateType)) {
        if (!t.actions[def.key]) {
          t.actions[def.key] = {
            imageUrl: null,
            frameImages: [],
            frameCount: def.frameCount,
            fps: def.fps,
            loop: def.loop,
          };
        }
        if (!Array.isArray(t.actions[def.key].frameImages)) {
          t.actions[def.key].frameImages = [];
        }
      }
      return t;
    });

    state.selectedTemplateId = state.templates[0]?.id || null;
    renderAll();
    log(`已匯入動畫模板 ${state.templates.length} 筆`);
  }

  function applyPresetActions(template) {
    if (!template) return;
    const defs = getActionDefs(template.templateType);
    const nextActions = {};
    defs.forEach((def) => {
      const current = template.actions?.[def.key] || {};
      const existingFrames = Array.isArray(current.frameImages) ? current.frameImages.filter(Boolean) : [];
      nextActions[def.key] = {
        imageUrl: current.imageUrl || null,
        frameImages: existingFrames.length ? existingFrames.slice(0, def.frameCount) : new Array(def.frameCount).fill(""),
        frameCount: def.frameCount,
        fps: Number.isFinite(Number(current.fps)) ? Math.max(1, Number(current.fps)) : def.fps,
        loop: typeof current.loop === "boolean" ? current.loop : def.loop,
      };
    });
    template.actions = nextActions;
  }

  function updateTemplateFromHeaderFields() {
    const selected = getSelectedTemplate();
    const templateId = byId("anim-template-id")?.value || state.selectedTemplateId;
    const template = selected && String(selected.id) === String(templateId)
      ? selected
      : (state.templates.find((t) => String(t.id) === String(templateId)) || selected);
    if (!template) return;

    const previousType = template.templateType;
    const nextType = byId("anim-template-type").value === "monster" ? "monster" : "character";

    template.name = byId("anim-template-name").value;
    template.templateType = nextType;
    template.note = byId("anim-template-note").value || "";
    template.bindWeaponType = byId("anim-bind-weapon").value || null;
    template.bindOffhandMode = byId("anim-bind-offhand-mode").value || "any";
    template.bindOffhandType = byId("anim-bind-offhand-type").value || null;
    template.bindMonsterId = byId("anim-bind-monster-id").value || null;
    state.selectedTemplateId = template.id;

    if (previousType !== nextType) {
      template.actions = buildDefaultActions(nextType);
    } else {
      const defs = getActionDefs(template.templateType);
      if (!template.actions || typeof template.actions !== "object") template.actions = {};
      for (const def of defs) {
        if (!template.actions[def.key]) {
          template.actions[def.key] = {
            imageUrl: null,
            frameImages: new Array(def.frameCount).fill(""),
            frameCount: def.frameCount,
            fps: def.fps,
            loop: def.loop,
          };
        }
      }
    }
  }

  async function uploadSingleImage(file) {
    const form = new FormData();
    form.append("image", file);
    const response = await fetch("/admin/animation-studio/template-image", {
      method: "POST",
      headers: { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` },
      body: form,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.status !== "ok") {
      throw new Error(json?.error?.message || json?.message || `Upload failed: ${response.status}`);
    }
    return json.data?.imageUrl || null;
  }

  function bindEvents() {
    byId("animation-reload")?.addEventListener("click", async () => {
      await loadBootstrap();
      log("已重新載入動作模板資料");
    });

    byId("animation-new-template")?.addEventListener("click", () => {
      const template = newTemplate("character");
      state.templates.push(template);
      state.selectedTemplateId = template.id;
      renderAll();
      log("已新增模板");
    });

    byId("animation-apply-preset")?.addEventListener("click", () => {
      const template = getSelectedTemplate();
      if (!template) {
        log("請先選擇模板");
        return;
      }
      applyPresetActions(template);
      renderAll();
      log("已套用預設動作幀數");
    });

    byId("animation-duplicate-template")?.addEventListener("click", () => {
      const current = getSelectedTemplate();
      if (!current) {
        log("請先選擇模板再複製");
        return;
      }
      const duplicated = cloneTemplate(current);
      state.templates.push(duplicated);
      state.selectedTemplateId = duplicated.id;
      renderAll();
      log("已複製模板");
    });

    byId("animation-delete-template")?.addEventListener("click", () => {
      const current = getSelectedTemplate();
      if (!current) {
        log("請先選擇模板再刪除");
        return;
      }
      const okDelete = window.confirm(`確定刪除模板「${current.name}」嗎？`);
      if (!okDelete) return;
      state.templates = state.templates.filter((tpl) => tpl.id !== current.id);
      state.selectedTemplateId = state.templates[0]?.id || null;
      renderAll();
      log("已刪除模板");
    });

    byId("animation-export-json")?.addEventListener("click", exportTemplatesJson);
    byId("animation-import-json")?.addEventListener("click", () => {
      byId("animation-import-file")?.click();
    });
    byId("animation-import-file")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        await importTemplatesJson(file);
      } catch (err) {
        log(`匯入失敗：${err.message}`);
      }
    });

    byId("animation-save-all")?.addEventListener("click", saveAllTemplates);

    byId("animation-template-list")?.addEventListener("click", (event) => {
      const btn = event.target.closest(".anim-template-btn");
      if (!btn) return;
      state.selectedTemplateId = btn.dataset.templateId;
      renderAll();
    });

    const nameInput = byId("anim-template-name");
    if (nameInput) {
      let composing = false;
      nameInput.addEventListener("compositionstart", () => {
        composing = true;
      });
      nameInput.addEventListener("compositionend", () => {
        composing = false;
        updateTemplateFromHeaderFields();
        renderTemplateList();
      });
      nameInput.addEventListener("input", () => {
        if (composing) return;
        updateTemplateFromHeaderFields();
        renderTemplateList();
      });
      nameInput.addEventListener("blur", () => {
        updateTemplateFromHeaderFields();
        renderTemplateList();
      });
    }

    [
      "anim-template-type",
      "anim-template-note",
      "anim-bind-weapon",
      "anim-bind-offhand-mode",
      "anim-bind-offhand-type",
      "anim-bind-monster-id",
    ].forEach((id) => {
      const el = byId(id);
      if (!el) return;
      el.addEventListener("change", () => {
        updateTemplateFromHeaderFields();
        renderAll();
      });
    });

    byId("animation-action-slots")?.addEventListener("input", (event) => {
      const row = event.target.closest("[data-action-row]");
      if (!row) return;
      const template = getSelectedTemplate();
      if (!template) return;
      const actionKey = row.dataset.actionRow;
      const slot = template.actions?.[actionKey];
      if (!slot) return;

      if (event.target.matches('[data-field="frameCount"]')) {
        setFrameCount(template, actionKey, event.target.value);
        renderActionSlots(template);
      } else {
        slot.frameCount = Math.max(1, Number(row.querySelector('[data-field="frameCount"]')?.value || 1));
      }

      slot.fps = Math.max(1, Number(row.querySelector('[data-field="fps"]')?.value || 10));
      slot.loop = !!row.querySelector('[data-field="loop"]')?.checked;
      refreshPreview();
    });

    byId("animation-action-slots")?.addEventListener("click", async (event) => {
      const template = getSelectedTemplate();
      if (!template) return;

      const saveBtn = event.target.closest(".anim-save-action-btn");
      if (saveBtn) {
        const actionKey = saveBtn.dataset.actionKey;
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = "存檔中...";
          await saveSingleAction(actionKey);
        } catch (err) {
          log(`存檔失敗：${err.message}`);
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = "存檔此動作";
        }
        return;
      }

      const applyBtn = event.target.closest(".anim-apply-preview-btn");
      if (applyBtn) {
        const actionKey = applyBtn.dataset.actionKey;
        const sel = byId("animation-preview-action");
        if (sel) sel.value = actionKey;
        await refreshPreview();
        return;
      }

      const clearActionBtn = event.target.closest(".anim-clear-action-btn");
      if (clearActionBtn) {
        const actionKey = clearActionBtn.dataset.actionKey;
        const slot = template.actions?.[actionKey];
        if (!slot) return;
        slot.imageUrl = null;
        slot.frameImages = new Array(Math.max(1, Number(slot.frameCount) || 1)).fill("");
        renderActionSlots(template);
        refreshPreview();
        return;
      }

      const uploadFrameBtn = event.target.closest(".anim-upload-frame-btn");
      if (uploadFrameBtn) {
        const actionKey = uploadFrameBtn.dataset.actionKey;
        const frameIndex = Number(uploadFrameBtn.dataset.frameIndex);
        const slot = template.actions?.[actionKey];
        if (!slot) return;

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            uploadFrameBtn.disabled = true;
            uploadFrameBtn.textContent = "上傳中...";
            const imageUrl = await uploadSingleImage(file);
            const len = Math.max(1, Number(slot.frameCount) || 1);
            if (!Array.isArray(slot.frameImages)) slot.frameImages = new Array(len).fill("");
            if (slot.frameImages.length < len) {
              slot.frameImages = [...slot.frameImages, ...new Array(len - slot.frameImages.length).fill("")];
            }
            slot.frameImages[frameIndex] = imageUrl || "";
            renderActionSlots(template);
            refreshPreview();
          } catch (err) {
            log(`上傳失敗：${err.message}`);
          } finally {
            uploadFrameBtn.disabled = false;
            uploadFrameBtn.textContent = "上傳";
          }
        };
        input.click();
        return;
      }

      const clearFrameBtn = event.target.closest(".anim-clear-frame-btn");
      if (clearFrameBtn) {
        const actionKey = clearFrameBtn.dataset.actionKey;
        const frameIndex = Number(clearFrameBtn.dataset.frameIndex);
        const slot = template.actions?.[actionKey];
        if (!slot) return;
        if (!Array.isArray(slot.frameImages)) {
          slot.frameImages = new Array(Math.max(1, Number(slot.frameCount) || 1)).fill("");
        }
        slot.frameImages[frameIndex] = "";
        renderActionSlots(template);
        refreshPreview();
      }
    });

    byId("animation-preview-action")?.addEventListener("change", refreshPreview);
  }

  document.addEventListener("adminConnected", () => {
    loadBootstrap().catch((err) => log(`載入動畫模板失敗：${err.message}`));
  });

  bindEvents();
})();
