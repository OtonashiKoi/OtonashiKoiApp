/* admin.shop.js */
(function(){
  let shopItems=[],libraryItems=[],activeTab='all';
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
    return true;
  }
  const TIER_RANKS=["E","D","C","B","A","S","SS"];
  const COLS=["seq","img","item","price","currency","stock","monthLimit","tiers","sale","enabled","actions"];
  const COL_HEADERS={seq:"#",img:"圖片",item:"道具名稱",price:"售價",currency:"幣種",stock:"庫存(-1=無限)",monthLimit:"月上限(0=無限)",tiers:"限定等級(空=全部)",sale:"優惠",enabled:"上架",actions:"操作"};
  const COL_WIDTHS={seq:"36px",img:"52px",item:"180px",price:"72px",currency:"90px",stock:"90px",monthLimit:"100px",tiers:"210px",sale:"48px",enabled:"52px",actions:"100px"};
  function auth(){return{Authorization:`Bearer ${window.getAdminToken?window.getAdminToken():""}` };}
  function jsonH(){return{"Content-Type":"application/json",...auth()};}
  async function loadShop(){const res=await fetch("/admin/shop/items",{headers:auth()});const json=await res.json();if(json.status==="ok"){shopItems=json.data||[];renderAll();}else{window.logActivity&&window.logActivity("❌ 無法載入商品："+(json.message||""));}}
  async function loadLib(){const res=await fetch("/admin/items",{headers:auth()});const json=await res.json();if(json.status==="ok")libraryItems=json.data||[];}
  function renderAll(){renderHead();renderBody();}
  function renderHead(){const h=document.getElementById("shop-sheet-head");if(!h)return;h.innerHTML=`<tr>${COLS.map(c=>`<th style="min-width:${COL_WIDTHS[c]};white-space:nowrap;">${COL_HEADERS[c]}</th>`).join("")}</tr>`;}
  function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function itemOpts(selId){return`<option value="">— 請選擇道具 —</option>`+libraryItems.map(it=>`<option value="${esc(it.id)}"${it.id===selId?" selected":""}>${esc(it.name)}</option>`).join("");}
  function buildRow(item,isNew=false,seq=0){
    const id=item.id||"__new__";
    const tiers=(item.allowedTiers||[]).join(",");
    const imgHtml=item.imageUrl?`<img src="${esc(item.imageUrl)}" style="height:36px;width:36px;object-fit:cover;border-radius:4px;">`:"—";
    const cells={
      seq:`<td style="text-align:center;color:var(--muted);font-size:0.8em;user-select:none;">${isNew?"":seq}</td>`,
      img:`<td style="text-align:center;width:52px;">${imgHtml}</td>`,
      item:`<td><select class="sheet-input" data-field="item" style="width:100%;">${itemOpts(item.itemLibraryId)}</select></td>`,
      price:`<td><input class="sheet-input" data-field="price" type="number" min="0" value="${esc(String(item.price??100))}" style="width:100%;text-align:right;"></td>`,
      currency:`<td><select class="sheet-input" data-field="currency" style="width:100%;"><option value="gold"${(item.currency||"gold")==="gold"?" selected":""}>💰 金幣</option><option value="diamond"${item.currency==="diamond"?" selected":""}>💎 鑽石</option></select></td>`,
      stock:`<td><input class="sheet-input" data-field="stock" type="number" value="${esc(String(item.stock??-1))}" style="width:100%;text-align:right;"></td>`,
      monthLimit:`<td><input class="sheet-input" data-field="monthLimit" type="number" min="0" value="${esc(String(item.maxPerMonth??0))}" style="width:100%;text-align:right;"></td>`,
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
    tbody.querySelectorAll('[data-field="item"]').forEach(sel=>sel.addEventListener("change",()=>{
      const lib=libraryItems.find(it=>it.id===sel.value);
      const imgTd=sel.closest("tr").querySelector("td:nth-child(2)");
      if(imgTd)imgTd.innerHTML=lib?.imageUrl?`<img src="${esc(lib.imageUrl)}" style="height:36px;width:36px;object-fit:cover;border-radius:4px;">`:"—";
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
  function getPayload(tr){
    const get=f=>tr.querySelector(`[data-field="${f}"]`)?.value??"";
    const chk=f=>tr.querySelector(`[data-field="${f}"]`)?.checked??false;
    const allowedTiers=[...tr.querySelectorAll(".tier-chip.active")].map(c=>c.dataset.tier);
    return{itemLibraryId:get("item"),price:Number(get("price"))||0,currency:get("currency")||"gold",stock:Number(get("stock"))||-1,maxPerMonth:Number(get("monthLimit"))||0,allowedTiers,isSale:chk("sale"),enabled:chk("enabled")};
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
    const ei={id:"__new__",itemLibraryId:"",price:100,currency:"gold",stock:-1,maxPerMonth:0,allowedTiers:[],isSale:false,enabled:true};
    const tmp=document.createElement("tbody");
    tmp.innerHTML=buildRow(ei,true);
    const nr=tmp.firstElementChild;
    tbody.prepend(nr);
    bindEvents(tbody);
    nr.querySelector('[data-field="item"]')?.focus();
  }
  window.shopUI={reload:loadShop};
  document.getElementById("shop-btn-new")?.addEventListener("click",addNewRow);
  document.querySelectorAll(".shop-tab-btn").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".shop-tab-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    activeTab=btn.dataset.shopTab;
    renderBody();
  }));
  document.addEventListener("adminConnected",async()=>{await loadLib();await loadShop();});
})();
