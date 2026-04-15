/* admin.tailwindify.js
   簡易 Tailwind 增強器：按一下切換按鈕即可把現有 UI 的主要區塊套上 Tailwind utility classes。
   這是漸進式遷移的第一步，保留現有 DOM IDs 與現有 JS 邏輯。
*/
(function(){
  const KEY = 'eg_admin_tailwind';

  function setBtnState(btn, on){
    if(!btn) return;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Tailwind: On' : 'Tailwind: Off';
  }

  function applyTailwind(on){
    // body
    if(on){
      document.body.classList.add('bg-white','text-slate-800');
      document.body.style.backgroundImage = 'none';
    } else {
      document.body.classList.remove('bg-white','text-slate-800');
      document.body.style.backgroundImage = '';
    }

    // topbar
    const top = document.querySelector('.window-top');
    if(top){
      if(on){ top.classList.add('bg-white','border-b','border-gray-200','shadow-sm'); }
      else { top.classList.remove('bg-white','border-b','border-gray-200','shadow-sm'); }
    }

    // sidebar
    const hero = document.querySelector('.hero');
    if(hero){
      if(on){ hero.classList.add('bg-white','border-r','border-gray-100'); }
      else { hero.classList.remove('bg-white','border-r','border-gray-100'); }
    }

    // nav links
    document.querySelectorAll('.nav-link').forEach(el=>{
      if(on){ el.classList.add('text-slate-600','hover:bg-slate-50','rounded-md','px-3','py-2'); }
      else { el.classList.remove('text-slate-600','hover:bg-slate-50','rounded-md','px-3','py-2'); }
    });

    // cards
    document.querySelectorAll('.card,.access-card,.role-item,.binding-item,.player-hero-card').forEach(el=>{
      if(on){ el.classList.add('bg-white','border','border-gray-100','shadow-sm','rounded-lg','p-6'); }
      else { el.classList.remove('bg-white','border','border-gray-100','shadow-sm','rounded-lg','p-6'); }
    });

    // buttons and control buttons
    document.querySelectorAll('.button, .control-btn').forEach(b=>{
      if(on){ b.classList.add('rounded-md','px-3','py-2','bg-white','border','border-gray-200','text-sm'); }
      else { b.classList.remove('rounded-md','px-3','py-2','bg-white','border','border-gray-200','text-sm'); }
    });

    // inputs
    document.querySelectorAll('input[type="text"],input[type="password"],input[type="number"],select,textarea').forEach(i=>{
      if(on){ i.classList.add('bg-white','border','border-gray-200','rounded-md','px-3','py-2','text-sm','text-slate-800'); }
      else { i.classList.remove('bg-white','border','border-gray-200','rounded-md','px-3','py-2','text-sm','text-slate-800'); }
    });

    // tables
    document.querySelectorAll('table').forEach(t=>{
      if(on){
        t.classList.add('min-w-full','text-sm','divide-y','divide-gray-100');
        t.querySelectorAll('th, td').forEach(cell=>{ cell.classList.add('py-2','pr-4','text-left'); });
      } else {
        t.classList.remove('min-w-full','text-sm','divide-y','divide-gray-100');
        t.querySelectorAll('th, td').forEach(cell=>{ cell.classList.remove('py-2','pr-4','text-left'); });
      }
    });

    // hero heading small tweaks
    document.querySelectorAll('.hero h1').forEach(h=>{
      if(on){ h.classList.add('text-xl','font-bold','text-slate-900'); }
      else { h.classList.remove('text-xl','font-bold','text-slate-900'); }
    });

    // item picker modal adjustments
    document.querySelectorAll('.item-picker-modal').forEach(modal=>{
      const sheet = modal.querySelector('.item-picker-sheet');
      if(on){
        modal.classList.add('fixed','inset-0','flex','items-center','justify-center','bg-black/40','p-4');
        if(sheet) sheet.classList.add('bg-white','rounded-lg','p-6','shadow-lg','max-w-4xl','w-full');
        modal.querySelectorAll('.item-picker-card').forEach(c=> c.classList.add('bg-white','border','border-gray-100','rounded-md','p-3'));
      } else {
        modal.classList.remove('fixed','inset-0','flex','items-center','justify-center','bg-black/40','p-4');
        if(sheet) sheet.classList.remove('bg-white','rounded-lg','p-6','shadow-lg','max-w-4xl','w-full');
        modal.querySelectorAll('.item-picker-card').forEach(c=> c.classList.remove('bg-white','border','border-gray-100','rounded-md','p-3'));
      }
    });

    // image cropper modal adjustments
    const cropper = document.getElementById('image-cropper-modal');
    if(cropper){
      const inner = cropper.querySelector(':scope > div');
      if(on){
        cropper.classList.add('fixed','inset-0','flex','items-center','justify-center','bg-black/40');
        if(inner){ inner.classList.add('bg-white','p-4','rounded-lg','shadow-lg'); inner.style.background = ''; inner.style.color = ''; }
      } else {
        cropper.classList.remove('fixed','inset-0','flex','items-center','justify-center','bg-black/40');
        if(inner){ inner.classList.remove('bg-white','p-4','rounded-lg','shadow-lg'); inner.style.background = ''; inner.style.color = ''; }
      }
    }
  }

  function removeExactDuplicateElements(){
    const nodes = Array.from(document.querySelectorAll('[id]'));
    const seen = new Set();
    nodes.forEach(el=>{
      try{
        const key = el.id + '::' + el.outerHTML;
        if(seen.has(key)){
          el.remove();
          console.warn('Removed duplicate element', el.id);
        } else {
          seen.add(key);
        }
      }catch(e){/* ignore */}
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    // Remove exact duplicate elements created by double-includes
    removeExactDuplicateElements();

    const btn = document.getElementById('tailwind-toggle');
    const initial = localStorage.getItem(KEY) === 'on';
    setBtnState(btn, initial);
    if(initial) applyTailwind(true);
    if(btn){
      btn.addEventListener('click', ()=>{
        const current = localStorage.getItem(KEY) === 'on';
        const next = !current;
        localStorage.setItem(KEY, next ? 'on' : 'off');
        applyTailwind(next);
        setBtnState(btn, next);
      });
    }
  });

})();
