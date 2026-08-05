const MAX_LEVEL = 50;

// 目標節奏（V0.5 重調）：1→50 約 45 小時實戰時間 ＝ 每天 6 小時、7.5 天滿等。
//
// ⚠️ 基準是「單人」——一個人自己打就要能 7.5 天滿等（單人 ×1、裝備強化 +3）。
//    組隊倍率是玩家自己組出來的加速，屬於額外報酬，不列入曲線基準。
//
// 三段式，越後面越慢，段界連續（不能有「升上去反而變快」的斷崖）：
//   1-10  新手期（0.75h）：一路衝，馬上感受成長。
//   11-35 推進期（10.5h）：陽光草原→古城，輕鬆推進。
//   36-50 耕作期（33.75h）：古城深處，全程 75% 的時間都在這裡。
// 曲線由「錨點反解 power 函數」而來，錨點即設計意圖；改節奏改錨點即可。
//
// 錨點怎麼來的（要改節奏請照這個流程重跑，不要手調數字）：
//   node scripts/measure-exp-rate.js 1 3 16   # 量每級實際經驗/小時（單人基準）
//   node scripts/tune-exp-curve.js            # 反解錨點並驗收分段時數
function solvePower(x1, v1, x2, v2) {
  const p = Math.log(v2 / v1) / Math.log(x2 / x1);
  return { p, A: v1 / Math.pow(x1, p) };
}
// 錨點：(等級, 該級→下一級所需經驗)
const SEG1 = solvePower(1, 500, 10, 5278);          // 1-10   新手期
const SEG2 = solvePower(11, 5542, 35, 407371);      // 11-35  推進期
const SEG3 = solvePower(36, 427740, 49, 1300089);   // 36-50  耕作期

function expToNextLevel(level) {
  if (level <= 10) {
    return Math.round(SEG1.A * Math.pow(level, SEG1.p));
  }
  if (level <= 35) {
    return Math.round(SEG2.A * Math.pow(level, SEG2.p));
  }
  return Math.round(SEG3.A * Math.pow(level, SEG3.p));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};
