"use strict";
/**
 * 轉職劇情【範本】：劍士 → 聖劍士 / 劍鬼
 *
 * 依 docs/JOB_INSTRUCTOR_SETTING.md 撰寫。重點：
 *   ‧ 白鷺是**虛擬世界的居民**，不屬於公會、不屬於職訓所。遇見她不是流程，是事故。
 *   ‧ 觸發不是玩家去找她——是**徽章帶你去的**。
 *   ‧ 結尾不是換證，是**徽章自主進化**；然後下一秒公會的扣款通知就來了（刻意的落差）。
 *   ‧ 語氣禁忌：不熱血、不說教、不喊招式、不寫成公務員也不寫成武俠師傅。
 *   ‧ 動機留白：白鷺對「你為什麼在這裡」給的答案是閃避且前後不一致的（伏筆）。
 *
 * ⚠️ 分支鐵則：choice 只跳轉、不記變數 → 兩條線各自走完（各有自己的 battle 與 transfer），
 *    不可合流共用一個 transfer，否則會發錯徽章。
 *
 * 用法：node scripts/upsert-job-story-swordsman.js [--apply]
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const CHAPTER_ID = "job-story-swordsman";
const SHIRASAGI = "npc-master-swordsman";
const MON = "master-swordsman";

const N = (text, extra = {}) => ({ type: "narration", text, ...extra });
const P = (text, extra = {}) => ({ type: "dialogue", npcId: "player", text, ...extra });
const S = (text, extra = {}) => ({ type: "dialogue", npcId: SHIRASAGI, side: "left", text, ...extra });

const nodes = [
  // ── ① 徵兆 ──────────────────────────────
  N("那天下線前，徽章燙了一下。", { textSpeed: "slow", holdSec: 1 }),
  N("不是錯覺。掛在胸前的劍士徽章，溫度比周圍高了一點點，像剛被誰握過。"),
  N("你看了看它。花紋已經磨得不太清楚了——這半年你揮了太多次。"),
  P("……壞了嗎？"),
  N("隔天登入，你照舊往古城的方向走。那條路你走過幾百次，閉著眼睛都知道第幾步該轉彎。"),
  N("然後你在第三個轉角停住了。"),
  N("那裡多了一道門。", { screenFx: "flash", textSpeed: "slow", holdSec: 1 }),
  N("不是新蓋的。牆上的苔痕和石縫的裂法，都跟旁邊的老牆一模一樣——它看起來已經在那裡很久了。"),
  N("久到你開始懷疑，是不是自己每次都剛好沒看見。"),
  P("……"),
  N("徽章又燙了一下。這次很明確，像是有人在推你的背。"),

  // ── ② 白鷺現身 ───────────────────────────
  N("門後是一片空地。沒有屋頂，光從上面漏下來，照著地上一圈一圈的痕跡。"),
  N("那是有人在同一個位置站了很久、轉了很多次身，才會留下的痕跡。"),
  N("空地中央坐著一個人。舊袍子洗到發白，膝上橫著一把沒有出鞘的劍。"),
  S("坐。", { portraitFx: "slideIn", textSpeed: "slow" }),
  P("……你在等我？"),
  S("我沒有在等你。"),
  S("我在這裡。你剛好走進來。"),
  N("她說話的方式很奇怪——不是冷淡，是那種「已經很久沒有需要解釋任何事」的平。"),
  P("那道門以前不在。"),
  S("門一直都在。"),
  S("是你的徽章今天才看得見它。"),

  // ── ③ 問答 ──────────────────────────────
  P("你是誰？"),
  S("白鷺。"),
  P("公會的人？"),
  S("不是。"),
  P("那你為什麼在這裡？"),
  N("她停了一下。那個停頓比回答本身長。"),
  S("……有人要我在這裡等。"),
  P("等誰？"),
  S("忘記了。", { textSpeed: "slow" }),
  N("她說忘記了的時候，右手在膝上的劍鞘上敲了兩下。"),
  N("你這才注意到——那隻手只剩三根手指。"),
  P("你的手——"),
  S("擋過一次不該擋的。"),
  N("她把手收進袖子裡，動作自然得像做過很多次。"),
  S("你的徽章磨成那樣，代表你揮了很多次。"),
  S("但揮得多，跟懂得為什麼揮，是兩件事。", { textFx: "glow", textSpeed: "slow" }),
  N("她抬眼看你。那是進門以來第一次。"),
  S("所以我問你——"),
  S("你的劍，是為了斬斷什麼？", { textSpeed: "slow", holdSec: 1 }),

  // ── ④ 分支 ──────────────────────────────
  {
    type: "choice",
    text: "（你發現自己沒辦法隨便回答。）",
    options: [
      { text: "為了護住身後的人", jumpTo: "holy" },
      { text: "為了斬盡擋路的一切", jumpTo: "oni" },
    ],
  },

  // ── ④-A 聖劍士（走到底，不合流）──────────
  P("為了護住身後的人。", { label: "holy" }),
  N("白鷺沒有點頭，也沒有搖頭。她只是把膝上的劍立了起來。"),
  S("那你要有心理準備。"),
  S("護人的劍不能只贏。它得撐住——撐到最後一個人走出去為止。"),
  S("贏一次很容易。撐住很難。"),
  N("她站起身。空地上那些轉身的痕跡，正好對上她的腳。"),
  S("我當年沒撐住。"),
  P("……那個人怎麼了？"),
  S("不知道。我只知道我沒撐住。", { textSpeed: "slow" }),
  N("她握住劍柄。三根手指，握法你從來沒見過。"),
  S("站起來。讓我看看你現在的樣子。"),
  {
    type: "battle", monsterId: MON, battleTitle: "白鷺",
    text: "她沒有拔劍。她只是走過來——然後你發現自己已經在擋了。",
    mustWin: true,
  },
  N("她退了半步，把劍放下。"),
  S("……可以了。"),
  P("我贏了？"),
  S("你沒有倒。這比贏重要。"),
  N("胸前的徽章突然燙起來，燙到你必須把它摘下來。"),
  N("它在你掌心裡開始改變形狀。不是碎裂，也不是重鑄——比較像是它終於想起了自己原本該是什麼樣子。", { screenFx: "flash", textSpeed: "slow" }),
  P("這是——"),
  S("它自己變的。跟我沒有關係。"),
  { type: "transfer", t2BadgeId: "job_holyblade_t2_v1", text: "掌心裡的東西安靜下來。它變重了，而且比剛才冷。" },
  S("拿好。它現在還不認得你。", { jumpTo: "ending" }),

  // ── ④-B 劍鬼（走到底，不合流）────────────
  P("為了斬盡擋路的一切。", { label: "oni" }),
  N("白鷺笑了。那是進門以來她第一次笑，而且很短。"),
  S("好。至少你沒有騙我。"),
  S("斬盡一切的劍走得快。快到某一天你會發現，擋路的東西裡面也包括你自己。"),
  P("那你會怎麼做？"),
  S("我沒走到那一步。所以我不知道。"),
  N("她站起身，把膝上的劍連鞘丟到你腳邊。"),
  S("你來走。走到了再回來告訴我。"),
  N("她握住腰間另一把——那把你進門時沒注意到的。"),
  S("站起來。讓我看看你現在的樣子。"),
  {
    type: "battle", monsterId: MON, battleTitle: "白鷺",
    text: "她沒有拔劍。她只是走過來——然後你發現自己已經在擋了。",
    mustWin: true,
  },
  N("她退了半步，把劍放下。"),
  S("……可以了。"),
  P("我贏了？"),
  S("你沒有停手。這在你選的那條路上比較重要。"),
  N("胸前的徽章突然燙起來，燙到你必須把它摘下來。"),
  N("它在你掌心裡開始改變形狀。不是碎裂，也不是重鑄——比較像是它終於想起了自己原本該是什麼樣子。", { screenFx: "flash", textSpeed: "slow" }),
  P("這是——"),
  S("它自己變的。跟我沒有關係。"),
  { type: "transfer", t2BadgeId: "job_swordoni_t2_v1", text: "掌心裡的東西安靜下來。它變重了，而且比剛才冷。" },
  S("拿好。它現在還不認得你。"),

  // ── ⑤ 收尾（合流；不再發放任何東西，短收）────
  N("空地上只剩下那一圈一圈的痕跡。門不見了，牆就是牆。", { label: "ending", screenFx: "fadeblack", textSpeed: "slow" }),
  N("『職業變更已登錄。變更登記費已自動結算。』", { textSize: "large", holdSec: 1 }),
];

(async () => {
  const db = await getMongoDb();
  const col = db.collection("storyChapters");

  const labels = new Set(nodes.map((n) => n.label).filter(Boolean));
  const jumps = nodes.flatMap((n) => (n.type === "choice" ? n.options.map((o) => o.jumpTo) : (n.jumpTo ? [n.jumpTo] : [])));
  for (const j of jumps) if (!labels.has(j)) throw new Error(`jumpTo 找不到 label: ${j}`);
  const transfers = nodes.filter((n) => n.type === "transfer");
  if (new Set(transfers.map((n) => n.t2BadgeId)).size !== transfers.length) throw new Error("transfer 節點的徽章重複了");

  const doc = {
    id: CHAPTER_ID,
    order: 300,
    zoneKey: null,
    title: "轉職・劍士：你的劍為了斬斷什麼",
    enabled: false,
    nodes,
    updatedAt: new Date().toISOString(),
  };

  console.log(`═══ ${doc.title} ═══`);
  console.log(`節點 ${nodes.length}｜分支 ${nodes.filter((n) => n.type === "choice").length}｜戰鬥 ${nodes.filter((n) => n.type === "battle").length}｜進化 ${transfers.length}（${transfers.map((n) => n.t2BadgeId).join(" / ")}）`);
  console.log(`狀態：${doc.enabled ? "開放" : "❌ 未開放"}\n`);
  nodes.forEach((n, i) => {
    const who = n.npcId === "player" ? "你" : n.npcId === SHIRASAGI ? "白鷺" : "";
    const tag = n.type === "choice" ? "❓" : n.type === "battle" ? "⚔️" : n.type === "transfer" ? "✨" : "  ";
    const body = n.type === "choice" ? `${n.text} → ${n.options.map((o) => o.text).join(" / ")}` : (n.text || "");
    console.log(`${String(i + 1).padStart(3)} ${tag} ${who ? who + "「" + body + "」" : "　" + body}${n.label ? `  <${n.label}>` : ""}`);
  });

  const existing = await col.findOne({ id: CHAPTER_ID });
  if (APPLY) {
    if (existing) await col.updateOne({ id: CHAPTER_ID }, { $set: doc });
    else await col.insertOne({ ...doc, createdAt: new Date().toISOString() });
    console.log("\n✅ 已寫入（enabled:false，未開放）");
  } else {
    console.log("\n（試跑，加 --apply 才寫入）");
  }
  process.exit(0);
})().catch((e) => { console.error("失敗：", e.message); process.exit(1); });
