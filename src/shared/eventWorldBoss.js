"use strict";
// 所有活動世界王共用的非致死血線；不能治療低血量或復活。
function crushHp(currentHp, maxHp) {
  const hp = Math.max(0, Number(currentHp) || 0);
  return hp > 0 ? Math.min(hp, Math.max(1, Math.ceil((Number(maxHp) || 0) * .01))) : 0;
}
module.exports = { crushHp };
