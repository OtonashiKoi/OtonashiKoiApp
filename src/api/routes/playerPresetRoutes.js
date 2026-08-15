"use strict";

const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const {
  EQUIP_PRESET_KEYS,
  resolveMembershipEntitlements,
  requiredTierForPreset,
  membershipTierLabel,
  presetLockReason,
} = require("../../shared/membershipEntitlements");

async function resolvePresetMembership(serviceContext, discordId, progress = null) {
  let bindings = [];
  try {
    bindings = await serviceContext.streamAccountBindingRepository
      .listByDiscordId(discordId)
      .catch(() => []);
  } catch (_) {
    bindings = [];
  }
  const playerProgress = progress
    || await serviceContext.progressRepository.findByPlayerId(discordId).catch(() => null);
  return resolveMembershipEntitlements(playerProgress, bindings);
}

function canUsePreset(membership, preset) {
  return EQUIP_PRESET_KEYS.indexOf(preset) < membership.maxPresetSlots;
}

function summarizePresetSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return { count: 0, names: [] };
  const entries = Object.values(snapshot).filter((value) => value && (value.itemId || value.uuid));
  return {
    count: entries.length,
    names: entries.map((value) => value.itemName).filter(Boolean).slice(0, 6),
  };
}

function registerPlayerPresetRoutes(router, serviceContext) {
  // 每人物各自保存 A～G；非會員 1 套、鯉民 3 套、鯉長 5 套、鯉市長以上 7 套。
  router.get("/api/me/presets", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const membership = await resolvePresetMembership(serviceContext, discordId, progress);
      const activePreset = progress?.activePreset || "A";
      const equipPresets = progress?.equipPresets || {};
      const presetNames = progress?.equipPresetNames || {};
      const presets = EQUIP_PRESET_KEYS.map((key) => {
        const snapshot = key === activePreset ? progress?.equipment : equipPresets[key];
        const summary = summarizePresetSnapshot(snapshot);
        const requiredTier = requiredTierForPreset(key);
        const locked = !canUsePreset(membership, key);
        return {
          key,
          name: presetNames[key] || null,
          active: key === activePreset,
          locked,
          requiredTier,
          requiredTierLabel: requiredTier ? membershipTierLabel(requiredTier) : null,
          lockReason: locked ? presetLockReason(key) : null,
          equipped: summary.count > 0,
          itemCount: summary.count,
          itemNames: summary.names,
        };
      });
      res.json(ok({
        activePreset,
        presets,
        isMember: membership.isMember,
        membershipTier: membership.tier,
        membershipLabel: membership.label,
        maxPresetSlots: membership.maxPresetSlots,
        maxCharacterSlots: membership.maxCharacterSlots,
      }));
    } catch (error) {
      next(error);
    }
  });

  for (const action of ["switch", "save"]) {
    router.post(`/api/me/presets/${action}`, requireAuth, async (req, res, next) => {
      try {
        const { discordId } = req.playerRecord;
        const preset = String(req.body?.preset || "").toUpperCase();
        if (!EQUIP_PRESET_KEYS.includes(preset)) {
          return res.status(400).json(fail("INVALID_ARGUMENT", "無效分頁，請選擇 A / B / C / D / E / F / G"));
        }
        const membership = await resolvePresetMembership(serviceContext, discordId);
        if (!canUsePreset(membership, preset)) {
          return res.status(403).json(fail("MEMBERSHIP_TIER_REQUIRED", presetLockReason(preset)));
        }
        const result = action === "switch"
          ? await serviceContext.shopService.switchEquipPreset(discordId, preset)
          : await serviceContext.shopService.saveEquipPreset(discordId, preset);
        return res.json(ok(action === "switch"
          ? { activePreset: result.activePreset, equipment: result.equipment }
          : { preset: result.preset }));
      } catch (error) {
        next(error);
      }
    });
  }

  router.post("/api/me/presets/rename", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const preset = String(req.body?.preset || "").toUpperCase();
      const name = String(req.body?.name || "").trim().slice(0, 12);
      if (!EQUIP_PRESET_KEYS.includes(preset)) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "無效分頁，請選擇 A / B / C / D / E / F / G"));
      }
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (!progress) return res.status(404).json(fail("NOT_FOUND", "找不到角色資料"));
      const membership = await resolvePresetMembership(serviceContext, discordId, progress);
      if (!canUsePreset(membership, preset)) {
        return res.status(403).json(fail("MEMBERSHIP_TIER_REQUIRED", presetLockReason(preset)));
      }
      if (!membership.isMember) {
        return res.status(403).json(fail("NOT_MEMBER", "自訂方案名稱限會員使用"));
      }
      progress.equipPresetNames = { ...(progress.equipPresetNames || {}), [preset]: name || null };
      await serviceContext.progressRepository.updateFields(progress.playerId, { equipPresetNames: progress.equipPresetNames });
      return res.json(ok({ preset, name: name || null }));
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerPlayerPresetRoutes,
  resolvePresetMembership,
  canUsePreset,
  summarizePresetSnapshot,
};
