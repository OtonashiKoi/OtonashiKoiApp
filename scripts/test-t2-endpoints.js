"use strict";
/**
 * 二轉職業的**真實 HTTP 端點**回歸測試。
 *
 * 為什麼需要這支：先前的測試都直接呼叫 runCombatLoop 與共用模組，
 * 完全測不到路由層 → 連 `Cannot access 'rewardLines' before initialization`
 * 這種一打就 500 的錯都漏掉。這支打的是真的 API。
 *
 * 用法：node scripts/test-t2-endpoints.js  （後端要在跑）
 * 測完會把玩家的職業徽章換回原本那個。
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const http = require("http");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const PID = "865264891991425055"; // 音無恋（四個二轉徽章都有）
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 5566;

let pass = 0, fail = 0;
const ck = (l, c, d = "") => { if (c) { pass++; console.log(`  ✅ ${l}`); } else { fail++; console.log(`  ❌ ${l} ${d}`); } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 打戰鬥端點，遇到兩種「不是錯、只是還沒輪到你」的狀況會等：
 *   429 = 個人戰鬥冷卻中
 *   409 = 上一場戰鬥動畫還沒播完（in-flight 鎖）
 */
async function battleReq(path, token, body, label = "") {
  for (let i = 0; i < 8; i++) {
    const r = await req("POST", path, token, body);
    if (r.status !== 429 && r.status !== 409) return r;
    const secs = r.status === 409 ? 8 : Number(String(r.json?.message || "").match(/retry in (\d+)/)?.[1] || 20) + 1;
    process.stdout.write(`     ⏳ ${label} ${r.status === 409 ? "等上一場播完" : "等冷卻"} ${secs}s…\n`);
    await sleep(secs * 1000);
  }
  return { status: 0, json: null, raw: "等太久，放棄" };
}

function req(method, path, token, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: HOST, port: PORT, path, method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (_) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, raw: buf.slice(0, 300) });
      });
    });
    r.on("error", (e) => resolve({ status: 0, json: null, raw: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const db = await getMongoDb();
  const progColl = db.collection("progress");
  const items = db.collection("items");
  const prog = await progColl.findOne({ playerId: PID });
  const originalJobEq = prog.equipment?.job_eq || null;
  const originalWeapon = prog.equipment?.weapon || null;
  const token = jwt.sign({ discordId: PID, displayName: "音無恋" }, process.env.JWT_SECRET, { expiresIn: "1h" });

  // 直接改 equipment 來切換職業（測試用，結束會還原）
  const setLoadout = async (badgeId, weaponType) => {
    const badge = await items.findOne({ id: badgeId });
    const job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "test-badge" };
    const weapon = { ...(originalWeapon || {}), itemId: "test-weapon", itemName: "測試武器", weaponType,
      isTwoHanded: weaponType.endsWith("2h"), equipStats: originalWeapon?.equipStats || {}, tier: originalWeapon?.tier || "S", enhanceLevel: 0 };
    const eq = { ...(prog.equipment || {}), job_eq, weapon };
    // 雙手武器要同時清掉副手與**盾牌**（盾是獨立的 shield 槽，不是 offhand）——
    // 直接寫 DB 會繞過遊戲的裝備驗證，忘了清盾就會測出「雙手劍還能用防禦姿態」的假結果
    if (weaponType.endsWith("2h")) { delete eq.offhand; delete eq.shield; }
    await progColl.updateOne({ playerId: PID }, { $set: { equipment: eq } });
  };

  console.log("① /api/me/profile 各職業都能取得（battleActions / 集氣條）");
  const LOADOUTS = [
    ["聖劍士", "job_holyblade_t2_v1", "sword_2h"],
    ["劍鬼", "job_swordoni_t2_v1", "sword_2h"],
    ["狂戰士", "job_berserker_t2_v1", "axe_2h"],
    ["矮人戰士長", "job_dwarflord_t2_v1", "mace_2h"],
  ];
  for (const [name, badgeId, wt] of LOADOUTS) {
    await setLoadout(badgeId, wt);
    const r = await req("GET", "/api/me/profile", token);
    const d = r.json?.data;
    ck(`${name}：profile 200 且有 battleActions`,
      r.status === 200 && Array.isArray(d?.battleActions) && d.battleActions.length > 0,
      `status=${r.status} ${r.raw}`);
    if (name === "狂戰士") {
      ck("狂戰士：profile 有 berserkGauge", d?.berserkGauge && typeof d.berserkGauge.max === "number", JSON.stringify(d?.berserkGauge));
      ck("狂戰士：有第 2 顆血祭鈕", d?.battleActions?.some((a) => a.kind === "sacrifice"), JSON.stringify(d?.battleActions));
    }
    if (name === "矮人戰士長") {
      ck("矮人戰士長：只有 1 顆按鈕", d?.battleActions?.length === 1, JSON.stringify(d?.battleActions));
    }
  }

  console.log("② /api/combat/quick-battle 一般關卡：四個職業都打得動");
  const ZONE = "hellfire";
  for (const [name, badgeId, wt] of LOADOUTS) {
    await setLoadout(badgeId, wt);
    const r = await battleReq("/api/combat/quick-battle", token, { zone: ZONE }, name);
    ck(`${name}：一般關卡出戰 200`, r.status === 200 && r.json?.data?.outcome, `status=${r.status} ${r.raw}`);
  }

  console.log("③ 狂戰士血祭：實際扣血 + 戰報看得到");
  await setLoadout("job_berserker_t2_v1", "axe_2h");
  {
    const r = await battleReq("/api/combat/quick-battle", token, { zone: ZONE, sacrifice: true }, "血祭");
    const d = r.json?.data;
    const logs = JSON.stringify(d?.logs || []);
    ck("血祭出戰 200", r.status === 200, `status=${r.status} ${r.raw}`);
    ck("戰報有血祭且帶自傷數字", /血祭/.test(logs) && /你受到 \*\*\d+\*\* 點自傷/.test(logs), logs.slice(0, 200));
  }
  await setLoadout("job_holyblade_t2_v1", "sword_2h");
  {
    const r = await battleReq("/api/combat/quick-battle", token, { zone: ZONE, sacrifice: true }, "血祭");
    ck("聖劍士送 sacrifice → 400 拒絕", r.status === 400, `status=${r.status} ${r.raw}`);
  }

  console.log("④ 聖劍士姿態：防禦沒帶盾要被拒絕");
  {
    const r = await battleReq("/api/combat/quick-battle", token, { zone: ZONE, stance: "defense" }, "防禦姿態");
    ck("雙手劍 + 防禦姿態 → 400 拒絕", r.status === 400, `status=${r.status} ${r.raw}`);
    const r2 = await battleReq("/api/combat/quick-battle", token, { zone: ZONE, stance: "attack" }, "攻擊姿態");
    ck("攻擊姿態 → 200", r2.status === 200, `status=${r2.status} ${r2.raw}`);
  }

  console.log("⑤ 單人世界王：四個職業都打得動（先前 TDZ 500 的地方）");
  const solo = await req("GET", "/api/me/solo-boss/status", token);
  ck("solo-boss/status 200", solo.status === 200, `status=${solo.status} ${solo.raw}`);
  const bossKey = solo.json?.data?.bosses?.[0]?.key || "daishi";
  // 單人王有入場費 → 測試前先補足金幣，測完扣回原本的量（不讓測試改變玩家財產）
  const wallets = db.collection("wallets");
  const w0 = await wallets.findOne({ playerId: PID });
  const goldBefore = Number(w0?.gold) || 0;
  const NEED = 5000 * 4 + 1000;
  if (goldBefore < NEED) {
    await wallets.updateOne({ playerId: PID }, { $set: { gold: NEED } }, { upsert: true });
    console.log(`     （測試用：金幣暫時補到 ${NEED}，結束會還原成 ${goldBefore}）`);
  }
  const partKey = solo.json?.data?.bosses?.[0]?.parts?.find((p) => !p.broken)?.key || "head";
  for (const [name, badgeId, wt] of LOADOUTS) {
    await setLoadout(badgeId, wt);
    const r = await battleReq("/api/me/solo-boss/battle", token, { key: bossKey, part: partKey }, name);
    ck(`${name}：單人王出戰 200`, r.status === 200, `status=${r.status} ${r.raw}`);
    if (name === "矮人戰士長" && r.status === 200) {
      ck("矮人戰士長：回應帶 bossStun 暈眩條", r.json?.data?.bossStun && typeof r.json.data.bossStun.threshold === "number",
        JSON.stringify(r.json?.data?.bossStun));
    }
  }

  // 還原金幣
  await wallets.updateOne({ playerId: PID }, { $set: { gold: goldBefore } });
  // 還原裝備
  const restore = { ...(prog.equipment || {}) };
  if (originalJobEq) restore.job_eq = originalJobEq; else delete restore.job_eq;
  if (originalWeapon) restore.weapon = originalWeapon; else delete restore.weapon;
  await progColl.updateOne({ playerId: PID }, { $set: { equipment: restore } });
  console.log(`\n（已還原職業徽章：${originalJobEq?.itemName || "無"}／武器：${originalWeapon?.itemName || "無"}）`);
  console.log(`結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
