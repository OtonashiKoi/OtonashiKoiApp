"use strict";

const DEFAULT_PART_LABELS = Object.freeze({
  head: "頭部",
  body: "軀幹",
  wings: "龍翼",
  legs: "下盤",
  upper_body: "上軀幹",
  lower_body: "下軀幹",
  tail: "尾巴",
});

const TURTLE_PART_LABELS = Object.freeze({
  head: "龜首",
  body: "島背",
  wings: "左鰭",
  legs: "右鰭",
});

function getWorldBossPartLabel(zoneKey, partKey) {
  const key = String(partKey || "");
  if (zoneKey === "event_boss") return TURTLE_PART_LABELS[key] || "島背";
  return DEFAULT_PART_LABELS[key] || key || "部位";
}

module.exports = { DEFAULT_PART_LABELS, TURTLE_PART_LABELS, getWorldBossPartLabel };
