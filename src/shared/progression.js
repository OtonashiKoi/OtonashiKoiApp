const MAX_LEVEL = 50;

// 目標節奏（V0.4 重調）：1→50 約需 48 小時手動戰鬥時間（含多人 Buff 空間預留）。
// 三段式，且「越後面越慢」，段界為溫和升階（約 2.2×，是難度上台階不是懸崖）：
//   ≤12   前期最快：新手一路衝到 12（總 ~0.4h），快速感受成長。
//   13-25 仍偏快：陽光帶推進（總 ~3h），比後段快很多。
//   26-50 整個慢下來：古城 + 三條 A 路線是主要耕作期（古城 ~20h / A 區 ~24h）。
// 曲線由「錨點反解 power 函數」而來，錨點即設計意圖；改節奏改錨點即可。
function solvePower(x1, v1, x2, v2) {
  const p = Math.log(v2 / v1) / Math.log(x2 / x1);
  return { p, A: v1 / Math.pow(x1, p) };
}
// 錨點：(等級, 該級→下一級所需經驗)
const SEG1 = solvePower(1, 460, 12, 15000);        // ≤12
const SEG2 = solvePower(13, 34000, 25, 720000);    // 13-25
const SEG3 = solvePower(26, 1600000, 49, 18000000); // 26-50

function expToNextLevel(level) {
  if (level <= 12) {
    return Math.round(SEG1.A * Math.pow(level, SEG1.p));
  }
  if (level <= 25) {
    return Math.round(SEG2.A * Math.pow(level, SEG2.p));
  }
  return Math.round(SEG3.A * Math.pow(level, SEG3.p));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};
