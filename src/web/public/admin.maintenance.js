// 後台：開／關服排程（openAt 未到=尚未開服；activateAt 到了=賽季結束；enabled=強制維護）
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("maint-save")) return;

  function headers() {
    return {
      Authorization: "Bearer " + (window.elements?.adminPassword?.value?.trim() || ""),
      "Content-Type": "application/json",
    };
  }
  // ISO(UTC) → datetime-local 需要的本機時間字串 YYYY-MM-DDTHH:mm
  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  // datetime-local(本機) → ISO(UTC)；空=null
  function toISO(v) {
    if (!v) return null;
    const d = new Date(v); // 以瀏覽器時區解讀
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const PHASE_ZH = { pre_open: "🟡 尚未開服（擋登入中）", open: "🟢 開放中", closed: "🔴 已關服／維護中（擋登入）" };

  async function load() {
    try {
      const res = await fetch("/admin/maintenance/config", { headers: headers() });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
      const s = j.data ?? j;
      $("maint-phase").textContent = "目前狀態：" + (PHASE_ZH[s.phase] || s.phase);
      $("maint-openAt").value = toLocalInput(s.openAt);
      $("maint-activateAt").value = toLocalInput(s.activateAt);
      $("maint-enabled").checked = s.enabled === true;
      $("maint-openTitle").value = s.openTitle || "";
      $("maint-openMessage").value = s.openMessage || "";
      $("maint-title").value = s.title || "";
      $("maint-message").value = s.message || "";
      $("maint-status").textContent = "已載入。白名單不受時間限制。";
    } catch (e) {
      $("maint-status").textContent = "載入失敗：" + (e.message || e);
    }
  }

  async function save() {
    $("maint-status").textContent = "儲存中…";
    const body = {
      openAt: toISO($("maint-openAt").value),
      activateAt: toISO($("maint-activateAt").value),
      enabled: $("maint-enabled").checked,
      openTitle: $("maint-openTitle").value,
      openMessage: $("maint-openMessage").value,
      title: $("maint-title").value,
      message: $("maint-message").value,
    };
    try {
      const res = await fetch("/admin/maintenance/config", { method: "POST", headers: headers(), body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
      const s = j.data ?? j;
      $("maint-phase").textContent = "目前狀態：" + (PHASE_ZH[s.phase] || s.phase);
      $("maint-status").textContent = "✅ 已儲存（後端 15 秒內生效）。";
    } catch (e) {
      $("maint-status").textContent = "儲存失敗：" + (e.message || e);
    }
  }

  $("maint-save").addEventListener("click", save);
  $("maint-reload").addEventListener("click", load);
  // 進到「權限與白名單」分頁時載入一次
  document.querySelector('[data-target="section-access"]')?.addEventListener("click", () => setTimeout(load, 50));
  load();
})();
