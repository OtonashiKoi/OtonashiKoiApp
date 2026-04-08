/* admin.items.js */
(function () {
  let items=[],activeTab='consumable',pendingImgRowId=null,searchQuery='',equipSubFilter='all',tierFilter='all';
  const SPECIAL_SLOTS=new Set(['title_eq','job_eq','special_1','special_2','special_3']);
  const STANDARD_SLOTS=new Set(['head_top','head_mid','head_low','armor','weapon','shield','garment','shoes','accessory_l','accessory_r']);
  const SLOT_LABELS={
    head_top:"頭上",
    head_mid:"頭中",
    head_low:"頭下",
    armor:"衣服",
    weapon:"武器",
    shield:"副手防具",
    garment:"披肩",
    shoes:"鞋子",
    accessory_l:"飾品左",
    accessory_r:"飾品右",
    title_eq:"稱號",
    job_eq:"職業",
    special_1:"特殊①",
    special_2:"特殊②",
    special_3:"特殊③"
  };
  const EFFECT_LABELS={
    none:"無效果",
    grant_gold:"💰 金幣",
    grant_diamond:"💎 鑽石",
    grant_exp:"✨ 經驗",
    grant_status_points:"📊 屬性點",
    checkin_multiplier:"🎯 打卡加倍"
  };
  const WEAPON_TYPE_LABELS={sword_1h:'劍(單)',sword_2h:'劍(雙)',dagger:'匕首',mace_1h:'鎚(單)',axe_1h:'斧(單)',axe_2h:'斧(雙)',staff_1h:'杖(單)',staff_2h:'杖(雙)',bow:'弓'};
  const OFFHAND_WEAPON_TYPE_LABELS={offhand_sword:'副手劍',offhand_dagger:'副手匕首',offhand_mace:'副手鎚'};
  function wepTypeHtml(item){
    if(item.equipSlot==='weapon'){const cur=item.weaponType||'';const opts='<option value="">（未設定）</option>'+Object.entries(WEAPON_TYPE_LABELS).map(([v,l])=>'<option value="'+v+'"'+(cur===v?' selected':'')+'>'+l+'</option>').join('');return'<select class="sheet-input" data-field="weaponType" style="width:100%;">'+opts+'</select>';}
    if(item.equipSlot==='shield'){const cur=item.weaponType||'';const opts='<option value="">防具（無攻擊）</option>'+Object.entries(OFFHAND_WEAPON_TYPE_LABELS).map(([v,l])=>'<option value="'+v+'"'+(cur===v?' selected':'')+'>'+l+'</option>').join('');return'<select class="sheet-input" data-field="weaponType" style="width:100%;">'+opts+'</select>';}
    return'<span style="padding:2px 6px;color:var(--muted)">—</span>';
  }
  const TAB_COLS={consumable:['seq','img','name','desc','effect','effectValue','actions'],collectible:['seq','img','name','desc','actions'],equipment:['seq','img','name','desc','slot','weaponType','str','agi','vit','int','dex','luk','actions'],special:['seq','img','name','desc','slot','str','agi','vit','int','dex','luk','actions']};
  const COL_HEADERS={
    seq:"#",
    img:"圖片",
    name:"名稱",
    desc:"說明",
    effect:"效果",
    effectValue:"效果值",
    slot:"槽位",
    str:"STR",
    agi:"AGI",
    vit:"VIT",
    int:"INT",
    dex:"DEX",
    luk:"LUK",
    weaponType:"武器類型",
    actions:"操作"
  };
  const COL_WIDTHS={
    seq:"36px",
    img:"56px",
    name:"150px",
    desc:"200px",
    effect:"140px",
    effectValue:"64px",
    slot:"100px",
    str:"52px",
    agi:"52px",
    vit:"52px",
    int:"52px",
    dex:"52px",
    luk:"52px",
    weaponType:"90px",
    actions:"110px"
  };
  function matchesTab(item,tab){if(tab==='consumable')return item.itemType==='consumable';if(tab==='collectible')return item.itemType==='collectible';if(tab==='equipment'){if(!(item.itemType==='equipment'&&STANDARD_SLOTS.has(item.equipSlot)))return false;if(equipSubFilter!=='all'){const sg={weapon:['weapon','shield'],head:['head_top','head_mid','head_low'],defense:['armor','garment','shoes'],accessory:['accessory_l','accessory_r']};if(!(sg[equipSubFilter]||[]).includes(item.equipSlot))return false;}if(tierFilter!=='all'&&!(item.description||'').includes(tierFilter+'級'))return false;return true;}if(tab==='special')return item.itemType==='equipment'&&SPECIAL_SLOTS.has(item.equipSlot);return true;}
  function defaultItemType(tab){return(tab==='equipment'||tab==='special')?'equipment':(tab==='collectible'?'collectible':'consumable');}
  function defaultSlot(tab){return tab==='special'?'title_eq':'head_top';}
  function authHeader(){return{Authorization:`Bearer ${window.getAdminToken?window.getAdminToken():''}`};}
  function jsonHeaders(){return{'Content-Type':'application/json',...authHeader()};}
  async function loadItems(){const res=await fetch('/admin/items',{headers:authHeader()});const json=await res.json();if(json.status==='ok'){items=json.data||[];renderAll();}else{window.logActivity&&window.logActivity('❌ 無法載入道具庫：'+(json.message||'')); }}
  function renderSubFilter(){const el=document.getElementById('items-equip-sub-filter');if(!el)return;if(activeTab!=='equipment'){el.style.display='none';return;}el.style.display='flex';const GRP=[['all','全部'],['weapon','武器'],['head','頭部'],['defense','防具'],['accessory','飾品']];const TIER=[['all','全'],['D','D'],['C','C'],['B','B'],['A','A']];const mkChip=(v,l,cur,attr)=>'<span class="tier-chip'+(cur===v?' active':'')+'" '+attr+'="'+v+'">'+l+'</span>';el.innerHTML='<span style="font-size:11px;color:var(--muted);margin-right:4px;">槽：</span>'+GRP.map(([v,l])=>mkChip(v,l,equipSubFilter,'data-sg')).join('')+'<span style="font-size:11px;color:var(--muted);margin:0 4px 0 12px;">階：</span>'+TIER.map(([v,l])=>mkChip(v,l,tierFilter,'data-tf')).join('');el.querySelectorAll('[data-sg]').forEach(c=>c.addEventListener('click',()=>{equipSubFilter=c.dataset.sg;renderAll();}));el.querySelectorAll('[data-tf]').forEach(c=>c.addEventListener('click',()=>{tierFilter=c.dataset.tf;renderAll();}));}
  function renderAll(){renderSubFilter();renderHead();renderBody();}
  function renderHead(){const h=document.getElementById('items-sheet-head');if(!h)return;const c=TAB_COLS[activeTab];h.innerHTML=`<tr>${c.map(x=>`<th style="min-width:${COL_WIDTHS[x]};white-space:nowrap;">${COL_HEADERS[x]}</th>`).join('')}</tr>`;}
  function renderBody(){const tbody=document.getElementById('items-tbody');if(!tbody)return;const q=searchQuery.toLowerCase();const f=items.filter(i=>matchesTab(i,activeTab)&&(!q||(i.name||'').toLowerCase().includes(q)||(i.description||'').toLowerCase().includes(q)));if(!f.length){const c=TAB_COLS[activeTab];tbody.innerHTML=`<tr><td colspan="${c.length}" style="text-align:center;color:var(--muted);padding:2rem;">此類目為空，點「＋新增一行」開始建立</td></tr>`;return;}tbody.innerHTML=f.map((item,i)=>buildRow(item,false,i+1)).join('');bindRowEvents(tbody);}
  function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function slotOptsHtml(sel){const mk=v=>`<option value="${v}"${v===sel?' selected':''}>${SLOT_LABELS[v]}</option>`;const std=['head_top','head_mid','head_low','armor','weapon','shield','garment','shoes','accessory_l','accessory_r'].map(mk).join('');const sp=['title_eq','job_eq','special_1','special_2','special_3'].map(mk).join('');return`<optgroup label="一般裝備槽">${std}</optgroup><optgroup label="特殊槽位">${sp}</optgroup>`;}
  function effectOptsHtml(sel){return Object.entries(EFFECT_LABELS).map(([v,l])=>`<option value="${v}"${v===sel?' selected':''}>${l}</option>`).join('');}
  function buildRow(item,isNew=false,seq=0){const cols=TAB_COLS[activeTab],id=item.id||'__new__',s=item.equipStats||{},eff=item.effect||{type:'none',value:0};const cells={seq:`<td style="text-align:center;color:var(--muted);font-size:0.8em;user-select:none;">${isNew?'':seq}</td>`,img:`<td class="img-cell" data-img-id="${id}" title="點此上傳圖片">${item.imageUrl?`<img src="${esc(item.imageUrl)}" style="height:40px;width:40px;object-fit:cover;border-radius:6px;" />`:`<span style="font-size:1.5em;color:var(--muted)">📷</span>`}</td>`,name:`<td><input class="sheet-input" data-field="name" value="${esc(item.name||'')}" placeholder="道具名稱" style="width:100%;" /></td>`,desc:`<td><input class="sheet-input" data-field="desc" value="${esc(item.description||'')}" placeholder="說明文字" style="width:100%;" /></td>`,effect:`<td><select class="sheet-input" data-field="effect" style="width:100%;">${effectOptsHtml(eff.type)}</select></td>`,effectValue:`<td><input class="sheet-input" data-field="effectValue" type="number" value="${eff.value||0}" style="width:100%;text-align:center;" /></td>`,slot:`<td><select class="sheet-input" data-field="slot" style="width:100%;">${slotOptsHtml(item.equipSlot)}</select></td>`,weaponType:`<td>${wepTypeHtml(item)}</td>`,str:`<td><input class="sheet-input" data-field="str" type="number" value="${s.str||0}" style="width:100%;text-align:center;" /></td>`,agi:`<td><input class="sheet-input" data-field="agi" type="number" value="${s.agi||0}" style="width:100%;text-align:center;" /></td>`,vit:`<td><input class="sheet-input" data-field="vit" type="number" value="${s.vit||0}" style="width:100%;text-align:center;" /></td>`,int:`<td><input class="sheet-input" data-field="int" type="number" value="${s.int||0}" style="width:100%;text-align:center;" /></td>`,dex:`<td><input class="sheet-input" data-field="dex" type="number" value="${s.dex||0}" style="width:100%;text-align:center;" /></td>`,luk:`<td><input class="sheet-input" data-field="luk" type="number" value="${s.luk||0}" style="width:100%;text-align:center;" /></td>`,actions:`<td style="white-space:nowrap;"><button class="button small item-save-btn">儲存</button>${!isNew?`<button class="button small danger item-del-btn" data-name="${esc(item.name||'')}">刪除</button>`:''}</td>`};return`<tr data-item-id="${id}">${cols.map(c=>cells[c]||'<td></td>').join('')}</tr>`;}
  function bindRowEvents(tbody){tbody.querySelectorAll('.img-cell').forEach(td=>{td.addEventListener('click',()=>{pendingImgRowId=td.dataset.imgId;document.getElementById('items-img-input').click();});});tbody.querySelectorAll('.item-save-btn').forEach(btn=>{btn.addEventListener('click',()=>saveRow(btn.closest('tr')));});tbody.querySelectorAll('.item-del-btn').forEach(btn=>{btn.addEventListener('click',()=>{const tr=btn.closest('tr');deleteItem(tr.dataset.itemId,btn.dataset.name);});});}
  function getRowPayload(tr){const get=f=>tr.querySelector(`[data-field="${f}"]`)?.value??'';const isEq=activeTab==='equipment'||activeTab==='special';const p={name:get('name'),description:get('desc'),itemType:isEq?'equipment':defaultItemType(activeTab)};if(activeTab==='consumable')p.effect={type:get('effect')||'none',value:Number(get('effectValue'))||0};if(isEq){p.equipSlot=get('slot')||defaultSlot(activeTab);p.equipStats={str:Number(get('str'))||0,agi:Number(get('agi'))||0,vit:Number(get('vit'))||0,int:Number(get('int'))||0,dex:Number(get('dex'))||0,luk:Number(get('luk'))||0};p.weaponType=(p.equipSlot==='weapon'||p.equipSlot==='shield')?(get('weaponType')||null):null;}return p;}
  async function saveRow(tr){const id=tr.dataset.itemId,payload=getRowPayload(tr);if(!payload.name.trim()){alert('請輸入道具名稱');return;}const isNew=id==='__new__';const res=await fetch(isNew?'/admin/items':`/admin/items/${id}`,{method:isNew?'POST':'PUT',headers:jsonHeaders(),body:JSON.stringify(payload)});const json=await res.json();if(json.status==='ok'){window.logActivity&&window.logActivity(`✅ 道具已${isNew?'新增':'更新'}：${payload.name}`);await loadItems();}else{window.logActivity&&window.logActivity('❌ 儲存失敗：'+(json.message||'')); }}
  async function deleteItem(id,name){if(!confirm(`確定要刪除道具「${name}」？`))return;const res=await fetch(`/admin/items/${id}`,{method:'DELETE',headers:authHeader()});const json=await res.json();if(json.status==='ok'){window.logActivity&&window.logActivity(`🗑️ 道具已刪除：${name}`);await loadItems();}else{window.logActivity&&window.logActivity('❌ 刪除失敗：'+(json.message||'')); }}
  async function uploadImage(id,file){const fd=new FormData();fd.append('image',file);const res=await fetch(`/admin/items/${id}/image`,{method:'POST',headers:authHeader(),body:fd});const json=await res.json();if(json.status==='ok'){window.logActivity&&window.logActivity('🖼️ 圖片上傳成功');const thumb=json.data?.imageThumbnailUrl||json.data?.imageUrl;if(thumb){const cell=document.querySelector(`.img-cell[data-img-id="${id}"]`);if(cell)cell.innerHTML=`<img src="${thumb}" style="height:40px;width:40px;object-fit:cover;border-radius:6px;" />`;}else{await loadItems();}}else{window.logActivity&&window.logActivity('❌ 圖片上傳失敗：'+(json.message||'')); }}
  function addNewRow(){const tbody=document.getElementById('items-tbody');if(!tbody)return;const ph=tbody.querySelector('td[colspan]');if(ph)ph.closest('tr').remove();const ei={id:'__new__',name:'',description:'',imageUrl:null,itemType:defaultItemType(activeTab),equipSlot:defaultSlot(activeTab),equipStats:{},effect:{type:'none',value:0}};const tmp=document.createElement('tbody');tmp.innerHTML=buildRow(ei,true);const nr=tmp.firstElementChild;tbody.prepend(nr);bindRowEvents(tbody);nr.querySelector("[data-field='name']")?.focus();}
  document.getElementById('items-btn-new')?.addEventListener('click',addNewRow);
  document.getElementById('items-img-input')?.addEventListener('change',async function(){const file=this.files[0];if(!file||!pendingImgRowId)return;if(pendingImgRowId==='__new__'){alert('請先按「儲存」建立道具，再上傳圖片。');this.value='';return;}await uploadImage(pendingImgRowId,file);this.value='';pendingImgRowId=null;});
  document.querySelectorAll('.items-tab-btn').forEach(btn=>{btn.addEventListener('click',()=>{activeTab=btn.dataset.itemsTab;equipSubFilter='all';tierFilter='all';document.querySelectorAll('.items-tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderAll();});});
  document.getElementById('items-search-input')?.addEventListener('input',function(){searchQuery=this.value.trim();renderBody();});
  window.itemsUI={reload:loadItems,getAll:()=>items};
  document.addEventListener('adminConnected',()=>loadItems());

  // ── CSV 匯出 / 匯入 ──────────────────────────────────────
  // 每個 tab 的 CSV 欄位定義
  const CSV_COLS = {
    consumable:  ['name','description','effect','effectValue'],
    collectible: ['name','description'],
    equipment:   ['name','description','equipSlot','weaponType','str','agi','vit','int','dex','luk'],
    special:     ['name','description','equipSlot','str','agi','vit','int','dex','luk'],
  };

  function itemToCsvRow(item, cols) {
    return cols.map(c => {
      let v = '';
      if (c === 'name')        v = item.name || '';
      else if (c === 'description') v = item.description || '';
      else if (c === 'effect')      v = (item.effect && item.effect.type) || 'none';
      else if (c === 'effectValue') v = String((item.effect && item.effect.value) || 0);
      else if (c === 'equipSlot')   v = item.equipSlot || '';
      else if (c === 'weaponType')  v = item.weaponType || '';
      else v = String((item.equipStats && item.equipStats[c]) || 0);
      // 包裹含逗號、換行、雙引號的欄位
      if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    });
  }

  function exportCsv() {
    const cols = CSV_COLS[activeTab];
    const filtered = items.filter(i => matchesTab(i, activeTab));
    const header = cols.join(',');
    const rows = filtered.map(item => itemToCsvRow(item, cols).join(','));
    const csv = [header, ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'items_' + activeTab + '_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCsvLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { result.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  async function importCsv(file) {
    const text = await file.text();
    // 移除 BOM
    const clean = text.replace(/^\uFEFF/, '');
    const lines = clean.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { alert('檔案為空或只有標頭'); return; }
    const cols = parseCsvLine(lines[0]);
    const isEq = activeTab === 'equipment' || activeTab === 'special';
    let ok = 0, fail = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCsvLine(lines[i]);
      const row = {};
      cols.forEach((c, idx) => { row[c] = vals[idx] ?? ''; });
      if (!row.name || !row.name.trim()) continue;
      const payload = {
        name: row.name.trim(),
        description: row.description || '',
        itemType: isEq ? 'equipment' : defaultItemType(activeTab),
      };
      if (activeTab === 'consumable') {
        payload.effect = { type: row.effect || 'none', value: Number(row.effectValue) || 0 };
      }
      if (isEq) {
        payload.equipSlot  = row.equipSlot || defaultSlot(activeTab);
        payload.equipStats = {
          str: Number(row.str) || 0, agi: Number(row.agi) || 0,
          vit: Number(row.vit) || 0, int: Number(row.int) || 0,
          dex: Number(row.dex) || 0, luk: Number(row.luk) || 0,
        };
        payload.weaponType = row.weaponType || null;
      }
      const res  = await fetch('/admin/items', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.status === 'ok') ok++; else fail++;
    }
    window.logActivity && window.logActivity(`✅ CSV 匯入完成：成功 ${ok} 筆，失敗 ${fail} 筆`);
    await loadItems();
  }

  document.getElementById('items-btn-export')?.addEventListener('click', exportCsv);
  document.getElementById('items-btn-import')?.addEventListener('click', () => {
    document.getElementById('items-csv-input').click();
  });
  document.getElementById('items-csv-input')?.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    await importCsv(file);
    this.value = '';
  });
})();
