// admin.modal-fixes.js
// 強制關閉 modal 補丁：Esc、overlay 點擊與備援 close 按鈕
(function(){
  const SELECTORS = [
    '#image-cropper-modal',
    '.item-picker-modal',
    '.shop-picker-modal',
    '.modal',
    '.sheet',
    '[role="dialog"]'
  ];

  function tryHideModal(el){
    if(!el) return false;
    try{
      if(el.style && (el.style.display === 'flex' || el.style.display === 'block' || el.style.display === 'grid')){
        el.style.display = 'none';
      }
      el.classList.remove('open','is-open','visible','show');
      el.classList.remove('backdrop','backdrop-open');
      const sheet = el.querySelector && el.querySelector('.item-picker-sheet');
      if(sheet) sheet.classList.remove('open','is-open');
      return true;
    }catch(e){
      console.warn('modal-fixes: hide failed', e);
      return false;
    }
  }

  function closeAllKnownModals(){
    let closed = 0;
    SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(m => { if(tryHideModal(m)) closed++; });
    });
    return closed;
  }

  function ensureFallbackCloseButton(modal){
    if(!modal || modal.dataset.modalFixCloseBound==='1') return;
    try{
      const header = modal.querySelector('.modal-header') || modal.querySelector('.section-head') || modal;
      const existing = modal.querySelector('.modal-fallback-close');
      if(!existing){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal-fallback-close button';
        btn.textContent = 'Close';
        btn.style.position = 'absolute';
        btn.style.top = '8px';
        btn.style.right = '8px';
        btn.style.zIndex = 2001;
        btn.addEventListener('click', ()=> tryHideModal(modal));
        header.style.position = header.style.position || 'relative';
        header.appendChild(btn);
      }
      modal.dataset.modalFixCloseBound = '1';
    }catch(e){/* ignore */}
  }

  function bindOverlayClicks(modal){
    if(!modal || modal.dataset.modalFixBound==='1') return;
    try{
      modal.addEventListener('click', function(ev){
        if(ev.target === modal){
          tryHideModal(modal);
        }
      });
      ensureFallbackCloseButton(modal);
      modal.dataset.modalFixBound = '1';
    }catch(e){/* ignore */}
  }

  function scanAndBind(){
    SELECTORS.forEach(sel=>{
      document.querySelectorAll(sel).forEach(modal => bindOverlayClicks(modal));
    });
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    scanAndBind();
    try{
      const mo = new MutationObserver((records)=>{
        let seen = false;
        for(const r of records){
          if(r.addedNodes && r.addedNodes.length) { seen = true; break; }
        }
        if(seen) scanAndBind();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }catch(e){/* ignore */}

    document.addEventListener('keydown', function(ev){
      if(ev.key === 'Escape' || ev.key === 'Esc'){
        const closed = closeAllKnownModals();
        if(closed > 0){ ev.preventDefault(); ev.stopPropagation(); }
      }
    }, { capture: true });

    document.addEventListener('click', function(ev){
      const target = ev.target.closest && ev.target.closest('[data-modal-close]');
      if(target){
        const modal = target.closest(SELECTORS.join(',')) || document.getElementById('image-cropper-modal');
        if(modal) tryHideModal(modal);
      }
    });

    window.adminModalFix = {
      closeAll: closeAllKnownModals,
      scan: scanAndBind
    };
  });

})();
