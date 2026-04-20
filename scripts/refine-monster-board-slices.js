const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const BOARD_IMAGE =
  "C:/Users/appsk/.codex/generated_images/019da39e-4813-7411-976f-08559ffdaef3/ig_0f498eef86c409860169e4f4d094188191a74c339f945a4e29.png";
const GENERATED_ROOT =
  "C:/Users/appsk/Documents/Github/equipmentGameGodot/assets/monster/generated";
const ALIAS_PATH =
  "C:/Users/appsk/Documents/Github/equipmentGAME/docs/MONSTER_FOLDER_ALIAS_V1.json";

const ACTIONS = ["idle", "attack", "hit", "death", "skill"];

// Coarse boxes (manually estimated), refined automatically by foreground detection.
const SLOTS = [
  { id: "c39bdddd-a33d-4e34-8019-d17020a8083b", x: 60, y: 170, w: 250, h: 300 }, // 小史(小)
  { id: "f00fd7b1-9f57-4532-9901-f4d4d74f132d", x: 330, y: 165, w: 275, h: 300 }, // 哥布
  { id: "a8ef443e-3a0d-4ccb-9290-d6394edaa59f", x: 610, y: 205, w: 270, h: 250 }, // 小狼
  { id: "2d226eea-934a-4787-8ff7-9f19d12ac590", x: 850, y: 130, w: 330, h: 350 }, // 石頭
  { id: "321a08e9-8fed-4a80-9526-b1f977fd9103", x: 1130, y: 90, w: 350, h: 390 }, // 大史(B)
  { id: "657afc88-c6db-4851-8c4c-50f225b18624", x: 25, y: 560, w: 350, h: 320 }, // 甲蟹
  { id: "13f56b92-709e-42ff-87d2-e8f129ed9207", x: 360, y: 610, w: 300, h: 260 }, // 牙牙狼
  { id: "b9c226a8-ea33-41de-9c9b-be24824a9fb1", x: 630, y: 500, w: 340, h: 390 }, // 巨巨
  { id: "f4bed595-74f8-493b-8551-9158f4b5381d", x: 930, y: 540, w: 280, h: 350 }, // 黑暗弓手
  { id: "517f9a27-f6f7-4251-8cf8-2140f02222c0", x: 1140, y: 470, w: 360, h: 430 } // 米拉桑(B)
];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function channelStats(samples) {
  const n = samples.length || 1;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(variance) };
}

function estimateBackground(raw, width, height, channels) {
  const r = [];
  const g = [];
  const b = [];
  const border = 8;
  const stride = channels;

  function pushPixel(ix, iy) {
    const idx = (iy * width + ix) * stride;
    r.push(raw[idx]);
    g.push(raw[idx + 1]);
    b.push(raw[idx + 2]);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < border || y < border || x >= width - border || y >= height - border) {
        pushPixel(x, y);
      }
    }
  }

  const rs = channelStats(r);
  const gs = channelStats(g);
  const bs = channelStats(b);
  return {
    mean: [rs.mean, gs.mean, bs.mean],
    sd: [rs.sd, gs.sd, bs.sd]
  };
}

function buildForegroundMask(raw, width, height, channels, bg) {
  const [mr, mg, mb] = bg.mean;
  const [sr, sg, sb] = bg.sd;
  const avgSd = (sr + sg + sb) / 3;
  const thrColor = Math.max(20, avgSd * 1.8 + 8);
  const thrHard = Math.max(34, thrColor * 1.35);
  const thrSat = 14;
  const stride = channels;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * stride;
      const pr = raw[idx];
      const pg = raw[idx + 1];
      const pb = raw[idx + 2];
      const maxC = Math.max(pr, pg, pb);
      const minC = Math.min(pr, pg, pb);
      const sat = maxC - minC;
      const d = Math.sqrt((pr - mr) ** 2 + (pg - mg) ** 2 + (pb - mb) ** 2);

      // Bottom floor band can have strong gradients; make the condition stricter there.
      const inFloorBand = y >= Math.floor(height * 0.9);
      const fg = inFloorBand
        ? d > thrHard + 4
        : (d > thrColor && sat > thrSat) || d > thrHard;

      mask[y * width + x] = fg ? 1 : 0;
    }
  }

  return { mask, thrColor };
}

function dilate(mask, width, height, iterations = 1) {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (src[ny * width + nx]) {
              on = 1;
              break;
            }
          }
        }
        out[y * width + x] = on;
      }
    }
    src = out;
  }
  return src;
}

function erode(mask, width, height, iterations = 1) {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let on = 1;
        for (let dy = -1; dy <= 1 && on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !src[ny * width + nx]) {
              on = 0;
              break;
            }
          }
        }
        out[y * width + x] = on;
      }
    }
    src = out;
  }
  return src;
}

function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(width * height);
  const comps = [];
  const queue = new Int32Array(width * height);

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    visited[i] = 1;

    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    while (head < tail) {
      const cur = queue[head++];
      const y = Math.floor(cur / width);
      const x = cur - y * width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // 4-neighborhood
      const n1 = cur - 1;
      const n2 = cur + 1;
      const n3 = cur - width;
      const n4 = cur + width;

      if (x > 0 && mask[n1] && !visited[n1]) {
        visited[n1] = 1;
        queue[tail++] = n1;
      }
      if (x < width - 1 && mask[n2] && !visited[n2]) {
        visited[n2] = 1;
        queue[tail++] = n2;
      }
      if (y > 0 && mask[n3] && !visited[n3]) {
        visited[n3] = 1;
        queue[tail++] = n3;
      }
      if (y < height - 1 && mask[n4] && !visited[n4]) {
        visited[n4] = 1;
        queue[tail++] = n4;
      }
    }

    comps.push({
      area,
      minX,
      minY,
      maxX,
      maxY,
      cx: sumX / area,
      cy: sumY / area
    });
  }

  return comps;
}

function bboxFromMask(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

function foregroundBox(raw, width, height, channels) {
  const bg = estimateBackground(raw, width, height, channels);
  const fg = buildForegroundMask(raw, width, height, channels, bg);

  // Morphological close/open: bridge sprite edges, remove tiny noise.
  const closed = erode(dilate(fg.mask, width, height, 2), width, height, 1);
  const opened = dilate(erode(closed, width, height, 1), width, height, 1);
  const comps = connectedComponents(opened, width, height);

  const minArea = Math.max(26, Math.floor(width * height * 0.002));
  const tx = width / 2;
  const ty = height * 0.55;
  let best = null;
  let bestScore = -Infinity;

  for (const c of comps) {
    if (c.area < minArea) continue;
    const dx = (c.cx - tx) / (width * 0.5);
    const dy = (c.cy - ty) / (height * 0.65);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const centerWeight = 1 - Math.min(1, dist) * 0.55;
    const score = c.area * centerWeight;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  let minX;
  let minY;
  let maxX;
  let maxY;
  let detected = true;

  // If best component is too small, merge several foreground components to recover fragmented dark sprites.
  if (best && best.area < width * height * 0.12) {
    let uMinX = width;
    let uMinY = height;
    let uMaxX = -1;
    let uMaxY = -1;
    let merged = 0;
    for (const c of comps) {
      if (c.area < minArea) continue;
      if (c.cy > height * 0.96) continue;
      uMinX = Math.min(uMinX, c.minX);
      uMinY = Math.min(uMinY, c.minY);
      uMaxX = Math.max(uMaxX, c.maxX);
      uMaxY = Math.max(uMaxY, c.maxY);
      merged += 1;
    }
    if (merged > 0 && uMaxX >= uMinX && uMaxY >= uMinY) {
      best = { minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY };
    }
  }

  if (best) {
    minX = best.minX;
    minY = best.minY;
    maxX = best.maxX;
    maxY = best.maxY;
  } else {
    const fb = bboxFromMask(opened, width, height);
    if (!fb) {
      return { left: 0, top: 0, width, height, detected: false, threshold: fg.thrColor };
    }
    minX = fb.minX;
    minY = fb.minY;
    maxX = fb.maxX;
    maxY = fb.maxY;
    detected = false;
  }

  // keep a modest padding around sprite.
  const padX = Math.max(8, Math.floor(width * 0.03));
  const padY = Math.max(8, Math.floor(height * 0.03));
  const left = clamp(minX - padX, 0, width - 1);
  const top = clamp(minY - padY, 0, height - 1);
  const right = clamp(maxX + padX, 0, width - 1);
  const bottom = clamp(maxY + padY, 0, height - 1);

  // Prevent pathological tiny crops.
  const minCropW = Math.max(64, Math.floor(width * 0.4));
  const minCropH = Math.max(64, Math.floor(height * 0.4));
  let outLeft = left;
  let outTop = top;
  let outRight = right;
  let outBottom = bottom;
  if (outRight - outLeft + 1 < minCropW) {
    const cx = Math.floor((outLeft + outRight) / 2);
    outLeft = clamp(cx - Math.floor(minCropW / 2), 0, width - 1);
    outRight = clamp(outLeft + minCropW - 1, 0, width - 1);
    outLeft = clamp(outRight - minCropW + 1, 0, width - 1);
  }
  if (outBottom - outTop + 1 < minCropH) {
    const cy = Math.floor((outTop + outBottom) / 2);
    outTop = clamp(cy - Math.floor(minCropH / 2), 0, height - 1);
    outBottom = clamp(outTop + minCropH - 1, 0, height - 1);
    outTop = clamp(outBottom - minCropH + 1, 0, height - 1);
  }

  return {
    left: outLeft,
    top: outTop,
    width: outRight - outLeft + 1,
    height: outBottom - outTop + 1,
    detected,
    threshold: fg.thrColor
  };
}

async function run() {
  const aliasMap = JSON.parse(fs.readFileSync(ALIAS_PATH, "utf8")).idToFolder || {};
  const board = sharp(BOARD_IMAGE);
  const boardMeta = await board.metadata();
  const bw = boardMeta.width || 0;
  const bh = boardMeta.height || 0;
  if (!bw || !bh) throw new Error("Invalid board image metadata");

  const report = [];

  for (const slot of SLOTS) {
    const coarse = {
      left: clamp(slot.x, 0, bw - 1),
      top: clamp(slot.y, 0, bh - 1),
      width: clamp(slot.w, 1, bw),
      height: clamp(slot.h, 1, bh)
    };
    if (coarse.left + coarse.width > bw) coarse.width = bw - coarse.left;
    if (coarse.top + coarse.height > bh) coarse.height = bh - coarse.top;

    const coarseImg = board.clone().extract(coarse);
    const { data, info } = await coarseImg.raw().toBuffer({ resolveWithObject: true });
    const refined = foregroundBox(data, info.width, info.height, info.channels || 4);

    const finalCrop = {
      left: coarse.left + refined.left,
      top: coarse.top + refined.top,
      width: refined.width,
      height: refined.height
    };

    const outBuf = await board.clone().extract(finalCrop).png().toBuffer();
    const folder = aliasMap[slot.id] || slot.id;

    for (const action of ACTIONS) {
      const dir = path.join(GENERATED_ROOT, folder, action);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${slot.id}_${action}_01.png`), outBuf);
      const meta = {
        sourceBoard: path.basename(BOARD_IMAGE),
        coarse,
        refinedRelative: refined,
        finalCrop,
        action,
        kind: "lineup_v1_refined_crop",
        generatedAt: new Date().toISOString()
      };
      fs.writeFileSync(path.join(dir, `${slot.id}_${action}_01.json`), JSON.stringify(meta, null, 2));
    }

    report.push({
      id: slot.id,
      folder,
      coarse,
      finalCrop,
      refinedDetected: refined.detected,
      threshold: refined.threshold
    });
  }

  const reportPath = path.join(GENERATED_ROOT, "_lineup_v1_refined_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Refined slices written. Report: ${reportPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
