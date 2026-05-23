const { Router } = require("express");
const jwt = require("jsonwebtoken");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");

const STATE_TTL = "10m";

function getJwtSecret() {
  return config.streamAuth?.stateSecret || process.env.JWT_SECRET || "creator-auth-secret";
}

function getPublicBaseUrl(req) {
  const configured = String(config.api?.publicBaseUrl || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (req?.get && req?.protocol) {
    const host = req.get("host");
    if (host) return `${req.protocol}://${host}`.replace(/\/+$/, "");
  }
  return `http://localhost:${config.api?.port || 5566}`;
}

function htmlEscape(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderResultPage(title, lines, buttons = []) {
  const lineHtml = lines.map((l) => `<p>${htmlEscape(l)}</p>`).join("");
  const btnHtml = buttons.map((b) => `<a class="btn ${htmlEscape(b.kind || "primary")}" href="${htmlEscape(b.href)}">${htmlEscape(b.label)}</a>`).join("");
  return `<!DOCTYPE html><html lang="zh-Hant"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${htmlEscape(title)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0f1220;color:#f5f7ff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:760px;width:100%;background:#171b2c;border:1px solid #2b3350;border-radius:18px;padding:24px}
h1{font-size:24px;margin:0 0 14px}
p{margin:8px 0;line-height:1.7;color:#d7defc}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700;margin-top:8px;margin-right:8px}
.btn.primary{background:#5b67ff;color:#fff}
.btn.secondary{background:#20273c;color:#fff;border:1px solid #32406b}
</style></head>
<body><main class="card"><h1>${htmlEscape(title)}</h1>${lineHtml}<div>${btnHtml}</div></main></body></html>`;
}

function createAdminCreatorAuthRoutes(serviceContext) {
  const router = Router();
  const creatorTokenService = serviceContext.creatorTokenService;

  const path = require("path");
  router.get("/admin/creator-auth", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(path.resolve(__dirname, "../../web/public/admin-creator-auth.html"));
  });

  function requireAdmin(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (token !== config.api.adminPassword) {
      return res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
    }
    next();
  }

  function buildCallbackUrl(req, provider) {
    return `${getPublicBaseUrl(req)}/api/creator-auth/callback/${provider}`;
  }

  router.get("/admin/creator-auth/status", requireAdmin, async (_req, res, next) => {
    try {
      const status = await creatorTokenService.getStatus();
      res.json(ok(status));
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/creator-auth/start", requireAdmin, async (req, res, next) => {
    try {
      const provider = String(req.body?.provider || req.query?.provider || "").trim().toLowerCase();
      if (!["twitch", "youtube"].includes(provider)) {
        return res.status(400).json(fail("INVALID_PROVIDER", "provider 必須是 twitch 或 youtube"));
      }
      const state = jwt.sign(
        { provider, purpose: "admin-creator-oauth", adminPassword: config.api.adminPassword },
        getJwtSecret(),
        { expiresIn: STATE_TTL }
      );
      const redirectUri = buildCallbackUrl(req, provider);
      const url = creatorTokenService.buildAuthorizeUrl({ provider, redirectUri, state });
      res.json(ok({ url, redirectUri, provider }));
    } catch (err) {
      next(err);
    }
  });

  // Debug: 用 broadcaster token 直接打 YouTube members API，看 Google 回的完整錯誤
  router.get("/admin/creator-auth/debug/youtube-members", requireAdmin, async (req, res, next) => {
    try {
      const channelId = String(req.query.channelId || "").trim();
      const token = await creatorTokenService.getValidToken("youtube");
      const url = channelId
        ? `https://www.googleapis.com/youtube/v3/members?part=snippet&filterByMemberChannelId=${encodeURIComponent(channelId)}&maxResults=5`
        : `https://www.googleapis.com/youtube/v3/members?part=snippet&maxResults=5`;
      const apiRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const body = await apiRes.text();
      res.json(ok({
        status: apiRes.status,
        statusText: apiRes.statusText,
        url,
        body: body.slice(0, 2000)
      }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/creator-auth/revoke", requireAdmin, async (req, res, next) => {
    try {
      const provider = String(req.body?.provider || req.query?.provider || "").trim().toLowerCase();
      if (!["twitch", "youtube"].includes(provider)) {
        return res.status(400).json(fail("INVALID_PROVIDER", "provider 必須是 twitch 或 youtube"));
      }
      await creatorTokenService.revoke(provider);
      res.json(ok({ provider, status: "revoked" }));
    } catch (err) {
      next(err);
    }
  });

  // OAuth callback：由 Twitch/Google 直接打進來，state 內含 adminPassword 驗證
  router.get("/api/creator-auth/callback/:provider", async (req, res) => {
    const provider = String(req.params.provider || "").trim().toLowerCase();
    try {
      if (!["twitch", "youtube"].includes(provider)) {
        return res.status(400).send(renderResultPage("授權失敗", ["❌ 未知的 provider"]));
      }
      const code = String(req.query.code || "").trim();
      const stateRaw = String(req.query.state || "").trim();
      if (!code || !stateRaw) {
        return res.status(400).send(renderResultPage(`${provider} 授權失敗`, ["❌ 缺少 code 或 state"]));
      }
      let state;
      try {
        state = jwt.verify(stateRaw, getJwtSecret());
      } catch (_) {
        return res.status(400).send(renderResultPage(`${provider} 授權失敗`, ["❌ state token 無效或已過期"]));
      }
      if (state?.purpose !== "admin-creator-oauth" || state?.provider !== provider) {
        return res.status(400).send(renderResultPage(`${provider} 授權失敗`, ["❌ state token 用途不符"]));
      }
      if (state?.adminPassword !== config.api.adminPassword) {
        return res.status(403).send(renderResultPage(`${provider} 授權失敗`, ["❌ 管理員密碼已變更，請重新從後台發起授權"]));
      }

      const redirectUri = buildCallbackUrl(req, provider);
      const tokenResponse = await creatorTokenService.exchangeCodeForToken({ provider, code, redirectUri });

      let broadcasterUserId = null;
      let broadcasterDisplayName = null;
      if (provider === "twitch") {
        const userRes = await fetch("https://api.twitch.tv/helix/users", {
          headers: {
            Authorization: `Bearer ${tokenResponse.accessToken}`,
            "Client-Id": config.streamAuth?.twitchClientId || ""
          }
        });
        const userData = await userRes.json().catch(() => ({}));
        const user = userData?.data?.[0] || null;
        if (user) {
          broadcasterUserId = String(user.id || "");
          broadcasterDisplayName = String(user.display_name || user.login || "");
        }
      } else if (provider === "youtube") {
        const chRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", {
          headers: { Authorization: `Bearer ${tokenResponse.accessToken}` }
        });
        const chData = await chRes.json().catch(() => ({}));
        const channel = chData?.items?.[0] || null;
        if (channel) {
          broadcasterUserId = String(channel.id || "");
          broadcasterDisplayName = String(channel.snippet?.title || channel.id || "");
        }
      }

      await creatorTokenService.saveBroadcasterToken({
        provider,
        tokenResponse,
        broadcasterUserId,
        broadcasterDisplayName,
        notes: `Authorized at ${new Date().toISOString()}`
      });

      return res.send(renderResultPage(`${provider} 授權完成`, [
        `✅ ${provider} broadcaster token 已寫入資料庫`,
        `頻道：${broadcasterDisplayName || "(未取得名稱)"} (${broadcasterUserId || "?"})`,
        `Scope：${tokenResponse.scope.join(", ") || "(無)"}`,
        `Expires in：${tokenResponse.expiresIn || "?"} 秒`
      ], [
        { label: "回到後台", href: "/admin", kind: "secondary" }
      ]));
    } catch (err) {
      return res.status(400).send(renderResultPage(`${provider} 授權失敗`, [
        `❌ ${err.message || "未知錯誤"}`
      ]));
    }
  });

  return router;
}

module.exports = { createAdminCreatorAuthRoutes };
