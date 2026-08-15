(function () {
  "use strict";
  function setActive(active) {
    window.adminSessionActive = Boolean(active);
    document.body.classList.toggle("admin-session-active", Boolean(active));
  }
  async function createSession(password) {
    const response = await fetch("/api/admin/session/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: String(password || "") })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "管理員登入失敗");
    setActive(true);
    return payload.data;
  }
  async function restoreSession() {
    const response = await fetch("/api/admin/session", { headers: { Accept: "application/json" } });
    setActive(response.ok);
    return response.ok;
  }
  async function clearSession() {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => {});
    setActive(false);
  }
  async function bootstrapConsole() {
    await window.adminBindings?.bootstrapConsole?.();
    document.dispatchEvent(new Event("adminConnected"));
  }
  function wireLogin(elements, log) {
    // 主後台每次開啟或重整都要由管理員主動輸入密碼。
    // HttpOnly Session 只供本次登入後的 API 請求使用，不在載入時自動恢復畫面權限。
    setActive(false);
    elements.adminPassword.value = "";
    elements.adminPassword.placeholder = "輸入後台管理員密碼 / Token...";
    elements.connectButton.addEventListener("click", async () => {
      try {
        await createSession(elements.adminPassword.value.trim());
        elements.adminPassword.value = "";
        elements.adminPassword.placeholder = "已建立安全工作階段";
        await bootstrapConsole();
      } catch (error) {
        elements.connectionState.textContent = error.message;
        log(`連線失敗：${error.message}`);
      }
    });
  }
  window.adminSession = { createSession, restoreSession, clearSession, wireLogin };
})();
