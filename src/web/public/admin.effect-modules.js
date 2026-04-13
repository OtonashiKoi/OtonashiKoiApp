(function(){
  // 重寫效果模組管理器：左側清單，右側編輯器；每列可獨立儲存/刪除；支援匯入/匯出 JSON

  function authHeaders(json = true){
    const headers = { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }
  async function fetchJson(url){
    const res = await fetch(url, { headers: authHeaders(false) });
    const payload = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
    return payload.data;
  }
  async function saveJson(url, body){
    const res = await fetch(url, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(body) });
    const payload = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
    return payload.data;
  }

  const section = document.getElementById('section-effect-modules');
  const tableBody = document.getElementById('effect-modules-tbody');
  const newBtn = document.getElementById('effect-modules-btn-new');
  const refreshBtn = document.getElementById('effect-modules-btn-refresh');

  let modules = [];
  let selectedModuleId = null;
  const CATEGORY_LABELS = { skill: '技能', buff: 'BUFF', debuff: 'DEBUFF', system: '系統效果' };

  function esc(s){ return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

  function summaryOf(mod){
    if (!mod || !Array.isArray(mod.effects)) return '未設定';
    return (mod.effects.slice(0,3).map(e => e.key || e?.params?.key || 'unk').join('、')) + (mod.effects.length>3 ? ` 等 ${mod.effects.length} 項` : '');
  }

  // 簡單的自然語言轉效果解析器（雛形）：支援中文關鍵字與數值抽取
  function parseNaturalLanguageToEffects(text){
    if (!text) return [];
    const s = String(text || '').trim();
    const parts = s.split(/[。\n；;，,]/).map(p=>p.trim()).filter(Boolean);
    const results = [];

    const keyPatterns = [
      [/攻擊力|攻擊/, 'atk_up'],
      [/防禦力|防禦/, 'def_up'],
      [/經驗|經驗值/, 'exp_gain_up'],
      [/最大生命|生命上限/, 'max_hp_up'],
      [/命中/, 'hit_up'],
      [/閃避/, 'dodge_up'],
      [/暴擊率/, 'crit_rate_up'],
      [/暴擊傷害/, 'crit_damage_up'],
      [/速度/, 'speed_up'],
      [/灼燒/, 'burn'],
      [/中毒/, 'poison'],
      [/流血/, 'bleed'],
      [/眩暈/, 'stun'],
      [/治療|回復/, 'heal_over_time'],
      [/護盾/, 'shield'],
      [/傷害減免|減傷/, 'damage_reduction'],
      [/吸血|生命竊取/, 'lifesteal']
    ];

    function detectTarget(p){
      if (/我|我們|自己|自身|己方|自方/.test(p)) return 'self';
      if (/全體.*敵|全體敵|全體敵人/.test(p)) return 'all_enemies';
      if (/全體.*友|全體友方|全隊|隊友/.test(p)) return 'all_allies';
      if (/友方|盟友|隊友/.test(p)) return 'ally';
      if (/敵人|敵方|目標/.test(p)) return 'enemy';
      return 'enemy';
    }

    function extractFirstNumber(p){
      const m = p.match(/(\d+(?:\.\d+)?)/);
      return m ? Number(m[1]) : null;
    }

    function extractPercent(p){
      const m = p.match(/(\d{1,3})\s*%/);
      return m ? Math.max(0, Math.min(100, Number(m[1]))) : null;
    }

    for (const segment of parts){
      const seg = segment;
      let matchedKey = null;
      for (const [rx,key] of keyPatterns){ if (rx.test(seg)) { matchedKey = key; break; } }
      // fallback: if contains "造成" and a number, treat as damage-like buff (use 'final_damage_up')
      if (!matchedKey && /造成/.test(seg) && /\d+/.test(seg)) matchedKey = 'final_damage_up';

      if (!matchedKey) continue;
      const value = extractFirstNumber(seg);
      const chance = extractPercent(seg) || ( /機率|概率|概率為|有.*機率/.test(seg) ? extractFirstNumber(seg) || 100 : 100 );
      const duration = extractFirstNumber(seg) || 1;
      const target = detectTarget(seg);

      function detectTrigger(seg){
        if (/獲得|取得|拿到|得到|獲取/.test(seg)) return 'on_gain';
        if (/當|當觸發|命中|on_/.test(seg)) return 'on_hit';
        return 'passive';
      }
      const eff = {
        key: matchedKey,
        trigger: detectTrigger(seg),
        target,
        chance: chance || 100,
        stacks: 1,
        stackMode: 'refresh',
        duration: { mode: 'turns', value: duration },
        params: typeof value === 'number' ? { value } : {},
        notes: segment
      };
      results.push(eff);
    }
    return results;
  }

  function renderList(){
    tableBody.innerHTML = '';
    if (!modules.length){
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="6" class="hint">尚無效果模組</td>';
      tableBody.appendChild(tr);
      return;
    }
    for (const mod of modules){
      const tr = document.createElement('tr');
      tr.dataset.moduleId = mod.id || '';
      tr.innerHTML = `<td>${esc(mod.id)}</td><td>${esc(mod.name)}</td><td>${esc(CATEGORY_LABELS[mod.category]||mod.category||'')}</td><td>${esc(mod.description||'')}</td><td>${esc(summaryOf(mod))}</td><td></td>`;
      const actions = tr.querySelector('td:last-child');
      const editBtn = document.createElement('button'); editBtn.className='button'; editBtn.textContent='編輯';
      const exportBtn = document.createElement('button'); exportBtn.className='button'; exportBtn.textContent='匯出'; exportBtn.style.marginLeft='8px';
      const delBtn = document.createElement('button'); delBtn.className='button danger'; delBtn.textContent='刪除'; delBtn.style.marginLeft='8px';
      actions.appendChild(editBtn); actions.appendChild(exportBtn); actions.appendChild(delBtn);

      editBtn.onclick = ()=> openEditor(mod.id);
      exportBtn.onclick = ()=> exportModule(mod);
      delBtn.onclick = async ()=>{
        if (!confirm(`確定刪除模組 ${mod.id} ?`)) return;
        try{
          const remaining = modules.filter(m=>m.id !== mod.id);
          await saveJson('/admin/effect-modules', { modules: remaining });
          modules = remaining;
          renderList();
          if (selectedModuleId === mod.id) closeEditor();
          alert('已刪除');
        }catch(e){ alert('刪除失敗：'+e.message); }
      };
      tableBody.appendChild(tr);
    }
  }

  // editor modal (large overlay) — created on demand
  function ensureEditorPanel(){
    let overlay = document.getElementById('effect-modules-modal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'effect-modules-modal';
    overlay.className = 'effect-modules-editor';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.66);padding:20px;overflow:auto;';

    const content = document.createElement('div');
    content.className = 'effect-modules-modal-content';
    content.style.cssText = 'max-width:1200px;height:calc(100% - 40px);margin:0 auto;background:var(--surface);border:1px solid var(--accent);border-radius:12px;padding:18px;display:grid;grid-template-rows:auto 1fr;gap:12px;';

    const header = document.createElement('div'); header.style.cssText='display:flex;align-items:center;gap:12px;';
    const title = document.createElement('div'); title.innerHTML = '<strong>編輯效果模組</strong>'; header.appendChild(title);
    const closeBtn = document.createElement('button'); closeBtn.className='button'; closeBtn.textContent='關閉'; closeBtn.style.marginLeft='auto';
    header.appendChild(closeBtn);
    content.appendChild(header);

    const bodyGrid = document.createElement('div'); bodyGrid.style.cssText = 'display:grid;grid-template-columns:1fr;height:100%;';

    // single-column editor (no left list)
    const right = document.createElement('div'); right.style.cssText = 'display:flex;flex-direction:column;gap:8px;overflow:auto;padding-right:6px;width:100%;';
    right.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;">
        <div style="flex:1;"><div>ID (識別碼)</div><input class="sheet-input" data-field="id" placeholder="module_fireball" /></div>
        <div style="width:160px;"><div>分類</div><select class="sheet-input" data-field="category"><option value="skill">技能</option><option value="buff">BUFF</option><option value="debuff">DEBUFF</option><option value="system">系統效果</option></select></div>
      </div>
      <div><div>名稱</div><input class="sheet-input" data-field="name" placeholder="火球術" /></div>
      <div><div>簡短說明</div><input class="sheet-input" data-field="description" placeholder="一句話描述" /></div>
      <div style="margin-top:6px;"><div><strong>完整說明</strong></div><textarea class="sheet-input" data-field="fullDescription" rows="4" style="width:100%;min-height:84px;box-sizing:border-box;"></textarea></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="button primary" data-role="save-module">儲存模組</button>
        <button class="button" data-role="import-json">匯入 JSON</button>
        <button class="button" data-role="export-json">匯出 JSON</button>
        <button class="button" data-role="generate-desc">生成說明</button>
        <div style="margin-left:auto;color:var(--muted);" class="editor-status"></div>
      </div>
      <div style="margin-top:6px;"><strong>效果清單</strong></div>
      <div class="module-effects-area" style="display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:200px;max-height:60vh;padding-right:6px;"></div>
      <div style="margin-top:12px;border:2px solid rgba(255,165,0,0.06);padding:12px;border-radius:6px;background:rgba(255,165,0,0.02);">
        <div style="font-weight:600;margin-bottom:6px;">自然語言編輯器（請輸入中文描述）</div>
        <textarea class="sheet-input" data-field="nl-input" rows="5" placeholder="例如：對敵人造成100點火焰傷害，並造成3回合灼燒" style="width:100%;box-sizing:border-box;"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="button" data-role="nl-parse">解析並產生效果</button>
          <button class="button" data-role="nl-generate-desc">從自然語言生成說明</button>
          <div style="margin-left:auto;color:var(--muted);" class="nl-status"></div>
        </div>
      </div>
    `;

    bodyGrid.appendChild(right);
    content.appendChild(bodyGrid);
    overlay.appendChild(content);
    document.body.appendChild(overlay);

    // close handler
    closeBtn.onclick = () => { overlay.style.display = 'none'; };
    overlay.addEventListener('click', (ev)=>{ if (ev.target === overlay) overlay.style.display = 'none'; });

    // no left list wiring (editor is single-column modal)

    return overlay;
  }

  function openEditor(moduleId){
    const overlay = ensureEditorPanel();
    overlay.style.display = 'block';
    selectedModuleId = moduleId || null;
    const idInput = overlay.querySelector('[data-field="id"]');
    const nameInput = overlay.querySelector('[data-field="name"]');
    const descInput = overlay.querySelector('[data-field="description"]');
    const catSelect = overlay.querySelector('[data-field="category"]');
    const status = overlay.querySelector('.editor-status');
    const effectsArea = overlay.querySelector('.module-effects-area');

    let current = { id:'', name:'', description:'', category:'buff', effects: [] };

    function renderEffects(){
      effectsArea.innerHTML = '';
      if (!window.adminEffects || !window.adminEffects.buildEffectRowElement || !window.adminEffects.readEffectRowElement){
        const hint = document.createElement('div'); hint.textContent = '效果編輯器尚未載入，請稍後再試。'; hint.style.color='var(--muted)';
        effectsArea.appendChild(hint); return;
      }
      if (!current.effects.length){
        const empty = document.createElement('p'); empty.className='hint'; empty.textContent='尚未設定效果'; effectsArea.appendChild(empty);
      }
      current.effects.forEach((eff, idx)=>{
        const itemWrap = document.createElement('div'); itemWrap.style.cssText='display:flex;gap:8px;align-items:flex-start;';
        const row = (window.adminEffects && window.adminEffects.buildEffectRowElement) ? window.adminEffects.buildEffectRowElement(eff) : (function(){ const p=document.createElement('div'); p.textContent='效果編輯器尚未載入'; p.style.color='var(--muted)'; return p; })();
        try { const innerDel = row.querySelector && row.querySelector('[data-role="delete-effect"]'); if (innerDel) innerDel.remove(); } catch(e) {}
        row.style.flex='1'; row.style.minWidth = '720px';
        const actions = document.createElement('div'); actions.style.cssText='display:flex;flex-direction:column;gap:6px;align-items:flex-end;';
        const saveBtn = document.createElement('button'); saveBtn.className='button primary'; saveBtn.textContent='儲存';
        const delBtn = document.createElement('button'); delBtn.className='button danger'; delBtn.textContent='刪除';
        const msg = document.createElement('div'); msg.style.cssText='font-size:12px;color:var(--muted);min-height:18px;';
        actions.appendChild(saveBtn); actions.appendChild(delBtn); actions.appendChild(msg);

        saveBtn.onclick = async ()=>{
          const thisEff = window.adminEffects.readEffectRowElement(row);
          if (!thisEff || !thisEff.key) { alert('請選擇效果類型'); return; }
          current.effects[idx] = thisEff;
          try{
            await persistModule(current);
            msg.textContent = '已儲存'; status.textContent=''; setTimeout(()=>msg.textContent='',1500);
            renderList();
          }catch(e){ msg.textContent='儲存失敗'; alert('儲存失敗：'+e.message); }
        };
        delBtn.onclick = async ()=>{
          if (!confirm('確定刪除此效果？')) return;
          current.effects.splice(idx,1);
          try{
            await persistModule(current);
            renderEffects(); renderList(); status.textContent='已刪除並儲存';
          }catch(e){ alert('刪除失敗：'+e.message); }
        };

        itemWrap.appendChild(row); itemWrap.appendChild(actions); effectsArea.appendChild(itemWrap);
      });

      const ctl = document.createElement('div'); ctl.style.cssText='display:flex;gap:8px;';
      const addBtn = document.createElement('button'); addBtn.className='button'; addBtn.textContent='＋ 新增效果';
      addBtn.onclick = ()=>{
        const newEff = { key:'', trigger:'passive', target:'self', chance:100, stacks:1, stackMode:'refresh', duration:{mode:'turns', value:1}, params:{value:0} };
        current.effects.push(newEff);
        renderEffects(); effectsArea.scrollTop = effectsArea.scrollHeight;
      };
      ctl.appendChild(addBtn); effectsArea.appendChild(ctl);
    }

    async function persistModule(mod){
      if (!mod.id || !mod.name) throw new Error('請填入模組 ID 與名稱');
      const others = modules.filter(m=>m.id !== mod.id);
      const next = [...others, mod];
      await saveJson('/admin/effect-modules', { modules: next });
      modules = next; selectedModuleId = mod.id;
    }

    function populateEditor(m){
      current = JSON.parse(JSON.stringify(m || { id:'', name:'', description:'', category:'buff', effects:[] }));
      idInput.value = current.id || '';
      nameInput.value = current.name || '';
      descInput.value = current.description || '';
      const fullEl = overlay.querySelector('[data-field="fullDescription"]');
      if (fullEl) fullEl.value = current.fullDescription || current.description || '';
      catSelect.value = current.category || 'buff';
      renderEffects();
    }

    // wire editor controls
    overlay.querySelector('[data-role="save-module"]').onclick = async ()=>{
      current.id = String(idInput.value||'').trim();
      current.name = String(nameInput.value||'').trim();
      current.description = String(descInput.value||'').trim();
      // save full description field too
      const fullDesc = overlay.querySelector('[data-field="fullDescription"]');
      if (fullDesc) current.fullDescription = String(fullDesc.value||'').trim();
      current.category = String(catSelect.value||'buff');
      try{ status.textContent = '儲存中...'; await persistModule(current); status.textContent = '儲存完成'; renderList(); setTimeout(()=>status.textContent='',1500); }
      catch(e){ status.textContent='儲存失敗'; alert('儲存失敗：'+e.message); }
    };

    overlay.querySelector('[data-role="import-json"]').onclick = ()=>{
      const txt = prompt('貼上模組 JSON (或空白以取消)'); if (!txt) return;
      try{ const mod = JSON.parse(txt); if (!mod || !mod.id) throw new Error('無效的模組 JSON'); populateEditor(mod); }
      catch(e){ alert('解析失敗：'+e.message); }
    };

    overlay.querySelector('[data-role="export-json"]').onclick = ()=>{
      const txt = JSON.stringify(current, null, 2); const blob = new Blob([txt], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(current.id||'module')}.json`; document.body.appendChild(a); a.click(); a.remove();
    };

    // 生成說明（從效果產生簡述）
    const genBtn = overlay.querySelector('[data-role="generate-desc"]');
    if (genBtn) genBtn.onclick = async ()=>{
      try{
        if (window.adminEffects && window.adminEffects.ensureLookups) await window.adminEffects.ensureLookups();
        const summary = (window.adminEffects && window.adminEffects.summarizeEffectRefs) ? window.adminEffects.summarizeEffectRefs(current.effects||[]) : (current.effects||[]).map(e=>e.key||'unk').join('、');
        const fullEl = overlay.querySelector('[data-field="fullDescription"]');
        if (fullEl) fullEl.value = `本模組包含：${summary}`;
      }catch(e){ alert('生成說明失敗：'+e.message); }
    };

    // 自然語言解析按鈕：將解析結果加入 current.effects（不自動儲存）
    const nlParseBtn = overlay.querySelector('[data-role="nl-parse"]');
    const nlGenDescBtn = overlay.querySelector('[data-role="nl-generate-desc"]');
    if (nlParseBtn){
      nlParseBtn.onclick = async ()=>{
        const statusEl = overlay.querySelector('.nl-status');
        const txt = overlay.querySelector('[data-field="nl-input"]')?.value || '';
        // 確保 effect definitions 已載入，否則下拉會是空的
        try{
          if (window.adminEffects && typeof window.adminEffects.ensureLookups === 'function'){
            if (statusEl) statusEl.textContent = '載入效果類型...';
            await window.adminEffects.ensureLookups();
            if (statusEl) statusEl.textContent = '';
          }
        }catch(err){
          console.error('ensureLookups failed', err);
          if (statusEl) statusEl.textContent = '載入效果類型失敗';
          setTimeout(()=>{ if (statusEl) statusEl.textContent = ''; }, 2000);
        }
        const parsed = parseNaturalLanguageToEffects(txt || '');
        if (!parsed || !parsed.length){ if (statusEl) statusEl.textContent = '未解析出效果'; setTimeout(()=>{ if (statusEl) statusEl.textContent=''; },1500); return; }
        // 將解析結果加入 current.effects，並重新渲染（renderEffects 會使用 adminEffects.buildEffectRowElement 產生填空式列）
        current.effects = current.effects.concat(parsed);
        renderEffects();
        if (statusEl) statusEl.textContent = `新增 ${parsed.length} 項效果（尚未儲存）`;
        setTimeout(()=>{ if (statusEl) statusEl.textContent=''; }, 2500);
      };
    }
    if (nlGenDescBtn){
      nlGenDescBtn.onclick = ()=>{
        const txt = overlay.querySelector('[data-field="nl-input"]')?.value || '';
        const parsed = parseNaturalLanguageToEffects(txt || '');
        const fullEl = overlay.querySelector('[data-field="fullDescription"]');
        if (!parsed || !parsed.length){ overlay.querySelector('.nl-status').textContent='未解析出效果'; setTimeout(()=>overlay.querySelector('.nl-status').textContent='',1500); return; }
        const lines = parsed.map(e=>`${e.key} ${e.params?.value || ''} (${e.duration?.value || 1}回合)`);
        if (fullEl) fullEl.value = lines.join('；');
      };
    }

    const mod = modules.find(m=>m.id === moduleId) || null;
    // 確保 adminEffects 的 lookup 已載入（effect definitions 等），否則下拉選單會是空的
    if (window.adminEffects && typeof window.adminEffects.ensureLookups === 'function'){
      const statusEl = overlay.querySelector('.editor-status');
      try{
        if (statusEl) statusEl.textContent = '載入效果類型...';
        window.adminEffects.ensureLookups().then(()=>{
          if (statusEl) statusEl.textContent = '';
          populateEditor(mod);
        }).catch((err)=>{
          if (statusEl) statusEl.textContent = '載入效果類型失敗';
          console.error('ensureLookups failed', err);
          populateEditor(mod);
        });
      }catch(e){
        console.error(e);
        populateEditor(mod);
      }
    } else {
      populateEditor(mod);
    }
  }

  function closeEditor(){
    const overlay = document.getElementById('effect-modules-modal');
    if (overlay) overlay.style.display = 'none';
    selectedModuleId = null;
  }

  function exportModule(mod){
    const txt = JSON.stringify(mod, null, 2);
    navigator.clipboard?.writeText(txt).then(()=> alert('已複製 JSON 到剪貼簿'), ()=>{ const blob = new Blob([txt], { type:'application/json' }); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${mod.id||'module'}.json`; document.body.appendChild(a); a.click(); a.remove(); });
  }

  async function loadModules(){
    try{
      const data = await fetchJson('/admin/effect-modules');
      modules = Array.isArray(data) ? data : [];
      renderList();
    }catch(e){ alert('載入模組失敗：'+e.message); }
  }

  newBtn.onclick = ()=> openEditor(null);
  refreshBtn.onclick = ()=> loadModules();

  // initial load
  setTimeout(()=>{ if (document.readyState === 'complete') loadModules(); else window.addEventListener('load', loadModules); },0);

})();
