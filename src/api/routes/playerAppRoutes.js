const { Router } = require("express");
const jwt = require("jsonwebtoken");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { getSnapshot: getStreamPresenceSnapshot } = require("../../services/stream/streamPresence");
const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");
const { isEffectConditionMet, decrementActiveEffects, collectEquipmentEffects, mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const { scaleSupportPartyEffects } = require("../../shared/supportAuraScaling");
const { ALL_ZONE_KEYS, normalizeZone, checkZoneLevelRequirementWithBinding, zoneToFeatureKey, getZoneDefaultEntryFee, getZoneTheme } = require("../../shared/zones");
const { isOnlyDTierEquipped } = require("../../shared/combatStats");
const { acquireSse } = require("../netGuards");
const { isMonsterBattleActive, isPkBattleActive, isTowerBattleActive } = require("../../shared/battlePresence");
const { acquireWebBattle } = require("../../services/progress/battleLock");

// 跨 DC/網頁/裝置「同時只能一場戰鬥」：檢查 DC 端是否正在戰鬥（怪物/PK/塔）
function describeDcBattle(discordId) {
  if (isMonsterBattleActive(discordId)) return "你正在 Discord 進行怪物戰鬥";
  if (isPkBattleActive(discordId)) return "你正在進行 PK 對戰";
  if (isTowerBattleActive(discordId)) return "你正在進行爬塔挑戰";
  return null;
}

// 排行榜顯示名稱:沒有真實暱稱(空 / 純數字 Discord ID)→ 顯示「玩家#末四碼」,不攤 18 碼 ID
function prettyLeaderboardName(displayName, discordId) {
  const dn = String(displayName || "").trim();
  const id = String(discordId || "");
  if (!dn || dn === id || /^\d{15,}$/.test(dn)) {
    return id ? `玩家#${id.slice(-4)}` : "玩家";
  }
  return dn;
}

// Track per-player battle cooldowns.
// Cooldown duration matches battle animation time: round logs * 700ms + 2s buffer.
const playerBattleCooldowns = new Map();

// 聊天圖片上傳：記憶體暫存、8MB 上限（轉發為 Discord 附件，不落地、不佔 Cloudinary）
const multer = require("multer");
const chatImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const chatImageCooldown = new Map(); // discordId -> 上次發圖時間（防洗版）
const chatTextCooldown = new Map(); // discordId -> 上次發文字時間（防洗版,1 秒冷卻）
const zoneEmoteCooldown = new Map(); // discordId -> 上次發領域表情時間（防洗版）
// 戰鬥領域快捷表情：固定用這幾個公會自訂 emoji/貼圖(依名稱),順序即顯示順序
const ZONE_EMOTE_NAMES = ["2026031101", "10", "09", "04", "waitwait", "Group43", "NO", "QQ", "洽囉", "021", "01_23", "2026021203"];
const ZONE_EMOTE_NAME_SET = new Set(ZONE_EMOTE_NAMES.map((n) => String(n)));

// 定時清理「只增不減」的防洗版冷卻 Map(每筆只是 timestamp,但避免依不重複玩家數無限累積)。
// TTL 30 分鐘遠大於實際冷卻(1~3 秒),過期刪除完全安全。
const _COOLDOWN_PRUNE_TTL_MS = 30 * 60 * 1000;
const _cooldownMapSweep = setInterval(() => {
  const now = Date.now();
  for (const m of [chatImageCooldown, chatTextCooldown, zoneEmoteCooldown]) {
    for (const [k, ts] of m) if (now - (Number(ts) || 0) > _COOLDOWN_PRUNE_TTL_MS) m.delete(k);
  }
  for (const [k, v] of playerBattleCooldowns) {
    const t = Number(v?.nextBattleAt) || 0;
    if (t && now - t > _COOLDOWN_PRUNE_TTL_MS) playerBattleCooldowns.delete(k);
  }
}, 10 * 60 * 1000);
_cooldownMapSweep.unref?.();

// webhook 訊息 id → 發送者 discordId（給引用 @ 原留言者用；webhook 訊息本身查不到真人）
const webMsgAuthors = new Map();
function rememberWebMsgAuthor(messageId, discordId) {
  if (!messageId || !discordId) return;
  webMsgAuthors.set(String(messageId), String(discordId));
  if (webMsgAuthors.size > 1000) webMsgAuthors.delete(webMsgAuthors.keys().next().value);
}

// 每回合動畫長度（ms）。可用 env `ROUND_MS` 覆寫。預設為 700 * 0.8
const ROUND_MS = Number(process.env.ROUND_MS || Math.round(700 * 0.8));

// AGI 攻速：與 DC 戰鬥相同公式（src/bot/handlers/monsterZoneHandlers.js calculateTickDelay）
// AGI 1→1500ms/回合，AGI 40+→500ms/回合；網頁端用它播放逐回合動畫，速度才會跟 DC 一致
const calculateTickDelay = (agi = 1) => {
  const baseDelay = 1500;
  const minDelay = 500;
  const capAgi = 40;
  const capped = Math.min(Math.max(1, agi), capAgi);
  return Math.round(baseDelay - ((capped - 1) / (capAgi - 1)) * (baseDelay - minDelay));
};

// 特效數值格式化 + 道具特效說明列：抽到 shared/itemEffectLines.js，
// 與戰鬥掉落氣泡（monsterZoneHandlers.toWebDrop）共用同一份格式。
const { formatEffectValueText, buildItemEffectLines } = require("../../shared/itemEffectLines");

// 由地圖狀態的 activeHealerAuras 算出「每位光環提供者 → 中文效果列」。
// 泡泡發光的真正來源（不論光環職在 DC 還是網頁戰鬥都通用），不依賴各自的 battlePresence.touch。
function buildZoneAuraMap(state) {
  const map = new Map();
  const auras = Array.isArray(state?.activeHealerAuras)
    ? state.activeHealerAuras
    : (state?.activeHealerAura ? [state.activeHealerAura] : []);
  for (const aura of auras) {
    if (!aura?.discordId) continue;
    const lines = (Array.isArray(aura.effects) ? aura.effects : [])
      .filter((eff) => eff && eff.key)
      .map((eff) => {
        const effName = EFFECT_NAME_ZH[eff.key] || eff.definitionName || eff.key;
        const vt = formatEffectValueText(eff.key, eff?.params);
        return `${effName}${vt ? ` ${vt}` : ""}`;
      });
    map.set(String(aura.discordId), lines);
  }
  return map;
}

// 與 Discord 戰鬥相同的低階區戰力同步規則。
const ZONE_DAMAGE_SYNC_RULES = {
  beginner: { maxHpRatioPerBattle: 0.30 },
  normal: { maxHpRatioPerBattle: 0.45 }
};
const DAMAGE_SYNC_NOTICE = "套用戰力同步：高階裝備與效果會暫時壓制到該區合理範圍。";

function applyZoneDamageSync(zoneKey, startMonsterHp, monsterMaxHp, rawDamage, rawFinalMonsterHp, rawOutcome) {
  const raw = Math.max(0, Math.round(Number(rawDamage || 0)));
  const startHp = Math.max(0, Math.round(Number(startMonsterHp || 0)));
  const rawFinalHp = Math.max(0, Math.round(Number(rawFinalMonsterHp ?? Math.max(0, startHp - raw))));
  const rule = ZONE_DAMAGE_SYNC_RULES[zoneKey];

  if (!rule || raw <= 0) {
    return {
      damage: raw,
      monsterHp: rawFinalHp,
      outcome: rawOutcome,
      applied: false,
      notice: null
    };
  }

  const maxHp = Math.max(1, Math.round(Number(monsterMaxHp || startHp || 1)));
  const cap = Math.max(1, Math.round(maxHp * Number(rule.maxHpRatioPerBattle || 1)));
  const damage = Math.min(raw, cap, startHp);
  const monsterHp = Math.max(0, startHp - damage);
  const outcome = rawOutcome === "lose" ? "lose" : (monsterHp <= 0 ? "win" : "timeout");
  const applied = damage < raw;

  return {
    damage,
    monsterHp,
    outcome,
    applied,
    notice: applied ? `${DAMAGE_SYNC_NOTICE} 本次有效傷害 ${damage} / 原始傷害 ${raw}。` : DAMAGE_SYNC_NOTICE
  };
}

function createPlayerAppRoutes(serviceContext, discordClient) {
  const router = Router();
  // 頭像快取用同一個 discord client(玩家氣泡需要頭像)
  try { require("../../services/realtime/avatarCache").setClient(discordClient); } catch (_) { /* noop */ }
  const STREAM_AUTH_STATE_TTL = "15m";
  const DISCORD_AUTH_STATE_TTL = "15m";

  function getPublicBaseUrl(req = null) {
    const configured = String(config.api?.publicBaseUrl || "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    if (req?.get && req?.protocol) {
      const host = req.get("host");
      if (host) return `${req.protocol}://${host}`.replace(/\/+$/, "");
    }
    return `http://localhost:${config.api?.port || 5566}`;
  }

  function signStreamAuthState(discordId) {
    return jwt.sign(
      { discordId: String(discordId || "").trim() },
      config.streamAuth?.stateSecret || process.env.JWT_SECRET || "stream-auth-secret",
      { expiresIn: STREAM_AUTH_STATE_TTL }
    );
  }

  function verifyStreamAuthState(token) {
    return jwt.verify(
      String(token || ""),
      config.streamAuth?.stateSecret || process.env.JWT_SECRET || "stream-auth-secret"
    );
  }

  function signDiscordAuthState(payload) {
    return jwt.sign(
      {
        discordId: String(payload?.discordId || "").trim(),
        discordName: String(payload?.discordName || "").trim(),
        purpose: "discord-binding-audit"
      },
      process.env.JWT_SECRET || "super-secret-jwt-key",
      { expiresIn: DISCORD_AUTH_STATE_TTL }
    );
  }

  function verifyDiscordAuthState(token) {
    return jwt.verify(
      String(token || ""),
      process.env.JWT_SECRET || "super-secret-jwt-key"
    );
  }

  function htmlEscape(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderAuthResultPage(title, lines, buttons = [], opts = {}) {
    const buttonHtml = buttons.map((btn) => {
      const href = htmlEscape(btn.href);
      const label = htmlEscape(btn.label);
      // 同網域的回遊戲連結用同分頁開；外部連結才開新分頁
      const target = String(btn.href || "").startsWith("/") ? "" : ' target="_blank" rel="noreferrer"';
      return `<a class="btn ${htmlEscape(btn.kind || "primary")}" href="${href}"${target}>${label}</a>`;
    }).join("");
    const lineHtml = lines.map((line) => `<p>${htmlEscape(line)}</p>`).join("");
    // 若在遊戲彈窗中開啟（window.opener 存在），成功時通知遊戲頁並自動關閉
    const popupScript = opts.autoClose
      ? `<script>
  (function(){
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "otonashi-stream-auth", ok: true, title: ${JSON.stringify(title)} }, "*");
        var c=document.getElementById("closehint"); if(c) c.style.display="block";
        setTimeout(function(){ window.close(); }, 1200);
      }
    } catch(e){}
  })();
</script>`
      : "";
    const closeHint = opts.autoClose
      ? `<p class="muted" id="closehint" style="display:none">已完成，視窗即將自動關閉…</p>`
      : "";
    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${htmlEscape(title)}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1220;color:#f5f7ff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:760px;width:100%;background:#171b2c;border:1px solid #2b3350;border-radius:18px;padding:24px 24px 20px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
  h1{font-size:26px;margin:0 0 14px}
  p{margin:8px 0;line-height:1.7;color:#d7defc}
  .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}
  .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700}
  .btn.primary{background:#5b67ff;color:#fff}
  .btn.secondary{background:#20273c;color:#fff;border:1px solid #32406b}
  .muted{color:#9aa4cf;font-size:13px;margin-top:14px}
</style>
</head>
<body>
  <main class="card">
    <h1>${htmlEscape(title)}</h1>
    ${lineHtml}
    <div class="actions">${buttonHtml}</div>
    ${closeHint}
  </main>
  ${popupScript}
</body>
</html>`;
  }

  function mapTwitchTierToPlayerTier(tier) {
    const normalized = String(tier || "").trim();
    const mapping = {
      "1000": "C",
      "2000": "C",
      "3000": "B"
    };
    return mapping[normalized] || null;
  }

  function mapYoutubeLevelToPlayerTier(displayName) {
    const normalized = String(displayName || "").trim();
    const mapping = config.streamMembership?.youtubeTiers || {};
    for (const [tier, name] of Object.entries(mapping)) {
      if (normalized === String(name || "").trim()) return tier;
    }
    return null;
  }

  function pickHigherTier(a, b) {
    const tierOrder = ["E", "D", "C", "B", "A", "S", "SS"];
    const normA = String(a || "").trim().toUpperCase();
    const normB = String(b || "").trim().toUpperCase();
    const idxA = tierOrder.indexOf(normA);
    const idxB = tierOrder.indexOf(normB);
    if (idxA === -1) return normB || normA || null;
    if (idxB === -1) return normA || normB || null;
    return idxA >= idxB ? normA : normB;
  }

  async function fetchGoogleCreatorAccessToken() {
    return serviceContext.creatorTokenService.getValidToken("youtube");
  }

  async function fetchTwitchBroadcasterAccessToken() {
    return serviceContext.creatorTokenService.getValidToken("twitch");
  }

  async function upsertStreamBindingAndTier({
    discordId,
    provider,
    platformUserId,
    displayName,
    tier,
    memberRoleIdsAtLink = [],
    linkedSupportAtLink = null,
    linkedSupportKindAtLink = null,
    linkedSupportBadgeLabelsAtLink = []
  }) {
    const bindingRepo = serviceContext.streamAccountBindingRepository;
    // 比對帳號是否相同時忽略歷史前綴差異（舊資料 youtube 存成 yt-UCxxx，新流程是 UCxxx）
    // → 同一個帳號重新授權只更新資料；真的換成「不同帳號」才擋
    const normId = (s) => String(s || "").replace(/^(yt-|youtube-|twitch-)/i, "").trim().toLowerCase();
    const existingSameProvider = await bindingRepo.findByDiscordAndPlatform(discordId, provider).catch(() => null);
    if (existingSameProvider && existingSameProvider.platformUserId
        && normId(existingSameProvider.platformUserId) !== normId(platformUserId)) {
      throw new Error(`你的 ${provider === "youtube" ? "YouTube" : "Twitch"} 已綁定過，無法更換帳號。`);
    }

    const existingByPlatform = await bindingRepo.findByPlatformAndUserId(provider, platformUserId).catch(() => null);
    if (existingByPlatform && existingByPlatform.discordId && existingByPlatform.discordId !== discordId) {
      throw new Error("該帳號已綁定其他DC");
    }

    const payload = {
      platform: provider,
      platformUserId,
      discordId,
      displayName,
      linkedAt: existingSameProvider?.linkedAt || new Date().toISOString(),
      playerTierAtLink: tier || existingSameProvider?.playerTierAtLink || null,
      memberRoleIdsAtLink,
      linkedSupportAtLink,
      linkedSupportKindAtLink,
      linkedSupportBadgeLabelsAtLink
    };
    await bindingRepo.save(payload);

    if (tier) {
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (progress && progress.playerTier !== tier) {
        progress.playerTier = tier;
        progress.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(progress);
      }
    }

    return payload;
  }

  async function sendTierDm(discordId, lines) {
    try {
      if (!discordClient?.isReady()) return false;
      const user = await discordClient.users.fetch(discordId).catch(() => null);
      if (!user) return false;
      await user.send(lines.join("\n"));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function getDiscordOAuthProfile(accessToken) {
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userData = await userRes.json();
    if (!userRes.ok || userData?.message || !userData?.id) {
      throw new Error(userData?.message || "Discord profile fetch failed");
    }
    return {
      id: String(userData.id),
      username: String(userData.username || "").trim(),
      globalName: String(userData.global_name || "").trim()
    };
  }

  async function buildBindingAudit(discordId) {
    const bindingRepo = serviceContext.streamAccountBindingRepository;
    const bindings = await bindingRepo.listByDiscordId(discordId).catch(() => []);
    const duplicates = [];
    for (const binding of bindings) {
      if (!binding?.platform || !binding?.platformUserId) continue;
      const found = await bindingRepo.findByPlatformAndUserId(binding.platform, binding.platformUserId).catch(() => null);
      if (found && String(found.discordId || "") !== String(discordId)) {
        duplicates.push({
          platform: binding.platform,
          platformUserId: binding.platformUserId,
          displayName: binding.displayName || found.displayName || "",
          otherDiscordId: found.discordId || "",
          linkedAt: found.linkedAt || null
        });
      }
    }
    return { bindings, duplicates };
  }

  async function getTwitchProfile(accessToken) {
    const auth = config.streamAuth || {};
    const validateRes = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const validateData = await validateRes.json();
    if (!validateRes.ok) {
      throw new Error(validateData?.message || "Twitch token validate failed");
    }
    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": auth.twitchClientId
      }
    });
    const userData = await userRes.json();
    if (!userRes.ok || !userData?.data?.length) {
      throw new Error(userData?.message || "無法取得 Twitch 使用者資料");
    }
    const user = userData.data[0];
    return {
      userId: validateData.user_id || user.id,
      login: validateData.login || user.login,
      displayName: user.display_name || validateData.login || user.login
    };
  }

  async function parseTwitchSubscriptionTier(userId) {
    const auth = config.streamAuth || {};
    if (!auth.twitchClientId || !auth.twitchBroadcasterId) {
      throw new Error("Twitch 會員驗證未設定完成，請先補齊 TWITCH_CLIENT_ID / TWITCH_BROADCASTER_ID。");
    }
    const broadcasterToken = await fetchTwitchBroadcasterAccessToken();
    const subRes = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${encodeURIComponent(auth.twitchBroadcasterId)}&user_id=${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${broadcasterToken}`,
        "Client-Id": auth.twitchClientId
      }
    });
    if (subRes.status === 404) return null;
    const subData = await subRes.json();
    if (!subRes.ok) {
      throw new Error(subData?.message || subRes.statusText || "Twitch 訂閱查詢失敗");
    }
    return subData?.data?.[0]?.tier || null;
  }

  async function getYoutubeProfile(accessToken) {
    const channelsRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const channelsData = await channelsRes.json();
    if (!channelsRes.ok || !channelsData?.items?.length) {
      throw new Error(channelsData?.error?.message || "無法取得 YouTube 頻道資料");
    }
    const channel = channelsData.items[0];
    return {
      channelId: channel.id,
      displayName: channel.snippet?.title || channel.id
    };
  }

  const buildJobSpecialDisplay = (progress) => {
    const equipped = progress?.equipment || {};
    const inventory = progress?.inventory || [];
    const jobEq = equipped.job_eq || null;
    if (!jobEq) {
      return { jobName: null, activeSpecials: [], summary: "無（未裝備職業裝）" };
    }
    const refs = [
      ...(Array.isArray(jobEq.passiveEffects) ? jobEq.passiveEffects : []),
      ...(Array.isArray(jobEq.procEffects) ? jobEq.procEffects : []),
      ...(Array.isArray(jobEq.combatEffects) ? jobEq.combatEffects : [])
    ];
    const context = { equipped, inventory };
    const activeSpecials = refs
      .filter((effect) => isEffectConditionMet(effect, context))
      .map((effect) => {
        const name = EFFECT_NAME_ZH[effect.key] || effect.definitionName || effect.key;
        const value = Number(effect?.params?.value);
        return Number.isFinite(value) ? `${name}(${value})` : name;
      });
    return {
      jobName: jobEq.itemName || null,
      activeSpecials,
      summary: activeSpecials.length > 0 ? activeSpecials.join("、") : "目前無符合條件的啟用效果"
    };
  };

  const buildCombatZonesSnapshot = async (discordId = null) => {
    const keys = ALL_ZONE_KEYS;
    return Promise.all(keys.map(async (key) => {
      const [state, monsters] = await Promise.all([
        serviceContext.monsterService.getState(key),
        serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: key })
      ]);
      let activeMonster = monsters.find((m) => m.seq === state.activeMonsterSeq);
      if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

      const dmgMap = state.damageMap || {};
      const damageLeaderboard = Object.values(dmgMap)
        .sort((a, b) => b.damage - a.damage)
        .slice(0, 10);

      const cooldown = discordId ? playerBattleCooldowns.get(discordId) : null;
      const nextBattleAt = (cooldown && cooldown.nextBattleAt > Date.now()) ? cooldown.nextBattleAt : null;

      return {
        zone: key,
        monsterId: activeMonster?.id || null,
        monsterName: activeMonster?.name || "未設定",
        monsterImageUrl: activeMonster?.imageUrl || null,
        monsterLevel: activeMonster?.level || 0,
        expReward: activeMonster?.expReward || 0,
        goldReward: activeMonster?.goldReward || 0,
        drops: (activeMonster?.drops || []).map((d) => d.itemName),
        currentHp: state.currentHp !== undefined ? state.currentHp : (activeMonster?.calc?.maxHp || 0),
        maxHp: activeMonster?.calc?.maxHp || 0,
        participantCount: Array.isArray(state.participants) ? state.participants.length : 0,
        activeMonsterSeq: state.activeMonsterSeq,
        damageLeaderboard,
        nextBattleAt,
        // 剩餘冷卻「毫秒數」(伺服器算好);前端用自己的時鐘 Date.now()+cooldownMs,
        // 避免裝置時間不準時拿絕對時間戳相減導致 CD 爆長/歸零。
        cooldownMs: nextBattleAt ? Math.max(0, nextBattleAt - Date.now()) : 0,
      };
    }));
  };

  // JWT 驗證 middleware 已抽成共用模組 ./requireAuth（行為不變），供其他玩家端 route 檔共用

  router.get("/api/stream-auth/start", async (req, res) => {
    try {
      const provider = String(req.query.provider || "").trim().toLowerCase();
      const stateToken = String(req.query.state || "").trim();
      if (!provider || !["youtube", "twitch"].includes(provider)) {
        return res.status(400).send(renderAuthResultPage("授權失敗", ["❌ 缺少或錯誤的 provider。"]));
      }
      const state = verifyStreamAuthState(stateToken);
      const baseUrl = getPublicBaseUrl(req);
      const callbackUrl = `${baseUrl}/api/stream-auth/callback/${provider}`;

      if (provider === "twitch") {
        const auth = config.streamAuth || {};
        if (!auth.twitchClientId || !auth.twitchClientSecret || !auth.twitchBroadcasterId) {
          return res.status(500).send(renderAuthResultPage("授權失敗", [
            "❌ Twitch OAuth 尚未設定完成。",
            "請補齊 TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET / TWITCH_BROADCASTER_ID。"
          ]));
        }
        const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
        authorizeUrl.search = new URLSearchParams({
          client_id: auth.twitchClientId,
          redirect_uri: callbackUrl,
          response_type: "code",
          // bind 階段只證明身分，訂閱狀態由 broadcaster token 查詢
          scope: "",
          state: stateToken
        }).toString();
        return res.redirect(authorizeUrl.toString());
      }

      const auth = config.streamAuth || {};
      if (!auth.youtubeClientId || !auth.youtubeClientSecret) {
        return res.status(500).send(renderAuthResultPage("授權失敗", [
          "❌ YouTube OAuth 尚未設定完成。",
          "請補齊 YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET。"
        ]));
      }
      // 註：broadcaster refresh token 在 creatorTokens collection（由 /admin/creator-auth 流程寫入），
      //     玩家綁定流程本身只需要 client_id/secret + 用戶 OAuth code，不需要 creator token

      const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizeUrl.search = new URLSearchParams({
        client_id: auth.youtubeClientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/youtube.readonly"
        ].join(" "),
        access_type: "offline",
        prompt: "consent",
        state: stateToken
      }).toString();
      return res.redirect(authorizeUrl.toString());
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("授權失敗", [
        `❌ ${err.message || "授權流程無法啟動"}`
      ]));
    }
  });

  router.get("/api/discord-auth/start", async (req, res) => {
    try {
      const discordId = String(req.query.discordId || "").trim();
      const discordName = String(req.query.discordName || "").trim();
      if (!discordId) {
        return res.status(400).send(renderAuthResultPage("授權失敗", ["❌ 缺少 Discord ID。"]));
      }
      const auth = config.discord || {};
      if (!auth.clientId || !auth.clientSecret) {
        return res.status(500).send(renderAuthResultPage("授權失敗", [
          "❌ Discord OAuth 尚未設定完成。",
          "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
        ]));
      }
      const stateToken = signDiscordAuthState({ discordId, discordName });
      const callbackUrl = `${getPublicBaseUrl(req)}/api/discord-auth/callback`;
      const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
      authorizeUrl.search = new URLSearchParams({
        client_id: auth.clientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: "identify",
        state: stateToken,
        prompt: "consent"
      }).toString();
      return res.redirect(authorizeUrl.toString());
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("授權失敗", [
        `❌ ${err.message || "Discord 授權流程無法啟動"}`
      ]));
    }
  });

  router.get("/api/discord-auth/callback", async (req, res) => {
    try {
      const state = verifyDiscordAuthState(req.query.state);
      if (!state || state.purpose !== "discord-binding-audit") {
        throw new Error("授權狀態無效，請重新從玩家面板開啟。");
      }
      const code = String(req.query.code || "").trim();
      if (!code) {
        return res.status(400).send(renderAuthResultPage("Discord 授權失敗", ["❌ 缺少授權 code。"]));
      }
      const auth = config.discord || {};
      if (!auth.clientId || !auth.clientSecret) {
        return res.status(500).send(renderAuthResultPage("Discord 授權失敗", [
          "❌ Discord OAuth 尚未設定完成。",
          "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
        ]));
      }

      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${getPublicBaseUrl(req)}/api/discord-auth/callback`
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData?.error_description || tokenData?.error || "Discord token exchange failed");
      }

      const profile = await getDiscordOAuthProfile(tokenData.access_token);
      if (state.discordId && String(state.discordId) !== String(profile.id)) {
        throw new Error("你登入的 Discord 與按鈕發送者不一致，請使用原本那個帳號重新驗證。");
      }

      const guildId = config.discord?.guildId;
      if (guildId && discordClient) {
        const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
        if (guild) {
          const member = await guild.members.fetch({ user: profile.id, force: true }).catch(() => null);
          if (!member) {
            return res.status(403).send(renderAuthResultPage("Discord 授權失敗", [
              "❌ 你必須先加入伺服器才能進行驗證。"
            ]));
          }
        }
      }

      const audit = await buildBindingAudit(profile.id);
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

      await sendTierDm(profile.id, lines);

      return res.send(renderAuthResultPage("Discord 驗證完成", lines, [
        { label: "回到 Discord", href: config.discord.inviteUrl || "https://discord.gg/", kind: "secondary" }
      ]));
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("Discord 授權失敗", [
        `❌ ${err.message || "Discord 授權失敗"}`
      ]));
    }
  });

  router.get("/api/stream-auth/callback/twitch", async (req, res) => {
    try {
      const state = verifyStreamAuthState(req.query.state);
      const code = String(req.query.code || "").trim();
      if (!code) {
        return res.status(400).send(renderAuthResultPage("Twitch 授權失敗", ["❌ 缺少授權 code。"]));
      }

      const auth = config.streamAuth || {};
      const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: auth.twitchClientId,
          client_secret: auth.twitchClientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${getPublicBaseUrl(req)}/api/stream-auth/callback/twitch`
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData?.message || tokenData?.error_description || "Twitch token exchange failed");
      }

      const profile = await getTwitchProfile(tokenData.access_token);
      const tierRaw = await parseTwitchSubscriptionTier(profile.userId).catch((err) => {
        console.warn("[stream-auth/twitch] subscription check via broadcaster token failed:", err.message);
        return null;
      });
        const mappedTier = mapTwitchTierToPlayerTier(tierRaw);
        const progress = await serviceContext.progressRepository.findByPlayerId(state.discordId);
        const currentTier = progress?.playerTier || null;
        const newTier = pickHigherTier(mappedTier, currentTier) || currentTier || mappedTier || null;
      const linkedSupportBadgeLabelsAtLink = tierRaw ? [`訂閱等級:${tierRaw}`] : [];

      const binding = await upsertStreamBindingAndTier({
        discordId: state.discordId,
        provider: "twitch",
        platformUserId: profile.userId,
        displayName: profile.displayName,
        tier: newTier,
        memberRoleIdsAtLink: [],
        linkedSupportAtLink: Boolean(tierRaw),
        linkedSupportKindAtLink: tierRaw ? "subscriber" : null,
        linkedSupportBadgeLabelsAtLink
      });

      const lines = [
        "✅ Twitch 授權完成",
        `帳號：${profile.displayName} (${profile.userId})`,
        tierRaw ? `訂閱等級：${tierRaw}` : "目前沒有偵測到訂閱，位階維持原狀",
        newTier ? `已同步位階：${newTier}` : `位階維持原狀：${currentTier || "未設定"}`
      ];

      await sendTierDm(state.discordId, lines);

      return res.send(renderAuthResultPage("Twitch 授權完成", lines, [
        { label: "回到遊戲", href: "/", kind: "primary" }
      ], { autoClose: true }));
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("Twitch 授權失敗", [
        `❌ ${err.message || "Twitch 授權失敗"}`
      ]));
    }
  });

  router.get("/api/stream-auth/callback/youtube", async (req, res) => {
    try {
      const state = verifyStreamAuthState(req.query.state);
      const code = String(req.query.code || "").trim();
      if (!code) {
        return res.status(400).send(renderAuthResultPage("YouTube 授權失敗", ["❌ 缺少授權 code。"]));
      }

      const auth = config.streamAuth || {};
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: auth.youtubeClientId,
          client_secret: auth.youtubeClientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${getPublicBaseUrl(req)}/api/stream-auth/callback/youtube`
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData?.error_description || tokenData?.error || "YouTube token exchange failed");
      }

      const profile = await getYoutubeProfile(tokenData.access_token);

      // 查會員狀態時容錯：頻道沒開 Channel Memberships、broadcaster token 過期、quota 用完
      // 等等情況都不該擋 bind，bind 是「身分綁定」，會員狀態查不到當未訂閱處理。
      let levelName = null;
      let memberLookupError = null;
      try {
        const creatorAccessToken = await fetchGoogleCreatorAccessToken();
        const memberRes = await fetch(`https://www.googleapis.com/youtube/v3/members?part=snippet&filterByMemberChannelId=${encodeURIComponent(profile.channelId)}&maxResults=1`, {
          headers: { Authorization: `Bearer ${creatorAccessToken}` }
        });
        const memberData = await memberRes.json().catch(() => ({}));
        if (!memberRes.ok) {
          memberLookupError = memberData?.error?.message || memberData?.error?.errors?.[0]?.message || `${memberRes.status} ${memberRes.statusText}`;
          console.warn("[stream-auth/youtube] member 查詢失敗（不擋 bind）:", memberLookupError);
        } else {
          const member = memberData?.items?.[0] || null;
          levelName = member?.snippet?.membershipsDetails?.highestAccessibleLevelDisplayName || null;
        }
      } catch (err) {
        memberLookupError = err.message || String(err);
        console.warn("[stream-auth/youtube] member 查詢例外（不擋 bind）:", memberLookupError);
      }
        const mappedTier = mapYoutubeLevelToPlayerTier(levelName);
        const progress = await serviceContext.progressRepository.findByPlayerId(state.discordId);
        const currentTier = progress?.playerTier || null;
        const newTier = pickHigherTier(mappedTier, currentTier) || currentTier || mappedTier || null;
      const linkedSupportBadgeLabelsAtLink = levelName ? [`會員等級:${levelName}`] : [];

      const binding = await upsertStreamBindingAndTier({
        discordId: state.discordId,
        provider: "youtube",
        platformUserId: profile.channelId,
        displayName: profile.displayName,
        tier: newTier,
        memberRoleIdsAtLink: [],
        linkedSupportAtLink: Boolean(levelName),
        linkedSupportKindAtLink: levelName ? "member" : null,
        linkedSupportBadgeLabelsAtLink
      });

      const lines = [
        "✅ YouTube 授權完成",
        `頻道：${profile.displayName} (${profile.channelId})`,
        levelName ? `會員等級：${levelName}` : (memberLookupError
          ? `會員狀態暫時無法查詢（${memberLookupError}）`
          : "目前沒有偵測到會員，位階維持原狀"),
        newTier ? `已同步位階：${newTier}` : `位階維持原狀：${currentTier || "未設定"}`
      ];

      await sendTierDm(state.discordId, lines);

      return res.send(renderAuthResultPage("YouTube 授權完成", lines, [
        { label: "回到遊戲", href: "/", kind: "primary" }
      ], { autoClose: true }));
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("YouTube 授權失敗", [
        `❌ ${err.message || "YouTube 授權失敗"}`
      ]));
    }
  });

  // 1. OAuth2 Login
  // 網頁 Discord 登入：導向 Discord OAuth（callback 回 game.html，前端再拿 code 換 JWT）
  router.get("/api/auth/discord/login", (req, res) => {
    try {
      const auth = config.discord || {};
      if (!auth.clientId || !auth.clientSecret) {
        return res.status(500).send(renderAuthResultPage("登入失敗", [
          "❌ Discord 登入尚未設定完成。",
          "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
        ]));
      }
      const returnTo = String(req.query.returnTo || "/game.html");
      const redirectUri = `${getPublicBaseUrl(req)}${returnTo}`;
      const url = new URL("https://discord.com/api/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: auth.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify",
        prompt: "consent"
      }).toString();
      return res.redirect(url.toString());
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("登入失敗", [`❌ ${err.message || "無法啟動 Discord 登入"}`]));
    }
  });

  router.post("/api/auth/discord", async (req, res, next) => {
    try {
      const { code } = req.body;
      let discordId;
      let displayName = "WebPlayer";

      // Development shortcut: treat codes prefixed with "mock:" as mock Discord logins.
      // 安全鎖：只接受本機請求（vite dev proxy / 本機測試）。對外網域（cloudflared 轉發時
      // Host 會是 otonashikoi.org）一律拒絕，避免任何人偽造任意玩家 JWT。
      if (code.startsWith("mock:")) {
        const reqHost = String(req.headers.host || "");
        const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(reqHost);
        if (!isLocalHost) {
          return res.status(403).json({ status: "error", message: "Mock login is disabled." });
        }
        console.log("[PlayerApp] Development mode mock login");
        discordId = code.replace("mock:", "");
        if (discordId.length < 5) discordId = "865264891991425055"; // Fallback test account for local development.
        // 從 Discord 抓真實名稱（公會暱稱優先，其次帳號名），避免一律記成 "WebPlayer"
        if (discordClient) {
          try {
            const guildId = require("../../config").discord?.guildId;
            if (guildId) {
              const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
              const member = guild ? await guild.members.fetch({ user: discordId, force: false }).catch(() => null) : null;
              if (member?.displayName) displayName = member.displayName;
            }
            if (displayName === "WebPlayer") {
              const u = await discordClient.users.fetch(discordId).catch(() => null);
              if (u) displayName = u.globalName || u.username || displayName;
            }
          } catch (_) {}
        }
      } else {
        // Exchange the authorization code with Discord OAuth2.
        if (!process.env.DISCORD_CLIENT_SECRET) {
          return res.status(500).json({ status: "error", message: "Server missing DISCORD_CLIENT_SECRET; Discord login is unavailable." });
        }
        // redirect_uri must match the value used to start the OAuth flow.
        const { redirect_uri } = req.body;
        if (!redirect_uri) {
          return res.status(400).json({ status: "error", message: "Missing redirect_uri" });
        }
        const params = new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri
        });

        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          body: params,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenRes.json();
        
        // Debug
        console.log("[PlayerApp] Discord Auth Response:", tokenData);

        if (tokenData.error) {
           return res.status(400).json({ status: "error", message: `Discord auth failed: ${tokenData.error_description || tokenData.error}` });
        }

        const userRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        discordId = userData.id;
        displayName = userData.global_name || userData.username;
      }

      // 登入閘門：必須是 Discord 伺服器成員，且具備「玩家」身分組才放行。
      const cfg = require("../../config").discord;
      const guildId = cfg.guildId;
      const inviteUrl = cfg.inviteUrl;
      if (guildId && discordClient && !code.startsWith("mock:")) {
        try {
          const guild = discordClient.guilds.cache.get(guildId)
            || await discordClient.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch({ user: discordId, force: true }).catch(() => null);
            // 1) 不是伺服器成員 → 給邀請連結
            if (!member) {
              return res.status(403).json({
                status: "error", code: "NOT_GUILD_MEMBER", inviteUrl,
                message: "請先加入 Discord 伺服器才能使用網頁遊戲。"
              });
            }
            // Prefer guild nickname over OAuth profile name.
            displayName = member.displayName || displayName;

            // 2) 是成員但沒有「玩家」身分組 → 擋下並引導取得身分組
            //    （取設定的玩家/管理員身分組；未設定任何身分組時退回「僅需成員」）
            const access = await serviceContext.accessControlService.getAccessControl().catch(() => null);
            const d = access?.discord || cfg;
            const gateRoleIds = [...new Set([...(d.playerRoleIds || []), ...(d.adminRoleIds || [])])];
            const allowUserIds = new Set([...(d.adminUserIds || []), ...(d.playerUserIds || [])]);
            const hasGateRole = gateRoleIds.length === 0
              || gateRoleIds.some((roleId) => member.roles.cache.has(roleId));
            if (!hasGateRole && !allowUserIds.has(discordId)) {
              return res.status(403).json({
                status: "error", code: "NO_PLAYER_ROLE", inviteUrl,
                message: "你已在伺服器，但尚未取得「玩家」身分組，請依伺服器指引領取後再登入。"
              });
            }
          }
        } catch (err) {
          // 基礎設施錯誤（公會抓不到等）不鎖死所有人，記錄後放行
          console.warn("[PlayerApp] Guild/role gate check failed, allowing login:", err.message);
        }
      }

      // Ensure player profile exists before returning a JWT.
      await serviceContext.playerService.ensurePlayer(discordId, displayName);

      // Issue JWT for the web app session.
      const token = jwt.sign({ discordId, displayName }, process.env.JWT_SECRET || "super-secret-jwt-key", { expiresIn: "7d" });
      res.json(ok({ token, discordId, displayName }));

    } catch (err) {
      next(err);
    }
  });

  // 2. Fetch Player Profile (Stats, Wallet, Progress)
  router.get("/api/me/profile", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      let avatarUrl = null;

      if (discordClient) {
        try {
          const discordUser = await discordClient.users.fetch(discordId, { force: false });
          avatarUrl = discordUser.displayAvatarURL({ size: 256, extension: 'png' });
        } catch (_) {}
      }
      
      const [profileResult, walletResult] = await Promise.all([
        serviceContext.playerService.getProfile(discordId, displayName),
        serviceContext.walletService.getWalletByDiscordId(discordId, displayName)
      ]);

      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };

      const { expToNextLevel, MAX_LEVEL } = require("../../shared/progression");
      const lv = progress?.level || 1;
      const isMaxLevel = lv >= MAX_LEVEL;
      const nextLevelExp = isMaxLevel ? null : expToNextLevel(lv);

      // 計算完整戰鬥能力（與 DC「我的資料」一致）
      let combatStats = null;
      let equipBonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
      let mergedEquipment = progress?.equipment || {};
      try {
        const { calcPlayerStats } = require("../../shared/combatStats");
        mergedEquipment = await mergeEquippedFromLibrary(progress?.equipment || {}, serviceContext.itemRepository);
        const cs = calcPlayerStats(attrs, mergedEquipment, progress?.activeEffects || [], progress?.inventory || []);
        // 計算裝備屬性加成
        for (const item of Object.values(mergedEquipment)) {
          if (!item?.equipStats) continue;
          for (const [k, v] of Object.entries(item.equipStats)) {
            if (k in equipBonus) equipBonus[k] += (Number(v) || 0);
          }
        }
        combatStats = {
          maxHp: Math.ceil(cs.maxHp),
          atk: Math.ceil(cs.atk),
          def: Math.ceil(cs.def),
          hit: Math.ceil(cs.hit || 0),
          dodge: Math.ceil(cs.dodge || 0),
          block: Math.ceil(cs.blockChance || 0),
          crit: Math.ceil(cs.crit || 0),
          combo: Math.ceil(cs.combo || 0),
          weaponType: cs.weaponType || null,
          isTwoHanded: Boolean(cs.isTwoHanded),
          isDualWield: Boolean(cs.isDualWield),
          tierSetBonuses: cs.tierSetBonuses || null
        };
      } catch (err) {
        console.warn("[profile] combatStats calc failed:", err?.message || err);
      }

      // 聚合「身上特效」：裝備/卡片/職業/稱號的被動·戰鬥·觸發效果（僅列條件成立者）+ 暫時 buff
      const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");
      const BODY_SLOT_ZH = {
        weapon: "武器", shield: "副手", armor: "上衣", garment: "披風",
        head_top: "頭部上", head_mid: "頭部中", head_low: "頭部下", shoes: "鞋子",
        accessory_l: "飾品左", accessory_r: "飾品右", title_eq: "稱號", job_eq: "職業",
        special_1: "特殊1", special_2: "特殊2", special_3: "特殊3"
      };
      const bodyEffects = [];
      try {
        const effCtx = { equipped: mergedEquipment, inventory: progress?.inventory || [] };
        for (const [slot, item] of Object.entries(mergedEquipment || {})) {
          if (!item || typeof item !== "object") continue;
          const arrs = [].concat(item.passiveEffects || [], item.combatEffects || [], item.procEffects || []);
          for (const eff of arrs) {
            if (!eff || !eff.key) continue;
            if (!isEffectConditionMet(eff, effCtx)) continue;
            // 數值顯示依引擎語意（PCT_VALUE_EFFECT_KEYS）：百分比效果帶 %、開關型不顯示數字
            const valueText = formatEffectValueText(eff.key, eff?.params);
            bodyEffects.push({
              source: item.itemName || item.name || BODY_SLOT_ZH[slot] || slot,
              slot,
              name: EFFECT_NAME_ZH[eff.key] || eff.definitionName || eff.key,
              desc: eff.notes || "",
              value: eff?.params?.value ?? null,
              valueText,
              chance: eff.chance ?? 100,
              trigger: eff.trigger || "passive"
            });
          }
        }
        for (const e of (progress?.activeEffects || [])) {
          if (!e) continue;
          const buffValueText = formatEffectValueText(e.key, e?.params);
          bodyEffects.push({
            source: "狀態", slot: "buff",
            name: e.definitionName || EFFECT_NAME_ZH[e.key] || e.key,
            desc: "", value: e?.params?.value ?? null, valueText: buffValueText,
            chance: 100, trigger: "buff", temporary: true
          });
        }
      } catch (err) { console.warn("[profile] bodyEffects failed:", err?.message); }

      res.json(ok({
        player: {
          ...profileResult.player,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        wallet: walletResult.wallet,
        progress: {
          level: lv,
          maxLevel: MAX_LEVEL,
          jobLevel: progress?.jobLevel || 1,
          job: progress?.job || "Novice",
          exp: progress?.exp || 0,
          nextLevelExp,
          isMaxLevel,
          statusPoints: progress?.statusPoints || 0,
          playerTier: progress?.playerTier || "E",
          attributes: attrs,
          equipBonus,
          equipment: mergedEquipment,
          combatStats,
          activeEffects: progress?.activeEffects || [],
          bodyEffects,
          jobSpecialDisplay: buildJobSpecialDisplay(progress)
        }
      }));
    } catch (err) {
      next(err);
    }
  });

  // 2.35 發直播綁定碼（DC 同款）：玩家拿碼去直播聊天室輸入 `!綁定 碼` 完成綁定+會員偵測
  router.post("/api/me/stream-bind-code", requireAuth, (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { createCode } = require("../../bot/bindingStore");
      const code = createCode(discordId);
      res.json(ok({
        code,
        command: `!綁定 ${code}`,
        expiresInMinutes: 10,
        youtubeUrl: config.streamMembership?.bindYoutubeUrl || null,
        twitchUrl: config.streamMembership?.twitchChannel || null
      }));
    } catch (err) {
      next(err);
    }
  });

  // ── 公告（首頁版位）──
  router.get("/api/announcements", requireAuth, async (req, res, next) => {
    try {
      const svc = require("../../services/announcement/announcementService");
      const list = await svc.listForPlayer(req.playerRecord.discordId);
      res.json(ok({ announcements: list }));
    } catch (err) { next(err); }
  });
  router.post("/api/announcements/:id/read", requireAuth, async (req, res, next) => {
    try {
      const svc = require("../../services/announcement/announcementService");
      await svc.markRead(req.playerRecord.discordId, req.params.id);
      res.json(ok({ read: req.params.id }));
    } catch (err) { next(err); }
  });

  // 直播頻道網址（給打卡教學「前往直播聊天室」用,與綁定同一處）
  router.get("/api/stream-channels", requireAuth, (req, res) => {
    const sm = config.streamMembership || {};
    res.json(ok({
      youtubeUrl: sm.bindYoutubeUrl || sm.youtubeChannel || null,
      twitchUrl: sm.twitchChannel || null
    }));
  });

  // 2.4 Issue stream-auth state token — 前端綁定流程的第一步
  router.post("/api/me/stream-auth/state", requireAuth, (req, res) => {
    const { discordId } = req.playerRecord;
    const state = signStreamAuthState(discordId);
    res.json(ok({ state, expiresIn: STREAM_AUTH_STATE_TTL }));
  });

  // 2.5 Fetch Stream Bindings + 即時會員狀態（用 broadcaster token 查）
  router.get("/api/me/bindings", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const bindings = await serviceContext.streamAccountBindingRepository
        .listByDiscordId(discordId)
        .catch(() => []);

      // 對每個 binding 嘗試即時查會員狀態
      const enriched = await Promise.all(bindings.map(async (b) => {
        const baseInfo = {
          platform: b.platform,
          platformUserId: b.platformUserId,
          displayName: b.displayName,
          linkedAt: b.linkedAt,
          playerTierAtLink: b.playerTierAtLink || null
        };
        try {
          if (b.platform === "twitch") {
            const tier = await parseTwitchSubscriptionTier(b.platformUserId);
            return {
              ...baseInfo,
              membership: {
                isMember: Boolean(tier),
                tier: tier || null,
                levelName: tier ? `訂閱等級 ${tier}` : null,
                checkedAt: new Date().toISOString(),
                source: "twitch-api"
              }
            };
          }
          if (b.platform === "youtube") {
            // YouTube members API 是 Google 白名單限定（個人創作者拿不到），一律 403。
            // 改用 DC 同款方案：會員狀態來自直播彈幕徽章（OneComme），綁定/留言當下偵測
            // 並記在 binding 上（linkedSupportAtLink / playerTierAtLink / badge labels）。
            const labels = Array.isArray(b.linkedSupportBadgeLabelsAtLink) ? b.linkedSupportBadgeLabelsAtLink : [];
            const isMember = Boolean(b.linkedSupportAtLink) || Boolean(b.playerTierAtLink);
            const levelName = labels.find(Boolean)
              || (b.playerTierAtLink ? `會員位階 ${b.playerTierAtLink}` : null)
              || (isMember ? "會員" : null);
            return {
              ...baseInfo,
              membership: {
                isMember,
                tier: b.playerTierAtLink || null,
                levelName,
                checkedAt: b.linkedAt || new Date().toISOString(),
                // 來源是直播彈幕偵測（非即時 API）；未偵測過會員時 isMember=false 但不是錯誤
                source: "stream-chat",
                hint: isMember ? null : "在直播聊天室以會員身分留言一次即可偵測"
              }
            };
          }
          return baseInfo;
        } catch (err) {
          return {
            ...baseInfo,
            membership: {
              isMember: false,
              checkedAt: new Date().toISOString(),
              source: "unavailable",
              error: err.message
            }
          };
        }
      }));

      res.json(ok({ bindings: enriched }));
    } catch (err) {
      next(err);
    }
  });

  // 2.6 SSE realtime — server push 推送資料變化給 web client
  router.get("/api/me/stream", (req, res) => {
    // SSE 不能用 Authorization header（EventSource 不支援），改用 query param token
    const token = String(req.query.token || "").trim();
    let playerRecord;
    try {
      playerRecord = jwt.verify(token, process.env.JWT_SECRET || "super-secret-jwt-key");
    } catch (_) {
      return res.status(401).json({ status: "error", message: "Invalid or expired token" });
    }
    const discordId = String(playerRecord?.discordId || "").trim();
    if (!discordId) return res.status(400).json({ status: "error", message: "Missing discordId" });
    // 被封鎖的玩家不給開 SSE 串流
    if (require("../../services/access/webBanStore").isBlocked(discordId)) {
      return res.status(403).json({ status: "error", code: "WEB_BLOCKED", message: "你的帳號已被管理員封鎖網頁使用權限。" });
    }

    const releaseSse = acquireSse(req); // SSE 連線數上限(防單一來源開大量連線耗盡記憶體)
    if (!releaseSse) return res.status(503).json({ status: "error", message: "連線數已滿,請稍後再試" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 給 nginx / cloudflare 用
    res.flushHeaders?.();

    const send = (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (_) { /* connection closed */ }
    };

    // 連線建立後送一個 hello 事件
    send({ type: "connected", data: { discordId, ts: new Date().toISOString() } });

    // 訂閱該玩家的 bus
    const { playerEventBus } = require("../../services/realtime/playerEventBus");
    const unsubscribe = playerEventBus.subscribe(discordId, send);

    // 記錄網頁在線狀態(供後台列出在線玩家)
    const webPresence = require("../../services/realtime/webPresence");
    webPresence.add(discordId, playerRecord?.displayName);

    // 每 25 秒送一個 heartbeat（避免被 proxy 斷線）
    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (_) {}
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      webPresence.remove(discordId);
      releaseSse();
    });
  });

  // 3. Fetch Player Inventory
  router.get("/api/me/inventory", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      let inventory = progress?.inventory || [];
      let equipped = progress?.equipment || {};

      // 圖片等顯示欄位以道具庫最新為準：實例是取得當下的快照，
      // 後台更新庫圖後舊實例會一直顯示舊圖（批次查詢，去重後通常只有幾十個 id）
      try {
        const repo = serviceContext.itemRepository;
        const ids = [...new Set(inventory.map((it) => it?.itemId).filter(Boolean))];
        const results = await Promise.all(ids.map((id) => repo.findById(id).catch(() => null)));
        const libMap = {};
        ids.forEach((id, i) => { if (results[i]) libMap[id] = results[i]; });
        inventory = inventory.map((it) => {
          const lib = it?.itemId ? libMap[it.itemId] : null;
          if (!lib) return it;
          return {
            ...it,
            imageUrl: lib.imageUrl || it.imageUrl || null,
            imageThumbnailUrl: lib.imageThumbnailUrl || it.imageThumbnailUrl || null,
            description: lib.description ?? it.description ?? null,
            monsterCardSkill: lib.monsterCardSkill || it.monsterCardSkill || null,
            // 詳細資料面板的「特效說明」列（卡片技能 + 裝備效果，後端組好直接顯示）
            effectLines: buildItemEffectLines(lib),
          };
        });
        equipped = await mergeEquippedFromLibrary(equipped, repo);
        for (const [slot, entry] of Object.entries(equipped)) {
          if (entry) equipped[slot] = { ...entry, effectLines: buildItemEffectLines(entry) };
        }
      } catch (_) { /* 合併失敗時回原始快照，不擋背包 */ }

      res.json(ok({ inventory, equipped }));
    } catch (err) {
      next(err);
    }
  });

  // 3.1 Equip Item
  router.post("/api/me/inventory/equip/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { uuid } = req.params;
      const { targetSlot } = req.body || {};
      const result = await serviceContext.shopService.equipItem(discordId, uuid, targetSlot);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.2 Unequip Item
  router.post("/api/me/inventory/unequip/:slot", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { slot } = req.params;
      const result = await serviceContext.shopService.unequipItem(discordId, slot);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.3 Use Item (consumable effect)
  router.post("/api/me/inventory/use/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { uuid } = req.params;
      const result = await serviceContext.shopService.useItem(discordId, uuid, displayName);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.4 Discard Item
  router.post("/api/me/inventory/discard/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { uuid } = req.params;
      const result = await serviceContext.shopService.discardItem(discordId, uuid);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.5 Sell Item
  router.post("/api/me/inventory/sell/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { uuid } = req.params;
      const confirm = req.body?.confirm === true || req.body?.confirm === "true";
      if (!confirm) {
        const quote = await serviceContext.shopService.getSellQuote(discordId, uuid, 1);
        return res.json(ok({
          requiresConfirmation: true,
          confirmField: "confirm",
          itemName: quote.itemName,
          sellCount: quote.sellCount,
          priceEach: quote.priceEach,
          totalGold: quote.totalGold,
          message: `你確定要販售 ${quote.itemName} 嗎？販售總價值 ${quote.totalGold} 金幣。`
        }));
      }
      const result = await serviceContext.shopService.sellItem(discordId, uuid);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.6 Enhance Item
  router.post("/api/me/inventory/enhance", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { targetUuid, materialUuid } = req.body;
      if (!targetUuid || !materialUuid) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "targetUuid and materialUuid are required", 400);
      const result = await serviceContext.shopService.enhanceItem(discordId, targetUuid, materialUuid);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 解析「戰鬥領域快捷表情」名稱 → 圖片 URL(從公會自訂 emoji + 貼圖找),依 ZONE_EMOTE_NAMES 順序
  // 帶 30 秒快取,避免每次都打 Discord API
  let _zoneEmoteCache = { at: 0, list: [] };
  async function resolveZoneEmotes() {
    if (Date.now() - _zoneEmoteCache.at < 30_000 && _zoneEmoteCache.list.length) return _zoneEmoteCache.list;
    const guildId = require("../../config").discord.guildId;
    if (!guildId || !discordClient) return _zoneEmoteCache.list;
    const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) return _zoneEmoteCache.list;
    const [emojis, stickers] = await Promise.all([
      guild.emojis.fetch().catch(() => guild.emojis.cache),
      guild.stickers.fetch().catch(() => guild.stickers.cache),
    ]);
    const byName = new Map();
    for (const e of emojis.values()) {
      byName.set(String(e.name), { name: String(e.name), url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`, animated: !!e.animated });
    }
    for (const s of stickers.values()) {
      if (byName.has(String(s.name))) continue; // emoji 優先
      byName.set(String(s.name), { name: String(s.name), url: s.format === 4 ? `https://media.discordapp.net/stickers/${s.id}.gif` : `https://media.discordapp.net/stickers/${s.id}.png`, animated: s.format === 4 });
    }
    const list = ZONE_EMOTE_NAMES.map((n) => byName.get(String(n))).filter(Boolean);
    _zoneEmoteCache = { at: Date.now(), list };
    return list;
  }

  // 取得戰鬥領域可用的快捷表情清單(給前端表情列渲染)
  router.get("/api/combat/zone-emotes", requireAuth, async (_req, res, next) => {
    try { res.json(ok({ emotes: await resolveZoneEmotes() })); } catch (e) { next(e); }
  });

  // 戰鬥領域快捷表情：只推給「目前在該領域戰鬥」的玩家(含自己),從泡泡上方冒出來
  router.post("/api/combat/zone-emote", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const zone = String(req.body?.zone || "").trim();
      const emote = String(req.body?.emote || "").trim();
      if (!zone) return res.status(400).json({ status: "error", message: "缺少領域" });
      if (!ZONE_EMOTE_NAME_SET.has(emote)) return res.status(400).json({ status: "error", message: "不支援的表情" });
      // 防洗版:每位玩家 1.2 秒冷卻
      const last = zoneEmoteCooldown.get(discordId) || 0;
      if (Date.now() - last < 1200) return res.status(429).json({ status: "error", message: "太快了，稍候再發。" });
      zoneEmoteCooldown.set(discordId, Date.now());

      const resolved = (await resolveZoneEmotes()).find((e) => e.name === emote);
      const url = resolved?.url || null;

      const { playerEventBus } = require("../../services/realtime/playerEventBus");
      const bp = require("../../services/realtime/battlePresence");
      const ids = new Set(bp.listByZone(zone).map((p) => p.discordId));
      ids.add(discordId); // 自己也看得到
      const payload = { zone, discordId, name: displayName, emote, url, ts: new Date().toISOString() };
      for (const id of ids) {
        try { playerEventBus.emit(id, { type: "zone_emote", data: payload }); } catch (_) {}
      }
      res.json(ok({ delivered: ids.size }));
    } catch (e) { next(e); }
  });

  // 4. Send Chat Lobby Message
  router.post("/api/chat/lobby", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { message, replyTo } = req.body;

      if (!message || String(message).trim() === "") {
        throw new Error("Message cannot be empty");
      }

      // 防洗版:每位玩家送文字訊息冷卻 1 秒
      const _lastChat = chatTextCooldown.get(discordId) || 0;
      if (Date.now() - _lastChat < 1000) {
        return res.status(429).json({ status: "error", message: "訊息太快了，請稍候再送。" });
      }
      chatTextCooldown.set(discordId, Date.now());
      // 記錄「最近在聊天大廳發言」(供戰鬥畫面玩家氣泡顯示講話圖示)
      try { require("../../services/realtime/chatPresence").markSpoke(discordId); } catch (_) { /* noop */ }

      // 內容長度上限,避免超長訊息(>2000 會讓 webhook.send 直接失敗)
      const safeMessage = String(message).slice(0, 500);

      // 引用留言:只信任「伺服器記錄的原留言者」(webMsgAuthors),不信任前端傳來的 authorId;
      // 且只接受合法 Discord snowflake,避免被拿來亂 tag。
      const trackedAuthor = (replyTo && replyTo.id) ? webMsgAuthors.get(String(replyTo.id)) : null;
      const clientAuthorId = (replyTo && /^\d{17,20}$/.test(String(replyTo.authorId || ""))) ? String(replyTo.authorId) : null;
      const replyAuthorId = trackedAuthor || clientAuthorId || null;
      const mention = replyAuthorId ? `<@${replyAuthorId}> ` : "";
      const body = mention + safeMessage;
      let outgoing = body;
      if (replyTo && (replyTo.author || replyTo.content)) {
        const qAuthor = String(replyTo.author || "").slice(0, 40);
        const qText = String(replyTo.content || "").replace(/\n/g, " ").slice(0, 80);
        outgoing = `> ↩ ${qAuthor}：${qText}\n${body}`;
      }

      // Resolve the bound Discord channel for town chat.
      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);
      
      if (townChatBinding && townChatBinding.channelId && discordClient) {
        const channel = discordClient.channels.cache.get(townChatBinding.channelId);
        if (channel) {
          // Try to mirror the player's Discord avatar in web chat.
          let avatarURL = null;
          try {
            const discordUser = await discordClient.users.fetch(discordId, { force: false });
            avatarURL = discordUser.displayAvatarURL({ size: 128, extension: 'png' });
          } catch (_) {}

          // Prefer webhook relay so the message appears under the player's display name.
          let webhook = null;
          try {
            const webhooks = await channel.fetchWebhooks();
            webhook = webhooks.find(w => w.name === 'PlayerWebChat' && w.owner?.id === discordClient.user.id);
            if (!webhook) {
              webhook = await channel.createWebhook({ name: 'PlayerWebChat', reason: 'Player web chat proxy' });
            }
          } catch (_) {}

          if (webhook) {
            const sent = await webhook.send({
              content: outgoing,
              username: displayName,
              ...(avatarURL ? { avatarURL } : {}),
              // 只允許 tag「被引用的原留言者」這一人;一律禁止 @everyone/@here/@role(防 mention 注入洗版)
              allowedMentions: { parse: [], users: replyAuthorId ? [replyAuthorId] : [] },
            });
            rememberWebMsgAuthor(sent?.id, discordId); // 記住這則 webhook 訊息是誰發的（給引用 @ 用）
          } else {
            // Fallback to a regular bot message if webhook creation fails.
            const sent = await channel.send({
              content: `**${displayName}**: ${outgoing}`,
              allowedMentions: { parse: [], users: replyAuthorId ? [replyAuthorId] : [] },
            });
            rememberWebMsgAuthor(sent?.id, discordId);
          }
        } else {
          console.warn(`[PlayerApp] ?曆???Town Chat ?駁? (ID: ${townChatBinding.channelId})`);
        }
      }

      res.json(ok({ status: "sent", message }));
    } catch (err) {
      next(err);
    }
  });

  // 4b. 聊天傳圖：轉發為 Discord 附件（圖存 Discord CDN，不佔本機/Cloudinary）
  router.post("/api/chat/lobby/image", requireAuth, chatImageUpload.single("image"), async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      if (!req.file || !req.file.buffer) return res.status(400).json(fail("INVALID_ARGUMENT", "缺少圖片"));
      if (!/^image\//.test(req.file.mimetype || "")) return res.status(400).json(fail("INVALID_ARGUMENT", "只能傳圖片"));
      // 發圖間隔（防洗版）：每人 3 秒一張
      const now = Date.now();
      if (now - (chatImageCooldown.get(discordId) || 0) < 3000) {
        return res.status(429).json(fail("RATE_LIMITED", "發圖太快，請稍候再試"));
      }

      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);
      if (!townChatBinding?.channelId || !discordClient) {
        return res.status(503).json(fail("UNAVAILABLE", "城鎮頻道尚未設定"));
      }
      const channel = discordClient.channels.cache.get(townChatBinding.channelId);
      if (!channel) return res.status(503).json(fail("UNAVAILABLE", "找不到城鎮頻道"));

      let avatarURL = null;
      try {
        const u = await discordClient.users.fetch(discordId, { force: false });
        avatarURL = u.displayAvatarURL({ size: 128, extension: "png" });
      } catch (_) {}

      let webhook = null;
      try {
        const webhooks = await channel.fetchWebhooks();
        webhook = webhooks.find(w => w.name === "PlayerWebChat" && w.owner?.id === discordClient.user.id)
          || await channel.createWebhook({ name: "PlayerWebChat", reason: "Player web chat proxy" });
      } catch (_) {}

      const ext = String(req.file.originalname || "").split(".").pop()?.toLowerCase();
      const safeName = `chat_${now}.${/^(png|jpe?g|gif|webp)$/.test(ext || "") ? ext : "png"}`;
      const caption = String(req.body?.caption || "").replace(/\n+/g, " ").slice(0, 300).trim();
      const files = [{ attachment: req.file.buffer, name: safeName }];

      let sent;
      const _imgCaption = caption ? String(caption).slice(0, 300) : "";
      if (webhook) {
        sent = await webhook.send({ content: _imgCaption || undefined, username: displayName, ...(avatarURL ? { avatarURL } : {}), files, allowedMentions: { parse: [] } });
      } else {
        sent = await channel.send({ content: _imgCaption ? `**${displayName}**: ${_imgCaption}` : `**${displayName}** 傳了一張圖`, files, allowedMentions: { parse: [] } });
      }
      rememberWebMsgAuthor(sent?.id, discordId);
      chatImageCooldown.set(discordId, now);
      res.json(ok({ status: "sent" }));
    } catch (err) {
      if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json(fail("FILE_TOO_LARGE", "圖片太大（上限 8MB）"));
      next(err);
    }
  });

  // 5. SSE Client Management
  // SSE and notification helpers for relaying Discord chat into the web app.
  const resolveMentions = async (text, guild = null) => {
    if (!text || typeof text !== "string") return text;
    const mentionRegex = /<@!?(\d+)>/g;
    const matches = [...text.matchAll(mentionRegex)];
    let resolvedText = text;

    // Cache resolved mention names within a single pass to avoid duplicate fetches.
    const localCache = {};

    for (const match of matches) {
      const userId = match[1];
      if (localCache[userId]) {
        resolvedText = resolvedText.replace(match[0], `[@${localCache[userId]}]`);
        continue;
      }

      try {
        let playerName = null;
        
        // 1. Prefer the guild member display name when available.
        if (guild) {
          try {
            const member = await guild.members.fetch(userId);
            if (member) playerName = member.displayName;
          } catch (e) { /* ignore guild member lookup errors */ }
        }

        // 2. Fall back to stored player/profile records.
        if (!playerName) {
          const player = await serviceContext.playerRepository.findByDiscordId(userId);
          if (player) {
            playerName = player.displayName;
          } else if (serviceContext.progressRepository) {
            const progress = await serviceContext.progressRepository.findByPlayerId(userId);
            if (progress) playerName = progress.displayName;
          }
        }

        // 3. Final fallback: fetch directly from Discord API.
        if (!playerName && discordClient) {
          try {
            const user = await discordClient.users.fetch(userId);
            if (user) {
              playerName = user.globalName || user.username;
            }
          } catch (discordErr) { /* ignore */ }
        }

        if (playerName) {
          localCache[userId] = playerName;
          resolvedText = resolvedText.replace(match[0], `[@${playerName}]`);
        } else {
          console.warn(`[Chat] failed to resolve mention id: ${userId}`);
        }
      } catch (err) {
        console.error(`[Chat] mention resolve error: ${userId}`, err);
      }
    }
    return resolvedText;
  };

  // sseClients: Map<discordId, Set<{ res }>> for per-player browser tabs.
  const sseClients = new Map();
  const streamPresenceClients = new Set();
  // notifQueue: polling fallback for environments where SSE is buffered or blocked.
  const notifQueue = new Map();

  function enqueueNotif(discordId, summary) {
    if (!notifQueue.has(discordId)) notifQueue.set(discordId, []);
    const q = notifQueue.get(discordId);
    // 保留穩定 id 與 ts(事件時間):不覆蓋,讓 SSE 與輪詢佇列同一則用同一個 id,
    // 前端才能跨「即時推播 / 輪詢 / 重整」去重,不會重複提示領過的通知。
    q.push({ ...summary, id: summary.id || crypto.randomUUID(), ts: summary.ts || Date.now() });
    if (q.length > 50) q.splice(0, q.length - 50); // Keep only the latest 50 notifications.
  }

  // Exposed to monster zone handlers so battle rewards can reach the web app.
  function pushRewardToPlayer(discordId, summary) {
    // 先補上穩定 id + ts,之後三條通道(佇列 / playerEventBus / SSE)都用同一份,id 一致才能去重。
    const withId = { ...summary, id: summary.id || crypto.randomUUID(), ts: summary.ts || Date.now() };
    // 1. Always queue the notification for polling fallback.
    enqueueNotif(discordId, withId);
    // 2. 同步推上 /api/me/stream 的 playerEventBus（網頁通知中心吃這條）
    try {
      const { playerEventBus } = require("../../services/realtime/playerEventBus");
      playerEventBus.emit(discordId, { type: "notify", data: withId });
    } catch (_) { /* 通知失敗不影響主流程 */ }
    // 3. Push instantly to all active SSE clients for that player.
    const clients = sseClients.get(discordId);
    if (!clients || clients.size === 0) return;
    const dataStr = `event: reward\ndata: ${JSON.stringify(withId)}\n\n`;
    clients.forEach(c => { try { c.res.write(dataStr); } catch (_) {} });
  }
  // Attach helper hooks onto serviceContext so other modules can reuse them.
  serviceContext._pushRewardToPlayer = pushRewardToPlayer;
  // 統一通知佇列 hook：給 services/realtime/playerNotifyService 走輪詢備援通道
  serviceContext._enqueueNotif = enqueueNotif;
  // 廣播版：發給所有「輪詢過通知」的玩家（notifQueue 既有 key；poll 後 key 仍保留）
  serviceContext._enqueueNotifAll = (payload) => {
    for (const discordId of notifQueue.keys()) enqueueNotif(discordId, payload);
  };
  serviceContext._pushStreamPresence = (snapshot = getStreamPresenceSnapshot()) => {
    const dataStr = `event: stream_presence\ndata: ${JSON.stringify(snapshot)}\n\n`;
    streamPresenceClients.forEach((client) => {
      try { client.res.write(dataStr); } catch (_) {}
    });
  };

  // 全體廣播給在線網頁玩家
  //   mode = "force"  → force_reload(立即重整,不問玩家)
  //   mode = "prompt" → update_prompt(彈出「有更新,請重整/重登」視窗,玩家自己按)
  serviceContext._broadcastForceReload = (reason = "admin_broadcast", mode = "force", message = "") => {
    const { playerEventBus } = require("../../services/realtime/playerEventBus");
    const webPresence = require("../../services/realtime/webPresence");
    const ids = webPresence.list().map(p => p.discordId);
    const type = mode === "prompt" ? "update_prompt" : "force_reload";
    const noticeBody = message || "已更新，畫面將套用最新內容。";
    for (const id of ids) {
      try { playerEventBus.emit(id, { type, data: { reason, message: message || undefined, ts: new Date().toISOString() } }); } catch (_) {}
      // 同步發網頁通知（force 模式重整後也能在通知中心看到；用佇列保證重整後補抓得到）
      try {
        const notif = { type: "system", title: "🔄 熱更優化", message: noticeBody, kind: "info", ts: Date.now() };
        enqueueNotif(id, notif);
        playerEventBus.emit(id, { type: "notify", data: notif });
      } catch (_) {}
    }
    return ids.length;
  };

  // 重啟/熱更新前的「即將短暫斷線」預告:彈出輕量提示,數秒後自動消失;不強制玩家做事
  serviceContext._broadcastMaintenance = (message = "", seconds = 0) => {
    const { playerEventBus } = require("../../services/realtime/playerEventBus");
    const webPresence = require("../../services/realtime/webPresence");
    const ids = webPresence.list().map(p => p.discordId);
    const data = { message: message || "系統熱更新中，可能短暫斷線，數秒後會自動恢復，請稍候 🙏", seconds: Number(seconds) || 0, ts: new Date().toISOString() };
    for (const id of ids) {
      try { playerEventBus.emit(id, { type: "maintenance_notice", data }); } catch (_) {}
    }
    return ids.length;
  };

  // 發送系統公告到聊天大廳（Discord town_chat + SSE 直推）
  serviceContext._announceTownChat = async (message) => {
    // 1. 直接推到所有 SSE chat 客戶端（立即顯示，不等 Discord echo）
    const sysPayload = {
      id: `sys_${Date.now()}`,
      author: "系統公告",
      authorId: null,
      avatar: null,
      content: message,
      timestamp: Date.now(),
      isBot: true,
      replyTo: null,
    };
    const dataStr = `data: ${JSON.stringify(sysPayload)}\n\n`;
    sseClients.forEach(clients => clients.forEach(c => { try { c.res.write(dataStr); } catch (_) {} }));

    // 2. 同時發到 Discord town_chat channel（讓 DC 端也看到公告）
    if (discordClient) {
      try {
        const layout = await serviceContext.channelLayoutRepository.get();
        const townChatBinding = (layout?.discord?.bindings || []).find(b => b.featureKey === "town_chat" && b.enabled);
        if (townChatBinding?.channelId) {
          const channel = discordClient.channels.cache.get(townChatBinding.channelId);
          if (channel) await channel.send({ content: `📢 **系統公告**：${message}`, allowedMentions: { parse: [] } });
        }
      } catch (_) {}
    }
  };

  if (discordClient) {
    discordClient.on("messageCreate", async (msg) => {
      const hasContent = msg.content || msg.embeds.length > 0 || msg.stickers.size > 0 || msg.attachments.size > 0;
      if (!hasContent) return;

      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);

      if (townChatBinding && msg.channelId === townChatBinding.channelId) {
        let content = msg.content || "";
        if (msg.stickers.size > 0) {
          const stickerUrls = [...msg.stickers.values()].map(s => `https://media.discordapp.net/stickers/${s.id}.png`);
          content = [content, ...stickerUrls].filter(Boolean).join(" ");
        }
        if (msg.attachments.size > 0) {
          const attachUrls = [...msg.attachments.values()].map(a => a.url);
          content = [content, ...attachUrls].filter(Boolean).join(" ");
        }
        if (msg.embeds.length > 0 && !content) content = "[Embedded content]";

        // Reply preview metadata.
        let replyTo = null;
        if (msg.reference?.messageId) {
          try {
            const replied = await msg.channel.messages.fetch(msg.reference.messageId);
            replyTo = {
              id: replied.id,
              author: replied.member?.displayName || replied.author.globalName || replied.author.username,
              content: (replied.content || "").slice(0, 80),
            };
          } catch (_) {}
        }

        // webhook 轉發的網頁引用：把內容開頭的「> ↩ 對方：原文」解析回 replyTo，
        // 讓網頁顯示精簡引用框、內文不再攏長（DC 端仍看得到 blockquote）。
        if (!replyTo) {
          const rm = String(content).match(/^>\s*↩\s*([^\n：:]+)[：:]\s?([^\n]*)\n([\s\S]*)$/);
          if (rm) { replyTo = { id: null, author: rm[1].trim(), content: rm[2].trim().slice(0, 80) }; content = rm[3].replace(/^<@!?\d+>\s*/, ""); }
        }

        const payload = {
          id: msg.id,
          author: msg.member?.displayName || msg.author.globalName || msg.author.username,
          authorId: msg.webhookId ? (webMsgAuthors.get(String(msg.id)) || null) : (msg.author?.id || null),
          avatar: msg.author.displayAvatarURL(),
          content: await resolveMentions(content, msg.guild),
          timestamp: msg.createdTimestamp,
          isBot: msg.author.bot,
          replyTo,
        };
        const dataStr = `data: ${JSON.stringify(payload)}\n\n`;
        sseClients.forEach(clients => clients.forEach(c => { try { c.res.write(dataStr); } catch (_) {} }));
      }
    });
  }

  // 5b. Viewer Profile — public, no auth required
  // Used by chat.html to look up a viewer's in-game level & title via OneComme platform ID.
  router.get("/api/chat/viewer-profile", async (req, res) => {
    try {
      // 強制字串化 + 白名單/字元驗證:防止 ?userId[$ne]= 之類把物件(含 $運算子)
      // 注入 Mongo 查詢(此端點未認證,尤其需要硬化)。
      const platform = String(req.query.platform || "").trim().toLowerCase();
      const userId = String(req.query.userId || "").trim();
      const PLATFORM_ALLOW = new Set(["youtube", "twitch"]);
      if (!PLATFORM_ALLOW.has(platform) || !userId || userId.length > 128 || !/^[A-Za-z0-9_.\-:@]+$/.test(userId)) {
        return res.json({ found: false });
      }

      const player = await serviceContext.playerRepository.findByExternalId(platform, userId);
      if (!player) return res.json({ found: false });

      const progress = await serviceContext.progressRepository.findByPlayerId(player.discordId);
      if (!progress) return res.json({ found: false });

      const level = progress.level || 1;
      const titleEq = progress.equipment?.title_eq;
      const title = titleEq?.itemName || null;

      // 聊天室 overlay 顯示「Discord 身分名稱」而非直播平台暱稱：
      // 公會暱稱優先 → Discord 全域名 → 帳號名 → 最後退回遊戲存檔暱稱。
      let displayName = player.displayName;
      try {
        if (discordClient && player.discordId) {
          const guildId = require("../../config").discord?.guildId;
          const guild = guildId
            ? (discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null))
            : null;
          const member = guild ? await guild.members.fetch({ user: player.discordId, force: false }).catch(() => null) : null;
          if (member?.displayName) {
            displayName = member.displayName;
          } else {
            const u = await discordClient.users.fetch(player.discordId).catch(() => null);
            if (u) displayName = u.globalName || u.username || displayName;
          }
        }
      } catch (_) { /* 抓不到 Discord 名稱時退回遊戲暱稱 */ }

      return res.json({ found: true, level, title, displayName, discordId: player.discordId });
    } catch (_) {
      return res.json({ found: false });
    }
  });

  // 6. SSE Stream
  router.get("/api/chat/stream", (req, res) => {
    const releaseSse = acquireSse(req); // 公開端點:連線數上限,防匿名來源開大量連線
    if (!releaseSse) return res.status(503).json({ status: "error", message: "連線數已滿,請稍後再試" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");  // Disable buffering on reverse proxies for SSE
    res.flushHeaders();

    // Optional token in query string lets us bind the SSE stream to a player.
    let discordId = null;
    try {
      const token = req.query.token || "";
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "super-secret-jwt-key");
        discordId = decoded.discordId || null;
      }
    } catch (_) {}

    const client = { res };
    streamPresenceClients.add(client);
    if (discordId) {
      if (!sseClients.has(discordId)) sseClients.set(discordId, new Set());
      sseClients.get(discordId).add(client);
    }

    try {
      res.write(`event: stream_presence\ndata: ${JSON.stringify(getStreamPresenceSnapshot())}\n\n`);
    } catch (_) {}

    const timer = setInterval(() => {
      res.write(":\n\n"); // Heartbeat comment
    }, 15000);

    req.on("close", () => {
      clearInterval(timer);
      streamPresenceClients.delete(client);
      if (discordId) {
        const s = sseClients.get(discordId);
        if (s) { s.delete(client); if (s.size === 0) sseClients.delete(discordId); }
      }
      releaseSse();
    });
  });

  // 聊天室 overlay 即時留言 SSE（密碼保護；給 chat.html 跨電腦讀取用）。
  // 網址：/api/chat/overlay-stream?key=密碼。密碼錯誤回 401，不外洩留言。
  router.get("/api/chat/overlay-stream", (req, res) => {
    const chatOverlayHub = require("../../services/chat/chatOverlayHub");
    const expected = process.env.CHAT_OVERLAY_PASSWORD || "a65194702A";
    const key = String(req.query.key || "");
    if (!expected || key !== expected) {
      return res.status(401).json(fail("UNAUTHORIZED", "聊天室 overlay 密碼錯誤"));
    }
    const releaseSse = acquireSse(req);
    if (!releaseSse) return res.status(503).json(fail("TOO_MANY", "連線數已滿,請稍後再試"));
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(`event: ready\ndata: {"ok":true}\n\n`);
    chatOverlayHub.addSubscriber(res);
    const hb = setInterval(() => { try { res.write(":\n\n"); } catch (_) {} }, 15000);
    req.on("close", () => { clearInterval(hb); chatOverlayHub.removeSubscriber(res); releaseSse(); });
  });

  router.get("/api/stream/presence", requireAuth, (req, res) => {
    res.json(ok(getStreamPresenceSnapshot()));
  });

  // 7. Poll notifications (fallback for Cloudflare/proxy that blocks SSE)
  router.get("/api/notifications/poll", requireAuth, (req, res) => {
    const discordId = req.playerRecord.discordId;
    const q = notifQueue.get(discordId) || [];
    notifQueue.set(discordId, []); // clear queue after polling
    res.json({ status: "ok", data: q });
  });

  // 8. Get Chat History
  router.get("/api/chat/history", requireAuth, async (req, res, next) => {
    try {
      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);
      
      if (!townChatBinding || !townChatBinding.channelId || !discordClient) {
        return res.json(ok([]));
      }
      
      const channel = discordClient.channels.cache.get(townChatBinding.channelId);
      if (!channel) return res.json(ok([]));
      
      const messages = await channel.messages.fetch({ limit: 50 });
      const history = await Promise.all([...messages.values()].map(async (msg) => {
        // Resolve missing guild member data on demand when cache misses.
        if (!msg.member && !msg.author.bot) {
          try { await channel.guild.members.fetch(msg.author.id); } catch (_) {}
        }
        let content = msg.content || "";
        if (msg.stickers.size > 0) {
          const stickerUrls = [...msg.stickers.values()].map(s => `https://media.discordapp.net/stickers/${s.id}.png`);
          content = [content, ...stickerUrls].filter(Boolean).join(" ");
        }
        if (msg.attachments.size > 0) {
          const attachUrls = [...msg.attachments.values()].map(a => a.url);
          content = [content, ...attachUrls].filter(Boolean).join(" ");
        }
        if (msg.embeds.length > 0 && !content) content = "[Embedded content]";

        let replyTo = null;
        if (msg.reference?.messageId) {
          const replied = messages.get(msg.reference.messageId);
          if (replied) {
            replyTo = {
              id: replied.id,
              author: replied.member?.displayName || replied.author.globalName || replied.author.username,
              content: (replied.content || "").slice(0, 80),
            };
          }
        }

        // webhook 網頁引用：解析開頭引用行回 replyTo，內文去掉引用行（同 SSE）
        if (!replyTo) {
          const rm = String(content).match(/^>\s*↩\s*([^\n：:]+)[：:]\s?([^\n]*)\n([\s\S]*)$/);
          if (rm) { replyTo = { id: null, author: rm[1].trim(), content: rm[2].trim().slice(0, 80) }; content = rm[3].replace(/^<@!?\d+>\s*/, ""); }
        }

        const resolvedContent = await resolveMentions(content, channel.guild);
        return {
          id: msg.id,
          author: msg.member?.displayName || msg.author.globalName || msg.author.username,
          authorId: msg.webhookId ? (webMsgAuthors.get(String(msg.id)) || null) : (msg.author?.id || null),
          avatar: msg.author.displayAvatarURL(),
          content: resolvedContent,
          timestamp: msg.createdTimestamp,
          isBot: msg.author.bot,
          replyTo,
        };
      }));
      res.json(ok(history.reverse()));
    } catch (err) {
      next(err);
    }
  });

  // 7b. Get guild stickers & emojis for chat picker
  router.get("/api/chat/expressions", requireAuth, async (req, res, next) => {
    try {
      const guildId = require("../../config").discord.guildId;
      console.log("[expressions] guildId:", guildId, "| discordClient ready:", !!discordClient?.isReady?.());
      if (!guildId || !discordClient) return res.json(ok({ stickers: [], emojis: [] }));

      const guild = discordClient.guilds.cache.get(guildId)
        || await discordClient.guilds.fetch(guildId).catch((e) => { console.error("[expressions] guild fetch error:", e.message); return null; });
      console.log("[expressions] guild found:", !!guild, "| name:", guild?.name);
      if (!guild) return res.json(ok({ stickers: [], emojis: [] }));

      const [fetchedEmojis, fetchedStickers] = await Promise.all([
        guild.emojis.fetch().catch((e) => { console.error("[expressions] emoji fetch error:", e.message); return guild.emojis.cache; }),
        guild.stickers.fetch().catch((e) => { console.error("[expressions] sticker fetch error:", e.message); return guild.stickers.cache; }),
      ]);
      console.log("[expressions] emojis:", fetchedEmojis.size, "| stickers:", fetchedStickers.size);

      const stickers = [...fetchedStickers.values()].map(s => ({
        id: s.id,
        name: s.name,
        // format: 1=PNG, 2=APNG, 3=Lottie, 4=GIF
        url: s.format === 4
          ? `https://media.discordapp.net/stickers/${s.id}.gif`
          : `https://media.discordapp.net/stickers/${s.id}.png`,
        isLottie: s.format === 3,
      }));

      const emojis = [...fetchedEmojis.values()].map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`,
        code: e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`,
      }));

      res.json(ok({ stickers, emojis }));
    } catch (err) {
      next(err);
    }
  });

  // 8. Get Shop Items
  router.get("/api/shop/items", requireAuth, async (req, res, next) => {
    try {
      const items = await serviceContext.shopService.listItems({ includeDisabled: false });
      // 商店道具自己沒填圖時，退回道具庫（itemLibraryId）的圖（藥水等共用素材常只在庫裡有圖）
      try {
        const repo = serviceContext.itemRepository;
        const needIds = [...new Set(items.filter((s) => !s.imageUrl && s.itemLibraryId).map((s) => s.itemLibraryId))];
        if (needIds.length) {
          const libs = await Promise.all(needIds.map((id) => repo.findById(id).catch(() => null)));
          const libMap = {};
          needIds.forEach((id, i) => { if (libs[i]) libMap[id] = libs[i]; });
          for (const s of items) {
            if (!s.imageUrl && s.itemLibraryId && libMap[s.itemLibraryId]) {
              const lib = libMap[s.itemLibraryId];
              s.imageUrl = lib.imageUrl || s.imageUrl || null;
              s.imageThumbnailUrl = s.imageThumbnailUrl || lib.imageThumbnailUrl || null;
            }
          }
        }
      } catch (_) { /* 撈庫失敗時回原始商店資料，不擋商店 */ }

      // 依玩家狀態標記:會員資格不符(allowedTiers 不含玩家位階)、本月限量已購滿(maxPerMonth)
      try {
        const { discordId } = req.playerRecord;
        const progress = await serviceContext.progressRepository.findByPlayerId(discordId).catch(() => null);
        const playerTier = progress?.playerTier || null;
        const ym = serviceContext.shopService._currentYearMonth();
        const monthlyCount = progress?.shopMonthlyCount || {};
        for (const s of items) {
          const allowed = Array.isArray(s.allowedTiers) ? s.allowedTiers : [];
          const tierLocked = allowed.length > 0 && !allowed.includes(playerTier ?? "");
          const maxPM = Math.max(0, Number(s.maxPerMonth || 0));
          const usedPM = maxPM > 0 ? Number((monthlyCount[s.id] || {})[ym] || 0) : 0;
          s.locked = tierLocked;                            // 會員資格不符
          s.lockReason = tierLocked ? "資格不符" : null;
          s.purchasedThisMonth = usedPM;
          s.monthlyExhausted = maxPM > 0 && usedPM >= maxPM; // 本月限量已購滿
        }
      } catch (_) { /* 標記失敗不擋商店 */ }

      res.json(ok(items));
    } catch (err) {
      next(err);
    }
  });

  // 9. Buy Shop Item
  router.post("/api/shop/buy/:itemId", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const itemId = req.params.itemId;

      // Read the player's guild roles so tier-gated shop items can be validated.
      let memberRoleIds = [];
      try {
        const guildId = require("../../config").discord.guildId;
        if (guildId && discordClient) {
          const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch({ user: discordId, force: false }).catch(() => null);
            if (member) memberRoleIds = [...member.roles.cache.keys()];
          }
        }
      } catch (_) {}

      const result = await serviceContext.shopService.purchase(discordId, displayName, itemId, memberRoleIds);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 10. Get Combat Zones Status
  router.get("/api/combat/zones", requireAuth, async (req, res, next) => {
    try {
      const keys = ALL_ZONE_KEYS;
      const results = await Promise.all(keys.map(async (key) => {
        const [state, monsters] = await Promise.all([
          serviceContext.monsterService.getState(key),
          serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: key })
        ]);
        
        let activeMonster = monsters.find(m => m.seq === state.activeMonsterSeq);
        if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

        const dmgMap = state.damageMap || {};
        const damageLeaderboard = Object.entries(dmgMap)
          .map(([pid, e]) => ({
            discordId: pid,
            name: e?.name || pid,
            level: Number(e?.level) || 0,
            damage: Number(e?.damage) || 0,
            taken: Number(e?.taken) || 0,
          }))
          .sort((a, b) => b.damage - a.damage)
          .slice(0, 20);
        // 玩家氣泡用「區域存在感」(3 分鐘或換區才消失),比當前怪物傷害名單更持久、看起來更多人
        const _avatarCache = require("../../services/realtime/avatarCache");
        const _chatPresence = require("../../services/realtime/chatPresence");
        const _battlePresence = require("../../services/realtime/battlePresence");
        const _auraMap = buildZoneAuraMap(state);
        const zonePlayers = _battlePresence.listByZone(key).map((p) => {
          const _auraLines = _auraMap.get(String(p.discordId)) || [];
          return {
            discordId: p.discordId,
            name: p.name,
            level: Number(p.level) || 0,
            avatarUrl: _avatarCache.get(p.discordId),
            speaking: _chatPresence.isSpeaking(p.discordId),
            hasAura: _auraLines.length > 0,
            auraLines: _auraLines,
            damage10m: Number(p.damage10m) || 0,
          };
        });

        const cooldown = playerBattleCooldowns.get(req.playerRecord.discordId);
        const nextBattleAt = (cooldown && cooldown.nextBattleAt > Date.now()) ? cooldown.nextBattleAt : null;

        const theme = getZoneTheme(key);

        return {
          zone: key,
          zoneLabel: theme.label,
          zoneEmoji: theme.emoji,
          zoneColor: `#${Number(theme.color || 0).toString(16).padStart(6, "0")}`,
          monsterId: activeMonster?.id || null,
          monsterName: activeMonster?.name || "Unknown",
          monsterImageUrl: activeMonster?.imageUrl || null,
          monsterLevel: activeMonster?.level || 0,
          expReward: activeMonster?.expReward || 0,
          goldReward: activeMonster?.goldReward || 0,
          drops: (activeMonster?.drops || []).map(d => d.itemName),
          currentHp: state.currentHp !== undefined ? state.currentHp : (activeMonster?.calc?.maxHp || 0),
          maxHp: activeMonster?.calc?.maxHp || 0,
          participantCount: Array.isArray(state.participants) ? state.participants.length : 0,
          activeMonsterSeq: state.activeMonsterSeq,
          damageLeaderboard,
          zonePlayers,
          nextBattleAt,
          cooldownMs: nextBattleAt ? Math.max(0, nextBattleAt - Date.now()) : 0,
        };
      }));
      res.json(ok(results));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/viewer/battle-config", async (_req, res, next) => {
    try {
      const configData = await serviceContext.battleConfigService.getViewerConfig();
      res.json(ok(configData));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/viewer/snapshot", async (_req, res, next) => {
    try {
      const keys = ALL_ZONE_KEYS;
      const zones = await Promise.all(keys.map(async (key) => {
        const [state, monsters] = await Promise.all([
          serviceContext.monsterService.getState(key),
          serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: key })
        ]);

        let activeMonster = monsters.find((m) => m.seq === state.activeMonsterSeq);
        if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

        const dmgMap = state.damageMap || {};
        const damageLeaderboard = await Promise.all(
          Object.entries(dmgMap)
            .sort(([, a], [, b]) => b.damage - a.damage)
            .slice(0, 10)
            .map(async ([pid, entry]) => {
              const [player, progress] = await Promise.all([
                serviceContext.playerRepository?.findByDiscordId(pid).catch(() => null),
                serviceContext.progressRepository?.findByPlayerId(pid).catch(() => null),
              ]);

              let avatarUrl = null;
              if (discordClient) {
                try {
                  const discordUser = await discordClient.users.fetch(pid, { force: false });
                  avatarUrl = discordUser.displayAvatarURL({ size: 128, extension: 'png' });
                } catch (_) {}
              }

              return {
                discordId: pid,
                name: entry?.name || player?.displayName || pid,
                damage: entry?.damage || 0,
                damageTaken: entry?.taken || 0,
                weaponType: progress?.equipment?.weapon?.weaponType || null,
                offhandWeaponType: progress?.equipment?.shield?.weaponType || null,
                weaponImageUrl: progress?.equipment?.weapon?.imageUrl || null,
                avatarUrl,
              };
            })
        );

        return {
          zone: key,
          monsterId: activeMonster?.id || null,
          monsterName: activeMonster?.name || "??堊?",
          monsterImageUrl: activeMonster?.imageUrl || null,
          monsterLevel: activeMonster?.level || 0,
          expReward: activeMonster?.expReward || 0,
          goldReward: activeMonster?.goldReward || 0,
          drops: (activeMonster?.drops || []).map((d) => d.itemName),
          currentHp: state.currentHp !== undefined ? state.currentHp : (activeMonster?.calc?.maxHp || 0),
          maxHp: activeMonster?.calc?.maxHp || 0,
          participantCount: Array.isArray(state.participants) ? state.participants.length : 0,
          activeMonsterSeq: state.activeMonsterSeq,
          damageLeaderboard,
          nextBattleAt: null,
        };
      }));

      res.json(ok({
        zones,
        roundMs: ROUND_MS,
        streamPresence: getStreamPresenceSnapshot(),
        refreshedAt: new Date().toISOString(),
      }));
    } catch (err) {
      next(err);
    }
  });

  // 11. Quick Battle
  router.post("/api/combat/quick-battle", requireAuth, async (req, res, next) => {
    let battleLock = null;   // 網頁戰鬥占用鎖
    let lockHeldForAnim = false; // 戰鬥成功 → 占用保留到動畫結束，不在 finally 立即釋放
    try {
      const { discordId, displayName } = req.playerRecord;
      const zoneKey = normalizeZone(req.body.zone);

      // Reject requests while the previous battle animation cooldown is still active.
      const cd = playerBattleCooldowns.get(discordId);
      if (cd && cd.nextBattleAt > Date.now()) {
        const secsLeft = Math.ceil((cd.nextBattleAt - Date.now()) / 1000);
        return res.status(429).json({ status: "error", message: `battle cooldown active, retry in ${secsLeft}s` });
      }

      // 跨 DC/網頁/裝置互斥：DC 端正在戰鬥 → 擋下網頁出戰
      const dcBusy = describeDcBattle(discordId);
      if (dcBusy) {
        return res.status(409).json({ status: "error", message: `${dcBusy}，請先結束後再從網頁出戰。` });
      }
      // 網頁端已有一場戰鬥（含動畫期間）→ 擋下重複出戰
      battleLock = acquireWebBattle(discordId, "web");
      if (!battleLock.ok) {
        battleLock = null;
        return res.status(409).json({ status: "error", message: "你已經有一場戰鬥正在進行，請等結束後再開始。" });
      }

      // 與 DC 一致：進入怪物區戰鬥時，自動結算並結束進行中的掛機（不阻擋戰鬥）
      try {
        await serviceContext.idleService?.settleDiscordSessionOnBattleStart?.(discordId, displayName);
      } catch (e) {
        console.warn("[PlayerApp] idle auto-settle on battle failed:", e.message);
      }
      
      const [stateRaw, monsters] = await Promise.all([
        serviceContext.monsterService.getState(zoneKey),
        serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey })
      ]);
      let state = stateRaw;
      
      if (!monsters.length) {
        return res.status(400).json({ status: "error", message: "No enabled monster in this zone." });
      }

      let monster = monsters.find(m => m.seq === state.activeMonsterSeq);
      if (!monster) {
        monster = monsters[0];
        const initHp = monster.calc.maxHp;
        await serviceContext.monsterService.saveState({ ...state, activeMonsterSeq: monster.seq, currentHp: initHp }, zoneKey);
        state = { ...state, activeMonsterSeq: monster.seq, currentHp: initHp };
      }

      // 防「鞭屍」：非世界王的怪若已死(currentHp<=0)但還沒換下一隻(轉場/sweep 尚未收尾)，
      // 先立刻換成下一隻活怪再打，避免一直重複攻擊同一隻 0 血屍體。
      const _isWBZone = require("../../services/worldBoss/worldBossService").isWorldBossZone;
      if (!_isWBZone(zoneKey) && monster && Number(state.currentHp) <= 0) {
        try {
          const { _doIdleRotate } = require("../../bot/handlers/monsterZoneHandlers");
          await _doIdleRotate(serviceContext, zoneKey);
          const rotated = await serviceContext.monsterService.getState(zoneKey);
          if (rotated && Number(rotated.currentHp) > 0) {
            state = rotated;
            monster = monsters.find(m => m.seq === state.activeMonsterSeq) || monster;
          }
        } catch (_) { /* 換怪失敗就照原狀，至少不崩 */ }
      }

      const monsterHpInitial = state.currentHp != null ? state.currentHp : monster.calc.maxHp;

      // Check level — 優先讀 channel layout binding 的自訂限制，fallback 到靜態預設
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const playerLevel = progress?.level ?? 1;
      const layout = await serviceContext.adminConsoleService.getChannelLayout();
      const featureKey = zoneToFeatureKey(zoneKey);
      const zoneBinding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey && b.enabled);
      const levelError = checkZoneLevelRequirementWithBinding(zoneKey, playerLevel, zoneBinding || null);
      if (levelError) {
        return res.status(400).json({ status: "error", message: levelError });
      }

      // Calc player stats（永遠從 DB 讀取最新 effects，不使用 snapshot 裡的舊值）
      const { calcPlayerStats } = require("../../shared/combatStats");
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      const equipped = await mergeEquippedFromLibrary(progress?.equipment || {}, serviceContext.itemRepository);
      // 與 DC 一致：傳 pkRating + zone，讓裝備的區域條件特效生效（如龍系武器在龍族之領 +20%）
      const pStats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], progress?.inventory || [], { pkRating: progress?.pkRating, zone: zoneKey });

      // ── 共鬥光環系統 ──
      const freshStateForAura = await serviceContext.monsterService.getState(zoneKey);

      let stateForCombat = freshStateForAura;
      let partyEffects = [];
      let selfAuraLines = []; // 本玩家提供給隊友的光環描述（供氣泡彈窗顯示）
      const rawPartyEffs = collectEquipmentEffects(equipped, "passive", { equipped, inventory: progress?.inventory || [] })
        .filter(e => e.target === "party");
      const partyEffs = scaleSupportPartyEffects(rawPartyEffs, { providerStats: pStats, equipped });
      const hasPartyAura = partyEffs.length > 0;

      // 相容舊格式 activeHealerAura（單一物件）→ activeHealerAuras（陣列），支援多光環疊加
      const prevAuras = Array.isArray(freshStateForAura.activeHealerAuras)
        ? freshStateForAura.activeHealerAuras
        : (freshStateForAura.activeHealerAura ? [{ ...freshStateForAura.activeHealerAura }] : []);

      let newAuras = prevAuras;
      if (hasPartyAura) {
        // 光環職業：更新或新增本玩家的光環項目
        newAuras = [...prevAuras.filter(a => a.discordId !== discordId), { discordId, displayName, effects: rawPartyEffs }];
        partyEffects = partyEffs;
        selfAuraLines = partyEffs.map(eff => {
          const effName = EFFECT_NAME_ZH[eff.key] || eff.definitionName || eff.key;
          const vt = formatEffectValueText(eff.key, eff?.params);
          return `${effName}${vt ? ` ${vt}` : ""}`;
        });
      } else {
        // 非光環職業：從陣列移除本玩家（若曾在其中）
        newAuras = prevAuras.filter(a => a.discordId !== discordId);
      }

      // 光環陣列有變動才重新存儲
      const auraChanged = JSON.stringify(newAuras) !== JSON.stringify(prevAuras);
      if (auraChanged) {
        const updatedState = { ...freshStateForAura, activeHealerAuras: newAuras, activeHealerAura: null };
        await serviceContext.monsterService.saveState(updatedState, zoneKey);
        stateForCombat = updatedState;
      }

      // 非光環職業：堆疊區域內所有光環提供者的效果
      if (!hasPartyAura && newAuras.length > 0) {
        const allCollected = [];
        for (const aura of newAuras) {
          if (!aura?.discordId) continue;
          const auraProgress = await serviceContext.progressRepository.findByPlayerId(aura.discordId).catch(() => null);
          if (!auraProgress) continue;
          const auraProviderEquipped = await mergeEquippedFromLibrary(auraProgress.equipment || {}, serviceContext.itemRepository);
          const auraAttrs = auraProgress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
          const auraProviderStats = calcPlayerStats(auraAttrs, auraProviderEquipped, auraProgress.activeEffects || [], auraProgress.inventory || []);
          const scaled = scaleSupportPartyEffects(
            (aura.effects || []).map(e => ({ ...e, sourceName: aura.displayName || null })),
            { providerStats: auraProviderStats, equipped: auraProviderEquipped }
          );
          allCollected.push(...scaled);
        }
        // 同一 effect key 不疊加：只取數值最高的那個提供者版本
        const byKey = new Map();
        for (const eff of allCollected) {
          if (!eff?.key) continue;
          const val = Number(eff?.params?.value ?? eff.value ?? 0);
          const prev = byKey.get(eff.key);
          const prevVal = prev ? Number(prev?.params?.value ?? prev.value ?? 0) : -Infinity;
          if (val > prevVal) byKey.set(eff.key, eff);
        }
        partyEffects = Array.from(byKey.values());
      }

      // ── 為怪物自動裝備自己的卡片 ──
      let monsterEquipped = {};
      try {
        const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
        const db = await getMongoDb();
        const monsterCard = await db.collection("items").findOne({
          name: { $regex: monster.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '卡' },
          equipSlot: 'special'
        });
        if (monsterCard) {
          monsterEquipped.special_1 = monsterCard;
        }
      } catch (e) {
        // 如果無法取得怪物卡片，繼續進行戰鬥
      }

      // 與 DC 一致：圖鑑加成（依玩家對這隻怪的累積擊殺，最高 +30% 傷害）
      const { bestiaryRequirement, bestiaryBonusPct, bestiaryGainFromDamage } = require("../../shared/bestiary");
      const { isWorldBossZone } = require("../../services/worldBoss/worldBossService");
      const _bestiaryMonsterId = String(monster?.id || monster?._id || monster.name || "");
      // 需求數依怪物種類判定（同 DC）：世界王 10 / BOSS 50 / 一般 100
      const _bestiaryReq = bestiaryRequirement(monster, isWorldBossZone(zoneKey));
      const _bestiaryKillsBefore = Number(progress?.bestiary?.[_bestiaryMonsterId]) || 0;
      const _bestiaryBonusPct = bestiaryBonusPct(_bestiaryKillsBefore, _bestiaryReq);

      // ── 世界王部位戰鬥（還原 DC）：戰前調整玩家/怪物 stats + 部位血量初始化 ──
      const {
        parseWorldBossTargetPart,
        applyWorldBossTargetToPlayerStats,
        applyWorldBossTargetToMonster,
        applyDragonKingBreakWeaken,
        ensureWorldBossPartState: ensureWBPartState,
        sumWorldBossPartHp: sumWBPartHp,
        isWorldBossAllPartsDefeated: isWBAllDefeated,
        DRAGON_KING_ZONE: WB_DRAGON_KING_ZONE
      } = require("../../bot/handlers/monsterZoneHandlers");

      const WB_VALID_PARTS = new Set(["head", "body", "wings", "legs"]);
      const isWorldBoss = isWorldBossZone(zoneKey) && Boolean(monster?.isBoss);
      // 部位：優先讀 req.body.part；不合法則 fallback "body"
      let worldBossPart = "body";
      if (isWorldBoss) {
        const rawPart = String(req.body?.part || "").trim();
        worldBossPart = WB_VALID_PARTS.has(rawPart) ? rawPart : "body";
      }

      let battlePStats = pStats;
      let battleMonsterStats = monster.calc;
      let battleMonsterEquipped = monsterEquipped;

      if (isWorldBoss) {
        // 確保 state 有部位血量；若沒有就先存回（與 DC 一致）
        const ensured = ensureWBPartState(stateForCombat, monster.calc.maxHp, zoneKey);
        if (ensured.changed) {
          const seeded = {
            ...stateForCombat,
            worldBossPartsHp: ensured.worldBossPartsHp,
            worldBossPartsMaxHp: ensured.worldBossPartsMaxHp,
            currentHp: ensured.currentHp
          };
          await serviceContext.monsterService.saveState(seeded, zoneKey).catch(() => {});
          stateForCombat = seeded;
        }

        // ── 開戰前確認世界王是否還活著 ──
        // 王死亡後進冷卻/刷新時,排隊中的玩家不該再揍下一隻;部位已破也不該再打。
        // 擋下時:不發公告、不收入場費、不扣血、不發提示,只回 409 讓前端安靜停止排隊。
        // 真正「退場」才擋:冷卻中/未解鎖/停用,或整隻王全破。
        let wbUnavailable = false;
        try {
          const wbSvc0 = serviceContext.worldBossServiceFor?.(zoneKey);
          if (wbSvc0?.getConfigWithStatus) {
            const cs = await wbSvc0.getConfigWithStatus();
            if (cs?.status && cs.status.canChallenge === false) wbUnavailable = true; // 冷卻中/未解鎖/停用
          }
        } catch (_) {}
        try { if (isWBAllDefeated(stateForCombat, zoneKey)) wbUnavailable = true; } catch (_) {} // 整王已全破
        if (wbUnavailable) {
          return res.status(409).json({ status: "error", code: "world_boss_unavailable", message: "世界王已被擊敗或進入冷卻,無法繼續挑戰。" });
        }

        // 目標部位已破但整隻王還活著 → 自動改打其他還活著的部位(不擋、不報退場)。
        // 解決:打完一場/預約續戰時,剛把該部位打破,下一戰仍鎖該部位而誤跳「已退場」。
        let _partHpNow = Math.max(0, Number(stateForCombat.worldBossPartsHp?.[worldBossPart] || 0));
        if (_partHpNow <= 0) {
          const _partsHp = stateForCombat.worldBossPartsHp || {};
          let _partKeys = [];
          try { _partKeys = require("../../bot/handlers/monsterZoneHandlers").getWorldBossPartKeys(zoneKey) || []; } catch (_) {}
          const _aliveKeys = _partKeys.filter((k) => Number(_partsHp[k] || 0) > 0);
          if (_aliveKeys.length > 0) {
            worldBossPart = _aliveKeys.includes("body") ? "body" : _aliveKeys[0];
            _partHpNow = Math.max(0, Number(_partsHp[worldBossPart] || 0));
          } else {
            // 沒有任何活著的部位 = 整王已破 → 才真的擋
            return res.status(409).json({ status: "error", code: "world_boss_unavailable", message: "世界王已被擊敗或進入冷卻,無法繼續挑戰。" });
          }
        }

        // 玩家 stats 依部位調整
        battlePStats = applyWorldBossTargetToPlayerStats(pStats, worldBossPart, zoneKey).stats;
        // 怪物 stats / 卡片依部位調整
        const adjM = applyWorldBossTargetToMonster(monster.calc, monsterEquipped, worldBossPart, zoneKey);
        battleMonsterStats = adjM.monsterStats;
        battleMonsterEquipped = adjM.monsterEquipped;
        // 古龍王：依已破壞部位套破鱗削弱（攻擊面）
        if (zoneKey === WB_DRAGON_KING_ZONE) {
          const weakened = applyDragonKingBreakWeaken(battleMonsterStats, battleMonsterEquipped, stateForCombat.worldBossPartsHp);
          battleMonsterStats = weakened.monsterStats;
          battleMonsterEquipped = weakened.monsterEquipped;
        }

        // 開戰公告:只由「真正把 battleStartedAt 從未設定→設定」的那一次發送(web/DC 共用同一旗標,避免重複)
        try {
          const wbSvc = serviceContext.worldBossServiceFor?.(zoneKey);
          const startRes = wbSvc ? await wbSvc.startBossBattleIfNeeded().catch(() => null) : null;
          const justStarted = !!startRes?.justStarted;
          if (justStarted) {
            if (discordClient?.isReady?.()) {
              const alarmRoleId = require("../../config").discord?.worldBossAlarmRoleId;
              const alarmTag = alarmRoleId ? `\n<@&${alarmRoleId}> 世界王鬧鐘響囉！` : "";
              const ch = await discordClient.channels.fetch("1498608950671839263").catch(() => null);
              if (ch?.isTextBased?.()) {
                await ch.send({
                  content: `⚔️ **世界BOSS 挑戰開始！**\n**${displayName}** 率先向 **${monster.name}** 發起挑戰！\n前往挑戰加入戰鬥，30 分鐘內未擊殺視為失敗。${alarmTag}`,
                  allowedMentions: alarmRoleId ? { roles: [alarmRoleId] } : { parse: [] }
                }).catch(() => {});
              }
            }
          }
        } catch (e) {
          console.warn("[worldBoss/web] 開打公告失敗:", e?.message || e);
        }
      }

      // ── 世界王入場費(與 DC 一致):每次出戰(含排隊自動出擊)都收費,金幣不足擋下 ──
      // 大史(elite)5000、龍王(dragon_king_lair)10000,以 zones.js 預設或怪物自訂為準。
      let worldBossEntryFee = 0;
      if (isWorldBoss) {
        worldBossEntryFee = Math.max(0, Number(monster?.entryFee ?? getZoneDefaultEntryFee(zoneKey)) || 0);
        if (worldBossEntryFee > 0) {
          const walletNow = await serviceContext.walletService.getWalletByDiscordId(discordId, displayName).catch(() => null);
          const goldOwned = Math.max(0, Number(walletNow?.wallet?.gold ?? walletNow?.gold) || 0);
          if (goldOwned < worldBossEntryFee) {
            // 提早 return,鎖由下方 finally 釋放(lockHeldForAnim 仍為 false)
            return res.status(400).json({
              status: "error",
              message: `挑戰 ${monster.name} 需要 ${worldBossEntryFee.toLocaleString()} 金幣，你目前只有 ${goldOwned.toLocaleString()} 金幣。`
            });
          }
          await serviceContext.rewardService.grantCurrency({
            discordId, displayName, currencyType: "gold", amount: -worldBossEntryFee,
            source: require("../../shared/sources").CURRENCY_SOURCES.MONSTER_ENTRY_FEE,
            operator: "monster_zone:web_enter_battle"
          });
        }
      }

      // 世界王:戰鬥用「當前被打部位的血量」當基準,讓 %型 DOT(中毒/流血等)與怪物自療
      // 都以部位血量計算,而非整隻王總血量(與 DC 端 session.monsterHp 一致)。
      const combatMonsterHp = isWorldBoss
        ? Math.max(0, Number(stateForCombat.worldBossPartsHp?.[worldBossPart] || 0))
        : monsterHpInitial;

      const { runCombatLoop } = require("../../shared/combatLoop");
      const combatResult =
        runCombatLoop(battlePStats, battleMonsterStats, monster.name, combatMonsterHp, undefined, {
          playerName: displayName,
          playerLevel: progress?.level || 1,
          equipped,
          inventory: progress?.inventory || [],
          partyEffects,
          monsterEquipped: battleMonsterEquipped,
          monsterIsBoss: Boolean(monster?.isBoss),
          bestiaryBonusPct: _bestiaryBonusPct, // 圖鑑傷害加成（同 DC）
          isWorldBoss, // 世界王：玩家 DOT 也吃王 def%（同 DC）
          zone: zoneKey // 裝備的區域條件特效（同 DC）
        });
      const { roundLogs, finalPlayerHp, combatStats } = combatResult;
      // 與 DC 一致：戰力同步已停用（monsterZoneHandlers.js 也是寫死 false），
      // 用原始傷害與真實 outcome，不再壓制低階區輸出
      const zoneDamageSyncApplied = false;
      const syncResult = zoneDamageSyncApplied
        ? applyZoneDamageSync(
          zoneKey,
          monsterHpInitial,
          monster.calc?.maxHp,
          combatResult.totalDamage,
          combatResult.finalMonsterHp,
          combatResult.outcome
        )
        : {
          damage: Math.max(0, Math.round(Number(combatResult.totalDamage || 0))),
          monsterHp: Math.max(0, Math.round(Number(combatResult.finalMonsterHp ?? Math.max(0, monsterHpInitial - combatResult.totalDamage)))),
          outcome: combatResult.outcome,
          applied: false,
          notice: null
        };
      let outcome = syncResult.outcome;
      const totalDamage = syncResult.damage;
      const totalTaken = Math.max(0, (pStats.maxHp || 0) - Math.max(0, finalPlayerHp));

      // ── 世界王部位戰鬥結算（還原 DC）：把本場傷害扣在被打的部位 ──
      // 只有「全部位破壞」才視為真正擊殺（呼叫 handleMonsterKill → 觸發冷卻/發獎）；
      // 部位破但王未全破：outcome 視該部位是否破，但不呼叫 handleMonsterKill。
      let worldBossSettled = false;       // true → 已在此自行寫入 state，跳過下方一般結算的 state 寫入
      let worldBossAllPartsDefeated = false;
      let worldBossPartHpCurrent = 0;
      let worldBossPartHpMax = 1;
      let worldBossPartsForResp = null;
      let worldBossPartBroken = false;
      if (isWorldBoss) {
        try {
          const freshState = await serviceContext.monsterService.getState(zoneKey);
          const prevParts = ensureWBPartState(freshState, monster.calc.maxHp, zoneKey);
          const latestPartHp = Math.max(0, Number(prevParts.worldBossPartsHp?.[worldBossPart] || 0));
          const nextPartHp = Math.max(0, latestPartHp - totalDamage);
          const nextPartsHp = { ...prevParts.worldBossPartsHp, [worldBossPart]: nextPartHp };
          const nextCurrentHp = sumWBPartHp(nextPartsHp);
          worldBossAllPartsDefeated = isWBAllDefeated(nextPartsHp);
          worldBossPartBroken = nextPartHp <= 0;
          worldBossPartHpCurrent = nextPartHp;
          worldBossPartHpMax = Math.max(1, Math.round(Number(prevParts.worldBossPartsMaxHp?.[worldBossPart] || 1)));

          const prevDmg = freshState.damageMap || {};
          const updatedDamageMap = {
            ...prevDmg,
            [discordId]: {
              name: displayName,
              level: progress?.level || 1,
              damage: (prevDmg[discordId]?.damage || 0) + totalDamage,
              taken: (prevDmg[discordId]?.taken || 0) + totalTaken,
              // 世界王貢獻寶箱:累計入場費(花費排名依據),與 DC 共用同一份 damageMap → 貢獻合併計算
              spent: (prevDmg[discordId]?.spent || 0) + (Number(worldBossEntryFee) || 0),
            }
          };
          const updatedParticipants = [...new Set([...(Array.isArray(freshState.participants) ? freshState.participants : []), discordId])];
          const nextState = {
            ...freshState,
            currentHp: nextCurrentHp,
            worldBossPartsHp: nextPartsHp,
            worldBossPartsMaxHp: prevParts.worldBossPartsMaxHp,
            damageMap: updatedDamageMap,
            participants: updatedParticipants,
            lastHitAt: new Date().toISOString()
          };
          await serviceContext.monsterService.saveState(nextState, zoneKey);
          stateForCombat = nextState;
          worldBossSettled = true;

          // 部位血條（回傳給前端即時更新）
          const PART_LABELS_RESP = { head: "頭部", body: "軀幹", wings: "龍翼", legs: "下盤" };
          const { getWorldBossPartKeys: wbPartKeys } = require("../../bot/handlers/monsterZoneHandlers");
          worldBossPartsForResp = wbPartKeys(zoneKey)
            .filter((k) => Object.prototype.hasOwnProperty.call(nextPartsHp, k))
            .map((k) => {
              const hp = Math.max(0, Number(nextPartsHp[k] || 0));
              const max = Math.max(1, Math.round(Number(prevParts.worldBossPartsMaxHp?.[k] || 0) || hp || 1));
              return { key: k, name: PART_LABELS_RESP[k] || k, currentHp: Math.round(hp), maxHp: max, broken: hp <= 0 };
            });

          // outcome：全破 → win（真正擊殺）；部位破但王未全破 → win（該部位戰勝，但不擊殺整王）；
          // 否則沿用戰鬥結果（lose / timeout / win-by-rounds 轉成 timeout 因王還有血）
          if (worldBossAllPartsDefeated) {
            outcome = "win";
          } else if (outcome !== "lose") {
            outcome = worldBossPartBroken ? "win" : "timeout";
          }
        } catch (e) {
          console.error("[WorldBoss] web part settlement failed:", e.message);
        }
      }

      // ── 怪物圖鑑累積（同 DC）：本場對該怪造成傷害 / 該怪最大HP（最多算 1 隻）原子累加 ──
      // 勝負/逃跑都累積（未擊殺也算），用本人 totalDamage。
      let bestiaryInfo = null;
      try {
        const _bMaxHp = Math.max(1, Number(monster?.calc?.maxHp || monsterHpInitial || 1));
        const _bGain = bestiaryGainFromDamage(totalDamage, _bMaxHp);
        if (_bGain > 0 && _bestiaryMonsterId) {
          const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
          const _db = await getMongoDb();
          await _db.collection("progress").updateOne(
            { playerId: discordId },
            { $inc: { ["bestiary." + _bestiaryMonsterId]: _bGain } }
          );
          const _bTotalAfter = _bestiaryKillsBefore + _bGain;
          bestiaryInfo = {
            monsterName: monster.name,
            gainPct: Math.round(_bGain * 1000) / 10,
            killsAfter: Math.round(_bTotalAfter * 10) / 10,
            requirement: _bestiaryReq,
            bonusPctBefore: Math.round(_bestiaryBonusPct * 10) / 10,
            bonusPctAfter: Math.round(bestiaryBonusPct(_bTotalAfter, _bestiaryReq) * 10) / 10
          };
        }
      } catch (e) {
        console.error("[Bestiary] web credit failed:", e.message);
      }

      // 蝯?
      const { handleMonsterKill, _republishPanel, _republishPanelWithRankingDebounce, MAX_ROUNDS } = require("../../bot/handlers/monsterZoneHandlers");
      let rewardLines = [];
      let mHp = syncResult.monsterHp;
      // 排行榜要顯示「本場剛打的這隻怪」最終貢獻(含本場傷害);擊殺後王/怪雖換成下一隻,
      // 仍回傳剛打那隻的累積排行,避免剛打死時排行歸零空白。
      let boardDamageMap = null;
      const currentParticipants = Array.isArray(stateForCombat.participants) ? stateForCombat.participants : [];

      if (isWorldBoss) {
        // ── 世界王：state 已由部位結算寫入；只有全部位破壞才呼叫 handleMonsterKill（觸發冷卻/發獎）──
        mHp = stateForCombat.currentHp ?? 0;
        const stateWithMe = stateForCombat;
        boardDamageMap = stateWithMe.damageMap || {};
        if (worldBossAllPartsDefeated) {
          const sessionPayload = { monsterName: monster.name, entryFee: monster.entryFee ?? getZoneDefaultEntryFee(zoneKey) };
          // handleMonsterKill 內部對世界王會 markBossKilled() → 設 lastKilledAt → 進入冷卻
          rewardLines = await handleMonsterKill({ discordId, displayName, session: sessionPayload, monster, state: stateWithMe, totalDamage, zoneKey });
        } else if (worldBossPartBroken) {
          rewardLines = [`💥 已擊破 ${monster.name} 的${({ head: "頭部", body: "軀幹", wings: "龍翼", legs: "下盤" })[worldBossPart] || "部位"}！繼續擊破其餘部位才能屠王。`];
        } else if (outcome === "lose") {
          rewardLines = [`你被 ${monster.name} 擊敗了…`];
        } else {
          rewardLines = [`激戰 ${MAX_ROUNDS} 回合，未能擊破部位（剩 ${Math.max(0, Math.round(worldBossPartHpCurrent))} HP），下次再來補刀！`];
        }
        // 部位戰報後即時更新面板（含部位血條）
        _republishPanelWithRankingDebounce(serviceContext, zoneKey, monster, stateForCombat.currentHp, currentParticipants.length + 1, stateForCombat.damageMap || {}).catch(() => {});
      } else if (outcome === "win") {
        mHp = 0;
        // Ensure this player is included in participants and damage map before kill handling.
        const stateWithMe = {
          ...stateForCombat,
          participants: [...new Set([...currentParticipants, discordId])],
          damageMap: {
            ...(stateForCombat.damageMap || {}),
            [discordId]: {
              name: displayName,
              level: progress?.level || 1,
              damage: (stateForCombat.damageMap?.[discordId]?.damage || 0) + totalDamage,
              taken: (stateForCombat.damageMap?.[discordId]?.taken || 0) + totalTaken,
            }
          }
        };
        boardDamageMap = stateWithMe.damageMap;
        const sessionPayload = { monsterName: monster.name, entryFee: monster.entryFee ?? getZoneDefaultEntryFee(zoneKey) };
        rewardLines = await handleMonsterKill({ discordId, displayName, session: sessionPayload, monster, state: stateWithMe, totalDamage, zoneKey });
      } else {
        mHp = Math.max(0, mHp);
        let damageMap = {};
        try {
          const freshState = await serviceContext.monsterService.getState(zoneKey);
          const prev = freshState.damageMap || {};
          damageMap = {
            ...prev,
            [discordId]: {
              name: displayName,
              level: progress?.level || 1,
              damage: (prev[discordId]?.damage || 0) + totalDamage,
              taken: (prev[discordId]?.taken || 0) + totalTaken,
            }
          };
          // Refresh participants from the latest state to avoid clobbering concurrent joins.
          const updatedParticipants = [...new Set([...(Array.isArray(freshState.participants) ? freshState.participants : []), discordId])];
          await serviceContext.monsterService.saveState({ ...freshState, currentHp: mHp, damageMap, participants: updatedParticipants }, zoneKey);
        } catch (e) {
          await serviceContext.monsterService.saveState({ ...state, currentHp: mHp }, zoneKey);
        }
        boardDamageMap = damageMap;

        if (outcome === "lose") {
          rewardLines = [`你被 ${monster.name} 擊敗了…`];
        } else {
          // timeout：撐完回合但沒打死（怪物血量跨場累積，其他玩家也會接力）
          rewardLines = [`激戰 ${MAX_ROUNDS} 回合，怪物殘血撤退（剩 ${Math.max(0, Math.round(mHp))} HP），下次再來補刀！`];
        }

        // update panel（排行榜去重，最多 5 秒更新一次）
        _republishPanelWithRankingDebounce(serviceContext, zoneKey, monster, mHp, currentParticipants.length + 1, damageMap).catch(() => {});
      }

      if (syncResult.notice) {
        rewardLines = [syncResult.notice, ...rewardLines];
      }

      if (progress && Array.isArray(progress.activeEffects) && progress.activeEffects.length > 0) {
        const nextActiveEffects = decrementActiveEffects(progress.activeEffects, "battle", 1);
        if (nextActiveEffects.length !== progress.activeEffects.length) {
          progress.activeEffects = nextActiveEffects;
          progress.updatedAt = new Date().toISOString();
          await serviceContext.progressRepository.save(progress).catch(() => {});
        }
      }

      // Weekly quest progression is updated after each battle result.
      try {
        const questService = serviceContext.questService || serviceContext.weeklyQuestService;
        await questService.recordProgress(discordId, "battle_count", 1);
        // battle_win is granted in handleMonsterKill to all participants on kill.
        await questService.recordProgress(discordId, "damage_total", totalDamage);
        // 職業任務：依「出戰所持武器類型」累加（與 DC 端 recordQuestBattleProgress 對齊）
        const _wt = String(equipped?.weapon?.weaponType || "");
        const _weaponMetric =
          (_wt === "sword_1h" || _wt === "sword_2h") ? "battle_with_sword"
          : (_wt === "axe_1h" || _wt === "axe_2h") ? "battle_with_axe"
          : (_wt === "mace_1h" || _wt === "mace_2h") ? "battle_with_mace"
          : (_wt === "dagger") ? "battle_with_dagger"
          : (_wt === "staff_1h" || _wt === "staff_2h") ? "battle_with_staff"
          : (_wt === "bow") ? "battle_with_bow"
          : null;
        if (_weaponMetric) await questService.recordProgress(discordId, _weaponMetric, 1);
        if (outcome === "lose") {
          await questService.recordProgress(discordId, "death_count", 1);
        }
        if (combatStats) {
          if (combatStats.comboCount > 0) await questService.recordProgress(discordId, "combo_count", combatStats.comboCount);
          if (combatStats.dodgeCount > 0) await questService.recordProgress(discordId, "dodge_count", combatStats.dodgeCount);
          if (combatStats.blockCount > 0) await questService.recordProgress(discordId, "block_count", combatStats.blockCount);
          if (combatStats.stunCount > 0) await questService.recordProgress(discordId, "stun_count", combatStats.stunCount);
          if (combatStats.burnTriggerCount > 0) await questService.recordProgress(discordId, "burn_trigger_count", combatStats.burnTriggerCount);
        }
      } catch (e) {
        console.error("[WeeklyQuest] recordProgress error:", e.message);
      }

      // Cooldown duration matches the client-side animation timeline.
      // 回合節奏依玩家 AGI（同 DC），env ROUND_MS 仍可覆寫成固定值
      const perRoundMs = process.env.ROUND_MS ? ROUND_MS : calculateTickDelay(pStats.agi || 1);
      // 死亡額外冷卻：與 DC 一致，戰鬥死亡(lose)在基準動畫時間外再加 10 秒懲罰
      const DEATH_EXTRA_COOLDOWN_MS = 10 * 1000;
      const animDurationMs = roundLogs.length * perRoundMs + 2000 + (outcome === "lose" ? DEATH_EXTRA_COOLDOWN_MS : 0);
      const nextBattleAt = Date.now() + animDurationMs;
      playerBattleCooldowns.set(discordId, { zone: zoneKey, nextBattleAt });
      // 戰鬥已結算：把網頁占用鎖延續到動畫結束才自動失效，期間 DC/其他裝置都視為忙碌
      if (battleLock) { battleLock.hold(animDurationMs); lockHeldForAnim = true; }
      // Clean up the cooldown map after the window has safely expired.
      setTimeout(() => {
        const entry = playerBattleCooldowns.get(discordId);
        if (entry && entry.nextBattleAt <= Date.now()) playerBattleCooldowns.delete(discordId);
      }, animDurationMs + 5000);

      // ── 共鬥光環回傳資料（供前端戰鬥畫面顯示光環效果）──
      // partyEffects 已由上方「共鬥光環系統」算好（不在此重算）；
      // 這裡只把它組成人類可讀的中文描述。
      const auraApplied = Array.isArray(partyEffects) && partyEffects.length > 0;
      const auraLines = [];
      // 多光環：每個效果各自帶提供者名稱；自身光環顯示自己
      const auraFromTeammate = auraApplied && !hasPartyAura && partyEffects.some(e => e && e.sourceName);
      // 提供者名稱：多人時取第一位（前端 header 用），各行內已含各自名稱
      const _auraNames = auraApplied && !hasPartyAura
        ? [...new Set(partyEffects.filter(e => e?.sourceName).map(e => e.sourceName))]
        : [];
      const auraProviderName = auraApplied
        ? (hasPartyAura ? displayName : (_auraNames.length === 1 ? _auraNames[0] : (_auraNames.length > 1 ? "隊友" : null)))
        : null;
      if (auraApplied) {
        for (const eff of partyEffects) {
          if (!eff?.key) continue;
          const name = EFFECT_NAME_ZH[eff.key] || eff.definitionName || eff.key;
          const valueText = formatEffectValueText(eff.key, eff?.params);
          const prefix = hasPartyAura
            ? `✨ ${displayName} 的共鬥光環：`
            : (eff.sourceName ? `✨ ${eff.sourceName} 的共鬥光環：` : "✨ 共鬥光環：");
          auraLines.push(`${prefix}${name}${valueText ? ` ${valueText}` : ""}`);
        }
      }

      // 圖鑑進度通知（同 DC 格式）：每場有累積就附在戰報尾端
      if (bestiaryInfo) {
        rewardLines.push(`📖 圖鑑：**${bestiaryInfo.monsterName}** +${bestiaryInfo.gainPct}%（累積 ${bestiaryInfo.killsAfter}/${bestiaryInfo.requirement} 隻，對該怪傷害 +${bestiaryInfo.bonusPctAfter}%）`);
      }

      // 記錄玩家「目前在此區域戰鬥」的存在感(供戰鬥畫面玩家氣泡;3 分鐘或換區才消失)
      try { require("../../services/realtime/battlePresence").touch(discordId, { name: displayName, level: progress?.level, zone: zoneKey, hasAura: hasPartyAura, auraLines: selfAuraLines, damage: totalDamage }); } catch (_) { /* noop */ }

      // ── 戰後即時排行榜 + 換怪同步（回傳給前端,免等 4 秒輪詢）──
      // 解決:進地圖第一隻/排隊時自己的傷害排行常常沒顯示;擊殺後怪物換成下一隻要同步。
      let postBattleLeaderboard = [];
      let postZonePlayers = [];
      let nextMonsterSync = null;
      try {
        const latestState = await serviceContext.monsterService.getState(zoneKey);
        // 排行榜用「本場剛打那隻怪」的貢獻表(含本場傷害);若無則 fallback 現場狀態。
        const dmgMap = (boardDamageMap && Object.keys(boardDamageMap).length) ? boardDamageMap : (latestState.damageMap || {});
        postBattleLeaderboard = Object.entries(dmgMap)
          .map(([pid, e]) => ({
            discordId: pid, name: e?.name || pid,
            level: Number(e?.level) || 0, damage: Number(e?.damage) || 0, taken: Number(e?.taken) || 0
          }))
          .sort((a, b) => b.damage - a.damage)
          .slice(0, 20);
        // 玩家氣泡用區域存在感(剛 touch 過,含自己)
        const _avatarCache2 = require("../../services/realtime/avatarCache");
        const _chatPresence2 = require("../../services/realtime/chatPresence");
        const _battlePresence2 = require("../../services/realtime/battlePresence");
        const _auraMap2 = buildZoneAuraMap(latestState);
        postZonePlayers = _battlePresence2.listByZone(zoneKey).map((p) => {
          const _auraLines = _auraMap2.get(String(p.discordId)) || [];
          return {
            discordId: p.discordId, name: p.name, level: Number(p.level) || 0,
            avatarUrl: _avatarCache2.get(p.discordId), speaking: _chatPresence2.isSpeaking(p.discordId),
            hasAura: _auraLines.length > 0, auraLines: _auraLines,
            damage10m: Number(p.damage10m) || 0
          };
        });
        // 非世界王才回傳「目前實際怪物」(他人擊殺/補刀後可能已換);世界王不換怪
        if (!isWorldBoss) {
          const liveMonsters = await serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
          const liveMon = liveMonsters.find((m) => m.seq === latestState.activeMonsterSeq) || liveMonsters[0] || null;
          if (liveMon) {
            nextMonsterSync = {
              monsterId: liveMon.id || null,
              monsterName: liveMon.name || "怪物",
              monsterImageUrl: liveMon.imageUrl || null,
              currentHp: latestState.currentHp != null ? latestState.currentHp : (liveMon.calc?.maxHp || 0),
              maxHp: liveMon.calc?.maxHp || 0,
              activeMonsterSeq: latestState.activeMonsterSeq
            };
          }
        }
      } catch (_) { /* 排行/換怪同步失敗不影響戰鬥結果 */ }

      res.json(ok({
        outcome,
        monsterName: monster.name,
        monsterImageUrl: monster.imageUrl || null, // 本場實際對戰怪物的圖,讓前端圖片永遠對得上名字(不受區域換怪延遲影響)
        logs: roundLogs,
        rewardLines,
        rewardSummary: rewardLines._summary || null,
        // 圖鑑本場進度（結構化，給前端顯示）
        bestiary: bestiaryInfo,
        // 本場掉落道具（結構化，給網頁漂浮道具氣泡 + 詳細視窗）
        drops: Array.isArray(rewardLines._drops) ? rewardLines._drops : [],
        // 戰後即時排行榜 + 目前實際怪物(換怪同步),前端立即更新免等輪詢
        damageLeaderboard: postBattleLeaderboard,
        zonePlayers: postZonePlayers,
        nextMonster: nextMonsterSync,
        totalDamage,
        finalPlayerHp: Math.max(0, finalPlayerHp),
        // 世界王:血條顯示「當前所打部位」的血量(非整隻王總血量);一般怪維持整隻血量
        finalMonsterHp: isWorldBoss ? Math.max(0, Math.round(worldBossPartHpCurrent)) : Math.max(0, mHp),
        // 進場瞬間怪物實際 HP 與滿血（共鬥怪可能非滿血，前端據此顯示血條）
        monsterStartHp: isWorldBoss ? Math.max(0, Math.round(Number(combatMonsterHp))) : Math.max(0, Math.round(Number(monsterHpInitial))),
        monsterMaxHp: isWorldBoss ? Math.max(1, Math.round(Number(worldBossPartHpMax))) : Math.max(1, Math.round(Number(monster.calc.maxHp))),
        nextBattleAt,
        // 剩餘冷卻毫秒(=本場動畫長度);前端用自己的時鐘換算,免受裝置時間不準影響
        cooldownMs: animDurationMs,
        // 本場是否吃到共鬥光環，以及各光環效果的中文描述（前端顯示光環效果用）
        auraApplied,
        auraLines,
        auraProviderName,
        auraFromTeammate,
        // 每回合播放節奏（依玩家 AGI，與 DC 一致），前端逐回合動畫用
        tickMs: calculateTickDelay(pStats.agi || 1),
        // ── 世界王部位戰鬥（前端戰報後即時更新部位血條）──
        targetPart: isWorldBoss ? worldBossPart : null,
        partName: isWorldBoss ? (({ head: "頭部", body: "軀幹", wings: "龍翼", legs: "下盤" })[worldBossPart] || null) : null,
        partHp: isWorldBoss ? { current: Math.max(0, Math.round(worldBossPartHpCurrent)), max: worldBossPartHpMax } : null,
        allPartsDefeated: isWorldBoss ? worldBossAllPartsDefeated : false,
        partBroken: isWorldBoss ? worldBossPartBroken : false,
        parts: isWorldBoss ? worldBossPartsForResp : null,
      }));

    } catch (err) {
      next(err);
    } finally {
      // 戰鬥成功時鎖已 hold 到動畫結束；其餘情況（例外/提早 return）立即釋放占用
      if (battleLock && !lockHeldForAnim) battleLock.release();
    }
  });

  // ──────────────────────────────────────────────────
  // 世界王（player 端唯讀狀態）
  // ──────────────────────────────────────────────────
  router.get("/api/worldboss/status", requireAuth, async (req, res, next) => {
    try {
      const wb = serviceContext.worldBossService;
      if (!wb) {
        return res.json(ok({ enabled: false, config: null, state: null, status: null, bosses: [] }));
      }

      const {
        WORLD_BOSS_ZONES,
        bossKeyForZone
      } = require("../../services/worldBoss/worldBossService");
      const {
        ensureWorldBossPartState,
        getWorldBossPartKeys,
        sumWorldBossPartHp
      } = require("../../bot/handlers/monsterZoneHandlers");

      const PART_LABELS = { head: "頭部", body: "軀幹", wings: "龍翼", legs: "下盤" };
      const DRAGON_KING_ZONE = "dragon_king_lair";

      // 各世界王部位增減益說明（給前端顯示）
      const PART_EFFECTS = {
        elite: [
          { key: "head", name: "頭部", desc: "怪物技能發動率↑（高風險）" },
          { key: "body", name: "軀幹", desc: "防禦極高、你的傷害被削減" },
          { key: "legs", name: "下盤", desc: "怪物攻擊更兇（你受到傷害 ×1.3）" }
        ],
        dragon_king_lair: [
          { key: "head", name: "頭部", desc: "取其首級，傳說落幕（破頭無削弱）" },
          { key: "body", name: "軀幹", desc: "破其逆鱗 → 王技能發動率降到 30%" },
          { key: "wings", name: "龍翼", desc: "折其雙翼 → 王技能傷害 −15%" },
          { key: "legs", name: "下盤", desc: "撼其根基 → 王普攻 −20%" }
        ]
      };

      // 各世界王攻略提示
      const PART_HINTS = {
        elite: {
          title: "擊破要害",
          lines: [
            "🗡️ 頭部：怪物技能發動率↑（高風險）",
            "🛡️ 軀幹：防禦極高、你的傷害被削減",
            "🦵 下盤：怪物攻擊更兇（你受到傷害 ×1.3）"
          ]
        },
        dragon_king_lair: {
          title: "破鱗・逆鱗（四部位俱破，方能屠龍）",
          lines: [
            "🐉 古龍王鱗甲如鐵，然其凶威，皆有所繫——",
            "🦵 下盤：撼其根基，巨龍難再昂首逞凶",
            "🪽 龍翼：折其雙翼，焚天之勢自消",
            "⚔️ 軀幹：破其逆鱗，狂焰之怒漸趨黯淡",
            "👑 頭顱：取其首級，傳說就此落幕",
            "💭 古諺有云：「先斷翼、再破鱗，龍焰終成餘燼。」"
          ]
        }
      };

      const partsByZone = {};
      const bosses = await Promise.all(Object.keys(WORLD_BOSS_ZONES).map(async (zoneKey) => {
        const svc = serviceContext.worldBossServiceFor(zoneKey);
        const [info, st, monsters] = await Promise.all([
          svc ? svc.getConfigWithStatus().catch(() => null) : Promise.resolve(null),
          serviceContext.monsterService.getState(zoneKey).catch(() => null),
          serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey }).catch(() => [])
        ]);
        const cfg = info?.config || {};
        const status = info?.status || {};

        // 該王怪物（取 boss；fallback 取當前 active / 第一隻）
        const bossMonster =
          (Array.isArray(monsters) ? monsters.find((m) => m?.isBoss) : null) ||
          (Array.isArray(monsters) ? monsters.find((m) => m?.seq === st?.activeMonsterSeq) : null) ||
          (Array.isArray(monsters) ? monsters[0] : null) ||
          null;

        const bossName = bossMonster?.name || cfg.bossName || "世界王";
        const imageUrl = bossMonster?.imageUrl || cfg.imageUrl || null;
        const bossMaxHp = Math.max(
          1,
          Math.round(Number(bossMonster?.calc?.maxHp || cfg.bossMaxHp || 0) || 1)
        );

        // 部位血量：state 沒有則用模板補上預設（讓前端顯示滿血部位）
        const partState = ensureWorldBossPartState(st || {}, bossMaxHp, zoneKey);
        const hpMap = partState.worldBossPartsHp;
        const maxMap = partState.worldBossPartsMaxHp;

        const partKeys = getWorldBossPartKeys(zoneKey);
        const parts = partKeys
          .filter((k) => Object.prototype.hasOwnProperty.call(hpMap, k))
          .map((k) => {
            const hp = Math.max(0, Number(hpMap[k] || 0));
            const max = Math.max(1, Math.round(Number(maxMap[k] || 0) || hp || 1));
            return { key: k, name: PART_LABELS[k] || k, currentHp: Math.round(hp), maxHp: max, broken: hp <= 0 };
          });
        partsByZone[zoneKey] = parts;

        const currentHp = sumWorldBossPartHp(hpMap);

        return {
          zoneKey,
          bossKey: bossKeyForZone(zoneKey),
          bossName,
          imageUrl,
          bossMaxHp,
          currentHp,
          parts,
          partEffects: PART_EFFECTS[zoneKey] || [],
          hints: PART_HINTS[zoneKey] || null,
          respawnCooldownMinutes: Number(cfg.respawnCooldownMinutes || 0),
          battleTimeLimitMinutes: Number(cfg.battleTimeLimitMinutes || 60),
          cooldownRemainingMs: Number(status.cooldownRemainingMs || 0),
          cooldownRemainingMinutes: Number(status.cooldownRemainingMinutes || 0),
          canChallenge: Boolean(status.canChallenge),
          unlocked: status.unlocked !== false,
          lockedReason: status.lockedReason || null,
          lastKilledAt: info?.state?.lastKilledAt || null,
          battleStartedAt: info?.state?.battleStartedAt || null,
          battleRemainingMs: Number(status.battleRemainingMs || 0),
          enabled: cfg.enabled !== false
        };
      }));

      // 舊欄位相容（仍給只看 elite 的舊前端）
      const legacy = bosses.find((b) => b.zoneKey === "elite") || bosses[0] || null;

      res.json(ok({
        bosses,
        // ↓ 舊欄位相容
        enabled: legacy ? legacy.enabled : false,
        config: legacy ? {
          bossName: legacy.bossName,
          bossMaxHp: legacy.bossMaxHp,
          respawnCooldownMinutes: legacy.respawnCooldownMinutes,
          battleTimeLimitMinutes: legacy.battleTimeLimitMinutes,
          imageUrl: legacy.imageUrl,
          enabled: legacy.enabled
        } : null,
        state: legacy ? {
          currentHp: legacy.currentHp,
          lastKilledAt: legacy.lastKilledAt,
          battleStartedAt: legacy.battleStartedAt,
          parts: legacy.parts
        } : null,
        partsByZone,
        status: legacy ? {
          cooldownRemainingMs: legacy.cooldownRemainingMs,
          cooldownRemainingMinutes: legacy.cooldownRemainingMinutes,
          canChallenge: legacy.canChallenge
        } : null
      }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 賭場 / 命運轉盤（玩家端；DC 賭場面板對應）
  // ──────────────────────────────────────────────────
  router.get("/api/casino/state", requireAuth, async (req, res, next) => {
    try {
      const cs = serviceContext.casinoService;
      if (!cs) return res.json(ok({ enabled: false, round: null, recent: [], myBets: [] }));
      const { discordId } = req.playerRecord;
      const [round, recent] = await Promise.all([cs.getCurrentRound(), cs.getRecentRounds(12)]);
      const myBets = round ? await cs.getPlayerBetsInRound(round.roundId, discordId) : [];
      const { COLOR_META, BET_MIN, BET_MAX } = require("../../services/casino/wheelConfig");
      res.json(ok({ enabled: true, round, recent, myBets, colors: COLOR_META, betMin: BET_MIN, betMax: BET_MAX, now: Date.now() }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/casino/bet", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { color, amount } = req.body || {};
      const result = await serviceContext.casinoService.placeBet({ discordId, displayName, color, amount });
      res.json(ok(result, "下注成功"));
    } catch (err) {
      if (err?.message) return res.status(400).json(fail("BET_FAILED", err.message));
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 寵物採集（玩家端；DC 寵物面板對應）
  // ──────────────────────────────────────────────────
  function petSvc(res) {
    const s = serviceContext.petService;
    if (!s) { res.json(ok({ pets: [], active: null, activePetUuid: null })); return null; }
    return s;
  }
  router.get("/api/me/pets", requireAuth, async (req, res, next) => {
    try { const s = petSvc(res); if (!s) return; res.json(ok(await s.getPetState(req.playerRecord.discordId))); }
    catch (err) { next(err); }
  });
  router.post("/api/me/pets/feed", requireAuth, async (req, res, next) => {
    try {
      const { petUuid, inventoryUuid, inventoryUuids, tier, preview, includeEnhanced } = req.body || {};
      const r = await serviceContext.petService.feedPet(req.playerRecord.discordId, petUuid, { inventoryUuid, inventoryUuids, tier, preview: Boolean(preview), includeEnhanced: Boolean(includeEnhanced) });
      res.json(ok(r, r?.message || "餵食完成"));
    } catch (err) { if (err?.message) return res.status(400).json(fail("PET_FEED_FAILED", err.message)); next(err); }
  });
  router.get("/api/me/pets/feedable", requireAuth, async (req, res, next) => {
    try { res.json(ok(await serviceContext.petService.listFeedableItems(req.playerRecord.discordId))); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_FEEDABLE_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/claim", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.claimGathering(req.playerRecord.discordId); res.json(ok(r, r?.message || "已收取採集物")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_CLAIM_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/active", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.setActivePet(req.playerRecord.discordId, req.body?.petUuid); res.json(ok(r, "已設為出戰寵物")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_ACTIVE_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/release", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.releasePet(req.playerRecord.discordId, req.body?.petUuid); res.json(ok(r, "已放生")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_RELEASE_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/rename", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.renamePet(req.playerRecord.discordId, req.body?.petUuid, req.body?.nickname); res.json(ok(r, "已改名")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_RENAME_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/hatch", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.hatchEggFromInventory(req.playerRecord.discordId, req.body?.inventoryUuid); res.json(ok(r, r?.message || "已放入孵化")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_HATCH_FAILED", err.message)); next(err); }
  });

  // ──────────────────────────────────────────────────
  // 爬塔（單人，網頁版；逐層挑戰、HP 帶入、繼續/撤退）
  // 數值完全比照 src/shared/towerConfig.js（與 DC 組隊爬塔同源）
  // ──────────────────────────────────────────────────
  const towerSessions = new Map(); // discordId -> { floor, playerHp, playerMaxHp, baseAtk, equipped, used:Set, alive, settled, startedAt }
  // 清理閒置/殘留的爬塔 session(每筆含 equipped + inventory 快照,不清會吃記憶體)：
  // 結束的(alive=false)直接刪;超過 30 分鐘沒動作的中途離開 session 也刪。
  const TOWER_SESSION_TTL_MS = 30 * 60 * 1000;
  const _towerSessionSweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of towerSessions) {
      if (!s || s.alive === false || (now - (Number(s.startedAt) || 0)) > TOWER_SESSION_TTL_MS) {
        towerSessions.delete(id);
      }
    }
  }, 10 * 60 * 1000);
  _towerSessionSweep.unref?.();
  const TW = require("../../shared/towerConfig");

  async function pickTowerMonster(floor, usedNames) {
    // 固定王關：直接取指定 boss（龍王(B)@50／大史王@51／古龍王(B)@52 等），與 DC 組隊爬塔同源
    const bossName = TW.getTowerFloorBossName(floor);
    if (bossName) {
      const all = await serviceContext.monsterService.listMonsters({ includeDisabled: false }).catch(() => []);
      const boss = all.find((m) => m.name === bossName);
      if (boss) return boss;
    }
    const pool = TW.getTowerMonsterPool(floor); // { zone, bossOnly }
    let mons = await serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: pool.zone }).catch(() => []);
    if (pool.bossOnly) mons = mons.filter((m) => m.isBoss);
    else mons = mons.filter((m) => m.name !== "廢都魔王(B)");
    if (!mons.length) return null;
    const fresh = mons.filter((m) => !usedNames.has(m.name));
    const arr = fresh.length ? fresh : mons;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  async function settleTower(discordId, displayName, s) {
    if (s.settled) return s._reward || null;
    s.settled = true;
    const cleared = Math.max(0, s.floor - 1);
    const reward = TW.calcTowerReward(cleared);
    if (reward.gold > 0) await serviceContext.rewardService.grantCurrency({ discordId, displayName, currencyType: "gold", amount: reward.gold, source: "tower_web" }).catch(() => {});
    if (reward.exp > 0 && serviceContext.progressService?.grantExp) await serviceContext.progressService.grantExp({ discordId, displayName, amount: reward.exp, source: "tower_web" }).catch(() => {});
    try {
      const prog = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (prog) {
        const rec = prog.towerRecord || { bestFloor: 0, totalRuns: 0 };
        rec.totalRuns = (rec.totalRuns || 0) + 1;
        if (cleared > (rec.bestFloor || 0)) { rec.bestFloor = cleared; rec.bestAt = new Date().toISOString(); }
        prog.towerRecord = rec; prog.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(prog).catch(() => {});
      }
    } catch (_) {}
    s._reward = { ...reward, clearedFloor: cleared };
    return s._reward;
  }

  router.get("/api/tower/state", requireAuth, async (req, res, next) => {
    try {
      const s = towerSessions.get(req.playerRecord.discordId);
      const prog = await serviceContext.progressRepository.findByPlayerId(req.playerRecord.discordId);
      res.json(ok({
        minLevel: TW.TOWER_MIN_LEVEL, totalFloors: TW.TOWER_TOTAL_FLOORS,
        level: prog?.level || 1, bestFloor: prog?.towerRecord?.bestFloor || 0,
        session: s && s.alive ? { floor: s.floor, playerHp: s.playerHp, playerMaxHp: s.playerMaxHp } : null,
      }));
    } catch (err) { next(err); }
  });

  router.post("/api/tower/start", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const prog = await serviceContext.progressRepository.findByPlayerId(discordId);
      const level = prog?.level || 1;
      if (level < TW.TOWER_MIN_LEVEL) return res.status(400).json(fail("LEVEL_TOO_LOW", `爬塔需要 Lv.${TW.TOWER_MIN_LEVEL} 以上（目前 Lv.${level}）`));
      const { calcPlayerStats } = require("../../shared/combatStats");
      const attrs = prog?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      const equipped = await mergeEquippedFromLibrary(prog?.equipment || {}, serviceContext.itemRepository);
      const ps = calcPlayerStats(attrs, equipped, prog?.activeEffects || [], prog?.inventory || []);
      const bonus = TW.getCumulativePartyBonus(1);
      const maxHp = Math.round((ps.maxHp || 100) * (1 + bonus.hpPct / 100));
      const s = { floor: 1, playerHp: maxHp, playerMaxHp: maxHp, baseAtk: ps.atk || 1, baseStats: ps, equipped, inventory: prog?.inventory || [], used: new Set(), alive: true, settled: false, startedAt: Date.now() };
      towerSessions.set(discordId, s);
      res.json(ok({ floor: s.floor, playerHp: s.playerHp, playerMaxHp: s.playerMaxHp, totalFloors: TW.TOWER_TOTAL_FLOORS }));
    } catch (err) { next(err); }
  });

  router.post("/api/tower/fight", requireAuth, async (req, res, next) => {
    let battleLock = null;
    try {
      const { discordId, displayName } = req.playerRecord;
      const s = towerSessions.get(discordId);
      if (!s || !s.alive) return res.status(400).json(fail("NO_SESSION", "沒有進行中的爬塔，請先開始"));

      // 跨 DC/網頁/裝置互斥：DC 端正在戰鬥，或網頁已有一場戰鬥（含怪物戰動畫）→ 擋下爬塔出手
      const dcBusy = describeDcBattle(discordId);
      if (dcBusy) return res.status(409).json(fail("BATTLE_BUSY", `${dcBusy}，請先結束後再爬塔。`));
      battleLock = acquireWebBattle(discordId, "tower");
      if (!battleLock.ok) { battleLock = null; return res.status(409).json(fail("BATTLE_BUSY", "你已經有一場戰鬥正在進行，請等結束後再爬塔。")); }

      const floor = s.floor;
      const monster = await pickTowerMonster(floor, s.used);
      if (!monster) return res.status(400).json(fail("NO_MONSTER", "找不到該層怪物"));
      s.used.add(monster.name);

      const baseHp = monster.calc?.maxHp || monster.maxHp || 200;
      const baseAtk = monster.calc?.atk || 20;
      const scaledHp = TW.scaleTowerMonsterHp(baseHp, floor);
      const scaledAtk = TW.scaleTowerMonsterAtk(baseAtk, floor);
      const bonus = TW.getCumulativePartyBonus(floor);
      const ps = { ...s.baseStats, maxHp: s.playerMaxHp, atk: Math.round(s.baseAtk * (1 + bonus.atkPct / 100)) };
      const mCalc = { ...(monster.calc || {}), maxHp: scaledHp, atk: scaledAtk, isBoss: Boolean(monster.isBoss) };

      const { runCombatLoop } = require("../../shared/combatLoop");
      const r = runCombatLoop(ps, mCalc, monster.name, scaledHp, TW.MAX_ROUNDS_PER_MEMBER, {
        playerName: displayName, playerLevel: (await serviceContext.progressRepository.findByPlayerId(discordId))?.level || 1,
        equipped: s.equipped, inventory: s.inventory, monsterIsBoss: Boolean(monster.isBoss),
        startPlayerHp: s.playerHp,
      });
      s.playerHp = Math.max(0, r.finalPlayerHp);
      const killed = (r.finalMonsterHp ?? 0) <= 0 && r.outcome === "win";
      const died = s.playerHp <= 0;

      let towerOver = false, reward = null, cleared = false;
      if (killed) {
        cleared = true; s.floor = floor + 1;
        if (s.floor > TW.TOWER_TOTAL_FLOORS) { towerOver = true; reward = await settleTower(discordId, displayName, s); s.alive = false; }
      } else {
        // 未擊殺（陣亡或回合耗盡）→ 本次攻塔結束，結算
        towerOver = true; s.alive = false; reward = await settleTower(discordId, displayName, s);
      }

      // 本次攻塔已結束 → 立刻釋放 session(內含 equipped/inventory 快照)
      if (!s.alive) towerSessions.delete(discordId);

      res.json(ok({
        floor, cleared, towerOver, died,
        monsterName: monster.name, monsterImageUrl: monster.imageUrl || null,
        enemyMaxHp: scaledHp, logs: r.roundLogs, outcome: r.outcome,
        finalPlayerHp: s.playerHp, finalMonsterHp: Math.max(0, r.finalMonsterHp ?? 0),
        nextFloor: s.alive ? s.floor : null, playerMaxHp: s.playerMaxHp, reward,
      }));
    } catch (err) { next(err); } finally {
      if (battleLock) battleLock.release();
    }
  });

  router.post("/api/tower/retreat", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const s = towerSessions.get(discordId);
      if (!s || !s.alive) return res.status(400).json(fail("NO_SESSION", "沒有進行中的爬塔"));
      const reward = await settleTower(discordId, displayName, s);
      s.alive = false;
      towerSessions.delete(discordId); // 撤退即釋放 session
      res.json(ok({ retreated: true, reward }));
    } catch (err) { next(err); }
  });

  router.get("/api/tower/leaderboard", requireAuth, async (req, res, next) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const rows = await serviceContext.progressRepository.findTopByTowerRecord(limit);
      const players = await serviceContext.playerRepository.listAll();
      const nameMap = Object.fromEntries((players || []).map((p) => [p.discordId, p.displayName]));
      const list = (rows || []).map((r, i) => ({
        rank: i + 1,
        playerId: r.playerId,
        name: prettyLeaderboardName(nameMap[r.playerId] || r.displayName, r.playerId),
        bestFloor: r.towerRecord?.bestFloor || 0,
        bestAt: r.towerRecord?.bestAt || null
      }));
      res.json(ok({ list, totalFloors: TW.TOWER_TOTAL_FLOORS }));
    } catch (err) { next(err); }
  });

  // ──────────────────────────────────────────────────
  // PK 擂台（網頁端；與 Discord 共用同一擂台狀態）
  // ──────────────────────────────────────────────────
  const pkArena = require("../../bot/handlers/pkArenaHandlers");
  router.get("/api/pk/state", requireAuth, async (req, res, next) => {
    try { res.json(ok(await pkArena.webGetArenaState(req.playerRecord.discordId))); }
    catch (err) { next(err); }
  });
  router.post("/api/pk/join", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const r = await pkArena.webJoinQueue(discordId, displayName);
      if (!r.ok) return res.status(400).json(fail("PK_JOIN_FAILED", r.message));
      res.json(ok(r, r.matched ? "已配對！" : "已加入排隊"));
    } catch (err) { next(err); }
  });
  router.post("/api/pk/leave", requireAuth, async (req, res, next) => {
    try {
      const r = await pkArena.webLeaveQueue(req.playerRecord.discordId);
      if (!r.ok) return res.status(400).json(fail("PK_LEAVE_FAILED", r.message));
      res.json(ok(r, "已離開排隊"));
    } catch (err) { next(err); }
  });
  router.post("/api/pk/bet", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { arenaIdx, side, amount } = req.body || {};
      const r = await pkArena.webPlaceBet({ discordId, name: displayName, arenaIdx: Number(arenaIdx), side, amount });
      if (!r.ok) return res.status(400).json(fail("PK_BET_FAILED", r.message));
      res.json(ok(r, `已押注 ${r.targetName}`));
    } catch (err) { next(err); }
  });
  router.get("/api/pk/last-result", requireAuth, async (req, res, next) => {
    try { res.json(ok(pkArena.webGetLastResult(req.playerRecord.discordId))); }
    catch (err) { next(err); }
  });

  router.get("/api/pk/leaderboard", requireAuth, async (req, res, next) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const rows = await serviceContext.progressRepository.findTopByPkRating(limit);
      const pkPlayers = await serviceContext.playerRepository.listAll();
      const pkNameMap = Object.fromEntries((pkPlayers || []).map((p) => [p.discordId, p.displayName]));
      const list = (rows || []).map((r, i) => {
        const wins = Number(r.pkWins) || 0;
        const losses = Number(r.pkLosses) || 0;
        const total = wins + losses;
        return {
          rank: i + 1,
          playerId: r.playerId,
          name: prettyLeaderboardName(pkNameMap[r.playerId] || r.displayName, r.playerId),
          rating: Math.round(Number(r.pkRating) || 0),
          wins, losses,
          winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
          level: r.level || 1,
          jobName: r.jobName || ""
        };
      });
      res.json(ok({ list }));
    } catch (err) { next(err); }
  });

  // ──────────────────────────────────────────────────
  // 拍賣行（DC 拍賣面板）
  // ──────────────────────────────────────────────────
  async function getMemberRoleIds(discordId) {
    if (!discordClient) return [];
    const guildId = config.discord?.guildId;
    if (!guildId) return [];
    try {
      const guild = discordClient.guilds.cache.get(guildId)
        || await discordClient.guilds.fetch(guildId).catch(() => null);
      if (!guild) return [];
      const member = await guild.members.fetch({ user: discordId, force: false }).catch(() => null);
      if (!member) return [];
      return Array.from(member.roles.cache.keys());
    } catch (_) {
      return [];
    }
  }

  // 會員判定（任一符合即視為會員）：
  //  1. 直播會員：streamAccountBinding 任一 isMember === true（或 linkedSupportAtLink / playerTierAtLink 有值）
  //  2. Discord 身分組會員：progress.playerTier 有值（非 null/空）
  async function resolveAuctionMembership(discordId) {
    // 直播會員：查 bindings
    let streamMember = false;
    try {
      const bindings = await serviceContext.streamAccountBindingRepository
        .listByDiscordId(discordId)
        .catch(() => []);
      streamMember = (bindings || []).some((b) =>
        b?.isMember === true
        || b?.linkedSupportAtLink === true
        || Boolean(b?.playerTierAtLink)
      );
    } catch (_) {
      streamMember = false;
    }

    // Discord 身分組會員：progress.playerTier 有值
    let tierMember = false;
    try {
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const tier = progress?.playerTier;
      tierMember = tier != null && String(tier).trim() !== "";
    } catch (_) {
      tierMember = false;
    }

    return {
      isMember: Boolean(streamMember || tierMember),
      streamMember: Boolean(streamMember),
      tierMember: Boolean(tierMember)
    };
  }

  // ===== 裝備方案 A/B/C（對齊 DC：progress.activePreset / progress.equipPresets）=====
  // 會員才可使用 B/C；非會員只有 A。沿用 resolveAuctionMembership 的雙重判定。
  const PRESET_KEYS = ["A", "B", "C"];

  function summarizePresetSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return { count: 0, names: [] };
    const entries = Object.values(snapshot).filter((v) => v && (v.itemId || v.uuid));
    return {
      count: entries.length,
      names: entries.map((v) => v.itemName).filter(Boolean).slice(0, 6)
    };
  }

  router.get("/api/me/presets", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const [progress, membership] = await Promise.all([
        serviceContext.progressRepository.findByPlayerId(discordId),
        resolveAuctionMembership(discordId)
      ]);
      const isMember = membership.isMember;
      const activePreset = progress?.activePreset || "A";
      const equipPresets = progress?.equipPresets || {};
      const presetNames = progress?.equipPresetNames || {};
      const presets = PRESET_KEYS.map((key) => {
        // 目前使用中的方案：以身上裝備為準；其餘看快照
        const snapshot = key === activePreset
          ? progress?.equipment
          : equipPresets[key];
        const summary = summarizePresetSnapshot(snapshot);
        return {
          key,
          name: presetNames[key] || null, // 會員自訂名稱
          active: key === activePreset,
          locked: key !== "A" && !isMember,
          equipped: summary.count > 0,
          itemCount: summary.count,
          itemNames: summary.names
        };
      });
      res.json(ok({ activePreset, presets, isMember }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/me/presets/switch", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const preset = String(req.body?.preset || "").toUpperCase();
      if (!PRESET_KEYS.includes(preset)) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "無效分頁，請選擇 A / B / C"));
      }
      if (preset !== "A") {
        const membership = await resolveAuctionMembership(discordId);
        if (!membership.isMember) {
          return res.status(403).json(fail("NOT_MEMBER", "裝備方案 B / C 限會員使用"));
        }
      }
      const result = await serviceContext.shopService.switchEquipPreset(discordId, preset);
      res.json(ok({ activePreset: result.activePreset, equipment: result.equipment }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/me/presets/save", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const preset = String(req.body?.preset || "").toUpperCase();
      if (!PRESET_KEYS.includes(preset)) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "無效分頁，請選擇 A / B / C"));
      }
      if (preset !== "A") {
        const membership = await resolveAuctionMembership(discordId);
        if (!membership.isMember) {
          return res.status(403).json(fail("NOT_MEMBER", "裝備方案 B / C 限會員使用"));
        }
      }
      const result = await serviceContext.shopService.saveEquipPreset(discordId, preset);
      res.json(ok({ preset: result.preset }));
    } catch (err) {
      next(err);
    }
  });

  // 會員自訂裝備方案名稱(存 progress.equipPresetNames)
  router.post("/api/me/presets/rename", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const preset = String(req.body?.preset || "").toUpperCase();
      const name = String(req.body?.name || "").trim().slice(0, 12);
      if (!PRESET_KEYS.includes(preset)) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "無效分頁，請選擇 A / B / C"));
      }
      const membership = await resolveAuctionMembership(discordId);
      if (!membership.isMember) {
        return res.status(403).json(fail("NOT_MEMBER", "自訂方案名稱限會員使用"));
      }
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (!progress) return res.status(404).json(fail("NOT_FOUND", "找不到角色資料"));
      progress.equipPresetNames = { ...(progress.equipPresetNames || {}), [preset]: name || null };
      await serviceContext.progressRepository.save(progress);
      res.json(ok({ preset, name: name || null }));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/auction/list", requireAuth, async (req, res, next) => {
    try {
      const { kind, currency } = req.query || {};
      const filters = {};
      if (kind && typeof kind === "string") filters.kind = kind;
      if (currency && typeof currency === "string") filters.currency = currency;
      const items = await serviceContext.auctionService.getActiveListings(filters);
      const enabled = await serviceContext.auctionService.isEnabled();
      // 階級高的(S)排最前面,讓最高級裝備一開始就看得到;同階維持原順序(最新在前)
      const TIER_RANK = { SS: 7, S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
      const sortedItems = [...(items || [])].sort((a, b) => {
        const at = TIER_RANK[String(a.tier || a.item?.tier || "").toUpperCase()] || 0;
        const bt = TIER_RANK[String(b.tier || b.item?.tier || "").toUpperCase()] || 0;
        return bt - at;
      });
      res.json(ok({
        enabled,
        listings: (sortedItems || []).map((a) => ({
          id: a.id || a._id?.toString(),
          itemUuid: a.itemUuid,
          itemName: a.itemName || a.item?.itemName,
          itemType: a.itemType || a.item?.itemType,
          tier: a.tier || a.item?.tier,
          imageUrl: a.item?.imageThumbnailUrl || a.item?.imageUrl || a.imageUrl || null,
          quantity: a.quantity || a.item?.stackCount || 1,
          currency: a.currency,
          price: a.price,
          sellerId: a.sellerId,
          sellerName: a.sellerName,
          listedAt: a.listedAt || a.createdAt,
          expiresAt: a.expiresAt,
          status: a.status
        }))
      }));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/auction/my", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const my = await serviceContext.auctionService.getMyListings(discordId);
      const roleIds = await getMemberRoleIds(discordId);
      const maxListings = await serviceContext.auctionService.getMaxListings(roleIds);
      const eligible = await serviceContext.auctionService.checkSellerEligibility(roleIds);
      const TIER_RANK = { SS: 7, S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
      const sortedMy = [...(my || [])].sort((a, b) =>
        (TIER_RANK[String(b.tier || b.item?.tier || "").toUpperCase()] || 0) -
        (TIER_RANK[String(a.tier || a.item?.tier || "").toUpperCase()] || 0));
      res.json(ok({
        listings: (sortedMy || []).map((a) => ({
          id: a.id || a._id?.toString(),
          itemUuid: a.itemUuid,
          itemName: a.itemName || a.item?.itemName,
          itemType: a.itemType || a.item?.itemType,
          tier: a.tier || a.item?.tier,
          imageUrl: a.item?.imageThumbnailUrl || a.item?.imageUrl || a.imageUrl || null,
          quantity: a.quantity || a.item?.stackCount || 1,
          currency: a.currency,
          price: a.price,
          listedAt: a.listedAt || a.createdAt,
          expiresAt: a.expiresAt,
          status: a.status
        })),
        eligible,
        maxListings,
        activeCount: (my || []).filter((l) => l.status === "active").length
      }));
    } catch (err) {
      next(err);
    }
  });

  // 前端用：判斷是否顯示/啟用上架 UI（與後端上架同一套會員判定）
  router.get("/api/auction/can-list", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const membership = await resolveAuctionMembership(discordId);
      res.json(ok({
        canList: membership.isMember,
        reason: membership.isMember ? null : "只有會員才能上架商品",
        streamMember: membership.streamMember,
        tierMember: membership.tierMember
      }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/auction/list-item", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { itemUuid, currency, price, hours, quantity = 1 } = req.body || {};
      if (!itemUuid || !currency || !price || !hours) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "itemUuid / currency / price / hours 必填"));
      }

      // 會員 gate：直播會員(binding.isMember) 或 身分組會員(progress.playerTier) 任一即可
      const membership = await resolveAuctionMembership(discordId);
      if (!membership.isMember) {
        return res.status(403).json(fail("NOT_MEMBER", "只有會員才能上架商品"));
      }

      const roleIds = await getMemberRoleIds(discordId);
      const result = await serviceContext.auctionService.listItem({
        sellerId: discordId,
        itemUuid,
        currency,
        price: Number(price),
        hours: Number(hours),
        quantity: Number(quantity) || 1,
        memberRoleIds: roleIds
      });
      res.json(ok(result, "上架成功"));
    } catch (err) {
      if (err?.message) {
        return res.status(400).json(fail("LIST_FAILED", err.message));
      }
      next(err);
    }
  });

  router.post("/api/auction/buy/:id", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const auctionId = String(req.params.id);
      const result = await serviceContext.auctionService.buyItem(discordId, auctionId);
      res.json(ok(result, "購買成功"));
    } catch (err) {
      if (err?.message) {
        return res.status(400).json(fail("BUY_FAILED", err.message));
      }
      next(err);
    }
  });

  router.post("/api/auction/cancel/:id", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const auctionId = String(req.params.id);
      const result = await serviceContext.auctionService.cancelListing(discordId, auctionId);
      res.json(ok(result, "下架成功"));
    } catch (err) {
      if (err?.message) {
        return res.status(400).json(fail("CANCEL_FAILED", err.message));
      }
      next(err);
    }
  });

  // 歷史紀錄：該玩家所有上架紀錄（所有狀態），時間新到舊
  router.get("/api/auction/history", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const history = await serviceContext.auctionService.getMyHistory(discordId);
      const sorted = [...(history || [])].sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      res.json(ok({
        history: sorted.map((a) => ({
          id: a.id || a._id?.toString(),
          itemName: a.itemName || a.item?.itemName,
          itemType: a.itemType || a.item?.itemType,
          tier: a.tier || a.item?.tier,
          imageUrl: a.item?.imageThumbnailUrl || a.item?.imageUrl || a.imageUrl || null,
          quantity: a.quantity || a.item?.stackCount || 1,
          currency: a.currency,
          price: a.price,
          status: a.status,
          listedAt: a.listedAt || a.createdAt,
          expiresAt: a.expiresAt,
          soldAt: a.soldAt || null,
          reclaimedAt: a.reclaimedAt || null
        }))
      }));
    } catch (err) {
      next(err);
    }
  });

  // 領回：到期未售的物品退回背包
  router.post("/api/auction/reclaim/:id", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const auctionId = String(req.params.id);
      const result = await serviceContext.auctionService.reclaimItem(discordId, auctionId);
      res.json(ok(result, "領回成功"));
    } catch (err) {
      if (err?.message) {
        return res.status(400).json(fail("RECLAIM_FAILED", err.message));
      }
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 交易紀錄（DC 玩家面板 → 交易紀錄）
  // ──────────────────────────────────────────────────
  router.get("/api/me/transactions", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const result = await serviceContext.transactionService.listRecentByDiscordId(discordId, displayName, limit);
      const { transactionSourceLabel } = require("../../shared/transactionLabels");
      const transactions = (result.transactions || []).map((tx) => {
        const direction = tx.direction === "debit" ? "debit" : "credit";
        const rawAmount = Math.abs(Number(tx.amount) || 0);
        const meta = transactionSourceLabel(tx.source);
        return {
          id: tx.id || tx._id?.toString(),
          source: tx.source || null,
          sourceTag: tx.source || null,
          label: meta.label,      // 中文來源（前端直接顯示，不再是 ❓）
          icon: meta.icon,
          direction,              // credit=收入 / debit=支出
          amount: direction === "debit" ? -rawAmount : rawAmount, // 帶正負號，前端據此分收入/支出
          currency: tx.currencyType || tx.currency || "gold",     // DB 是 currencyType
          balanceAfter: tx.balanceAfter ?? null,
          occurredAt: tx.occurredAt || tx.createdAt
        };
      });
      res.json(ok({ transactions, count: transactions.length }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 邀請碼系統（DC 玩家面板 → 🎟️ 我的邀請碼 / 🎁 輸入邀請碼）
  // ──────────────────────────────────────────────────
  router.get("/api/me/invite", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      await serviceContext.playerService.ensurePlayer(discordId, displayName);
      const doc = await serviceContext.inviteService.getOrCreateCode(discordId);
      res.json(ok({
        code: doc.code,
        useCount: (doc.uses || []).length,
        uses: (doc.uses || []).slice(-10).map((u) => ({
          inviteeId: u.inviteeId,
          inviteeName: u.inviteeName,
          usedAt: u.usedAt
        }))
      }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/me/invite/use", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const rawCode = String(req.body?.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(rawCode)) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "邀請碼格式錯誤（8 碼大寫英數）"));
      }
      await serviceContext.playerService.ensurePlayer(discordId, displayName);
      const result = await serviceContext.inviteService.useCode(rawCode, discordId);
      if (!result.ok) {
        return res.status(400).json(fail("INVITE_REJECTED", result.reason || "邀請碼無效"));
      }
      res.json(ok({
        inviterId: result.inviterId,
        inviterName: result.inviterName,
        rewards: result.rewards || {
          gold: 50000,
          gems: [{ tier: "D", count: 20 }, { tier: "C", count: 5 }]
        }
      }, "邀請碼兌換成功"));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 打卡狀態查詢（DC 我的資料 → 📅 打卡狀態）
  // ──────────────────────────────────────────────────
  router.get("/api/me/checkin", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 7));
      const checkins = await serviceContext.checkinService.listRecentByDiscordId(discordId, limit);

      // 算今日是否已打卡（用台北時區）
      const tz = "Asia/Taipei";
      const todayKey = new Date().toLocaleDateString("zh-TW", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
      const todayCheckin = (checkins || []).find((c) => {
        if (!c?.occurredAt) return false;
        const k = new Date(c.occurredAt).toLocaleDateString("zh-TW", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
        return k === todayKey;
      });

      res.json(ok({
        checkedToday: Boolean(todayCheckin),
        todayReward: todayCheckin?.rewardDetail?.amount ?? null,
        todayAt: todayCheckin?.occurredAt || null,
        history: (checkins || []).slice(0, limit).map((c) => ({
          date: c?.occurredAt ? new Date(c.occurredAt).toLocaleDateString("zh-TW", { timeZone: tz }) : null,
          amount: c?.rewardDetail?.amount ?? 0,
          occurredAt: c?.occurredAt || null
        }))
      }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 世界王鬧鐘（與 DC 共用同一個身分組，開戰通知 tag）
  // ──────────────────────────────────────────────────

  async function fetchAlarmMember(discordId) {
    const { worldBossAlarmRoleId, guildId } = require("../../config").discord || {};
    if (!worldBossAlarmRoleId || !guildId || !discordClient) return { roleId: null, member: null };
    const guild = discordClient.guilds.cache.get(guildId)
      || await discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { roleId: worldBossAlarmRoleId, member: null };
    const member = await guild.members.fetch(discordId).catch(() => null);
    return { roleId: worldBossAlarmRoleId, member };
  }

  router.get("/api/me/worldboss-alarm", requireAuth, async (req, res, next) => {
    try {
      const { roleId, member } = await fetchAlarmMember(req.playerRecord.discordId);
      if (!roleId) return res.json(ok({ available: false, enabled: false, reason: "尚未設定世界王鬧鐘身分組" }));
      if (!member) return res.json(ok({ available: false, enabled: false, reason: "找不到你的 Discord 伺服器成員資料" }));
      res.json(ok({ available: true, enabled: member.roles.cache.has(roleId) }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/me/worldboss-alarm", requireAuth, async (req, res, next) => {
    try {
      const { roleId, member } = await fetchAlarmMember(req.playerRecord.discordId);
      if (!roleId) return res.status(400).json({ status: "error", message: "尚未設定世界王鬧鐘身分組，請聯絡管理員。" });
      if (!member) return res.status(400).json({ status: "error", message: "找不到你的 Discord 伺服器成員資料，請確認你在伺服器內。" });

      const current = member.roles.cache.has(roleId);
      const target = typeof req.body?.enabled === "boolean" ? req.body.enabled : !current;
      if (target !== current) {
        if (target) await member.roles.add(roleId);
        else await member.roles.remove(roleId);
      }
      res.json(ok({ available: true, enabled: target }));
    } catch (err) {
      console.warn("[worldBossAlarm] 網頁切換身分組失敗:", err?.message || err);
      res.status(500).json({ status: "error", message: "設定失敗，可能是機器人權限不足（需要「管理身分組」）。請聯絡管理員。" });
    }
  });

  // ──────────────────────────────────────────────────
  // 寶石強化相關 endpoints
  // ──────────────────────────────────────────────────

  // GET /api/me/enhance/:itemUuid - 查詢某件裝備的強化信息（寶石強化）
  router.get("/api/me/enhance/:itemUuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const info = await serviceContext.enhanceService.getEnhanceInfo(discordId, req.params.itemUuid, { mode: req.query.mode });
      if (!info) {
        return res.status(400).json({ error: "該道具無法強化" });
      }

      res.json(ok(info, "強化信息"));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/me/enhance/:itemUuid - 強化裝備（寶石強化）
  router.post("/api/me/enhance/:itemUuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const result = await serviceContext.enhanceService.enhanceEquipment(discordId, req.params.itemUuid, { mode: req.body?.mode });
      res.json(ok(result, result.message));
    } catch (err) {
      next(err);
    }
  });

  // 新手指引「完成 1 次強化」步驟:免費強化指定裝備一次(不扣寶石/金幣、必定成功)。每人只能用一次。
  router.post("/api/me/onboarding/free-enhance/:itemUuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (!progress) return res.status(404).json({ status: "error", message: "找不到玩家進度" });
      if (progress.flags?.onboardingFreeEnhanceUsed) {
        return res.status(400).json({ status: "error", message: "免費強化已使用過" });
      }
      const result = await serviceContext.enhanceService.enhanceEquipment(discordId, req.params.itemUuid, { free: true });
      // 標記已使用(重新讀取以避免覆蓋強化寫入的進度)
      const fresh = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (fresh) {
        fresh.flags = { ...(fresh.flags || {}), onboardingFreeEnhanceUsed: true };
        fresh.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(fresh);
      }
      res.json(ok(result, result.message || "免費強化完成"));
    } catch (err) {
      next(err);
    }
  });

  // 新手指引第一步:確認武器(或任一裝備)已穿上 → 記錄 equip_count 讓該步完成。
  // 賽季/新角色會自動裝備木劍,所以不需真的再裝一次,確認有穿即可。
  router.post("/api/me/onboarding/confirm-equip", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (!progress) return res.status(404).json({ status: "error", message: "找不到玩家進度" });
      const equipment = progress.equipment || {};
      const hasWeapon = Boolean(equipment.weapon && equipment.weapon.uuid);
      const hasAnyEquip = hasWeapon || Object.values(equipment).some((e) => e && e.uuid);
      if (!hasAnyEquip) {
        return res.status(400).json({ status: "error", message: "目前沒有裝備任何武器,請先到背包把武器裝備上" });
      }
      await serviceContext.questService.recordProgress(discordId, "equip_count", 1);
      res.json(ok({ confirmed: true, hasWeapon }, "已確認武器已裝備"));
    } catch (err) {
      next(err);
    }
  });

  // 新手指引全部完成 → 發放新手資金 1000 金幣(每人只發一次)
  router.post("/api/me/onboarding/complete-reward", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (!progress) return res.status(404).json({ status: "error", message: "找不到玩家進度" });
      const displayName = progress.displayName || progress.playerName || discordId;
      if (progress.flags?.onboardingCompleteRewarded) {
        return res.json(ok({ alreadyRewarded: true, gold: 0 }, "新手資金已領取過"));
      }
      const amount = 1000;
      await serviceContext.rewardService.grantCurrency({
        discordId, displayName, currencyType: "gold", amount,
        source: require("../../shared/sources").CURRENCY_SOURCES.QUEST_REWARD,
        operator: "onboarding:complete-reward"
      });
      // 重新讀取(grantCurrency 可能已改動進度),寫入已領取旗標
      const fresh = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (fresh) {
        fresh.flags = { ...(fresh.flags || {}), onboardingCompleteRewarded: true };
        fresh.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(fresh);
      }
      res.json(ok({ gold: amount }, "已領取新手資金 1000 金幣"));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerAppRoutes };
