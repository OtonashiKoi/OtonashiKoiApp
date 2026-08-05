"use strict";
// 直播警報事件層：從 OneComme 留言流偵測「Twitch 訂閱 / Raid 降落 / YT 會員加入」，
// 加上「YT 訂閱數里程碑」輪詢，落地到 streamAlertEvents 供 /api/stream-overlay/feed 撈給 alert.html。
//
// 設計原則（與斗內記錄層一致）：
//   - 只新增自己的 collection，不動任何既有寫入路徑
//   - OneComme 各平台事件欄位沒有正式文件 → 偵測採「多候選訊號」寬鬆判定，
//     並對「疑似特殊事件但認不出來」的留言 dump 原始欄位（同幣別診斷 log 模式），拿到鐵證再收緊
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COL = "streamAlertEvents";

// Twitch 訂閱類 type 候選（OneComme/各版本命名不一，寬鬆涵蓋）
const SUB_TYPES = new Set(["subscribe", "subscription", "sub", "resub", "subgift", "submysterygift", "giftpurchase", "prime"]);
const RAID_TYPES = new Set(["raid", "raids", "hosted"]);
const YT_MEMBER_TYPES = new Set(["membership", "membershipgift", "membershipitem", "newsponsor", "sponsor", "milestonechat"]);

let _indexReady = false;
async function col() {
  const db = await getMongoDb();
  const c = db.collection(COL);
  if (!_indexReady) {
    _indexReady = true;
    c.createIndex({ createdAt: -1 }).catch(() => {});
    c.createIndex({ sourceId: 1 }, { unique: true, sparse: true }).catch(() => {});
  }
  return c;
}

async function insertEvent(evt, sourceId = null) {
  try {
    const c = await col();
    const doc = { ...evt, sourceId: sourceId || null, createdAt: new Date().toISOString() };
    if (sourceId) {
      // 以留言 id 去重（OneComme 重連可能重播）
      await c.updateOne({ sourceId }, { $setOnInsert: doc }, { upsert: true });
    } else {
      await c.insertOne(doc);
    }
  } catch (e) {
    if (!/duplicate key/i.test(String(e?.message))) {
      console.warn("[StreamAlert] insert failed:", e?.message || e);
    }
  }
}

function lc(v) { return String(v || "").toLowerCase(); }
function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 從 OneComme 留言偵測警報事件。掛在 handleStreamComment 入口（fire-and-forget）。
 * @param {{ id?:string, name:string, service:string, text?:string, raw?:object }} comment
 */
function ingestComment(comment) {
  try {
    const raw = comment?.raw || {};
    if (raw._onecommeHistory === true) return;         // 重連歷史重播不算新事件
    const platform = lc(comment?.service).includes("twitch") || String(comment?.userId || "").startsWith("tw-")
      ? "twitch"
      : (lc(comment?.service).includes("youtube") || String(comment?.userId || "").startsWith("yt-") ? "youtube" : lc(comment?.service));
    const rawType = lc(raw.type || raw.payload?.type);
    const name = String(comment?.name || raw.displayName || "").trim() || "神秘旅人";
    const sourceId = comment?.id ? `oc:${comment.id}` : null;

    // ── Twitch Raid（降落）──
    if (RAID_TYPES.has(rawType) || raw.isRaid === true || /raiders?/i.test(lc(raw.messageType))) {
      const viewers = num(raw.viewers ?? raw.viewerCount ?? raw.raiders ?? raw.amount);
      insertEvent({ type: "raid", platform: "twitch", name, viewers }, sourceId);
      console.log(`[StreamAlert] 🛬 RAID：${name} +${viewers}`);
      return;
    }

    // ── Twitch 訂閱／續訂／贈訂 ──
    if (platform === "twitch" && (SUB_TYPES.has(rawType) || raw.isSubscribe === true || raw.isGift === true)) {
      const months = num(raw.months ?? raw.cumulativeMonths ?? raw.streakMonths);
      const gift = raw.isGift === true || /gift/.test(rawType);
      insertEvent({ type: "sub", platform: "twitch", name, months, gift }, sourceId);
      console.log(`[StreamAlert] 🔔 SUB：${name} months=${months} gift=${gift}`);
      return;
    }

    // ── YT 會員加入/里程碑（2026-07-25 直播鐵證：type 是空的，資訊在 giftType/membership 物件）──
    //    加入：{ giftType:"milestonechat", membership:{ sub:"歡迎加入 鯉民！" }, isFirstTime:true }
    const giftType = lc(raw.giftType);
    const membershipObj = (raw.membership && typeof raw.membership === "object") ? raw.membership : null;
    if (platform === "youtube" && (membershipObj || YT_MEMBER_TYPES.has(rawType) || YT_MEMBER_TYPES.has(giftType) || raw.isMembershipItem === true)) {
      const subText = String(membershipObj?.sub || "").trim();
      const primText = String(membershipObj?.primary || "").trim();
      const joinMatch = subText.match(/歡迎加入\s*(.+?)\s*[!！]?\s*$/);
      // 位階名直接取 YT 事件文字（頻道位階設定：鯉民/鯉長/鯉市長）
      const label = joinMatch ? joinMatch[1].trim() : null;
      const eventText = joinMatch ? "加入會員" : (primText || subText || "會員里程碑");
      insertEvent({ type: "member", platform: "youtube", name, eventText, label }, sourceId);
      console.log(`[StreamAlert] 👑 YT會員事件：${name} ${eventText}${label ? `（${label}）` : ""}`);
      return;
    }

    // ── Twitch 訂閱補判：giftType 也算（與 type 欄位雙軌）──
    if (platform === "twitch" && SUB_TYPES.has(giftType)) {
      const months = num(raw.months ?? raw.cumulativeMonths ?? raw.streakMonths);
      insertEvent({ type: "sub", platform: "twitch", name, months, gift: /gift/.test(giftType) }, sourceId);
      return;
    }

    // ── 診斷：疑似特殊事件但沒認出來 → dump 原始欄位（拿到鐵證再收緊上面的判定）──
    // superchat 由斗內管線處理（會進 donationEvents → 警報自動有），這裡不重複也不當可疑
    const suspicious = ((rawType && rawType !== "comment" && rawType !== "comments")
      || (giftType && giftType !== "superchat" && giftType !== "supersticker")
      || raw.isRaid != null || raw.isSubscribe != null || raw.isMembershipItem != null);
    if (suspicious) {
      console.log(`[StreamAlert][診斷] 未識別特殊留言 type=${rawType} gift=${giftType} platform=${platform} keys=${Object.keys(raw).join(",")} sample=${JSON.stringify(raw).slice(0, 400)}`);
    }
  } catch (e) {
    console.warn("[StreamAlert] ingest error:", e?.message || e);
  }
}

// ── YT 訂閱數里程碑：每 5 分鐘用頻道 OAuth 抓精確 subscriberCount，跨過門檻就發事件 ──
const YT_SUBS_STEP = 100;            // 每 +100 人彈一次（使用者 2026-07-25 定案，原 10）
const YT_POLL_MS = 5 * 60 * 1000;
let _ytTimer = null;

async function pollYtSubscribers(serviceContext) {
  try {
    if (!serviceContext?.creatorTokenService) return;
    // getValidToken 回傳 access token「字串」（非物件）
    const accessToken = await serviceContext.creatorTokenService.getValidToken("youtube").catch((e) => {
      console.warn("[StreamAlert] YT token 取得失敗:", e?.message || e);
      return null;
    });
    if (!accessToken) return;
    // OAuth 是頻道主本人 → mine=true 免帶頻道 ID（STREAM_YOUTUBE_CREATOR_CHANNEL_ID 實測是空值）；
    // 有設定 ID 時仍優先使用
    const channelId = String(process.env.STREAM_YOUTUBE_CREATOR_CHANNEL_ID || "").trim();
    const query = channelId ? `id=${encodeURIComponent(channelId)}` : "mine=true";
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) { console.warn("[StreamAlert] YT channels.list 失敗:", res.status); return; }
    const json = await res.json();
    const count = Number(json?.items?.[0]?.statistics?.subscriberCount);
    if (!Number.isFinite(count) || count <= 0) return;

    const db = await getMongoDb();
    const stateCol = db.collection("streamAlertState");
    const st = await stateCol.findOne({ _id: "ytSubs" });
    const last = Number(st?.lastCount) || 0;
    await stateCol.updateOne({ _id: "ytSubs" }, { $set: { lastCount: count, updatedAt: new Date().toISOString() } }, { upsert: true });

    // 首次記錄只建基準不發事件；之後跨過每 STEP 門檻發一次
    if (last > 0 && Math.floor(count / YT_SUBS_STEP) > Math.floor(last / YT_SUBS_STEP)) {
      const milestone = Math.floor(count / YT_SUBS_STEP) * YT_SUBS_STEP;
      await insertEvent({ type: "milestone", platform: "youtube", count, milestone });
      console.log(`[StreamAlert] 🎉 YT 訂閱數里程碑：${milestone}（目前 ${count}）`);
    }
  } catch (e) {
    console.warn("[StreamAlert] YT subscriber poll failed:", e?.message || e);
  }
}

function startYtSubscriberPoller(serviceContext) {
  if (_ytTimer) clearInterval(_ytTimer);
  _ytTimer = setInterval(() => pollYtSubscribers(serviceContext), YT_POLL_MS);
  _ytTimer.unref?.();
  pollYtSubscribers(serviceContext); // 開機先建基準
  console.log(`[StreamAlert] YT 訂閱數里程碑輪詢已啟動（每 5 分鐘，每 +${YT_SUBS_STEP} 彈警報）`);
}

module.exports = { ingestComment, startYtSubscriberPoller, insertEvent };
