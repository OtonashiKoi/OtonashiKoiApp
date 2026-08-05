"use strict";
/**
 * 二轉轉職劇情的「師傅」NPC（11 位，對應 11 個一轉職業）。
 *
 * 設計（見 docs/JOB_BADGE_SYSTEM_DESIGN.md）：
 *   徽章練滿 Lv20 → 全服廣播 → 該職業的轉職劇情開放 →
 *   師傅現身 → 對話 → 劇情中的 choice ＝二轉分支 → 師傅戰 → transfer 節點遞交。
 *
 * 立繪：先留佔位路徑，圖由使用者自己補（放到 otonashikoi.org/npc-art/masters/<id>.png 即可）。
 *
 * 用法：
 *   node scripts/upsert-job-masters.js            # 試跑
 *   node scripts/upsert-job-masters.js --apply    # 寫入
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const ART = "https://otonashikoi.org/npc-art/masters";

const MASTERS = [
  { key: "swordsman", name: "白鷺", title: "劍之師", desc: "劍士的師傅。話少，出手更少——因為她只出一次。" },
  { key: "warrior", name: "鐵砧", title: "斧之師", desc: "戰士的師傅。左臂是鐵的，右臂比鐵硬。" },
  { key: "dwarf_warrior", name: "石鬍子", title: "槌之師", desc: "矮人戰士的師傅。矮，但沒人敢說第二次。" },
  { key: "rogue", name: "影七", title: "匕之師", desc: "盜賊的師傅。你以為你在找他的時候，他已經在你後面很久了。" },
  { key: "mage", name: "灰燼夫人", title: "杖之師", desc: "法師的師傅。她的實驗室燒過三次，每次都是故意的。" },
  { key: "healer", name: "無傷", title: "癒之師", desc: "治療師的師傅。身上一道疤都沒有——因為傷都被他接走了。" },
  { key: "archer", name: "遠山", title: "弓之師", desc: "弓箭手的師傅。他說射不中不是手的問題，是你太急著看結果。" },
  { key: "tactician", name: "枯棋", title: "謀之師", desc: "軍師的師傅。他不挑武器，因為武器從來不是重點。" },
  { key: "bard", name: "斷弦", title: "歌之師", desc: "詩人的師傅。琴上只剩三根弦，他說夠了。" },
  { key: "barrier_mage", name: "壁", title: "護之師", desc: "結界師的師傅。她這輩子沒打倒過任何人，也沒讓任何人倒下。" },
  { key: "gambler", name: "老千", title: "運之師", desc: "賭徒的師傅。他從不作弊——他只是比較懂什麼時候該收手。" },
];

(async () => {
  const db = await getMongoDb();
  const col = db.collection("storyNpcs");
  let created = 0, updated = 0;

  console.log(`═══ 職業師傅 NPC ${MASTERS.length} 位 ═══`);
  for (const m of MASTERS) {
    const id = `npc-master-${m.key.replace(/_/g, "-")}`;
    const doc = {
      id,
      name: `${m.name}（${m.title}）`,
      portraitUrl: `${ART}/${m.key}.png`,
      description: m.desc,
      expressions: [],
      updatedAt: new Date().toISOString(),
    };
    const existing = await col.findOne({ id });
    console.log(`  ${existing ? "~" : "+"} ${doc.name.padEnd(16)} ${id}`);
    if (existing) updated++; else created++;
    if (APPLY) {
      if (existing) await col.updateOne({ id }, { $set: doc });
      else await col.insertOne({ ...doc, createdAt: new Date().toISOString() });
    }
  }
  console.log(`\n新增 ${created} 位、更新 ${updated} 位。${APPLY ? "✅ 已寫入" : "（試跑，加 --apply 才生效）"}`);
  console.log(`立繪請放到 ${ART}/<職業key>.png（圖由使用者自備）`);
  process.exit(0);
})().catch((e) => { console.error("失敗：", e.message); process.exit(1); });
