"use strict";
/**
 * 玩家裝備分解 API（網頁 App 用，對應 Discord 背包「🔨 分解／批量分解」）：
 *   POST /api/me/inventory/dismantle
 *     body { uuid }                     單件分解（shopService.discardItem）
 *     body { uuid, bulk: true, qty? }   同款未強化批量分解（shopService.discardItemBulk，同 DC 批量分解按鈕）
 *     body { uuids: [uuid, ...] }       多件逐一分解（每件獨立判定，單件失敗不中斷其他）
 *
 * 產物規則完全由 shopService.DISMANTLE_YIELD 決定（50% 機率產出強化寶石；
 * 同階 1 顆：S→S、A→A、B→B、C→C、D→D；怪物卡不可分解）。
 * 屬性石是另一條獨立判定（只有帶 element 的實例才有），機率依階級查
 * shopService.ELEMENT_STONE_RATE_BY_TIER：D 25% / C 35% / B 50% / A 65% / S 85%。
 */

const { Router } = require("express");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");

const { getElementLabel } = require("../../shared/elementSystem");

const MAX_UUIDS_PER_REQUEST = 50;
const MAX_BATCH_UUIDS = 2000; // /batch 端點單次上限（背包容量最高 1500，留餘裕）

function createPlayerForgeRoutes(serviceContext) {
  const router = Router();

  // 批次處理背包（網頁「🧹 整理」多選）：一次收整包 uuids，伺服器單次讀寫處理完。
  //   body { action: "sell"|"discard"|"dismantle", uuids: [uuid, ...] }（上限 2000 件/次）
  // 守門規則同單件端點；單件不合規只略過並回報原因，不中斷整批。
  router.post("/api/me/inventory/batch", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const body = req.body || {};
      const action = String(body.action || "").trim();
      const uuids = Array.isArray(body.uuids)
        ? body.uuids.map((u) => String(u || "").trim()).filter(Boolean).slice(0, MAX_BATCH_UUIDS)
        : [];
      const r = await serviceContext.shopService.processInventoryBatch(discordId, action, uuids);
      const verb = action === "sell" ? "出售" : action === "discard" ? "丟棄" : "分解";
      return res.json(ok(r, `批次${verb}完成：成功 ${r.okCount} 件${r.failCount ? `、略過 ${r.failCount} 件` : ""}`));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/me/inventory/dismantle", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const body = req.body || {};
      const uuids = Array.isArray(body.uuids)
        ? body.uuids.map((u) => String(u || "").trim()).filter(Boolean)
        : null;
      const uuid = String(body.uuid || "").trim();

      // 多件逐一分解：每件獨立 50% 判定，單件失敗（找不到/怪物卡）不影響其他
      if (uuids && uuids.length > 0) {
        const items = [];
        const gemTotals = {}; // tier → count
        const stoneTotals = {}; // element → count（屬性石，獨立於強化寶石判定）
        for (const u of uuids.slice(0, MAX_UUIDS_PER_REQUEST)) {
          try {
            const r = await serviceContext.shopService.discardItem(discordId, u, { mode: "dismantle" });
            if (r.gems) gemTotals[r.gems.tier] = (gemTotals[r.gems.tier] || 0) + r.gems.count;
            if (r.elementStones) {
              const { element, count } = r.elementStones;
              stoneTotals[element] = (stoneTotals[element] || 0) + count;
            }
            items.push({ uuid: u, ok: true, itemName: r.itemName, dismantled: r.dismantled, gems: r.gems, elementStones: r.elementStones });
          } catch (e) {
            items.push({ uuid: u, ok: false, error: e?.message || "分解失敗" });
          }
        }
        const okCount = items.filter((i) => i.ok).length;
        const gemText = Object.entries(gemTotals).map(([tier, count]) => `${count} 顆 ${tier} 階`).join("、");
        const stoneText = Object.entries(stoneTotals)
          .map(([el, count]) => `${count} 顆 ${getElementLabel(el) || el}屬性石`).join("、");
        return res.json(ok(
          { mode: "uuids", requested: uuids.length, dismantledCount: okCount, items, gemTotals, stoneTotals },
          okCount > 0
            ? `已分解 ${okCount} 件${gemText ? `，共獲得 ${gemText}強化寶石` : "，未分解出寶石"}${stoneText ? `；另獲得 ${stoneText}` : ""}`
            : "沒有任何物品被分解"
        ));
      }

      if (!uuid) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "請提供 uuid（單件/批量）或 uuids（多件）"));
      }

      // 同款未強化批量分解（同 DC「🔨 批量分解 (共N)」按鈕；qty 0/缺省＝全部）
      if (body.bulk === true || body.bulk === "true") {
        const qty = Math.max(0, Math.floor(Number(body.qty) || 0));
        const r = await serviceContext.shopService.discardItemBulk(discordId, uuid, qty);
        const message = r.gems
          ? `批量分解 ${r.itemName} ×${r.dismantledCount} → 成功 ${r.successCount} 件，共獲得 ${r.gems.count} 顆 ${r.gems.tier} 階強化寶石`
          : `批量分解 ${r.itemName} ×${r.dismantledCount} 完成，這次都沒分解出寶石（裝備已消失）`;
        const bulkStoneText = r.elementStones
          ? Object.entries(r.elementStones).map(([el, n]) => `${n} 顆 ${getElementLabel(el) || el}屬性石`).join("、")
          : "";
        return res.json(ok({ mode: "bulk", ...r }, bulkStoneText ? `${message}；另獲得 ${bulkStoneText}` : message));
      }

      // 單件分解（同 DC「🔨 分解」按鈕）
      const r = await serviceContext.shopService.discardItem(discordId, uuid, { mode: "dismantle" });
      const message = r.gems
        ? `分解 ${r.itemName} 成功，獲得 ${r.gems.count} 顆 ${r.gems.tier} 階強化寶石`
        : (r.dismantled
          ? `分解 ${r.itemName} 失敗，未取得任何寶石（裝備已消失）`
          : `已丟棄 ${r.itemName}`);
      const singleStoneText = r.elementStones
        ? `${r.elementStones.count} 顆 ${getElementLabel(r.elementStones.element) || r.elementStones.element}屬性石`
        : "";
      return res.json(ok({ mode: "single", ...r }, singleStoneText ? `${message}；另獲得 ${singleStoneText}` : message));
    } catch (err) {
      next(err);
    }
  });

  // 破壞拆除一顆指定屬性石：成敗都扣金幣，成功才永久累計該件裝備的拆除次數。
  router.post("/api/me/enhance/:itemUuid/element/remove", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const element = String(req.body?.element || "").trim();
      const result = await serviceContext.enhanceService.removeElementSocket(
        discordId,
        req.params.itemUuid,
        element
      );
      res.json(ok(result, result.message));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerForgeRoutes };
