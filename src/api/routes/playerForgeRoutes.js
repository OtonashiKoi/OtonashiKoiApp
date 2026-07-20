"use strict";
/**
 * 玩家裝備分解 API（網頁 App 用，對應 Discord 背包「🔨 分解／批量分解」）：
 *   POST /api/me/inventory/dismantle
 *     body { uuid }                     單件分解（shopService.discardItem）
 *     body { uuid, bulk: true, qty? }   同款未強化批量分解（shopService.discardItemBulk，同 DC 批量分解按鈕）
 *     body { uuids: [uuid, ...] }       多件逐一分解（每件獨立判定，單件失敗不中斷其他）
 *
 * 產物規則完全由 shopService.DISMANTLE_YIELD 決定（50% 機率產出強化寶石；
 * S→1 顆 S 階、A→2 顆 B 階、B→2 顆 C 階、C→2 顆 D 階、D→1 顆 D 階；怪物卡不可分解）。
 */

const { Router } = require("express");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");

const MAX_UUIDS_PER_REQUEST = 50;

function createPlayerForgeRoutes(serviceContext) {
  const router = Router();

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
        for (const u of uuids.slice(0, MAX_UUIDS_PER_REQUEST)) {
          try {
            const r = await serviceContext.shopService.discardItem(discordId, u, { mode: "dismantle" });
            if (r.gems) gemTotals[r.gems.tier] = (gemTotals[r.gems.tier] || 0) + r.gems.count;
            items.push({ uuid: u, ok: true, itemName: r.itemName, dismantled: r.dismantled, gems: r.gems });
          } catch (e) {
            items.push({ uuid: u, ok: false, error: e?.message || "分解失敗" });
          }
        }
        const okCount = items.filter((i) => i.ok).length;
        const gemText = Object.entries(gemTotals).map(([tier, count]) => `${count} 顆 ${tier} 階`).join("、");
        return res.json(ok(
          { mode: "uuids", requested: uuids.length, dismantledCount: okCount, items, gemTotals },
          okCount > 0
            ? `已分解 ${okCount} 件${gemText ? `，共獲得 ${gemText}強化寶石` : "，未分解出寶石"}`
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
        return res.json(ok({ mode: "bulk", ...r }, message));
      }

      // 單件分解（同 DC「🔨 分解」按鈕）
      const r = await serviceContext.shopService.discardItem(discordId, uuid, { mode: "dismantle" });
      const message = r.gems
        ? `分解 ${r.itemName} 成功，獲得 ${r.gems.count} 顆 ${r.gems.tier} 階強化寶石`
        : (r.dismantled
          ? `分解 ${r.itemName} 失敗，未取得任何寶石（裝備已消失）`
          : `已丟棄 ${r.itemName}`);
      return res.json(ok({ mode: "single", ...r }, message));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerForgeRoutes };
