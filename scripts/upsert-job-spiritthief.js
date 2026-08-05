"use strict";
/**
 * 盜靈徽章（盜賊二轉 B 分支）upsert。
 *
 * ⚠️ 下季內容・本季不開放：
 *   - 徽章本身沒有任何取得管道（不掉落、不販售、不進寶箱），只能由管理員手動發放
 *   - 試煉任務不建立（等下季開放時再建，且照慣例 enabled:false 起手）
 *   - 機制設定的單一來源在 src/shared/jobAdvancement.js 的 T2_BRANCHES.rogue[1]
 *
 * 用法：node scripts/upsert-job-spiritthief.js
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const BADGE_ID = "job_spiritthief_t2_v1";

// 屬性預算與影舞者對齊（agi7/dex3/luk2 = 12），盜靈把 1 點 agi 挪去 luk（identity：堆運）
const EQUIP_STATS = { str: 0, agi: 6, vit: 0, int: 0, dex: 3, luk: 3 };

const DOC = {
  id: BADGE_ID,
  name: "盜靈徽章",
  description:
    "「東西在誰手上，只是暫時的。」\n" +
    "【巧手】大成功以上的攻擊更痛。\n" +
    "【得手】大成功以上時有機率當場從對手身上偷走一件東西——每隻怪（含世界王）只能偷一次。\n" +
    "【順手牽羊】得手的瞬間手感變順：LUK +25、爆擊率 +15，持續 3 回合。",
  itemType: "job_badge",
  equipSlot: "job_eq",
  imageUrl: null,
  imageThumbnailUrl: null,
  effect: { type: "none", value: 0 },
  useEffects: [],
  equipStats: EQUIP_STATS,
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  tier: null,
  enhanceLevel: 0,
  // ⚠️ 徽章效果與影舞者「完全相同」（含 condition / duration / stackMode 等全部欄位）。
  //    平衡驗證全部是在這個前提下跑的：唯一變因＝分支機制（巧手/得手/探囊 vs 連擊氣條/影襲）。
  //    ⚠️⚠️ 特別是 procEffects 的 proc_poison —— 第一版建徽章時漏掉它，
  //    實測從 0.90x 直接掉到 0.40x（毒傷對數十萬血的世界王部位佔盜賊輸出約六成）。
  passiveEffects: [
    { key: "atk_multiplier_up", trigger: "passive", target: "self", chance: 100, stacks: 1, stackMode: "replace",
      duration: { mode: "battle", value: 1 }, params: { value: 20 },
      condition: { weaponType: "dagger" }, notes: "主手為匕首時武器倍率 x1.2" },
    { key: "block_chance_up", trigger: "passive", target: "self", chance: 100, stacks: 1, stackMode: "replace",
      duration: { mode: "battle", value: 1 }, params: { value: 10 },
      condition: { all: [{ weaponType: "dagger" }, { equippedSlot: "shield" }] }, notes: "主武匕首 + 盾：格擋 +10%" },
    { key: "combo_up", trigger: "passive", target: "self", chance: 100, stacks: 1, stackMode: "replace",
      duration: { mode: "battle", value: 1 }, params: { value: 5 },
      condition: { all: [{ weaponType: "dagger" }, { any: [{ weaponType: "offhand_dagger" }] }] }, notes: "主武匕首 + 副手武器：連擊率 +5%" },
  ],
  procEffects: [
    { key: "proc_poison", trigger: "on_hit", target: "enemy", chance: 10, stacks: 1, stackMode: "replace",
      duration: { mode: "turns", value: 2 },
      params: { value: 0.5, mode: "pct", stackAdd: 1, maxPct: 2, dexMultiplier: 0.01 },
      condition: { weaponType: "dagger" },
      notes: "主武匕首：命中時 10% 機率造成中毒（基礎 0.5% HP + DEX × 0.01%，持續 2 回合，每次觸發增加 1% 並刷新，最高疊至 1.5%）" },
  ],
  combatEffects: [
    { key: "poison_chance_up", trigger: "on_high_hp", target: "self", chance: 100, stacks: 1, stackMode: "replace",
      duration: { mode: "battle", value: 1 }, params: { value: 20, thresholdPct: 80 },
      condition: { all: [{ weaponType: "dagger" }, { any: [{ weaponType: "offhand_dagger" }] }] },
      notes: "主匕首 + 副手武器且血量 >80% 時上毒率 +20%" },
    { key: "dodge_up", trigger: "on_high_hp", target: "self", chance: 100, stacks: 1, stackMode: "replace",
      duration: { mode: "battle", value: 1 }, params: { value: 5, thresholdPct: 80 },
      condition: { all: [{ weaponType: "dagger" }, { any: [{ weaponType: "offhand_dagger" }] }] },
      notes: "主匕首 + 副手武器且血量 >80% 時迴避率 +5%" },
  ],
  jobSkills: [
    {
      key: "spiritthief_pouch",
      name: "探囊",
      description: "本回合大成功機率 +35。",
      trigger: "round_start_chance",
      chance: 40,
      cooldownTurns: 3,
      // 通用成本機制（2026-07-28 新增）：連段不夠就不會發動，不會欠帳。
      // 連段陣亡歸零 → 盜靈想常態用技能就得活著，與下季生存主題咬合。
      cost: { type: "combo", value: 3 },
      // 一場只發動一次：連段每場只 +1，若一場能發動好幾次會忽多忽少（實測一場曾吃掉 6 點）。
      // 限制成 1 次後經濟就穩定了——大約每 3 場攢得起一次探囊。
      oncePerBattle: true,
      condition: {},
      procEffects: [
        { key: "great_chance_up", target: "self", params: { value: 35 } },
      ],
    },
    {
      key: "rogue_smoke_bomb",
      name: "煙霧彈",
      description: "敵方命中-20、自身迴避+12，持續2回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "hit_down",  target: "enemy", params: { value: 20, duration: { mode: "turns", value: 2 } } },
        { key: "dodge_up",  target: "self",  params: { value: 12, duration: { mode: "turns", value: 2 } } },
      ],
    },
  ],
};

(async () => {
  const db = await getMongoDb();
  const col = db.collection("items");
  const now = new Date().toISOString();
  const existing = await col.findOne({ id: BADGE_ID });
  await col.updateOne(
    { id: BADGE_ID },
    { $set: { ...DOC, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  console.log(existing ? "✅ 盜靈徽章已更新" : "✅ 盜靈徽章已建立");
  const saved = await col.findOne({ id: BADGE_ID });
  console.log("   技能:", (saved.jobSkills || []).map((s) => `${s.name}${s.cost ? `(消耗${s.cost.value}${s.cost.type})` : ""}`).join("、"));
  console.log("   屬性:", JSON.stringify(saved.equipStats));
  console.log("⚠️  無任何取得管道（不掉落/不販售），試煉任務未建立 —— 下季開放時再處理");
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
