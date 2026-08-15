"use strict";

const ANCHOR_ACQUISITION_HINTS = Object.freeze({
  "s-legend-resonance": "推進第一章主線劇情即可取得。",
  "s-legend-burst": "打倒大史王取得寶箱；開啟寶箱時有 3% 機率取得。",
  "s-legend-linger": "打倒大史王取得寶箱；寶箱未開出先機之刃時，再以 3% 機率判定（實際約 2.9%）。",
  "s-legend-dice": "命運轉盤每輪只要有下注，不論輸贏皆有 3% 機率取得；每位玩家限取得一次。",
  "s-legend-bond": "集齊治療師、軍師、詩人與結界師徽章後，使用任一輔助職業出戰累積 1,500 場。",
  "s-legend-endure": "累積實際承受 50,000 傷害後顯示試煉；總承傷達 100,000 完成。",
  "s-legend-thirst": "累積實際吸血 50,000 後顯示試煉；總有效吸血達 100,000 完成。滿血溢出不計。",
  "s-legend-saint": "累積 50,000 點實際非吸血治療完成。滿血溢補、治療轉傷害與吸血不計。",
  "s-legend-timelord": "連續簽到 3 天後顯示試煉；連續簽到滿 7 天完成。",
});

function getAnchorAcquisitionHint(itemId) {
  return ANCHOR_ACQUISITION_HINTS[String(itemId || "")] || "探索劇情、首領寶箱或隱藏試煉來尋找這件錨點。";
}

module.exports = { ANCHOR_ACQUISITION_HINTS, getAnchorAcquisitionHint };
