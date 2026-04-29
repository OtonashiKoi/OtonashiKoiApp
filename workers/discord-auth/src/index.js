const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

function htmlEscape(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPage(title, lines, button) {
  const lineHtml = lines.map((line) => `<p>${htmlEscape(line)}</p>`).join("");
  const buttonHtml = button
    ? `<a class="btn" href="${htmlEscape(button.href)}">${htmlEscape(button.label)}</a>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)}</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0d1120;color:#f5f7ff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{width:min(760px,100%);background:#171c2f;border:1px solid #2b3558;border-radius:18px;padding:26px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
    h1{margin:0 0 14px;font-size:28px}
    p{margin:8px 0;line-height:1.7;color:#d6defd}
    .btn{display:inline-flex;align-items:center;justify-content:center;margin-top:18px;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700;background:#5865f2;color:#fff}
    .muted{margin-top:14px;color:#9aa4cf;font-size:13px}
  </style>
</head>
<body>
  <main class="card">
    <h1>${htmlEscape(title)}</h1>
    ${lineHtml}
    ${buttonHtml}
    <p class="muted">這個頁面由 Cloudflare Workers 提供，適合正式 OAuth 回呼使用。</p>
  </main>
</body>
</html>`;
}

function getBaseUrl(req) {
  return new URL(req.url).origin.replace(/\/+$/, "");
}

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const padded = String(input).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (String(input).length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(data)));
  return base64UrlEncode(new Uint8Array(sig));
}

async function signState(payload, secret, ttlSeconds = 15 * 60) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const signature = await hmacSha256(secret, signingInput);
  return `${signingInput}.${signature}`;
}

async function verifyState(token, secret) {
  const [encodedHeader, encodedBody, signature] = String(token || "").split(".");
  if (!encodedHeader || !encodedBody || !signature) {
    throw new Error("授權狀態無效，請重新從玩家面板開啟。");
  }
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const expected = await hmacSha256(secret, signingInput);
  if (expected !== signature) {
    throw new Error("授權狀態簽章驗證失敗，請重新從玩家面板開啟。");
  }
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedBody)));
  if (!payload?.exp || Math.floor(Date.now() / 1000) > Number(payload.exp)) {
    throw new Error("授權狀態已過期，請重新從玩家面板開啟。");
  }
  return payload;
}

function authSecret(env) {
  return String(env.AUTH_STATE_SECRET || env.JWT_SECRET || env.DISCORD_CLIENT_SECRET || "stream-auth-secret");
}

function dbSecret(env) {
  return String(env.STREAM_BINDING_API_TOKEN || env.INTERNAL_API_TOKEN || "").trim();
}

async function discordApi(path, { env, method = "GET", body = null, token = null } = {}) {
  const res = await fetch(`https://discord.com/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(env.DISCORD_BOT_TOKEN ? { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `${res.status} ${res.statusText}`);
  }
  return data;
}

async function fetchDiscordProfile(env, accessToken) {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    throw new Error(data?.message || "Discord profile fetch failed");
  }
  return {
    id: String(data.id),
    username: String(data.username || ""),
    globalName: String(data.global_name || ""),
    avatar: data.avatar || null
  };
}

async function fetchGuildMember(env, discordId) {
  if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) return null;
  const res = await fetch(`https://discord.com/api/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(discordId)}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

async function sendDm(env, discordId, lines) {
  if (!env.DISCORD_BOT_TOKEN) return false;
  try {
    const channel = await discordApi("/users/@me/channels", {
      env,
      method: "POST",
      body: { recipient_id: String(discordId) }
    });
    await discordApi(`/channels/${channel.id}/messages`, {
      env,
      method: "POST",
      body: { content: lines.join("\n") }
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function queryBindings(env, sql, params = []) {
  const stmt = env.DB.prepare(sql);
  const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
  return result?.results || [];
}

function normalizeBinding(row) {
  if (!row) return null;
  let memberRoleIdsAtLink = [];
  if (Array.isArray(row.member_role_ids_at_link)) {
    memberRoleIdsAtLink = row.member_role_ids_at_link.map((id) => String(id).trim()).filter(Boolean);
  } else if (typeof row.member_role_ids_at_link === "string" && row.member_role_ids_at_link.trim()) {
    try {
      const parsed = JSON.parse(row.member_role_ids_at_link);
      memberRoleIdsAtLink = Array.isArray(parsed) ? parsed.map((id) => String(id).trim()).filter(Boolean) : [];
    } catch (_) {}
  }

  return {
    platform: String(row.platform || "").trim().toLowerCase(),
    platformUserId: String(row.platform_user_id || row.platformUserId || "").trim(),
    discordId: String(row.discord_id || row.discordId || "").trim(),
    displayName: String(row.display_name || row.displayName || "").trim(),
    linkedAt: row.linked_at || row.linkedAt || null,
    playerTierAtLink: row.player_tier_at_link || row.playerTierAtLink || null,
    memberRoleIdsAtLink,
    updatedAt: row.updated_at || row.updatedAt || null
  };
}

async function listBindings(env) {
  return (await queryBindings(env, "SELECT * FROM stream_account_bindings ORDER BY platform ASC, linked_at ASC"))
    .map(normalizeBinding)
    .filter(Boolean);
}

async function listBindingsByDiscord(env, discordId) {
  return (await queryBindings(env, "SELECT * FROM stream_account_bindings WHERE discord_id = ? ORDER BY linked_at ASC, updated_at ASC", [String(discordId || "").trim()]))
    .map(normalizeBinding)
    .filter(Boolean);
}

async function findBindingByPlatformAndUserId(env, platform, platformUserId) {
  const rows = await queryBindings(env, "SELECT * FROM stream_account_bindings WHERE platform = ? AND platform_user_id = ? LIMIT 1", [
    String(platform || "").trim().toLowerCase(),
    String(platformUserId || "").trim()
  ]);
  return normalizeBinding(rows[0] || null);
}

async function findBindingByDiscordAndPlatform(env, discordId, platform) {
  const rows = await queryBindings(env, "SELECT * FROM stream_account_bindings WHERE discord_id = ? AND platform = ? LIMIT 1", [
    String(discordId || "").trim(),
    String(platform || "").trim().toLowerCase()
  ]);
  return normalizeBinding(rows[0] || null);
}

async function upsertBinding(env, binding) {
  const doc = normalizeBinding({
    platform: binding.platform,
    platform_user_id: binding.platformUserId,
    discord_id: binding.discordId,
    display_name: binding.displayName,
    linked_at: binding.linkedAt,
    player_tier_at_link: binding.playerTierAtLink,
    member_role_ids_at_link: binding.memberRoleIdsAtLink,
    updated_at: new Date().toISOString()
  });
  if (!doc.platform || !doc.platformUserId || !doc.discordId) {
    throw new Error("Invalid stream binding payload");
  }

  const samePlatformForDiscord = await findBindingByDiscordAndPlatform(env, doc.discordId, doc.platform);
  if (samePlatformForDiscord && samePlatformForDiscord.platformUserId && samePlatformForDiscord.platformUserId !== doc.platformUserId) {
    throw new Error(`你的 ${doc.platform === "youtube" ? "YouTube" : "Twitch"} 已綁定過，無法更換帳號。`);
  }

  const existingByPlatform = await findBindingByPlatformAndUserId(env, doc.platform, doc.platformUserId);
  if (existingByPlatform && existingByPlatform.discordId && existingByPlatform.discordId !== doc.discordId) {
    throw new Error("該帳號已綁定其他DC");
  }

  const linkedAt = doc.linkedAt || new Date().toISOString();
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO stream_account_bindings (
      platform, platform_user_id, discord_id, display_name, linked_at,
      player_tier_at_link, member_role_ids_at_link, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, platform_user_id) DO UPDATE SET
      discord_id = excluded.discord_id,
      display_name = excluded.display_name,
      linked_at = COALESCE(stream_account_bindings.linked_at, excluded.linked_at),
      player_tier_at_link = COALESCE(excluded.player_tier_at_link, stream_account_bindings.player_tier_at_link),
      member_role_ids_at_link = excluded.member_role_ids_at_link,
      updated_at = excluded.updated_at
  `).bind(
    doc.platform,
    doc.platformUserId,
    doc.discordId,
    doc.displayName || "",
    linkedAt,
    doc.playerTierAtLink || null,
    JSON.stringify(doc.memberRoleIdsAtLink || []),
    updatedAt
  ).run();

  return {
    ...doc,
    linkedAt,
    updatedAt
  };
}

async function deleteByDiscordId(env, discordId) {
  const result = await env.DB.prepare("DELETE FROM stream_account_bindings WHERE discord_id = ?")
    .bind(String(discordId || "").trim())
    .run();
  return { deletedCount: Number(result?.meta?.changes || 0) };
}

async function buildBindingAudit(env, discordId) {
  const bindings = await listBindingsByDiscord(env, discordId);
  const duplicates = [];
  for (const binding of bindings) {
    if (!binding?.platform || !binding?.platformUserId) continue;
    const other = await findBindingByPlatformAndUserId(env, binding.platform, binding.platformUserId);
    if (other && String(other.discordId || "") !== String(discordId)) {
      duplicates.push({
        platform: binding.platform,
        platformUserId: binding.platformUserId,
        displayName: binding.displayName,
        otherDiscordId: other.discordId
      });
    }
  }
  return { bindings, duplicates };
}

async function handleDiscordStart(req, env) {
  const url = new URL(req.url);
  const discordId = String(url.searchParams.get("discordId") || "").trim();
  const discordName = String(url.searchParams.get("discordName") || "").trim();
  if (!discordId) {
    return textResponse(renderPage("授權失敗", ["❌ 缺少 Discord ID。"]));
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return textResponse(renderPage("授權失敗", [
      "❌ Discord OAuth 尚未設定完成。",
      "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
    ]), 500);
  }

  const callbackUrl = `${getBaseUrl(req)}/api/discord-auth/callback`;
  const state = await signState(
    { discordId, discordName, purpose: "discord-binding-audit" },
    authSecret(env)
  );
  const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent"
  }).toString();
  return Response.redirect(authorizeUrl.toString(), 302);
}

async function handleDiscordCallback(req, env) {
  try {
    const url = new URL(req.url);
    const state = await verifyState(url.searchParams.get("state"), authSecret(env));
    if (!state || state.purpose !== "discord-binding-audit") {
      throw new Error("授權狀態無效，請重新從玩家面板開啟。");
    }
    const code = String(url.searchParams.get("code") || "").trim();
    if (!code) {
      return textResponse(renderPage("Discord 授權失敗", ["❌ 缺少授權 code。"]), 400);
    }
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
      return textResponse(renderPage("Discord 授權失敗", [
        "❌ Discord OAuth 尚未設定完成。",
        "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
      ]), 500);
    }

    const callbackUrl = `${getBaseUrl(req)}/api/discord-auth/callback`;
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl
      })
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(tokenData?.error_description || tokenData?.error || "Discord token exchange failed");
    }

    const profile = await fetchDiscordProfile(env, tokenData.access_token);
    if (state.discordId && String(state.discordId) !== String(profile.id)) {
      throw new Error("你登入的 Discord 與按鈕發送者不一致，請使用原本那個帳號重新驗證。");
    }

    if (env.DISCORD_GUILD_ID && env.DISCORD_BOT_TOKEN) {
      const member = await fetchGuildMember(env, profile.id);
      if (!member) {
        return textResponse(renderPage("Discord 授權失敗", ["❌ 你必須先加入伺服器才能進行驗證。"]), 403);
      }
    }

    const audit = await buildBindingAudit(env, profile.id);
    const lines = [
      "✅ Discord 授權完成",
      `帳號：${profile.globalName || profile.username || "Unknown"} (${profile.id})`,
      audit.bindings.length > 0
        ? `目前綁定：${audit.bindings.map((b) => `${b.platform === "youtube" ? "YouTube" : "Twitch"}:${b.displayName || b.platformUserId}`).join("、")}`
        : "目前沒有任何直播綁定",
      audit.duplicates.length > 0
        ? `重複綁定：${audit.duplicates.map((d) => `${d.platform === "youtube" ? "YouTube" : "Twitch"}:${d.displayName || d.platformUserId} → ${d.otherDiscordId}`).join("、")}`
        : "未發現與其他 DC 重複的綁定"
    ];

    await sendDm(env, profile.id, lines);

    return textResponse(renderPage("Discord 驗證完成", lines, {
      label: "回到 Discord",
      href: env.DISCORD_INVITE_URL || "https://discord.gg/"
    }));
  } catch (err) {
    return textResponse(renderPage("Discord 授權失敗", [`❌ ${err.message || "Discord 授權失敗"}`]), 400);
  }
}

async function requireInternalAuth(req, env) {
  const expected = dbSecret(env);
  if (!expected) return true;
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return auth.slice(7).trim() === expected;
}

async function handleBindingsApi(req, env) {
  if (!(await requireInternalAuth(req, env))) {
    return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && path === "/api/bindings") {
    return jsonResponse({ ok: true, bindings: await listBindings(env) });
  }

  if (req.method === "GET" && path.startsWith("/api/bindings/by-discord/")) {
    const discordId = decodeURIComponent(path.split("/").pop() || "");
    const platform = String(url.searchParams.get("platform") || "").trim().toLowerCase();
    const bindings = await listBindingsByDiscord(env, discordId);
    if (platform) {
      return jsonResponse({ ok: true, binding: bindings.find((row) => row.platform === platform) || null });
    }
    return jsonResponse({ ok: true, bindings });
  }

  if (req.method === "GET" && path.startsWith("/api/bindings/by-platform/")) {
    const parts = path.split("/");
    const platform = decodeURIComponent(parts[3] || "");
    const platformUserId = decodeURIComponent(parts[4] || "");
    const binding = await findBindingByPlatformAndUserId(env, platform, platformUserId);
    return jsonResponse({ ok: true, binding });
  }

  if (req.method === "POST" && path === "/api/bindings/upsert") {
    const body = await req.json().catch(() => ({}));
    const binding = await upsertBinding(env, body);
    return jsonResponse({ ok: true, binding });
  }

  if (req.method === "DELETE" && path.startsWith("/api/bindings/by-discord/")) {
    const discordId = decodeURIComponent(path.split("/").pop() || "");
    const result = await deleteByDiscordId(env, discordId);
    return jsonResponse({ ok: true, ...result });
  }

  return jsonResponse({ ok: false, message: "Not Found" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && path === "/") {
      return textResponse(renderPage("音無樂園認證頁", [
        "這個 Worker 提供 Discord 授權與綁定查核入口。",
        "請從遊戲內玩家面板按「更新位階」開啟。"
      ], {
        label: "前往 Discord 授權",
        href: `${getBaseUrl(req)}/api/discord-auth/start`
      }));
    }

    if (path === "/api/discord-auth/start" && req.method === "GET") {
      return handleDiscordStart(req, env);
    }

    if (path === "/api/discord-auth/callback" && req.method === "GET") {
      return handleDiscordCallback(req, env);
    }

    if (path.startsWith("/api/bindings")) {
      return handleBindingsApi(req, env);
    }

    return textResponse(renderPage("404", ["❌ 找不到這個頁面。"]), 404);
  }
};
