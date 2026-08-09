"use strict";
/**
 * 主線故事系統（文字冒險）。
 *
 * 設計（2026-07 賽季地基）：
 * - 每一章綁一個 zone（zoneKey）；章節依 order 全域排序、一章一章解鎖：
 *   第 N 章可讀 ⇔ 所有 order 更小且 enabled 的章節都已完成。
 * - 區域閘門：某 zone 有 enabled 章節時，玩家必須完成該 zone 的全部章節
 *   才能在該區戰鬥/掛機（等級到了也不行）。沒有章節的 zone 不受限 →
 *   在使用者於後台寫入章節前，本系統對現有玩法零影響。
 * - SKIP 也算完成（記 skipped:true），玩家不想看劇情不會被卡。
 * - 玩家進度存 progress.storyProgress = { completed: { [chapterId]: { at, skipped } } }。
 *
 * 章節文件（storyChapters）：
 *   { id, order, zoneKey, title, enabled,
 *     nodes: [{ type: "narration"|"dialogue", npcId?, nameOverride?, side?("left"|"right"), text }],
 *     createdAt, updatedAt }
 * NPC 文件（storyNpcs）：{ id, name, portraitUrl, description, createdAt, updatedAt }
 */

const crypto = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");

const NODE_TYPES = new Set(["narration", "dialogue", "battle", "cg", "choice", "transfer"]);
const TEXT_SPEEDS = new Set(["slow", "normal", "fast"]);
const SCREEN_FX = new Set(["", "shake", "flash", "fadeblack"]);
const EXIT_SIDES = new Set(["left", "center", "right", "all"]); // 立繪退場位置
const TEXT_SIZES = new Set(["small", "large"]); // 文字大小(空=標準)
const TEXT_FX = new Set(["shake", "quake", "glow", "pulse", "wave"]); // 文字演出效果

const clampNum = (n, lo, hi, dflt) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Number(n))) : dflt);
// 背景平移+縮放 {x,y,z}（background-position %；z=縮放倍率 0.5~3，1=原本cover）
function sanitizeBgPos(v) {
  if (!v || typeof v !== "object") return null;
  const x = Number(v.x), y = Number(v.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out = { x: Math.max(0, Math.min(100, Math.round(x))), y: Math.max(0, Math.min(100, Math.round(y))) };
  if (v.z != null) { const z = clampNum(v.z, 0.5, 3, 1); if (Math.abs(z - 1) > 0.001) out.z = Math.round(z * 100) / 100; }
  return out;
}
// 🏞 章節級「每張背景圖」的位置/縮放/裁切：{ [url]: {x,y,z,fit} }
function sanitizeBgSettings(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  for (const url of Object.keys(v)) {
    const p = v[url]; if (!p || typeof p !== "object" || !url) continue;
    const e = sanitizeBgPos(p) || {};
    if (p.fit === "contain") e.fit = "contain";
    if (Object.keys(e).length) out[String(url).slice(0, 400)] = e;
  }
  return Object.keys(out).length ? out : null;
}
// 立繪位移+縮放 { left/center/right: {x,y,s} }（x/y 相對立繪大小 %；s=縮放 0.3~3，1=原本）
function sanitizeStagePos(v) {
  // 立繪保留「頭頂錨點 hy(占舞台高%)＋縮放 s」；水平由 side 決定。hy 以整個舞台高為基準 → 直式/橫式一致。
  if (!v || typeof v !== "object") return null;
  const out = {};
  for (const s of ["left", "center", "right"]) {
    const p = v[s];
    if (p && typeof p === "object") {
      const e = {};
      const hy = Number(p.hy);
      if (Number.isFinite(hy)) e.hy = Math.max(-20, Math.min(95, Math.round(hy)));
      const lhy = Number(p.lhy); // 橫式專用頭頂錨點(覆寫 hy)；只有立繪位置分直/橫兩軌
      if (Number.isFinite(lhy)) e.lhy = Math.max(-20, Math.min(95, Math.round(lhy)));
      if (p.s != null) { const sc = clampNum(p.s, 0.3, 3, 1); if (Math.abs(sc - 1) > 0.001) e.s = Math.round(sc * 100) / 100; }
      if (p.ls != null) { const sc = clampNum(p.ls, 0.3, 3, 1); if (Math.abs(sc - 1) > 0.001) e.ls = Math.round(sc * 100) / 100; } // 橫式專用縮放
      if (Object.keys(e).length) out[s] = e;
    }
  }
  return Object.keys(out).length ? out : null;
}

// B1:從 NPC 表情差分取指定表情的圖（取不到回 null，呼叫端退回預設立繪）
function resolveExpression(npc, exprName) {
  if (!exprName || !Array.isArray(npc?.expressions)) return null;
  const e = npc.expressions.find((x) => x && x.name === exprName);
  return e?.url || null;
}

// 主角＝登入玩家：這些 sentinel 代表玩家本人 → 出場時換成玩家的 DC 名字 + DC 頭像立繪
const PLAYER_NPC_ID = "player";
const PLAYER_NAME_TOKENS = new Set(["玩家", "主角", "你"]); // 舊劇本用 nameOverride 標主角
function isPlayerSpeaker(n) {
  if (n && n.npcId === PLAYER_NPC_ID) return true;
  return Boolean(n && !n.npcId && PLAYER_NAME_TOKENS.has(String(n.nameOverride || "").trim()));
}
// 文字裡的名字佔位符（___ / ＿＿＿ 連續 2 個以上底線）換成玩家 DC 名
function fillPlayerName(text, name) {
  const nm = String(name || "冒險者").trim() || "冒險者";
  return String(text == null ? "" : text).replace(/[_＿]{2,}/g, nm);
}

class StoryService {
  constructor(storyRepository, progressRepository, monsterService = null, itemRepository = null,
    walletRepository = null, rewardService = null) {
    this.storyRepository = storyRepository;
    this.progressRepository = progressRepository;
    this.monsterService = monsterService; // 供戰鬥節點載入指定怪 + 補怪物名稱/圖
    this.itemRepository = itemRepository;  // 供 🎁 發道具節點解析道具
    this.walletRepository = walletRepository; // ⚔️ 轉職節點扣金幣
    this.rewardService = rewardService;       // 有的話走台帳（扣款會留交易紀錄）
  }

  // ── 內部工具 ──

  _completedMap(progress) {
    const sp = progress?.storyProgress;
    return sp && typeof sp.completed === "object" && sp.completed ? sp.completed : {};
  }

  _battlesWonMap(progress) {
    const sp = progress?.storyProgress;
    return sp && typeof sp.battlesWon === "object" && sp.battlesWon ? sp.battlesWon : {};
  }

  /** 章節裡「必勝」戰鬥節點的 index 清單。 */
  _mustWinBattleIndexes(chapter) {
    // 分支章節：只強制「第一個選項節點之前、必經路線上」的必勝戰。分支內/之後的戰鬥
    // 可能在玩家沒走的線上，不能擋完成（閱讀中前端仍會就地強制必勝）。
    const nodes = Array.isArray(chapter.nodes) ? chapter.nodes : [];
    const labelIdx = {};
    nodes.forEach((n, i) => { if (n && n.label) labelIdx[n.label] = i; });
    const out = [], seen = new Set();
    let i = 0;
    while (i >= 0 && i < nodes.length && !seen.has(i)) {
      seen.add(i);
      const n = nodes[i];
      if (!n) break;
      if (n.type === "choice") break; // 進入分支 → 之後不強制
      if (n.type === "battle" && n.mustWin !== false && n.forcedOutcome !== "lose") out.push(i);
      i = (n.jumpTo && labelIdx[n.jumpTo] != null) ? labelIdx[n.jumpTo] : i + 1;
    }
    return out;
  }

  /** 🔒 節點條件是否滿足（等級/職業/稱號）。cond 空＝一律顯示。 */
  _condMet(cond, progress, ctx = {}) {
    if (!cond || typeof cond !== "object") return true;
    // 🎫 會員限定分支：cond.member === true → 只有會員看得到；=== false → 只有非會員看得到。
    //    會員判定不能只看 progress.playerTier（實測 424 人中只有 29 人有值、實際會員 81 人，
    //    binding/progress 不同步是既知的坑），所以由呼叫端用 backpackService 解析聯集後傳進來。
    if (cond.member != null && Boolean(ctx.isMember) !== Boolean(cond.member)) return false;
    if (cond.minLevel != null && (Number(progress?.level) || 1) < Number(cond.minLevel)) return false;
    if (cond.job && String(progress?.job || "") !== String(cond.job)) return false;
    if (cond.title) {
      const want = String(cond.title);
      const pool = [...(progress?.inventory || []), ...Object.values(progress?.equipment || {})];
      const has = pool.some((it) => it && it.equipSlot === "title_eq" && (it.itemName === want || it.name === want));
      if (!has) return false;
    }
    return true;
  }

  /** 全部 enabled 章節，依 order 升冪。 */
  async _enabledChapters() {
    const all = await this.storyRepository.listChapters();
    return all
      .filter((c) => c && c.enabled !== false)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }

  /** 章節對玩家的狀態：completed / available / locked */
  _chapterStatus(chapter, orderedChapters, completedMap) {
    if (completedMap[chapter.id]) return "completed";
    for (const c of orderedChapters) {
      if (c.id === chapter.id) return "available";
      if (!completedMap[c.id]) return "locked"; // 前面有未完成章節
    }
    return "locked";
  }

  // ── 玩家端 ──

  /** 章節清單（不含 nodes 內文，供目錄頁）。 */
  // 登入時預先下載用：所有啟用章節會用到的背景/CG 圖 + BGM 曲目 key（去重）
  async listPreloadAssets() {
    const chapters = await this._enabledChapters();
    const images = new Set(), bgm = new Set();
    // 立繪要跟著預抓 → 先備妥 NPC 表(含表情差分)＋怪物圖快取，逐節點解析立繪來源
    const npcs = await this.storyRepository.listNpcs().catch(() => []);
    const npcOf = Object.fromEntries((npcs || []).map((n) => [n.id, n]));
    const monImg = {}; // 怪物 id → imageUrl(快取，避免重複查)
    const monImageOf = async (id) => {
      if (!id) return null;
      if (!(id in monImg)) { const m = await this.monsterService?.getMonsterById(id).catch(() => null); monImg[id] = m ? (m.imageUrl || null) : null; }
      return monImg[id];
    };
    // 把某個立繪來源 id(player/npc/mon:) 解析成圖 URL 加進 images
    const addPortrait = async (id, expression) => {
      if (!id || id === "player") return; // 玩家立繪＝各自 DC 頭像，非固定資產，跳過
      if (typeof id === "string" && id.startsWith("mon:")) { const u = await monImageOf(id.slice(4)); if (u) images.add(u); return; }
      const npc = npcOf[id]; if (!npc) return;
      if (npc.portraitUrl) images.add(npc.portraitUrl);
      const e = (npc.expressions || []).find((x) => x && x.name === expression);
      if (e && e.url) images.add(e.url);
    };
    for (const ch of chapters) {
      if (ch.backgroundUrl) images.add(ch.backgroundUrl);
      for (const n of (Array.isArray(ch.nodes) ? ch.nodes : [])) {
        if (n.backgroundUrl) images.add(n.backgroundUrl);
        if (n.cgUrl) images.add(n.cgUrl);
        if (n.bgm && n.bgm !== "silence" && n.bgm !== "zone") bgm.add(n.bgm);
        if (n.type === "dialogue" && n.npcId) await addPortrait(n.npcId, n.expression); // 對話立繪+表情差分
        if (n.type === "battle" && n.monsterId) { const u = await monImageOf(n.monsterId); if (u) images.add(u); } // 戰鬥怪物圖
        if (n.stageNpcId) await addPortrait(n.stageNpcId, null); // 🧍立繪擺台
      }
    }
    return { images: Array.from(images), bgm: Array.from(bgm) };
  }

  async listChaptersForPlayer(discordId) {
    const [chapters, progress] = await Promise.all([
      this._enabledChapters(),
      this.progressRepository.findByPlayerId(discordId).catch(() => null)
    ]);
    const completed = this._completedMap(progress);
    return chapters.map((c) => ({
      id: c.id,
      order: Number(c.order) || 0,
      zoneKey: c.zoneKey || null,
      title: c.title || "(未命名章節)",
      nodeCount: Array.isArray(c.nodes) ? c.nodes.length : 0,
      isPrologue: Boolean(c.isPrologue),
      status: this._chapterStatus(c, chapters, completed),
      skipped: Boolean(completed[c.id]?.skipped)
    }));
  }

  /** 章節完整內容（nodes 附 NPC 名字/立繪）。鎖定中不可讀。 */
  async getChapterForPlayer(discordId, chapterId, player = {}) {
    const playerName = player?.name || null;          // 玩家 DC 顯示名（替換 ___ / 主角名）
    const playerAvatarUrl = player?.avatarUrl || null; // 玩家 DC 頭像（做主角立繪）
    const [chapters, progress] = await Promise.all([
      this._enabledChapters(),
      this.progressRepository.findByPlayerId(discordId).catch(() => null)
    ]);
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該章節", 404);
    const status = this._chapterStatus(chapter, chapters, this._completedMap(progress));
    if (status === "locked") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "請先完成前面的章節", 403);
    }
    const npcs = await this.storyRepository.listNpcs();
    const npcOf = Object.fromEntries(npcs.map((n) => [n.id, n]));
    const battlesWon = this._battlesWonMap(progress)[chapterId] || [];
    // 🎫 會員判定（給 cond.member 用）：走 backpackService 的聯集口徑
    //    （綁定 playerTierAtLink/linkedSupportAtLink ＋ progress.playerTier ＋ DC 身分組，取最高、只加不減），
    //    它自帶快取；解析失敗一律當非會員，確保只會「少給」不會誤放會員限定內容。
    let isMember = false;
    try {
      const bp = require("../backpack/backpackService");
      const eff = await bp.resolveCapacity(discordId);
      isMember = Boolean(eff && eff.tier);
    } catch (_) { isMember = false; }
    const condCtx = { isMember };
    // 戰鬥節點：補上怪物名稱/圖（供閱讀器顯示）
    const monsterCache = {};
    const getMonster = async (id) => {
      if (!id || !this.monsterService) return null;
      if (!(id in monsterCache)) monsterCache[id] = await this.monsterService.getMonsterById(id).catch(() => null);
      return monsterCache[id];
    };
    const rawNodes = Array.isArray(chapter.nodes) ? chapter.nodes : [];
    // 分支：label→index 對照，前端拿 jumpToIndex 直接跳（不用自己解析 label）
    const labelIdx = {};
    rawNodes.forEach((n, i) => { if (n && n.label) labelIdx[n.label] = i; });
    const jumpIdxOf = (jumpTo) => (jumpTo && labelIdx[jumpTo] != null) ? labelIdx[jumpTo] : null;
    const nodes = await Promise.all(rawNodes.map(async (n, i) => {
      // 分支/條件共用欄位（含戰鬥節點）
      const flow = {
        label: n.label || null,
        jumpToIndex: jumpIdxOf(n.jumpTo),                 // 此節點看完後跳去哪(null=下一句)
        condSkip: !this._condMet(n.cond, progress, condCtx) // 🔒 條件不符→前端跳過此節點
      };
      if (n.type === "battle") {
        const m = await getMonster(n.monsterId);
        return {
          type: "battle",
          monsterId: n.monsterId || null,
          text: fillPlayerName(n.text, playerName), // 戰鬥前的旁白/描述
          battleTitle: n.battleTitle ? fillPlayerName(n.battleTitle, playerName) : null, // 橘字標題
          monsterName: m?.name || "（怪物不存在）",
          monsterImageUrl: m?.imageUrl || null,
          monsterLevel: m?.level ?? null,
          // 劇情殺·必敗時 mustWin 一律視為 false(否則玩家會卡關)；其餘照設定
          mustWin: n.forcedOutcome === "lose" ? false : n.mustWin !== false,
          forcedOutcome: (n.forcedOutcome === "win" || n.forcedOutcome === "lose") ? n.forcedOutcome : null,
          won: battlesWon.includes(i), // 玩家是否已通過此戰
          backgroundUrl: n.backgroundUrl || null,
          bgm: n.bgm || null,
          sfx: n.sfx || null,
          grantItemId: n.grantItemId || null,
          t2BadgeId: n.t2BadgeId || null,
          ...flow
        };
      }
      if (n.type === "choice") {
        // ❓ 選項分支：選項各自跳到 label(前端拿 index)
        return {
          type: "choice",
          text: fillPlayerName(n.text, playerName),
          options: (n.options || []).map((o) => ({ text: fillPlayerName(o.text, playerName), jumpToIndex: jumpIdxOf(o.jumpTo) })),
          backgroundUrl: n.backgroundUrl || null,
          bgm: n.bgm || null, sfx: n.sfx || null,
          voiceUrl: n.voiceUrl || null,
          ...flow
        };
      }
      // 🧍立繪擺台(不當說話者)：任何節點可指定一角色立繪放上台。解析 id→圖(玩家頭像/NPC立繪/怪物圖)
      let stagePortraitUrl = null;
      if (n.stageNpcId) {
        if (n.stageNpcId === PLAYER_NPC_ID || n.stageNpcId === "player") stagePortraitUrl = playerAvatarUrl || null;
        else if (typeof n.stageNpcId === "string" && n.stageNpcId.startsWith("mon:")) { const sm = await getMonster(n.stageNpcId.slice(4)); stagePortraitUrl = sm ? (sm.imageUrl || null) : null; }
        else { const sn = npcOf[n.stageNpcId]; stagePortraitUrl = sn ? (sn.portraitUrl || null) : null; }
      }
      // 共用演出欄位（B2 清台/退場 / B3 畫面效果·文字節奏）
      const common = {
        stageNpcId: n.stageNpcId || null,       // 🧍立繪擺台角色 id(供舞台記位置)
        stagePortraitUrl,                        // 🧍立繪擺台圖(解析後)；null=沒設
        clearStage: n.clearStage === true,               // B2:進此節點前清掉台上其他立繪
        exitSide: EXIT_SIDES.has(n.exitSide) ? n.exitSide : null, // 讓某位置立繪退場(left/center/right/all)
        textSize: TEXT_SIZES.has(n.textSize) ? n.textSize : null, // 文字大小
        textFx: TEXT_FX.has(n.textFx) ? n.textFx : null,          // 文字演出效果
        bgPos: sanitizeBgPos(n.bgPos),                   // 背景平移
        stagePos: sanitizeStagePos(n.stagePos),          // 立繪位移(每側)
        screenFx: SCREEN_FX.has(n.screenFx) ? (n.screenFx || null) : null, // B3:震動/閃白/漸黑
        textSpeed: TEXT_SPEEDS.has(n.textSpeed) ? n.textSpeed : null,      // B3:文字節奏
        backgroundUrl: n.backgroundUrl || null,
        bgm: n.bgm || null,
        sfx: n.sfx || null,
        grantItemId: n.grantItemId || null, // 🎁 發道具(讀到即給，前端呼叫 /grant)
        t2BadgeId: n.t2BadgeId || null,     // ⚔️ 轉職節點要換發的二轉徽章
        voiceUrl: n.voiceUrl || null,       // 🎤 配音
        holdSec: Number(n.holdSec) > 0 ? Number(n.holdSec) : null, // ⏱進場停頓秒
        ...flow
      };
      if (n.type === "cg") {
        return { type: "cg", cgUrl: n.cgUrl || null, cgPos: sanitizeBgPos(n.cgPos), text: fillPlayerName(n.text, playerName), ...common };
      }
      const isDlg = n.type === "dialogue";
      const isPlayer = isDlg && isPlayerSpeaker(n); // 主角＝登入玩家 → 換 DC 名字+頭像立繪
      // 立繪來源可為怪物庫：npcId="mon:<id>" → 用怪物圖當立繪（與 NPC 立繪一樣獨立擺台）
      const monId = (isDlg && !isPlayer && typeof n.npcId === "string" && n.npcId.startsWith("mon:")) ? n.npcId.slice(4) : null;
      const mon = monId ? await getMonster(monId) : null;
      const npc = (!isPlayer && !monId && n.npcId) ? npcOf[n.npcId] : null;
      // B1:表情差分 — 依 node.expression 從 NPC 的 expressions 取圖，取不到退回預設立繪
      const exprUrl = isPlayer
        ? (playerAvatarUrl || null)
        : mon ? (mon.imageUrl || null)
          : (isDlg && npc ? (resolveExpression(npc, n.expression) || npc.portraitUrl || null) : null);
      return {
        type: NODE_TYPES.has(n.type) ? n.type : "narration",
        text: fillPlayerName(n.text, playerName),
        side: n.side === "left" ? "left" : (n.side === "right" ? "right" : "center"), // 預設置中
        // B2:舞台狀態要靠 npcId 判斷同角色；主角統一給 sentinel "player"；怪物保留 "mon:<id>" 當識別碼
        npcId: isDlg ? (isPlayer ? PLAYER_NPC_ID : (n.npcId || null)) : null,
        npcName: isDlg ? (isPlayer ? (playerName || "冒險者") : (n.nameOverride || mon?.name || npc?.name || "???")) : null,
        npcPortraitUrl: exprUrl,
        expression: (isDlg && !isPlayer && !mon) ? (n.expression || null) : null,
        portraitFx: isDlg ? (n.portraitFx || null) : null, // 立繪演出(彈入/晃動/…)
        ...common
      };
    }));
    return {
      id: chapter.id, order: chapter.order, zoneKey: chapter.zoneKey || null, title: chapter.title, status,
      backgroundUrl: chapter.backgroundUrl || null, // 章節預設背景
      bgSettings: chapter.bgSettings || null,       // 🏞 每張背景圖的位置/縮放/裁切
      nodes
    };
  }

  /** 完成章節（含 SKIP）。冪等：重複完成不報錯。 */
  async completeChapter(discordId, chapterId, { skipped = false } = {}) {
    const chapters = await this._enabledChapters();
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該章節", 404);

    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家進度", 404);
    const completed = { ...this._completedMap(progress) };
    if (completed[chapterId]) {
      return { chapterId, alreadyCompleted: true };
    }
    const status = this._chapterStatus(chapter, chapters, completed);
    if (status === "locked") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "請先完成前面的章節", 403);
    }
    // 必勝戰鬥閘門：章內所有 mustWin 戰鬥都要通過，才能完成章節（SKIP 也擋，避免繞過）
    const mustWin = this._mustWinBattleIndexes(chapter);
    if (mustWin.length > 0) {
      const won = this._battlesWonMap(progress)[chapterId] || [];
      const pending = mustWin.filter((i) => !won.includes(i));
      if (pending.length > 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "本章還有必勝戰鬥尚未通過", 403);
      }
    }
    completed[chapterId] = { at: new Date().toISOString(), skipped: Boolean(skipped) };
    progress.storyProgress = { ...(progress.storyProgress || {}), completed };
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    // 回傳「因此新解鎖」的資訊，讓前端能提示（下一章 / 區域開放）
    const next = chapters.find((c) => !completed[c.id]);
    return {
      chapterId,
      completed: true,
      skipped: Boolean(skipped),
      zoneUnlocked: chapter.zoneKey && (await this._zoneFullyCompleted(chapter.zoneKey, completed)) ? chapter.zoneKey : null,
      nextChapter: next ? { id: next.id, title: next.title, zoneKey: next.zoneKey || null } : null
    };
  }

  async _zoneFullyCompleted(zoneKey, completedMap) {
    const chapters = await this._enabledChapters();
    return chapters.filter((c) => c.zoneKey === zoneKey).every((c) => completedMap[c.id]);
  }

  // ── 區域閘門（戰鬥/掛機入口呼叫）──

  /**
   * 檢查玩家可否在該 zone 進行遊玩。
   * @returns {null | { chapterId, chapterTitle }} null=放行；否則回傳「需先完成的章節」。
   * progress 可直接傳入（呼叫端通常已載入），避免重查 DB。
   */
  async checkZoneStoryGate(progressOrDiscordId, zoneKey) {
    const chapters = await this._enabledChapters();
    const zoneChapters = chapters.filter((c) => c.zoneKey === zoneKey);
    if (zoneChapters.length === 0) return null; // 該區沒有章節 → 不閘

    const progress = typeof progressOrDiscordId === "string"
      ? await this.progressRepository.findByPlayerId(progressOrDiscordId).catch(() => null)
      : progressOrDiscordId;
    const completed = this._completedMap(progress);
    const missing = zoneChapters.find((c) => !completed[c.id]);
    if (!missing) return null;
    return { chapterId: missing.id, chapterTitle: missing.title || "(未命名章節)" };
  }

  // ── 戰鬥節點 ──

  /** 取得戰鬥節點資訊（供 /api/story/battle 用）；驗證章節可讀、節點確為戰鬥。 */
  async getBattleNode(discordId, chapterId, nodeIndex) {
    const [chapters, progress] = await Promise.all([
      this._enabledChapters(),
      this.progressRepository.findByPlayerId(discordId).catch(() => null)
    ]);
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該章節", 404);
    if (this._chapterStatus(chapter, chapters, this._completedMap(progress)) === "locked") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "請先完成前面的章節", 403);
    }
    const node = (chapter.nodes || [])[nodeIndex];
    if (!node || node.type !== "battle") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "該節點不是戰鬥節點", 400);
    }
    const mr = Number(node.maxRounds);
    return {
      monsterId: node.monsterId || null,
      mustWin: node.forcedOutcome === "lose" ? false : node.mustWin !== false,
      forcedOutcome: (node.forcedOutcome === "win" || node.forcedOutcome === "lose") ? node.forcedOutcome : null,
      maxRounds: Number.isFinite(mr) && mr >= 1 ? Math.min(30, Math.round(mr)) : null
    };
  }

  /** 記錄玩家通過某章某戰鬥節點（冪等）。 */
  async recordBattleWin(discordId, chapterId, nodeIndex) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家進度", 404);
    const battlesWon = { ...this._battlesWonMap(progress) };
    const arr = new Set(battlesWon[chapterId] || []);
    arr.add(Number(nodeIndex));
    battlesWon[chapterId] = [...arr];
    progress.storyProgress = { ...(progress.storyProgress || {}), battlesWon };
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
  }

  /** 🎁 讀到某節點時發指定道具（冪等：每章每節點只發一次）。 */
  async grantNodeItem(discordId, chapterId, nodeIndex) {
    const chapters = await this._enabledChapters();
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該章節", 404);
    if (this._chapterStatus(chapter, chapters, this._completedMap(await this.progressRepository.findByPlayerId(discordId).catch(() => null))) === "locked") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "請先完成前面的章節", 403);
    }
    const node = (chapter.nodes || [])[nodeIndex];
    const wantId = node && node.grantItemId ? String(node.grantItemId) : null;
    if (!wantId) return { granted: false, reason: "no_grant" };
    const libraryItem = this.itemRepository ? await this.itemRepository.findById(wantId).catch(() => null) : null;
    if (!libraryItem) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "指定道具不存在", 400);
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家進度", 404);
    const sp = progress.storyProgress || {};
    const grantedMap = { ...(sp.grantedItems && typeof sp.grantedItems === "object" ? sp.grantedItems : {}) };
    const key = `${chapterId}:${nodeIndex}`;
    const item = libraryItem;
    const brief = { name: item.name, imageUrl: item.imageUrl || null, tier: item.tier || null, itemType: item.itemType || "consumable" };
    if (grantedMap[key]) return { granted: false, alreadyGranted: true, item: brief };

    const crypto = require("crypto");
    const entry = {
      uuid: crypto.randomUUID(),
      itemId: String(item.id),
      itemName: item.name,
      itemEffect: item.effect || { type: "none", value: 0 },
      useEffects: item.useEffects || [],
      passiveEffects: item.passiveEffects || [],
      procEffects: item.procEffects || [],
      combatEffects: item.combatEffects || [],
      itemType: item.itemType || "consumable",
      imageUrl: item.imageUrl || null,
      imageThumbnailUrl: item.imageThumbnailUrl || null,
      equipSlot: item.equipSlot || null,
      equipStats: item.equipStats || null,
      weaponType: item.weaponType || null,
      isTwoHanded: Boolean(item.isTwoHanded),
      tier: item.tier || null,
      source: "story",
      sourceRef: chapterId,
      purchasedAt: new Date().toISOString()
    };
    try { require("../enchant/enchantService").rollForEntry(entry); } catch (_) { /* noop */ }
    progress.inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    progress.inventory.push(entry);
    grantedMap[key] = new Date().toISOString();
    progress.storyProgress = { ...sp, grantedItems: grantedMap };
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return { granted: true, item: brief };
  }

  /**
   * ⚔️ 轉職節點：消耗「一轉徽章 ＋ 金幣」→ 換發二轉徽章（Lv1 重練）。
   *
   * 規則（見 docs/JOB_BADGE_SYSTEM_DESIGN.md）：
   *   ‧ 一轉徽章必須練滿 Lv20（jobBadgeLevel.TRANSFER_LEVEL）
   *   ‧ 費用依「目前已持有幾個二轉徽章」遞增：25 萬 / 100 萬 / 300 萬（之後都 300 萬）
   *   ‧ 一轉徽章**直接消耗掉**（連同練出來的熟練度），且該職業的一轉試煉不會再給第二個
   *   ‧ 冪等：同一個 chapter:node 只會成功一次（存 storyProgress.transfers）
   */
  async transferJobAtNode(discordId, chapterId, nodeIndex) {
    const jobAdvancement = require("../../shared/jobAdvancement");
    const jobBadgeLevel = require("../../shared/jobBadgeLevel");
    const { withPlayerProgressLock } = require("../progress/progressLocks");

    const chapters = await this._enabledChapters();
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該章節", 404);
    const node = (chapter.nodes || [])[nodeIndex];
    if (!node || node.type !== "transfer") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此節點不是轉職節點", 400);
    }
    const t2BadgeId = node.t2BadgeId ? String(node.t2BadgeId) : null;
    if (!t2BadgeId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "轉職節點未設定二轉徽章", 400);

    // 二轉徽章 → 它的一轉職業 → 該吃掉哪個一轉徽章
    const branch = jobAdvancement.getT2Branch(t2BadgeId);
    const baseKey = branch?.baseKey || null;
    const t1BadgeId = baseKey ? jobAdvancement.BASE_JOBS?.[baseKey]?.badgeId : null;
    if (!t1BadgeId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "找不到對應的一轉職業", 400);

    const t2Item = this.itemRepository ? await this.itemRepository.findById(t2BadgeId).catch(() => null) : null;
    if (!t2Item) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "二轉徽章道具不存在", 400);

    return withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家進度", 404);

      const sp = progress.storyProgress || {};
      const transfers = { ...(sp.transfers && typeof sp.transfers === "object" ? sp.transfers : {}) };
      const key = `${chapterId}:${nodeIndex}`;
      if (transfers[key]) return { transferred: false, alreadyDone: true };

      // ① 找一轉徽章（身上優先，其次背包）並確認練滿
      const equipment = progress.equipment || {};
      const inventory = Array.isArray(progress.inventory) ? progress.inventory : (progress.inventory = []);
      const equippedIsT1 = String(equipment.job_eq?.itemId || "") === t1BadgeId;
      const invIdx = inventory.findIndex((e) => e && String(e.itemId || "") === t1BadgeId);
      const t1Entry = equippedIsT1 ? equipment.job_eq : (invIdx !== -1 ? inventory[invIdx] : null);
      if (!t1Entry) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "你身上沒有這個職業的一轉徽章", 400);
      }
      const t1Progress = jobBadgeLevel.readBadgeProgress(t1Entry);
      if (!t1Progress.canTransfer) {
        throw new AppError(
          ERROR_CODES.INVALID_ARGUMENT,
          `徽章熟練度不足（目前 Lv.${t1Progress.level}／需 Lv.${jobBadgeLevel.TRANSFER_LEVEL}）`,
          400
        );
      }

      // ② 費用：依目前已持有的二轉徽章數遞增
      const ownedIds = [
        ...inventory.map((e) => String(e?.itemId || "")),
        ...Object.values(equipment).map((e) => String(e?.itemId || "")),
      ].filter(Boolean);
      const ownedT2 = jobAdvancement.countOwnedT2(ownedIds);
      const cost = jobAdvancement.transferCostFor(ownedT2);

      const wallet = this.walletRepository
        ? await this.walletRepository.findByPlayerId(discordId).catch(() => null)
        : null;
      const gold = Math.max(0, Number(wallet?.gold) || 0);
      if (gold < cost) {
        throw new AppError(
          ERROR_CODES.INVALID_ARGUMENT,
          `金幣不足：轉職需要 ${cost.toLocaleString()} 金，目前 ${gold.toLocaleString()} 金`,
          400
        );
      }

      // ③ 扣款（有 rewardService 就走台帳，留交易紀錄）
      const displayName = progress.displayName || progress.playerName || discordId;
      if (this.rewardService?.grantCurrency) {
        await this.rewardService.grantCurrency({
          discordId, displayName, currencyType: "gold",
          amount: -Math.abs(cost), source: "job_transfer", operator: "story:job-transfer",
        });
      } else if (this.walletRepository) {
        await this.walletRepository.save({ ...wallet, playerId: discordId, gold: gold - cost });
      } else {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, "缺少金幣扣款服務", 500);
      }

      // ④ 消耗一轉徽章（連同練出來的熟練度一起交出去）
      if (equippedIsT1) delete equipment.job_eq;
      else inventory.splice(invIdx, 1);

      // ⑤ 換發二轉徽章：Lv1 重練，並直接裝上（玩家不會有一瞬間沒有職業）
      const crypto = require("crypto");
      const t2Entry = {
        uuid: crypto.randomUUID(),
        itemId: String(t2Item.id),
        itemName: t2Item.name,
        itemType: t2Item.itemType || "job_badge",
        equipSlot: t2Item.equipSlot || "job_eq",
        itemEffect: t2Item.effect || { type: "none", value: 0 },
        useEffects: t2Item.useEffects || [],
        passiveEffects: t2Item.passiveEffects || [],
        procEffects: t2Item.procEffects || [],
        combatEffects: t2Item.combatEffects || [],
        imageUrl: t2Item.imageUrl || null,
        imageThumbnailUrl: t2Item.imageThumbnailUrl || null,
        tier: t2Item.tier || null,
        equipStats: t2Item.equipStats || null,
        enhanceLevel: 0,
        jobExp: 0,                       // ← Lv1 重練
        source: "job_transfer",
        sourceRef: chapterId,
        purchasedAt: new Date().toISOString(),
      };
      progress.equipment = { ...equipment, job_eq: t2Entry };

      transfers[key] = { at: new Date().toISOString(), from: t1BadgeId, to: t2BadgeId, cost };
      progress.storyProgress = { ...sp, transfers };
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);

      // ⑥ 全服廣播（轉職是大事，一輩子一次）
      try {
        const tc = require("../../shared/announceTownChat");
        const name = await tc.resolveDiscordName(discordId).catch(() => null);
        const who = name ? `**${name}**` : "有位冒險者";
        await tc.announceTownChat(`⚔️ ${who} 完成了二轉，成為 **${t2Item.name.replace(/徽章$/, "")}**！`);
      } catch (_) { /* 廣播失敗不影響轉職 */ }

      // ⑦ 賽季任務指標：完成二轉（「第二個身分」等任務；失敗不影響轉職）
      try {
        const sc = require("../createServiceContext").createServiceContext?.();
        const qs = sc?.questService || sc?.weeklyQuestService;
        if (qs?.recordProgress) await qs.recordProgress(discordId, "t2_transfer_done", 1);
      } catch (_) { /* 任務進度失敗不影響轉職 */ }

      return {
        transferred: true,
        from: { itemId: t1BadgeId, name: t1Entry.itemName || t1BadgeId, level: t1Progress.level },
        to: { itemId: t2BadgeId, name: t2Item.name, level: 1 },
        cost,
        goldLeft: gold - cost,
      };
    });
  }

  // ── 後台（Admin）──

  async adminListChapters() {
    const all = await this.storyRepository.listChapters();
    return all.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }

  _validateNodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    // 瘦身：丟掉 null/undefined/空字串 的欄位不存(讀取端都有預設值)。避免每個節點都灌十幾個空欄位。
    // side/type/mustWin 等有意義的預設(含 false)保留。
    const strip = (o) => { for (const k of Object.keys(o)) { const v = o[k]; if (v === null || v === undefined || v === "") delete o[k]; } return o; };
    return nodes.map((n) => {
      const type = NODE_TYPES.has(n?.type) ? n.type : "narration";
      // Phase C 預留：label(節點標籤)/jumpTo(跳轉目標)，供未來選項分支用；目前僅存不讀。
      const reserved = {
        label: n?.label ? String(n.label).slice(0, 40) : null,
        jumpTo: n?.jumpTo ? String(n.jumpTo).slice(0, 40) : null
      };
      // 🔒 條件（等級/職業/稱號；不滿足→玩家端跳過此節點）
      let cond = null;
      if (n?.cond && typeof n.cond === "object") {
        const c = {};
        const lv = Number(n.cond.minLevel);
        if (Number.isFinite(lv) && lv > 1) c.minLevel = Math.min(999, Math.round(lv));
        if (n.cond.job) c.job = String(n.cond.job).slice(0, 40);
        if (n.cond.title) c.title = String(n.cond.title).slice(0, 60);
        if (Object.keys(c).length) cond = c;
      }
      // 共用演出欄位
      const common = {
        clearStage: n?.clearStage === true, // B2
        exitSide: EXIT_SIDES.has(n?.exitSide) ? n.exitSide : null, // 立繪退場
        textSize: TEXT_SIZES.has(n?.textSize) ? n.textSize : null, // 文字大小
        textFx: TEXT_FX.has(n?.textFx) ? n.textFx : null,          // 文字演出效果
        bgPos: sanitizeBgPos(n?.bgPos),       // 背景平移
        stagePos: sanitizeStagePos(n?.stagePos), // 立繪位移
        screenFx: SCREEN_FX.has(n?.screenFx) ? (n.screenFx || null) : null, // B3
        textSpeed: TEXT_SPEEDS.has(n?.textSpeed) ? n.textSpeed : null, // B3
        backgroundUrl: n?.backgroundUrl ? String(n.backgroundUrl) : null,
        bgm: n?.bgm ? String(n.bgm) : null,
        sfx: n?.sfx ? String(n.sfx) : null,
        grantItemId: n?.grantItemId ? String(n.grantItemId) : null, // 🎁 讀到此節點發指定道具(一次)
        t2BadgeId: n?.t2BadgeId ? String(n.t2BadgeId) : null,       // ⚔️ 轉職節點：換發的二轉徽章 id
        voiceUrl: n?.voiceUrl ? String(n.voiceUrl) : null,          // 🎤 配音(顯示此節點時播放)
        stageNpcId: n?.stageNpcId ? String(n.stageNpcId).slice(0, 60) : null, // 🧍立繪擺台(不當說話者)：任何節點可放一個角色立繪上台(id=player/npc/mon:<id>)
        holdSec: (() => { const s = Number(n?.holdSec); return Number.isFinite(s) && s > 0 ? Math.min(10, Math.round(s * 10) / 10) : null; })(), // ⏱進場停頓秒(0~10)：擋點擊等音樂/演出進來
        cond,                                                        // 🔒 顯示條件
        ...reserved
      };
      if (type === "choice") {
        // ❓ 選項分支：2~4 個選項，各自跳到某個 label（空＝順著往下）
        const options = (Array.isArray(n?.options) ? n.options : []).slice(0, 4)
          .map((o) => ({ text: String(o?.text || "").slice(0, 80), jumpTo: o?.jumpTo ? String(o.jumpTo).slice(0, 40) : null }))
          .filter((o) => o.text.trim());
        return { type: "choice", text: String(n?.text || "").slice(0, 400), options, ...common };
      }
      if (type === "battle") {
        const forcedOutcome = (n?.forcedOutcome === "win" || n?.forcedOutcome === "lose") ? n.forcedOutcome : null; // 劇情殺
        const mr = Number(n?.maxRounds); // 回合上限(1~30)；無效/空＝null(用預設)
        const maxRounds = Number.isFinite(mr) && mr >= 1 ? Math.min(30, Math.round(mr)) : null;
        return {
          type: "battle",
          monsterId: n?.monsterId ? String(n.monsterId) : null,
          text: String(n?.text || "").slice(0, 2000), // 戰鬥前的旁白/描述
          battleTitle: n?.battleTitle ? String(n.battleTitle).slice(0, 60) : null, // 橘字標題(留空=自動)
          mustWin: n?.mustWin !== false, // 預設必勝
          forcedOutcome, // 劇情殺：win=一定贏 / lose=一定輸(劇情照走) / null=正常
          maxRounds,     // 戰鬥回合上限(讓劇情戰鬥更快)
          backgroundUrl: common.backgroundUrl, bgm: common.bgm, sfx: common.sfx,
          grantItemId: common.grantItemId, t2BadgeId: common.t2BadgeId, cond: common.cond, ...reserved
        };
      }
      if (type === "cg") {
        return { type: "cg", cgUrl: n?.cgUrl ? String(n.cgUrl) : null, cgPos: sanitizeBgPos(n?.cgPos), text: String(n?.text || "").slice(0, 2000), ...common };
      }
      return {
        type,
        npcId: n?.npcId ? String(n.npcId) : null,
        nameOverride: n?.nameOverride ? String(n.nameOverride).slice(0, 40) : null,
        side: n?.side === "left" ? "left" : (n?.side === "right" ? "right" : "center"), // 預設置中
        portraitFx: n?.portraitFx ? String(n.portraitFx) : null,
        expression: n?.expression ? String(n.expression).slice(0, 40) : null, // B1
        text: String(n?.text || "").slice(0, 2000),
        ...common
      };
    }).map(strip);
  }

  async adminSaveChapter(input) {
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const existing = input.id ? await this.storyRepository.findChapterById(input.id) : null;
    const doc = {
      id,
      order: Number(input.order) || 0,
      zoneKey: input.zoneKey ? String(input.zoneKey) : null,
      title: String(input.title || "").slice(0, 80) || "(未命名章節)",
      enabled: input.enabled !== false,
      backgroundUrl: input.backgroundUrl ? String(input.backgroundUrl) : null,
      // 快速編寫的「原始劇本文字」草稿：跟章節一起存，下次打開帶回，確認後才解析成節點（不影響玩家端）
      scriptDraft: input.scriptDraft !== undefined ? String(input.scriptDraft || "").slice(0, 40000) : (existing?.scriptDraft || ""),
      bgSettings: sanitizeBgSettings(input.bgSettings) || existing?.bgSettings || null, // 🏞 每張背景圖的位置/縮放/裁切(章節級一份)
      nodes: this._validateNodes(input.nodes),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await this.storyRepository.saveChapter(doc);
    return doc;
  }

  async adminDeleteChapter(id) {
    await this.storyRepository.deleteChapter(id);
    return { deleted: id };
  }

  async adminListNpcs() {
    return this.storyRepository.listNpcs();
  }

  async adminSaveNpc(input) {
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const existing = input.id ? await this.storyRepository.findNpcById(input.id) : null;
    // 欄位未提供（undefined）時保留既有值——立繪上傳只帶 portraitUrl 不能洗掉名字。
    const doc = {
      id,
      name: input.name !== undefined
        ? (String(input.name || "").slice(0, 40) || "(未命名NPC)")
        : (existing?.name || "(未命名NPC)"),
      portraitUrl: input.portraitUrl !== undefined ? (input.portraitUrl || null) : (existing?.portraitUrl || null),
      // B1:表情差分 — [{ name, url }]。未提供則保留既有。
      expressions: input.expressions !== undefined
        ? (Array.isArray(input.expressions)
          ? input.expressions
            .filter((e) => e && e.name && e.url)
            .slice(0, 20)
            .map((e) => ({ name: String(e.name).slice(0, 40), url: String(e.url) }))
          : [])
        : (existing?.expressions || []),
      description: input.description !== undefined
        ? String(input.description || "").slice(0, 500)
        : (existing?.description || ""),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await this.storyRepository.saveNpc(doc);
    return doc;
  }

  async adminDeleteNpc(id) {
    await this.storyRepository.deleteNpc(id);
    return { deleted: id };
  }
}

module.exports = { StoryService };
