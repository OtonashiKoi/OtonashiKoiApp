// 共用工具函式：HTTP 請求、格式化、HTML 跳脫
// ------------------------------------------------

function getHeaders() {
  const adminPasswordEl = document.getElementById("admin-password");
  const token = window.getAdminToken?.() || (adminPasswordEl ? adminPasswordEl.value.trim() : "") || (window.adminSessionActive ? "session" : "");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers || {}) }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Request failed: ${response.status}`);
  }

  return payload.data;
}

function splitLines(value) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-TW", { hour12: false });
}

function log(message) {
  const activityLog = document.getElementById("activity-log");
  if (!activityLog) return;
  const stamp = new Date().toLocaleString("zh-TW", { hour12: false });
  activityLog.textContent = `[${stamp}] ${message}\n${activityLog.textContent}`.trim();
}
