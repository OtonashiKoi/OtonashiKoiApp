// admin.tailwind-cleanup.js
// 清除 admin.tailwindify.js 可能已套用的 utility classes，並移除 localStorage 狀態與 UI toggle
(function(){
  const KEY = 'eg_admin_tailwind';
  const CLASSES = [
    'bg-white','text-slate-800','border-b','border-gray-200','shadow-sm',
    'bg-white','border-r','border-gray-100','text-slate-600','hover:bg-slate-50','rounded-md','px-3','py-2',
    'border','border-gray-100','rounded-lg','p-6','shadow-sm','rounded-md','text-sm',
    'min-w-full','divide-y','divide-gray-100','py-2','pr-4','text-left','text-xl','font-bold','text-slate-900',
    'fixed','inset-0','flex','items-center','justify-center','bg-black/40','p-4','bg-black/40','bg-white','p-4','rounded-lg','shadow-lg'
  ];

  function removeClasses(){
    CLASSES.forEach(cls => {
      document.querySelectorAll('.' + cls.split(' ').join('.')).forEach(el => el.classList.remove(cls));
    });
    // remove inline background set by tailwindify
    document.body.style.backgroundImage = '';
    document.body.classList.remove('bg-white','text-slate-800','theme-tailwind');
  }

  function removeToggleButton(){
    const btn = document.getElementById('tailwind-toggle');
    if(btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    try{
      localStorage.removeItem(KEY);
    }catch(e){}
    removeClasses();
    removeToggleButton();
    // expose for manual trigger
    window.adminTailwindCleanup = { run: removeClasses };
  });
})();
