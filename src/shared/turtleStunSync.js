"use strict";

const turtleTide = require("./turtleTide");
const dwarfStunGauge = require("./dwarfStunGauge");

/** 用獨立原子暈眩文件校正可能被舊 monsterState 蓋回的龜王詠唱。 */
async function reconcileTurtleCastFromStunGauge(state, zoneKey, now = Date.now()) {
  const stunState = await dwarfStunGauge
    .read(dwarfStunGauge.gaugeKeyForZone(zoneKey), zoneKey, now)
    .catch(() => null);
  const repaired = turtleTide.reconcileCastAfterStun(
    state,
    `${stunState?.lastTriggerBy || "矮人戰士長"}（巨神震擊）`,
    stunState?.stunnedUntil,
    Number(stunState?.stunnedUntil || 0) - dwarfStunGauge.STUN_WINDOW_MS,
    now
  );
  return { repaired, stunState };
}

module.exports = { reconcileTurtleCastFromStunGauge };
