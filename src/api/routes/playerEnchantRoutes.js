"use strict";
/**
 * 附魔重骰 API（網頁 App + 給 DC 共用邏輯）：
 *   POST /api/me/enchant/reroll  body { uuid }  對一件裝備(背包或已裝備)重骰整組附魔，消耗 1 個「附魔重骰藥水」。
 */
const { Router } = require("express");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const { rerollEntryEnchant } = require("../../services/enchant/enchantService");

const POTION_ID = "enchant_reroll_potion";

function countPotions(inv) {
  return inv.filter((e) => e && e.itemId === POTION_ID).reduce((s, e) => s + (Number(e.stackCount) || 1), 0);
}

function createPlayerEnchantRoutes(serviceContext) {
  const router = Router();
  const repo = serviceContext.progressRepository;

  router.post("/api/me/enchant/reroll", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const uuid = String(req.body?.uuid || "").trim();
      if (!uuid) return res.status(400).json(fail("INVALID_ARGUMENT", "請提供要重骰的裝備 uuid"));

      const progress = await repo.findByPlayerId(discordId);
      if (!progress) return res.status(404).json(fail("PLAYER_NOT_FOUND", "找不到玩家進度"));
      const inv = Array.isArray(progress.inventory) ? progress.inventory : [];
      const equip = (progress.equipment && typeof progress.equipment === "object") ? progress.equipment : {};

      // 找藥水
      const potionIdx = inv.findIndex((e) => e && e.itemId === POTION_ID);
      if (potionIdx < 0) return res.status(403).json(fail("NO_POTION", "你沒有「附魔重骰藥水」"));

      // 找目標裝備（背包或已裝備）
      let target = inv.find((e) => e && e.uuid === uuid);
      if (!target) {
        for (const it of Object.values(equip)) { if (it && it.uuid === uuid) { target = it; break; } }
      }
      if (!target) return res.status(404).json(fail("ITEM_NOT_FOUND", "找不到這件裝備（背包或裝備欄）"));
      if (target.itemType !== "equipment") return res.status(400).json(fail("NOT_EQUIPMENT", "只能對裝備使用重骰藥水"));

      const r = rerollEntryEnchant(target);
      if (!r.ok) {
        const msg = r.reason === "story-item" ? "主線劇情裝備為固定數值，無法附魔" : r.reason === "no-tier" ? "這件裝備沒有階級，無法附魔" : "這件裝備無法重骰附魔";
        return res.status(400).json(fail("REROLL_FAILED", msg));
      }

      // 消耗 1 個藥水
      const p = inv[potionIdx];
      if ((Number(p.stackCount) || 1) > 1) p.stackCount = (Number(p.stackCount) || 1) - 1;
      else inv.splice(potionIdx, 1);

      progress.inventory = inv;
      progress.equipment = equip;
      progress.updatedAt = new Date().toISOString();

      await repo.save(progress);

      const fmt = (list) => (list || []).map((e) => `${e.label} +${e.value}${e.unit || ""}`);
      return res.json(ok({
        itemName: target.itemName,
        tier: target.tier,
        before: fmt(r.before),
        after: fmt(r.after),
        potionsLeft: countPotions(inv)
      }, `已重骰 ${target.itemName} 的附魔！`));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerEnchantRoutes };
