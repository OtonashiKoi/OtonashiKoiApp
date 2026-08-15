"use strict";

const CHARACTER_SLOTS = Object.freeze([1, 2, 3]);
const EQUIP_PRESET_KEYS = Object.freeze(["A", "B", "C", "D", "E", "F", "G"]);
const TIER_ORDER = Object.freeze(["E", "D", "C", "B", "A", "S", "SS"]);
const TIER_LABELS = Object.freeze({
  C: "鯉民",
  B: "鯉長",
  A: "鯉市長",
  S: "S級",
  SS: "SS級",
});
const TIER_ALIASES = Object.freeze({
  鯉民: "C",
  鯉長: "B",
  鯉市長: "A",
  鯉事長: "A",
});

function normalizeMembershipTier(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (TIER_ORDER.includes(upper)) return upper;
  return TIER_ALIASES[raw] || null;
}

function higherMembershipTier(current, candidate) {
  const a = normalizeMembershipTier(current);
  const b = normalizeMembershipTier(candidate);
  if (!a) return b;
  if (!b) return a;
  return TIER_ORDER.indexOf(b) > TIER_ORDER.indexOf(a) ? b : a;
}

function resolveMembershipTier(progress, bindings = []) {
  if (progress?.isTestAccount) return "SS";
  let tier = normalizeMembershipTier(progress?.playerTier);
  for (const binding of bindings || []) {
    tier = higherMembershipTier(tier, binding?.playerTierAtLink);
    if (binding?.isMember === true || binding?.linkedSupportAtLink === true) {
      tier = higherMembershipTier(tier, "C");
    }
  }
  return tier;
}

function tierAtLeast(actualTier, requiredTier) {
  const actual = normalizeMembershipTier(actualTier);
  const required = normalizeMembershipTier(requiredTier);
  if (!actual || !required) return !required;
  return TIER_ORDER.indexOf(actual) >= TIER_ORDER.indexOf(required);
}

function membershipEntitlements(tierValue) {
  const tier = normalizeMembershipTier(tierValue);
  if (tierAtLeast(tier, "A")) {
    return { tier, label: TIER_LABELS[tier] || tier, isMember: true, maxCharacterSlots: 3, maxPresetSlots: 7 };
  }
  if (tierAtLeast(tier, "B")) {
    return { tier, label: TIER_LABELS[tier] || tier, isMember: true, maxCharacterSlots: 3, maxPresetSlots: 5 };
  }
  if (tierAtLeast(tier, "C")) {
    return { tier, label: TIER_LABELS[tier] || tier, isMember: true, maxCharacterSlots: 3, maxPresetSlots: 3 };
  }
  return { tier, label: "非會員", isMember: false, maxCharacterSlots: 1, maxPresetSlots: 1 };
}

function resolveMembershipEntitlements(progress, bindings = []) {
  return membershipEntitlements(resolveMembershipTier(progress, bindings));
}

function requiredTierForCharacterSlot(slotValue) {
  const slot = Number(slotValue);
  if (slot <= 1) return null;
  if (slot <= 3) return "C";
  return "A";
}

function requiredTierForPreset(presetValue) {
  const preset = String(presetValue || "").trim().toUpperCase();
  if (preset === "A") return null;
  if (preset === "B" || preset === "C") return "C";
  if (preset === "D" || preset === "E") return "B";
  return "A";
}

function membershipTierLabel(tier) {
  const normalized = normalizeMembershipTier(tier);
  return normalized ? (TIER_LABELS[normalized] || normalized) : "非會員";
}

function characterSlotLockReason(slot) {
  const required = requiredTierForCharacterSlot(slot);
  return required ? `人物欄位 ${slot} 需提升至${membershipTierLabel(required)}會員才可使用。` : null;
}

function presetLockReason(preset) {
  const required = requiredTierForPreset(preset);
  return required ? `裝備方案 ${preset} 需提升至${membershipTierLabel(required)}會員才可使用。` : null;
}

module.exports = {
  CHARACTER_SLOTS,
  EQUIP_PRESET_KEYS,
  TIER_ORDER,
  TIER_LABELS,
  normalizeMembershipTier,
  higherMembershipTier,
  resolveMembershipTier,
  resolveMembershipEntitlements,
  membershipEntitlements,
  membershipTierLabel,
  tierAtLeast,
  requiredTierForCharacterSlot,
  requiredTierForPreset,
  characterSlotLockReason,
  presetLockReason,
};
