const config = require("../../config");

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh if expiring within 5 minutes

const PROVIDER_CONFIGS = {
  twitch: {
    tokenUrl: "https://id.twitch.tv/oauth2/token",
    revokeUrl: "https://id.twitch.tv/oauth2/revoke",
    authorizeUrl: "https://id.twitch.tv/oauth2/authorize",
    defaultScopes: [
      "channel:read:subscriptions",
      "moderator:read:followers"
    ]
  },
  youtube: {
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    defaultScopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.channel-memberships.creator"
    ]
  }
};

function getProviderCredentials(provider) {
  const auth = config.streamAuth || {};
  if (provider === "twitch") {
    return {
      clientId: auth.twitchClientId || "",
      clientSecret: auth.twitchClientSecret || "",
      broadcasterId: auth.twitchBroadcasterId || ""
    };
  }
  if (provider === "youtube") {
    return {
      clientId: auth.youtubeClientId || "",
      clientSecret: auth.youtubeClientSecret || "",
      seedRefreshToken: auth.youtubeCreatorRefreshToken || ""
    };
  }
  return {};
}

class CreatorTokenService {
  constructor({ creatorTokenRepository }) {
    if (!creatorTokenRepository) {
      throw new Error("CreatorTokenService requires creatorTokenRepository");
    }
    this.repo = creatorTokenRepository;
    this.inFlightRefresh = new Map();
  }

  getProviderConfig(provider) {
    return PROVIDER_CONFIGS[provider] || null;
  }

  buildAuthorizeUrl({ provider, redirectUri, state, extraScopes = [] }) {
    const cfg = this.getProviderConfig(provider);
    const creds = getProviderCredentials(provider);
    if (!cfg || !creds.clientId) {
      throw new Error(`${provider} OAuth 未設定完成（缺少 clientId）。`);
    }
    const scopes = Array.from(new Set([...cfg.defaultScopes, ...extraScopes]));
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      state
    });
    if (provider === "youtube") {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    } else if (provider === "twitch") {
      params.set("force_verify", "true");
    }
    const url = new URL(cfg.authorizeUrl);
    url.search = params.toString();
    return url.toString();
  }

  async exchangeCodeForToken({ provider, code, redirectUri }) {
    const cfg = this.getProviderConfig(provider);
    const creds = getProviderCredentials(provider);
    if (!cfg || !creds.clientId || !creds.clientSecret) {
      throw new Error(`${provider} OAuth 未設定完成（缺少 clientId 或 clientSecret）。`);
    }
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    });
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error_description || data.error || `${provider} token exchange failed`);
    }
    return this._normalizeTokenResponse(data);
  }

  async saveBroadcasterToken({ provider, tokenResponse, broadcasterUserId, broadcasterDisplayName, notes }) {
    const expiresAt = tokenResponse.expiresIn
      ? new Date(Date.now() + tokenResponse.expiresIn * 1000).toISOString()
      : null;
    return this.repo.save({
      provider,
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      scope: tokenResponse.scope,
      tokenType: tokenResponse.tokenType,
      expiresAt,
      broadcasterUserId,
      broadcasterDisplayName,
      status: "active",
      notes: notes || null,
      lastRefreshedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString()
    });
  }

  async getValidToken(provider) {
    let record = await this.repo.get(provider);

    // Fallback: if no DB record but legacy env var refresh token exists (YouTube only), bootstrap from it.
    if (!record && provider === "youtube") {
      const creds = getProviderCredentials("youtube");
      if (creds.seedRefreshToken) {
        record = await this.repo.save({
          provider: "youtube",
          refreshToken: creds.seedRefreshToken,
          status: "active",
          notes: "Bootstrapped from STREAM_YOUTUBE_CREATOR_REFRESH_TOKEN env var"
        });
      }
    }

    if (!record || !record.refreshToken) {
      throw new Error(`${provider} broadcaster token 尚未設定，請至 /admin/creator-auth 完成授權。`);
    }
    if (record.status === "revoked") {
      throw new Error(`${provider} broadcaster token 已被撤銷，請重新授權。`);
    }

    const needsRefresh = !record.accessToken
      || !record.expiresAt
      || (new Date(record.expiresAt).getTime() - Date.now() < REFRESH_THRESHOLD_MS);

    if (needsRefresh) {
      record = await this._refreshTokenLocked(provider, record);
    }

    return record.accessToken;
  }

  async _refreshTokenLocked(provider, currentRecord) {
    if (this.inFlightRefresh.has(provider)) {
      return this.inFlightRefresh.get(provider);
    }
    const promise = this._doRefresh(provider, currentRecord).finally(() => {
      this.inFlightRefresh.delete(provider);
    });
    this.inFlightRefresh.set(provider, promise);
    return promise;
  }

  async _doRefresh(provider, currentRecord) {
    const cfg = this.getProviderConfig(provider);
    const creds = getProviderCredentials(provider);
    if (!cfg || !creds.clientId || !creds.clientSecret) {
      throw new Error(`${provider} OAuth 未設定完成（缺少 clientId 或 clientSecret）。`);
    }
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: currentRecord.refreshToken,
      grant_type: "refresh_token"
    });
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const message = data.error_description || data.error || `${provider} token refresh failed`;
      await this.repo.updateStatus(provider, {
        status: "expired",
        notes: `Refresh failed at ${new Date().toISOString()}: ${message}`
      });
      throw new Error(message);
    }
    const normalized = this._normalizeTokenResponse(data);
    const expiresAt = normalized.expiresIn
      ? new Date(Date.now() + normalized.expiresIn * 1000).toISOString()
      : null;
    return this.repo.updateStatus(provider, {
      accessToken: normalized.accessToken,
      // Twitch returns a new refresh_token; Google may omit it (then keep current)
      refreshToken: normalized.refreshToken || currentRecord.refreshToken,
      scope: normalized.scope.length > 0 ? normalized.scope : currentRecord.scope,
      expiresAt,
      status: "active",
      lastRefreshedAt: new Date().toISOString(),
      notes: null
    });
  }

  async getStatus() {
    const records = await this.repo.list();
    const result = {};
    for (const provider of Object.keys(PROVIDER_CONFIGS)) {
      const record = records.find((r) => r.provider === provider) || null;
      const creds = getProviderCredentials(provider);
      result[provider] = {
        provider,
        configured: Boolean(creds.clientId && creds.clientSecret),
        hasToken: Boolean(record?.refreshToken),
        accessTokenValid: Boolean(record?.accessToken && record.expiresAt && new Date(record.expiresAt).getTime() > Date.now()),
        expiresAt: record?.expiresAt || null,
        status: record?.status || "unset",
        scope: record?.scope || [],
        broadcasterUserId: record?.broadcasterUserId || null,
        broadcasterDisplayName: record?.broadcasterDisplayName || null,
        lastRefreshedAt: record?.lastRefreshedAt || null,
        lastVerifiedAt: record?.lastVerifiedAt || null,
        updatedAt: record?.updatedAt || null,
        notes: record?.notes || null
      };
    }
    return result;
  }

  async markVerified(provider) {
    return this.repo.updateStatus(provider, { lastVerifiedAt: new Date().toISOString() });
  }

  async revoke(provider) {
    return this.repo.updateStatus(provider, { status: "revoked" });
  }

  _normalizeTokenResponse(raw) {
    const scopeRaw = raw.scope;
    let scope = [];
    if (Array.isArray(scopeRaw)) {
      scope = scopeRaw.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof scopeRaw === "string") {
      scope = scopeRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    }
    return {
      accessToken: String(raw.access_token || "").trim(),
      refreshToken: String(raw.refresh_token || "").trim(),
      tokenType: String(raw.token_type || "Bearer").trim(),
      expiresIn: Number(raw.expires_in) || null,
      scope
    };
  }
}

module.exports = { CreatorTokenService };
