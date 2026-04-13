const TOKEN_KEY = "battle_viewer_token";

function resolveApiOrigin() {
  const envUrl = typeof import.meta !== "undefined" ? import.meta.env?.VITE_API_URL : "";
  if (envUrl) return String(envUrl).replace(/\/+$/, "");
  const host = window.location.hostname;
  if (host === "127.0.0.1" || host === "localhost") return "http://127.0.0.1:5566";
  return window.location.origin.replace(/\/+$/, "");
}

export class BattleViewerApi {
  constructor() {
    this.apiOrigin = resolveApiOrigin();
    this.token = localStorage.getItem(TOKEN_KEY) || "";
  }

  async request(path, { method = "GET", body, auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`${this.apiOrigin}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const json = await response.json();
    if (!response.ok || json.status !== "ok") {
      const err = new Error(json?.message || `HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }
    return json.data;
  }

  async loginGuest() {
    if (this.token) return this.token;
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const data = await this.request("/api/auth/discord", {
      method: "POST",
      body: { code: "mock:battle-viewer", redirect_uri: redirectUri },
    });
    this.token = data.token || "";
    if (this.token) localStorage.setItem(TOKEN_KEY, this.token);
    return this.token;
  }

  async fetchZones() {
    let battleConfig = null;
    try {
      battleConfig = await this.request("/api/viewer/battle-config");
    } catch (_err) {
      battleConfig = null;
    }

    try {
      const snapshot = await this.request("/api/viewer/snapshot");
      return {
        source: "viewer_snapshot",
        zones: snapshot.zones || [],
        refreshedAt: snapshot.refreshedAt || null,
        battleConfig
      };
    } catch (publicError) {
      if (publicError.status && publicError.status !== 404) throw publicError;
    }

    await this.loginGuest();
    const zones = await this.request("/api/combat/zones", { auth: true });
    return {
      source: "combat_zones",
      zones,
      refreshedAt: new Date().toISOString(),
      battleConfig
    };
  }
}
