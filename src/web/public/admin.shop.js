/* admin.shop.js */
(function(){
  let shopItems=[],libraryItems=[],shopClaims=[],activeTab='all';
  const STANDARD_SLOTS=new Set(['head_top','head_mid','head_low','armor','weapon','shield','garment','shoes','accessory_l','accessory_r']);
  const SPECIAL_SLOTS=new Set(['title_eq','job_eq','special_1','special_2','special_3']);
  function getLibItem(id){return libraryItems.find(i=>i.id===id)||null;}
  function matchesTab(shopItem,tab){
    if(tab==='all')return true;
    const lib=getLibItem(shopItem.itemLibraryId);
    if(!lib)return tab==='all';
    if(tab==='consumable')return lib.itemType==='consumable';
    if(tab==='collectible')return lib.itemType==='collectible';
    if(tab==='equipment')return lib.itemType==='equipment'&&STANDARD_SLOTS.has(lib.equipSlot);
    if(tab==='special')return lib.itemType==='equipment'&&SPECIAL_SLOTS.has(lib.equipSlot);
    if(tab==='job_badge')return lib.itemType==='job_badge';
    return true;
  }
  const TIER_RANKS=["E","D","C","B","A","S","SS"];
  const COLS=["seq","img","item","price","currency","stock","monthLimit","dayLimit","claimLimit","tiers","sale","enabled","actions"];
  const COL_HEADERS={seq:"#",img:"圖片",item:"道具名稱",price:"售價",currency:"幣種",stock:"庫存(-1=無限)",monthLimit:"月上限(0=無限)",dayLimit:"日上限(0=無限)",claimLimit:"會員紀錄",tiers:"限定等級(空=全部)",sale:"優惠",enabled:"上架",actions:"操作"};
  const COL_WIDTHS={seq:"36px",img:"52px",item:"220px",price:"72px",currency:"90px",stock:"90px",monthLimit:"100px",dayLimit:"100px",claimLimit:"112px",tiers:"210px",sale:"48px",enabled:"52px",actions:"100px"};
  function auth(){return{Authorization:`Bearer ${window.getAdminToken?window.getAdminToken():""}` };}
  function jsonH(){return{"Content-Type":"application/json",...auth()};}
  async function loadShop(){const res=await fetch("/admin/shop/items",{headers:auth()});const json=await res.json();if(json.status==="ok"){shopItems=json.data||[];renderAll();}else{window.logActivity&&window.logActivity("❌ 無法載入商品："+(json.message||""));}}
  async function loadLib(){const res=await fetch("/admin/items",{headers:auth()});const json=await res.json();if(json.status==="ok")libraryItems=json.data||[];}
  async function loadClaims(){const res=await fetch("/admin/shop/claims",{headers:auth()});const json=await res.json();if(json.status==="ok"){shopClaims=json.data||[];renderClaims();}else{window.logActivity&&window.logActivity("❌ 無法載入會員獎勵紀錄："+(json.message||""));}}
  function renderAll(){renderHead();renderBody();}
  function renderHead(){const h=document.getElementById("shop-sheet-head");if(!h)return;h.innerHTML=`<tr>${COLS.map(c=>`<th style="min-width:${COL_WIDTHS[c]};white-space:nowrap;">${COL_HEADERS[c]}</th>`).join("")}</tr>`;}
  function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

  // ── Item Picker Modal（與怪物掉落物相同風格）──
  const PICKER_TABS=[{key:"all",label:"全部"},{key:"weapon",label:"⚔️ 武器"},{key:"defense",label:"🛡️ 防具/盾"},{key:"head",label:"🪖 頭部"},{key:"accessory",label:"💍 飾品"},{key:"consumable",label:"🧪 消耗品"},{key:"collectible",label:"📦 收藏品"},{key:"job_badge",label:"📖 職業徽章"}];
  const WEAPON_TYPE_LABELS={sword_1h:'劍(單)',sword_2h:'劍(雙)',mace_1h:'鎚(單)',mace_2h:'鎚(雙)',axe_1h:'斧(單)',axe_2h:'斧(雙)',dagger:'匕首',staff_1h:'杖(單)',staff_2h:'杖(雙)',bow:'弓',dice:'骰子'};
  const TIER_COLORS={D:'#8899aa',C:'#44cc88',B:'#6699ff',A:'#ffcc44'};
  function getItemTab(it){
    if(it.itemType==='consumable')return 'consumable';
    if(it.itemType==='collectible')return 'collectible';
    if(it.itemType==='job_badge')return 'job_badge';
    if(it.itemType!=='equipment')return 'other';
    const s=it.equipSlot||'';
    if(s==='weapon')return 'weapon';
    if(s==='shield'||s==='armor'||s==='garment'||s==='shoes')return 'defense';
    if(s.startsWith('head'))return 'head';
    if(s.startsWith('accessory'))return 'accessory';
    return 'defense';
  }
  function formatStats(equipStats){if(!equipStats)return'';return Object.entries(equipStats).map(([k,v])=>`${k.toUpperCase()}+${v}`).join(' ');}

  function getShopPickerModal(){
    let modal=document.getElementById('shop-item-picker-modal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.id='shop-item-picker-modal';
    modal.style.cssText='display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.65);align-items:center;justify-content:center;padding:16px;';
    const panel=document.createElement('div');
    panel.style.cssText='width:1100px;max-width:98vw;height:88vh;display:flex;flex-direction:column;border-radius:10px;background:var(--surface);border:1px solid var(--accent);padding:16px;box-shadow:0 8px 40px rgba(0,0,0,0.7);overflow:hidden;';

    // Header
    const header=document.createElement('div');
    header.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-shrink:0;';
    header.innerHTML='<strong style="font-size:1rem;">選擇道具</strong>';
    const closeBtn=document.createElement('button');
    closeBtn.className='button';closeBtn.textContent='關閉';
    closeBtn.addEventListener('click',()=>{modal.style.display='none';modal._cb=null;});
    header.appendChild(closeBtn);

    // 搜尋
    const search=document.createElement('input');
    search.type='text';search.placeholder='🔍 搜尋道具...';
    search.style.cssText='width:100%;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid var(--line);background:var(--bg);flex-shrink:0;box-sizing:border-box;';

    // Tab 列
    let pickerActiveTab='all',pickerActiveTier='all';
    const tabBar=document.createElement('div');
    tabBar.style.cssText='display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;flex-shrink:0;';
    const tierBar=document.createElement('div');
    tierBar.style.cssText='display:flex;gap:4px;margin-bottom:10px;flex-shrink:0;align-items:center;';
    tierBar.innerHTML='<span style="font-size:11px;color:var(--muted);margin-right:4px;">階級：</span>';

    function mkChip(label,active,onClick,color){
      const c=document.createElement('span');
      c.textContent=label;
      c.style.cssText=`padding:3px 10px;border-radius:20px;font-size:12px;cursor:pointer;border:1px solid ${color||'var(--line)'};transition:all 0.15s;`;
      c.style.background=active?(color||'var(--accent)'):'transparent';
      c.style.color=active?'#111':(color||'var(--text)');
      c.addEventListener('click',onClick);
      return c;
    }
    function renderPickerTabBar(){
      tabBar.innerHTML='';
      PICKER_TABS.forEach(t=>{
        tabBar.appendChild(mkChip(t.label,pickerActiveTab===t.key,()=>{pickerActiveTab=t.key;renderPickerTabBar();renderPickerTierBar();renderPickerItems(search.value);},null));
      });
    }
    function renderPickerTierBar(){
      const show=['all','weapon','defense','head','accessory'].includes(pickerActiveTab);
      tierBar.style.display=show?'flex':'none';
      while(tierBar.children.length>1)tierBar.removeChild(tierBar.lastChild);
      [['all','全部','var(--muted)'],['D','D 級',TIER_COLORS.D],['C','C 級',TIER_COLORS.C],['B','B 級',TIER_COLORS.B],['A','A 級',TIER_COLORS.A]].forEach(([v,l,col])=>{
        tierBar.appendChild(mkChip(l,pickerActiveTier===v,()=>{pickerActiveTier=v;renderPickerTierBar();renderPickerItems(search.value);},col));
      });
    }

    const content=document.createElement('div');
    content.style.cssText='flex:1;overflow-y:auto;overflow-x:hidden;';

    function makePickerCard(it){
      const card=document.createElement('div');
      card.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:7px;cursor:pointer;border:1px solid transparent;transition:background 0.12s;';
      card.addEventListener('mouseenter',()=>{card.style.background='var(--surface-hover)';card.style.borderColor='var(--accent)';});
      card.addEventListener('mouseleave',()=>{card.style.background='';card.style.borderColor='transparent';});
      const thumb=it.imageThumbnailUrl||it.imageUrl||'';
      const tierBadge=it.tier?`<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${TIER_COLORS[it.tier]||'#888'};color:#111;font-weight:700;margin-left:4px;">${it.tier}</span>`:'';
      const statsLine=it.itemType==='equipment'?`<div style="font-size:10px;color:var(--muted);margin-top:1px;">${formatStats(it.equipStats)||'—'}</div>`:`<div style="font-size:10px;color:var(--muted);">${it.effect?.type!=='none'?it.effect?.type:''}</div>`;
      card.innerHTML=`${thumb?`<img src="${thumb}" style="width:34px;height:34px;object-fit:contain;border-radius:5px;flex-shrink:0;"/>`:`<div style="width:34px;height:34px;background:rgba(255,255,255,0.05);border-radius:5px;flex-shrink:0;"></div>`}<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.name}${tierBadge}</div>${statsLine}</div>`;
      card.addEventListener('click',()=>{
        if(typeof modal._cb==='function')modal._cb(it);
        modal.style.display='none';modal._cb=null;
      });
      return card;
    }

    function renderPickerItems(filter){
      content.innerHTML='';
      const kw=(filter||'').trim().toLowerCase();
      let list=kw?libraryItems.filter(i=>(i.name||'').toLowerCase().includes(kw)):libraryItems;
      if(pickerActiveTab!=='all')list=list.filter(i=>getItemTab(i)===pickerActiveTab);
      if(pickerActiveTier!=='all'&&pickerActiveTab!=='job_badge')list=list.filter(i=>i.tier===pickerActiveTier);
      if(!list.length){content.innerHTML='<div style="text-align:center;color:var(--muted);padding:40px;">沒有符合條件的道具</div>';return;}
      if(pickerActiveTab==='weapon'||(pickerActiveTab==='all'&&!kw)){
        const weapons=list.filter(i=>i.equipSlot==='weapon');
        const rest=list.filter(i=>i.equipSlot!=='weapon');
        if(weapons.length){
          const wtGroups={};
          weapons.forEach(i=>{const wt=i.weaponType||'other';if(!wtGroups[wt])wtGroups[wt]=[];wtGroups[wt].push(i);});
          Object.entries(wtGroups).forEach(([wt,items])=>{
            const section=document.createElement('div');section.style.cssText='margin-bottom:14px;';
            const sh=document.createElement('div');sh.style.cssText='font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;border-bottom:1px solid var(--line);padding-bottom:4px;';
            sh.textContent=WEAPON_TYPE_LABELS[wt]||wt;section.appendChild(sh);
            const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;';
            items.forEach(it=>grid.appendChild(makePickerCard(it)));section.appendChild(grid);content.appendChild(section);
          });
        }
        if(rest.length){const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;';rest.forEach(it=>grid.appendChild(makePickerCard(it)));content.appendChild(grid);}
      } else {
        const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;';
        list.forEach(it=>grid.appendChild(makePickerCard(it)));content.appendChild(grid);
      }
    }

    search.addEventListener('input',()=>renderPickerItems(search.value));
    renderPickerTabBar();renderPickerTierBar();

    panel.append(header,search,tabBar,tierBar,content);
    modal.appendChild(panel);document.body.appendChild(modal);

    modal.open=function({cb=null}={}){
      modal._cb=cb;
      search.value='';pickerActiveTab='all';pickerActiveTier='all';
      renderPickerTabBar();renderPickerTierBar();renderPickerItems('');
      modal.style.display='flex';
    };
    return modal;
  }

  // ── 商品列 item 欄：改為 picker 按鈕 ──
  function buildItemCell(item){
    const lib=getLibItem(item.itemLibraryId);
    const thumb=lib?.imageThumbnailUrl||lib?.imageUrl||'';
    const thumbHtml=thumb?`<img src="${esc(thumb)}" style="width:22px;height:22px;object-fit:contain;border-radius:3px;flex-shrink:0;">`:'<div style="width:22px;height:22px;background:rgba(255,255,255,0.05);border-radius:3px;flex-shrink:0;"></div>';
    const label=lib?lib.name:'— 請選擇道具 —';
    return `<td>
      <div style="display:flex;gap:6px;align-items:center;">
        <span class="shop-item-thumb" style="flex-shrink:0;">${thumbHtml}</span>
        <span class="shop-item-label" style="flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${lib?'var(--text)':'var(--muted)'};">${esc(label)}</span>
        <input type="hidden" class="shop-item-id" data-field="item" value="${esc(item.itemLibraryId||'')}">
        <button type="button" class="button small shop-pick-btn" style="flex-shrink:0;">選擇</button>
      </div>
    </td>`;
  }

  function buildRow(item,isNew=false,seq=0){
    const id=item.id||"__new__";
    const imgHtml=item.imageUrl?`<img src="${esc(item.imageUrl)}" style="height:36px;width:36px;object-fit:cover;border-radius:4px;">`:"—";
    const cells={
      seq:`<td style="text-align:center;color:var(--muted);font-size:0.8em;user-select:none;">${isNew?"":seq}</td>`,
      img:`<td style="text-align:center;width:52px;" class="shop-img-td">${imgHtml}</td>`,
      item:buildItemCell(item),
      price:`<td><input class="sheet-input" data-field="price" type="number" min="0" value="${esc(String(item.price??100))}" style="width:100%;text-align:right;"></td>`,
      currency:`<td><select class="sheet-input" data-field="currency" style="width:100%;"><option value="gold"${(item.currency||"gold")==="gold"?" selected":""}>💰 金幣</option><option value="diamond"${item.currency==="diamond"?" selected":""}>💎 鑽石</option></select></td>`,
      stock:`<td><input class="sheet-input" data-field="stock" type="number" value="${esc(String(item.stock??-1))}" style="width:100%;text-align:right;"></td>`,
      monthLimit:`<td><input class="sheet-input" data-field="monthLimit" type="number" min="0" value="${esc(String(item.maxPerMonth??0))}" style="width:100%;text-align:right;"></td>`,
      dayLimit:`<td><input class="sheet-input" data-field="dayLimit" type="number" min="0" value="${esc(String(item.maxPerDay??0))}" style="width:100%;text-align:right;"></td>`,
      claimLimit:`<td><select class="sheet-input" data-field="claimLimit" style="width:100%;"><option value="none"${(item.claimLimit||"none")==="none"?" selected":""}>無</option><option value="once_per_player"${item.claimLimit==="once_per_player"?" selected":""}>每人一次</option></select></td>`,
      tiers:`<td style="white-space:nowrap;">${TIER_RANKS.map(r=>`<span class="tier-chip${(item.allowedTiers||[]).includes(r)?" active":""}" data-tier="${r}">${r}</span>`).join("")}</td>`,
      sale:`<td style="text-align:center;"><input type="checkbox" data-field="sale"${item.isSale?" checked":""}></td>`,
      enabled:`<td style="text-align:center;"><input type="checkbox" data-field="enabled"${item.enabled!==false?" checked":""}></td>`,
      actions:`<td style="white-space:nowrap;"><button class="button small shop-save-btn">儲存</button>${!isNew?`<button class="button small danger shop-del-btn" data-name="${esc(item.name||"")}">刪除</button>`:""}</td>`
    };
    return `<tr data-shop-id="${esc(id)}">${COLS.map(c=>cells[c]||"<td></td>").join("")}</tr>`;
  }
  function bindEvents(tbody){
    tbody.querySelectorAll(".shop-save-btn").forEach(btn=>btn.addEventListener("click",()=>saveRow(btn.closest("tr"))));
    tbody.querySelectorAll(".shop-del-btn").forEach(btn=>btn.addEventListener("click",()=>{const tr=btn.closest("tr");deleteItem(tr.dataset.shopId,btn.dataset.name);}));
    tbody.querySelectorAll(".tier-chip").forEach(chip=>chip.addEventListener("click",()=>chip.classList.toggle("active")));
    tbody.querySelectorAll(".shop-pick-btn").forEach(btn=>btn.addEventListener("click",()=>{
      const tr=btn.closest("tr");
      const hiddenInput=tr.querySelector(".shop-item-id");
      const label=tr.querySelector(".shop-item-label");
      const thumbWrap=tr.querySelector(".shop-item-thumb");
      const imgTd=tr.querySelector(".shop-img-td");
      getShopPickerModal().open({cb:(it)=>{
        if(hiddenInput)hiddenInput.value=it.id;
        if(label){label.textContent=it.name;label.style.color='var(--text)';}
        const thumb=it.imageThumbnailUrl||it.imageUrl||'';
        if(thumbWrap)thumbWrap.innerHTML=thumb?`<img src="${esc(thumb)}" style="width:22px;height:22px;object-fit:contain;border-radius:3px;flex-shrink:0;">`:'<div style="width:22px;height:22px;background:rgba(255,255,255,0.05);border-radius:3px;flex-shrink:0;"></div>';
        if(imgTd)imgTd.innerHTML=thumb?`<img src="${esc(it.imageUrl||thumb)}" style="height:36px;width:36px;object-fit:cover;border-radius:4px;">`:'—';
      }});
    }));
  }
  function renderBody(){
    const tbody=document.getElementById("shop-tbody");
    if(!tbody)return;
    const filtered=shopItems.filter(i=>matchesTab(i,activeTab));
    if(!filtered.length){tbody.innerHTML=`<tr><td colspan="${COLS.length}" style="text-align:center;color:var(--muted);padding:2rem;">${shopItems.length?'此分類尚無商品。':'尚無商品，按「＋ 新增一行」開始上架。'}</td></tr>`;return;}
    tbody.innerHTML=filtered.map((item,i)=>buildRow(item,false,i+1)).join("");
    bindEvents(tbody);
  }
  function fmtTime(v){
    if(!v)return '—';
    try{return new Date(v).toLocaleString('zh-TW',{hour12:false});}catch{return String(v);}
  }
  function renderClaims(){
    const tbody=document.getElementById("shop-claims-tbody");
    if(!tbody)return;
    if(!shopClaims.length){
      tbody.innerHTML=`<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:2rem;">目前沒有會員獎勵領取紀錄。</td></tr>`;
      return;
    }
    tbody.innerHTML=shopClaims.map((row)=>{
      return `<tr>
        <td>${esc(fmtTime(row.claimedAt))}</td>
        <td>${esc(row.boundDiscordId||'')}</td>
        <td>${esc(row.playerDisplayName||'')}</td>
        <td>${esc(row.boundYouTubeId||'')}</td>
        <td>${esc(fmtTime(row.youtubeLinkedAt))}</td>
        <td>${esc(row.boundTwitchId||'')}</td>
        <td>${esc(fmtTime(row.twitchLinkedAt))}</td>
        <td>${esc(row.itemName||row.itemId||'')}</td>
        <td>${esc(row.claimLimit==="once_per_player"?'每人一次':'')}${row.source?` ${esc(row.source)}`:''}</td>
      </tr>`;
    }).join("");
  }
  function getPayload(tr){
    const get=f=>tr.querySelector(`[data-field="${f}"]`)?.value??"";
    const chk=f=>tr.querySelector(`[data-field="${f}"]`)?.checked??false;
    const allowedTiers=[...tr.querySelectorAll(".tier-chip.active")].map(c=>c.dataset.tier);
    return{itemLibraryId:get("item"),price:Number(get("price"))||0,currency:get("currency")||"gold",stock:Number(get("stock"))||-1,maxPerMonth:Number(get("monthLimit"))||0,maxPerDay:Number(get("dayLimit"))||0,claimLimit:get("claimLimit")||"none",allowedTiers,isSale:chk("sale"),enabled:chk("enabled")};
  }
  async function saveRow(tr){
    const id=tr.dataset.shopId,payload=getPayload(tr);
    if(!payload.itemLibraryId){alert("請選擇道具");return;}
    const isNew=id==="__new__";
    const res=await fetch(isNew?"/admin/shop/items":`/admin/shop/items/${id}`,{method:isNew?"POST":"PUT",headers:jsonH(),body:JSON.stringify(payload)});
    const json=await res.json();
    if(json.status==="ok"){window.logActivity&&window.logActivity(`✅ 商品已${isNew?"新增":"更新"}：${json.data.name}`);await loadShop();}
    else{window.logActivity&&window.logActivity("❌ 儲存失敗："+(json.message||""));}
  }
  async function deleteItem(id,name){
    if(!confirm(`確定要刪除「${name}」？`))return;
    const res=await fetch(`/admin/shop/items/${id}`,{method:"DELETE",headers:auth()});
    const json=await res.json();
    if(json.status==="ok"){window.logActivity&&window.logActivity(`✅ 商品已刪除：${name}`);await loadShop();}
    else{window.logActivity&&window.logActivity("❌ 刪除失敗："+(json.message||""));}
  }
  function addNewRow(){
    const tbody=document.getElementById("shop-tbody");
    if(!tbody)return;
    const ph=tbody.querySelector("td[colspan]");
    if(ph)ph.closest("tr").remove();
    const ei={id:"__new__",itemLibraryId:"",price:100,currency:"gold",stock:-1,maxPerMonth:0,maxPerDay:0,claimLimit:"none",allowedTiers:[],isSale:false,enabled:true};
    const tmp=document.createElement("tbody");
    tmp.innerHTML=buildRow(ei,true);
    const nr=tmp.firstElementChild;
    tbody.prepend(nr);
    bindEvents(tbody);
    nr.querySelector('.shop-pick-btn')?.focus();
  }
  window.shopUI={reload:async()=>{await loadShop();await loadClaims();}};
  document.getElementById("shop-btn-new")?.addEventListener("click",addNewRow);
  document.getElementById("shop-claims-refresh")?.addEventListener("click",loadClaims);
  document.querySelectorAll(".shop-tab-btn").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".shop-tab-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    activeTab=btn.dataset.shopTab;
    renderBody();
  }));
  document.addEventListener("adminConnected",async()=>{await loadLib();await loadShop();await loadClaims();});
})();
