"use strict";
const { isDisabledAnchor, assertAnchorAvailable } = require("./anchorFeature");
const { isDisabledSEquipment, S_DISABLED_MESSAGE } = require("./sEquipmentFeature");
function isUnavailableEquipment(item, slot = null) {
  return isDisabledAnchor(item) || Boolean(isDisabledSEquipment(item, slot));
}
function assertEquipmentAvailable(item, slot = null) {
  assertAnchorAvailable(item);
  if (isDisabledSEquipment(item, slot)) {
    const { AppError } = require("./errors");
    throw new AppError("FEATURE_DISABLED", S_DISABLED_MESSAGE, 403);
  }
}
module.exports = { isUnavailableEquipment, assertEquipmentAvailable };
