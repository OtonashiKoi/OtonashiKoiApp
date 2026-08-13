"use strict";
/**
 * 二轉（Job Advancement Tier 2）單一來源。
 *
 * 為什麼獨立一個檔：
 *   既有 10 個一轉職業的判定散落在 combatLoop / towerHandlers / supportAuraScaling /
 *   monsterZoneHandlers / playerAppRoutes / jobBadgeBonus 等 6～7 處各自的字串比對表，
 *   新增一個職業要改 7～13 個檔。二轉是全新系統，這裡從一開始就收成單一來源，
 *   之後新增二轉只要動這個檔 + 一支 upsert script。
 *   （既有一轉的散落硬編碼本次刻意不動，避免影響線上。）
 *
 * 二轉通則（使用者定案）：
 *   - 門檻：Lv.35，且必須持有對應的一轉徽章
 *   - 試煉條件：以該一轉職業累積戰鬥次數（metric = battle_as_<baseKey>）
 *   - 一轉徽章不銷毀，二轉後仍可自由換回
 *   - 每位玩家最多持有 3 個二轉徽章
 *   - 同時只能進行 1 條二轉試煉
 *   - 第 1／2／3 個二轉的試煉要求＝出戰 350 ／ 700 ／ 1000 場
 *   - 同一個一轉職業的分支只能選一個（選了聖劍士就不能再拿大劍）
 */

/** 二轉門檻等級 */
const T2_LEVEL_REQUIREMENT = 35;

/**
 * 每位玩家最多可持有的二轉徽章數。
 * 2026-08-03 起**取消上限**（使用者定案：「有能力就可以多轉一些」）——
 * 稀缺性改由轉職本身的成本控制：一轉徽章會被消耗且永久不可再取得，
 * 且轉職費用逐次遞增（見 T2_TRANSFER_COSTS）。
 */
const T2_MAX_OWNED = Infinity;

/**
 * 轉職費用（金幣）：依「目前已持有的二轉徽章數」查，index 0 ＝第 1 個。
 * 超出表長一律用最後一項（第 3 個以後都 300 萬）。
 */
const T2_TRANSFER_COSTS = [250_000, 1_000_000, 3_000_000];

/** 第 N 個二轉徽章的轉職費用（ownedCount ＝目前已持有幾個） */
function transferCostFor(ownedCount = 0) {
  const n = Math.max(0, Math.floor(Number(ownedCount) || 0));
  return T2_TRANSFER_COSTS[Math.min(n, T2_TRANSFER_COSTS.length - 1)];
}

/**
 * 第 N 個二轉的試煉要求（index 0 = 第 1 個），單位＝以該一轉職業出戰次數。
 * 越後面的二轉越難拿，逼玩家想清楚順序。
 */
const T2_TRIAL_TARGETS = [350, 700, 1000];

/**
 * 一轉職業：key → { badgeId, name, battleMetric }
 * battleMetric 是「裝備該徽章出戰一場」會累積的任務指標。
 */
const BASE_JOBS = {
  swordsman:     { badgeId: "job_swordsman_v1",     name: "劍士" },
  warrior:       { badgeId: "job_warrior_v1",       name: "戰士" },
  dwarf_warrior: { badgeId: "job_dwarf_warrior_v1", name: "矮人戰士" },
  rogue:         { badgeId: "job_rogue_v1",         name: "盜賊" },
  mage:          { badgeId: "job_mage_v1",          name: "法師" },
  healer:        { badgeId: "job_healer_v1",        name: "治療師" },
  archer:        { badgeId: "job_archer_v1",        name: "弓箭手" },
  tactician:     { badgeId: "job_tactician_v1",     name: "軍師" },
  bard:          { badgeId: "job_bard_v1",          name: "詩人" },
  barrier_mage:  { badgeId: "job_barrier_mage_v1",  name: "結界師" },
  gambler:       { badgeId: "job_gambler_v1",       name: "賭徒" },
};

/** 該一轉職業的「出戰次數」任務指標名稱 */
function battleMetricFor(baseKey) {
  return `battle_as_${baseKey}`;
}

/** 全部一轉職業的出戰指標清單（給 weeklyQuestService 註冊 QUEST_TYPES 用） */
function allBattleMetrics() {
  return Object.keys(BASE_JOBS).map(battleMetricFor);
}

/**
 * 二轉分支表：baseKey → 分支陣列。
 *
 * 每個一轉至少要有一個二轉分支；尚未定案的第二分支不先放占位資料。
 * 分支物件格式：
 *   {
 *     id:        "job_holyblade_t2_v1",     // 徽章 itemId，必須以 job_ 開頭、含 _t2_
 *     key:       "holyblade",
 *     name:      "聖劍士",
 *     theme:     "盾牌格擋反擊",              // 一句話定位，給後台/文件看
 *     stances:   { ... }                      // 選配：戰鬥姿態（見聖劍士）
 *   }
 */
const T2_BRANCHES = {
  swordsman: [
    {
      id: "job_holyblade_t2_v1",
      key: "holyblade",
      name: "聖劍士",
      theme: "攻守姿態切換",
      // 戰鬥姿態：開打前選一個，整場適用（戰鬥是一次跑完 15 回合，中途無法切換）。
      // combatLoop 只認這張表，不寫死職業判斷 → 之後別的二轉要做姿態照同格式填即可。
      // 戰鬥畫面的行動按鈕（最多 4 顆，槽位固定；不同職業只換名稱與行為）
      battleActions: [
        { slot: 1, key: "attack",  label: "攻擊", icon: "⚔️", tone: "gold",  kind: "stance" },
        { slot: 2, key: "defense", label: "防禦", icon: "🛡️", tone: "steel", kind: "stance", requiresShield: true },
      ],
      stances: {
        attack: {
          label: "攻擊",
          blockChance: 30,          // 覆寫格擋率（劍士原本 60）
          // 保證站在屬性相剋的優勢方：武器屬性等級 < upgradeFromWeaponLevel → baseLevel，否則 upgradedLevel
          guaranteedElement: { baseLevel: 2, upgradedLevel: 4, upgradeFromWeaponLevel: 2 },
        },
        defense: {
          label: "防禦",
          blockChance: 70,
          shieldBashPct: 60,        // 格擋成功時追加盾擊＝ATK 的 60%
          requiresShield: true,
        },
      },
    },
    {
      id: "job_swordoni_t2_v1",
      key: "swordoni",
      // 本季不開放（2026-08-05 使用者定案）。與「試煉任務的 enabled」是**兩道獨立的閘門**：
      // 之後整批開放二轉時，任務開關會一起打開，這一道才是真正擋住劍鬼的那道。
      // 只擋新轉職，不影響已持有徽章的玩家（目前僅測試帳號音無恋各持有一枚）。
      seasonLocked: true,
      name: "劍鬼",
      theme: "區域連段（COMBO）",
      // 2026-07-22 改版：斬改為「氣力 3 格自動施放」→ 不再需要按鈕，只剩攻擊一顆
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "⚔️", tone: "gold", kind: "normal" },
      ],
      // 劍鬼吃 zoneCombo（見 src/shared/zoneCombo.js）＋戰內氣力格（combatLoop）：
      //   被動 — 連段階梯：1/3/5/10/15/20/25/30 段，30 封頂（吸血 10% 壓軸）
      //   被動 — 死鬥：打完就 +1 不論生死，陣亡不歸零（只有換區/10 分鐘閒置歸零）
      //   自動 — 斬：氣力 3 格（每回合有攻擊到 +1 格）滿 → 下回合自動施放，
      //             倍率 1+0.1×min(連段,30)、無視防禦與等級差、可爆擊
      combo: true,
    },
  ],
  warrior: [
    {
      id: "job_berserker_t2_v1",
      key: "berserker",
      name: "狂戰士",
      theme: "血量是燃料（血怒／血祭／戰意集氣）",
      battleActions: [
        { slot: 1, key: "attack",    label: "攻擊", icon: "⚔️", tone: "gold",    kind: "normal" },
        { slot: 2, key: "sacrifice", label: "血祭", icon: "🩸", tone: "crimson", kind: "sacrifice" },
      ],
      // 血怒（被動）：每缺 1% HP → 該回合 ATK +1.2%，封頂 +60%。
      // 逐回合看「當下」HP——實裝實測(400場/組)：世界王 1.21x、中怪 1.17x、小怪 1.0x。
      // （初版 0.6%/50 的紙面估算高估了：常數近似從第 1 回合就生效，真實血怒前期沒加成，
      //   實裝只剩 1.03~1.11x 完全沒二轉感 → 上調到 1.2/60。）
      bloodRage: { perMissPct: 1.2, capPct: 60 },
      // 血祭（開打前選擇）：付出當前 HP 30%，整場 ATK +25%。
      // ⚠️ 刻意不帶吸血——血怒讓玩家常駐低血，吸血每一口都是大回復，
      //    帶 10% 吸血實測世界王 2.31x 直接爆表。
      // 血怒1.2 + 血祭25 實測：世界王 1.40x、中怪 1.33x(勝率12%→41%)，
      // 加上滿氣場約每 6 場一次 → 持續輸出貼齊聖劍士的 1.50x。
      sacrifice: { hpCostPct: 30, atkUpPct: 25 },
      // 戰意集氣（被動）：每打完一場 +1 格，集滿下一場追加爆擊率並清空重集。
      // DC 與網頁共用；滿氣自動觸發，不用按。
      gauge: { max: 5, critRateBonus: 30 },
    },
  ],
  dwarf_warrior: [
    {
      id: "job_dwarflord_t2_v1",
      key: "dwarflord",
      name: "矮人戰士長",
      theme: "世界王暈眩條（巨神震擊）— 團隊開關",
      // 沒有第二顆按鈕：巨神震擊是被動累積，打就是敲，不用選
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "⚔️", tone: "gold", kind: "normal" },
      ],
      // 巨神震擊：規則與狀態都在 src/shared/dwarfStunGauge.js
      //   只有這個徽章敲得動世界王的暈眩條（敲擊量＝實際有攻擊到的回合數），
      //   敲滿全服共享 20 秒暈眩窗口 → 期間任何人出戰都整場免傷，之後 2 分鐘免疫。
      stunGauge: true,
      // 暈眩專精（矮人戰士長的核心）：暈眩是他的武器，不是運氣。
      //   defIgnoreVsStunned — 被動「山碎」：對暈眩中的目標無視防禦%（固定防禦 flatDef 仍在）
      //   bossStunCap        — 被動「巨神之握」：世界王暈眩上限 1 → 2 回合
      //                        （combatLoop 原本一律 min(1) 防單人鎖王，這是全遊戲唯一的例外）
      // 兩者都吃「回合暈眩」與「時間暈眩（巨神震擊）」。
      stunMastery: { defIgnoreVsStunned: 100, bossStunCap: 2 },
    },
  ],
  rogue: [
    {
      id: "job_shadowdancer_t2_v1",
      key: "shadowdancer",
      name: "影舞者",
      theme: "連擊氣條（殘影亂舞）— 快到只剩殘影",
      battleActions: [
        { slot: 1, key: "attack",      label: "攻擊", icon: "⚔️", tone: "gold",    kind: "normal" },
      ],
      // 連擊氣條：規則與持久化在 src/shared/shadowGauge.js，戰鬥內邏輯在 combatLoop
      //   累氣：本回合有連擊 → +1 格（每回合最多 1）；滿 5 格 → 下一回合固定 5 連擊（該回合不累氣）
      //   同場域跨場沿用（換區/10 分鐘沒打歸零）
      shadowGauge: true,
    },
    {
      id: "job_spiritthief_t2_v1",
      key: "spiritthief",
      // 本季不開放（2026-08-05 使用者定案）。理由同劍鬼，見該分支註解。
      seasonLocked: true,
      name: "盜靈",
      theme: "大成功即出手（巧手／得手）— 打的同時把東西摸走",
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "⚔️", tone: "gold", kind: "normal" },
      ],
      // ── 巧手（被動）：大成功**以上**（含完美）本擊額外 ×aboveGreatMult。
      //    ⚠️ 必須乘進「條件乘數」而不是覆寫 ATTACK_TIER_MULT.great——
      //    實測發現本體既有行為：爆擊時 finalDamage 會從 attackBase 重算，
      //    把階級乘數整個丟掉（盜賊爆擊率 81.6% → 覆寫階級倍率幾乎完全無效）。
      //    走條件乘數則 attackBase/爆擊路徑都自然繼承（同血怒的作法）。
      //    舊版實測（1500~2000場/組・古龍王頭部；當時影舞者仍含已移除的影襲）：
      //      巧手1.25 → 0.99x（太接近，且盜靈是全被動、影舞者有主動技 → 使用者判定太強）
      //      巧手1.08 + 探囊 + 徽章 luk 傾斜 → **0.83~0.85x**（定案）
      //    ⚠️ 量測踩過的兩個坑，之後改數值務必注意：
      //      ① 徽章的 procEffects.proc_poison 漏掉 → 直接掉到 0.40x
      //         （毒傷對數十萬血的世界王部位佔盜賊輸出約六成）
      //      ② 徽章屬性 1 點 AGI 換 1 點 LUK ＝ -3.4% 輸出
      //         （AGI 對盜賊邊際效益遠高於 LUK —— 下季屬性斜率工作可參考）
      deftHands: { aboveGreatMult: 1.08 },
      // ── 得手（被動）：大成功以上時判定盜取；成功則「當場」偷走一件（不等擊殺、不走幸運者機制）
      //    ⚠️ oncePerMonster：每隻怪（含世界王整隻）每位玩家只能偷一次 —— 使用者定案 2026-07-28。
      //       目的：讓每次得手是事件而非刷取，世界王也不會變成偷取農場。
      //    偷到的東西＝從該怪掉落池「依原掉落率權重」抽一件必得（保留稀有度相對關係）。
      //    盜取成功的那一擊額外 ×hitDamageMult（「那一下會特別痛」）。
      //    ⚠️ 數值於 2026-07 舊基準調校，G1 血量基底上線後需重跑 balance-job-matrix 校正。
      //    實測（1000場/組・古龍王頭部）：平均大成功以上 4.9~5.8 次/場 →
      //      單場得手率 LUK10 65% / LUK40 78% / LUK60 80%（＝多數玩家打一場就偷到，堆運縮短到手時間）
      steal: {
        baseChancePct: 12,      // 每次大成功以上的基礎盜取率
        lukPerPoint: 0.15,      // 每點 LUK +0.15%（攻擊階級本身的屬性斜率太平，堆運的回報放這裡）
        hitDamageMult: 1.8,     // 得手那一擊的額外傷害倍率
        oncePerMonster: true,
        // 「順手牽羊」：偷到的當下**順帶**手感變順 —— 不是技能、不用按、沒有成本，
        // 就是得手這件事本身附帶的效果（使用者定案 2026-07-28）。
        riderBuff: { lukUp: 25, critRateUp: 15, turns: 3 },
      },
    },
  ],
  mage: [
    {
      id: "job_elementalist_t2_v1",
      key: "elementalist",
      name: "元素師",
      theme: "場地魔法（炎圈／凍霜／嵐暴）",
      // 進場就是三顆姿態鈕、沒有一般攻擊（嵐暴放中間＝預設）
      battleActions: [
        { slot: 1, key: "fire",  label: "炎圈", icon: "🔥", tone: "crimson", kind: "stance" },
        { slot: 2, key: "storm", label: "嵐暴", icon: "🌩️", tone: "gold",    kind: "stance" },
        { slot: 3, key: "frost", label: "凍霜", icon: "❄️", tone: "steel",   kind: "stance" },
      ],
      // DC 與未指定姿態時的預設（一般職業預設 "attack"，元素師沒有一般攻擊）
      defaultStance: "storm",
      stances: {
        fire: {
          label: "炎圈",
          // 燃燒領域：怪物每回合受到 MATK×matkPct% 火傷（開場就燒、整場持續、走 DOT 管線）。
          // 世界王：四個部位一起燒——其他部位的份在戰後由呼叫端用 combatStats.fireCircleDamage 鏡射結算。
          // 10→15（2026-07-23 校準：10% 時鏡射後僅 1.29x，被王防壓扁）
          fireCircle: { matkPct: 15 },
          // 本身攻擊帶火屬性 2 級（與武器屬性的疊加規則見 combatLoop：同屬性相加封頂4、不同取最高）
          stanceElement: { element: "fire", level: 2 },
        },
        storm: {
          label: "嵐暴",
          // 三連法術：每回合固定 3 段、每段＝普攻的 pctPerHit%、各段獨立擲爆擊。
          // 無視連擊/三元牌/骰子多段（雙持副手追擊保留、維持單追擊）。
          // 70→85（2026-07-23 校準：真實裝備帶連擊/三元卡時，關掉多段的代價讓 70% 只剩 1.13x）
          // 85→45（2026-08-05 使用者定案，中途試過 40）：85 讓每回合總量達 255%，
          // 一般區實測平均 5,275＝中位數的 2.58 倍、比第二名高 39%。
          // 40 砍過頭（122%，反而變三姿態最弱，因為炎圈/凍霜另有屬性等級 2 的相剋加成），
          // 定案 45 → 總量 135%，落在炎圈(155%)與凍霜(129%)之間。
          // 補打段另外不再吃武器主屬性加成（見 combatLoop 嵐暴區塊）。
          stormVolley: { hits: 3, pctPerHit: 45 },
        },
        frost: {
          label: "凍霜",
          // 出戰累積該區域冰凍值（規則在 zoneFreezeGauge：滿 300 → 區域冰封 20 秒全員免傷 → 免疫 2 分鐘）
          freezeCharge: true,
          stanceElement: { element: "water", level: 2 },
        },
      },
    },
  ],
  healer: [
    {
      id: "job_spiritmaster_t2_v1",
      key: "spiritmaster",
      name: "聖靈師",
      theme: "日之精靈（代承／光環×2／日屬性協攻）",
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "⚔️", tone: "gold", kind: "normal" },
      ],
      // 日之精靈：持久化規則在 sunSpirit.js、戰內邏輯在 combatLoop
      //   代承：怪物攻擊先打精靈（精靈血量＝主人 maxHp；不套用主人任何防禦效果）
      //   協攻：每回合一擊，ATK＝主人×atkRatio%、日屬性 elementLevel 級（單發不爆擊不連擊）
      //   光環：精靈在場（出戰當下）→ 給隊伍的光環效果 ×auraMult（route 層快照套用）
      //   大治療術：每 healEveryRounds 個有出手的回合回復 maxHp×healPct%＋INT 補正（先精靈後自己；聖人錨點下全數轉傷）
      sunSpirit: {
        atkRatio: 33,          // 主人 ATK 的 %（1/3）
        element: "sun",
        elementLevel: 3,
        auraMult: 2,
        healEveryRounds: 5,
        healPct: 30,
      },
    },
  ],
  archer: [
    {
      id: "job_sniper_t2_v1",
      key: "sniper",
      name: "神射手",
      theme: "掩護射擊（全區支援）／神速反擊／震盪射擊",
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "🏹", tone: "gold", kind: "normal" },
      ],
      // 神射手三件套（戰內邏輯在 combatLoop、掩護射擊在 route 層光環管線、震盪值在 sniperGauge.js）：
      //   掩護射擊（團隊）：區內其他玩家出戰時，每名神射手每回合各補一箭＝本人 ATK×supportShotPct%（吃本人的爆擊、終傷與武器屬性；世界王各自歸戶）
      //   神速反擊（被動）：這回合對手沒打到你（揮空/被閃/來不及出手/被暈眩/被冰封）→ 多一箭 ATK×counterShotPct%
      //   震盪射擊（氣條 4 格）：每個有攻擊的回合 +1，滿 4 → 立刻一箭 ATK×shockShotPct%＋推遠 → 下回合對手攻擊不到你
      sniper: {
        supportShotPct: 70,
        counterShotPct: 100,
        shockShotPct: 100,
      },
    },
  ],
  tactician: [
    {
      id: "job_sage_t2_v1",
      key: "sage",
      name: "兵聖",
      theme: "三十六計（計謀值施計）／知彼（圖鑑加成×2）",
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "📜", tone: "gold", kind: "normal" },
      ],
      // 兵聖三件套（戰內在 combatLoop、計謀值在 sageGauge、知彼/教學相長在 route 層）：
      //   施計：計謀值 3 格（有攻擊的回合 +1），滿 → 隨機施展一計（火攻/落石/瞞天過海/連環/破釜沉舟）
      //   知彼：圖鑑傷害加成上限 15% → ×knowledgeMult（30%）——把既有 bestiary 加成翻倍
      //   （教學相長已依使用者指示移除：圖鑑累積不加速）
      sage: {
        knowledgeMult: 2,   // 圖鑑加成倍率（15% → 30%）
        // 五計數值：火攻(一擊% / 灼燒 每跳 casterAtk% × 回合)、落石(一擊% + 暈1)、
        // 連環(固定連擊段數)、破釜沉舟(施計後 rounds 回合傷害×mult、受傷×1.5、不可閃避格擋)
        fire: { hitPct: 150, burnPct: 30, burnTurns: 3 },
        rock: { hitPct: 120 },
        chain: { hits: 3 },
        allin: { mult: 3, rounds: 2, takenMult: 1.5 },
      },
    },
  ],
  bard: [
    {
      id: "job_minstrel_t2_v1",
      key: "minstrel",
      name: "吟遊詩人",
      theme: "演奏判定（方向輸入・連奏加成）",
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "🎸", tone: "gold", kind: "normal" },
      ],
      // 演奏判定：規則/出題/計分在 bardSong.js、傷害倍率與完美和弦在 combatLoop、
      // 出題與驗卷在 route 層（網頁/單人王；DC 無演奏 ±0 不斷連奏）
      bardSong: true,
    },
  ],
  barrier_mage: [
    {
      id: "job_sanctum_t2_v1",
      key: "sanctum",
      name: "聖域師",
      theme: "符文結界（吸收→共鳴反爆）／聖域展開（區域護佑）",
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "🔷", tone: "gold", kind: "normal" },
      ],
      // 符文結界（戰內邏輯在 combatLoop、聖域值在 sanctumGauge.js）：
      //   結界：開場展開，厚度＝maxHp×barrierBasePct% + INT×barrierPerInt；受傷先扣結界再扣血
      //   共鳴反爆：結界吸收的傷害累積，三個引爆時機（伺服器整場先算好，可以「預知」）——
      //     ①提前引爆：某回合的反爆值 ≥ 怪物當前血量 → 當回合引爆收頭
      //     ②結界被打爆：破碎當回合引爆
      //     ③撐到最後一回合：滿額引爆（最痛）
      //     反爆＝累積吸收 × detonateMult × (引爆回合/全場回合)——倍率隨回合成長，
      //     撐到最後一回合才吃滿 detonateMult（早被打爆＝吸滿但倍率打折 → 撐盾永遠是對的）；
      //     無視防禦、不擲爆擊（走終傷層倍率鏈，吃部位/屬性/演奏類加成）
      //   聖域展開：聖域值 4 格（每場 +1），滿 → 區域 20 秒聖域：出戰受傷 -sanctumDamageCutPct%、
      //     每回合回復 maxHp×sanctumHealPct%；期間聖域師自己的隊伍光環 ×auraMult（route 層快照）
      sanctum: {
        barrierBasePct: 25,
        barrierPerInt: 25,
        detonateMult: 2,
        sanctumDamageCutPct: 50,
        sanctumHealPct: 3,
        auraMult: 2,
      },
    },
  ],
  gambler: [
    {
      id: "job_dicegod_t2_v1",
      key: "dicegod",
      name: "賭神",
      theme: "魔法骰（破防）／命運骰（第三骰連擊）／手氣正旺（跨場疊傷）",
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "🎲", tone: "gold", kind: "normal" },
      ],
      // 賭神三件套（戰內在 combatLoop、跨場持久化在 diceGauge.js）：
      //   魔法骰：骰子武器傷害視為魔法（常駐無視 25% DEF，與雙手杖同級；改在武器層 combatStats）
      //   命運骰：6 格（有攻擊的回合 +1），滿的那回合改丟 3 顆——第三顆骰出 N ＝ 當回合 N 連擊，
      //     每一擊都是前面兩顆骰子的傷害（骰面沿用、各擊獨立擲爆擊）；放完歸零
      //   手氣正旺：每攻擊回合看兩顆傷害骰平均——>3 手氣+1層（每層 +2%、上限 25 層＝+50%）、
      //     <3 歸零、=3 維持；全域跨場（只有平均<3 會掉，不吃換區/閒置）
      //   （賭徒技能綁骰子武器：condition.weaponType＝dice，引擎在技能觸發處判定）
      diceGod: {
        gaugeMax: 6,
        luckPerStackPct: 2,
        luckMaxStacks: 25,
      },
    },
  ],
};

/** 攤平成 id → { ...branch, baseKey } 的索引 */
const T2_BY_ID = (() => {
  const map = new Map();
  for (const [baseKey, branches] of Object.entries(T2_BRANCHES)) {
    for (const b of branches) {
      if (b && b.id) map.set(String(b.id), { ...b, baseKey });
    }
  }
  return map;
})();

/** 這個 itemId 是不是二轉徽章 */
function isT2BadgeId(itemId) {
  return T2_BY_ID.has(String(itemId || ""));
}

/** 取得二轉分支定義（找不到回 null） */
function getT2Branch(itemId) {
  return T2_BY_ID.get(String(itemId || "")) || null;
}

/** 取得某一轉職業的全部二轉分支 */
/**
 * 某個一轉底下的二轉分支。
 * 預設**排除本季不開放（seasonLocked）的分支** —— 玩家看得到、選得到的一律走這裡。
 * 平衡量測/後台需要看全部時傳 { includeLocked: true }。
 */
function getBranchesForBase(baseKey, { includeLocked = false } = {}) {
  const all = T2_BRANCHES[baseKey] ? [...T2_BRANCHES[baseKey]] : [];
  return includeLocked ? all : all.filter((b) => b && b.seasonLocked !== true);
}

/** 這個二轉徽章是否本季不開放 */
function isSeasonLockedT2(badgeId) {
  const br = getT2Branch(String(badgeId || ""));
  return Boolean(br && br.seasonLocked === true);
}

/** 一轉徽章 itemId → baseKey（找不到回 null） */
function getBaseKeyByBadgeId(badgeId) {
  const id = String(badgeId || "");
  for (const [key, def] of Object.entries(BASE_JOBS)) {
    if (def.badgeId === id) return key;
  }
  return null;
}

/**
 * 計算玩家已持有的二轉徽章數量。
 * itemIds 可以是 Set 或陣列（背包 + 已裝備都要算，因為一轉徽章不銷毀、可自由換裝）。
 */
function countOwnedT2(itemIds) {
  const ids = itemIds instanceof Set ? itemIds : new Set(Array.isArray(itemIds) ? itemIds : []);
  let n = 0;
  for (const id of ids) {
    if (isT2BadgeId(id)) n += 1;
  }
  return n;
}

/**
 * 第 N 個二轉的試煉要求。ownedCount = 玩家目前已持有的二轉徽章數。
 * 已達上限時回 null（代表不該再顯示新的二轉試煉）。
 */
function trialTargetFor(ownedCount) {
  const n = Math.max(0, Number(ownedCount) || 0);
  if (n >= T2_MAX_OWNED) return null;
  return T2_TRIAL_TARGETS[n] ?? T2_TRIAL_TARGETS[T2_TRIAL_TARGETS.length - 1];
}

/**
 * 玩家已經二轉過的一轉職業集合。
 * 用於「同一個一轉職業的分支只能選一個」——選了聖劍士就永遠不能再拿大劍。
 */
function ownedT2BaseKeys(itemIds) {
  const ids = itemIds instanceof Set ? itemIds : new Set(Array.isArray(itemIds) ? itemIds : []);
  const keys = new Set();
  for (const id of ids) {
    const branch = getT2Branch(id);
    if (branch && branch.baseKey) keys.add(branch.baseKey);
  }
  return keys;
}

/**
 * 解析玩家這場戰鬥要套用的姿態設定。
 * @param {object} jobEq      已裝備的職業徽章（progress.equipment.job_eq）
 * @param {string} stanceKey  玩家選的姿態（"attack" / "defense"）
 * @returns {object|null}     姿態設定；徽章沒有姿態系統或 key 不存在 → null（＝完全走現況）
 */
function resolveStance(jobEq, stanceKey) {
  if (!jobEq || !stanceKey) return null;
  const branch = getT2Branch(String(jobEq.itemId || jobEq.id || ""));
  const stance = branch && branch.stances ? branch.stances[String(stanceKey)] : null;
  return stance ? { ...stance, key: String(stanceKey), jobName: branch.name } : null;
}

/** 這個徽章有沒有姿態系統（前端要不要渲染兩顆按鈕） */
function getStances(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.stances ? branch.stances : null;
}

/** 未指定姿態時的預設鍵（聖劍士＝attack；元素師沒有一般攻擊＝storm） */
function getDefaultStance(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return (branch && branch.defaultStance) || "attack";
}

/** 血怒設定（狂戰士）：徽章沒有就 null → combatLoop 完全走現況 */
function getBloodRage(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.bloodRage ? { ...branch.bloodRage, jobName: branch.name } : null;
}

/** 血祭設定（狂戰士）：開打前選擇，付 HP 換整場 ATK */
function getSacrifice(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.sacrifice ? { ...branch.sacrifice, jobName: branch.name } : null;
}

/** 盜靈設定：{ deftHands, steal }；沒有徽章 → null → combatLoop 完全走現況 */
function getSpiritThief(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  if (!branch || (!branch.deftHands && !branch.steal)) return null;
  return {
    deftHands: branch.deftHands ? { ...branch.deftHands } : null,
    steal: branch.steal ? { ...branch.steal } : null,
    jobName: branch.name,
  };
}

/**
 * ⭐ 全遊戲判斷「這個徽章算哪個職業」的**唯一入口**。
 *
 * 一轉徽章 → 自己的 key；二轉徽章 → 它的 baseKey（繼承一轉的所有程式碼內建加成）。
 *
 * 為什麼一定要走這裡：職業加成有一大半**寫在程式碼裡、不在道具資料上**
 * （劍士的格擋反擊、矮人的對暈眩加傷、盜賊的連擊率破百…），
 * 以前各檔案各自用 `id.includes("swordsman") || name.includes("劍士")` 判斷 →
 * 二轉徽章只要名字沒撞上關鍵字就整組失效。
 * 實例：**劍鬼**（id `job_swordoni_t2_v1`、名「劍鬼徽章」）兩個都不中，
 * 少了雙手劍格擋 +5% 與**格擋反擊**，實測比一轉劍士還弱 10%。
 *
 * 新增職業只要登記進 BASE_JOBS / T2_BRANCHES，所有判定自動正確。
 */
function resolveJobKey(jobEq) {
  if (!jobEq) return null;
  const id = String(jobEq.itemId || jobEq.id || "");
  const t2 = getT2Branch(id);
  if (t2) return t2.baseKey;
  const base = getBaseKeyByBadgeId(id);
  if (base) return base;
  return legacyGuessJobKey(jobEq);
}

/**
 * 後備：沒登記在 BASE_JOBS / T2_BRANCHES 的徽章（舊資料、後台自訂）才走字串比對。
 * 正常情況不該用到——用到代表有徽章沒登記。
 */
const LEGACY_MATCHERS = [
  ["barrier_mage",  ["barrier_mage"], ["結界"]],
  ["dwarf_warrior", ["dwarf"],        ["矮人"]],
  ["healer",        ["healer"],       ["治療"]],
  ["tactician",     ["tactician"],    ["軍師"]],
  ["bard",          ["bard"],         ["詩人"]],
  ["gambler",       ["gambler"],      ["賭徒"]],
  ["swordsman",     ["swordsman"],    ["劍士"]],
  ["warrior",       ["warrior"],      ["戰士"]],
  ["archer",        ["archer"],       ["弓箭手"]],
  ["rogue",         ["rogue"],        ["盜賊"]],
  ["mage",          ["mage"],         ["法師"]],
];
function legacyGuessJobKey(jobEq) {
  const id = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const name = String(jobEq?.itemName || jobEq?.name || "");
  // 順序有意義：結界師/矮人戰士要排在法師/戰士前面，否則會被前綴吃掉
  for (const [key, ids, names] of LEGACY_MATCHERS) {
    if (ids.some((x) => id.includes(x)) || names.some((x) => name.includes(x))) return key;
  }
  return null;
}

/** 這個徽章是不是某個一轉職業（含其二轉分支）。全遊戲的職業判定都該用這個。 */
function isJob(jobEq, baseKey) {
  return resolveJobKey(jobEq) === baseKey;
}

/** 職業 key → 中文名（顯示用） */
function jobDisplayName(baseKey) {
  return BASE_JOBS[baseKey]?.name || null;
}

/** 暈眩專精設定（矮人戰士長）：沒有這套的職業回 null → combatLoop 完全走現況 */
function getStunMastery(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.stunMastery ? { ...branch.stunMastery, jobName: branch.name } : null;
}

/** 日之精靈設定（聖靈師）：沒有精靈系統的職業回 null */
function getSunSpirit(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.sunSpirit ? { ...branch.sunSpirit, jobName: branch.name } : null;
}

/** 神射手設定：沒有的職業回 null */
function getSniper(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.sniper ? { ...branch.sniper, jobName: branch.name } : null;
}

/** 兵聖設定：沒有的職業回 null */
function getSage(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.sage ? { ...branch.sage, jobName: branch.name } : null;
}

/** 聖域師設定（符文結界/聖域）：沒有的職業回 null */
function getSanctum(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.sanctum ? { ...branch.sanctum, jobName: branch.name } : null;
}

/** 賭神設定（命運骰/手氣正旺）：沒有的職業回 null */
function getDiceGod(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.diceGod ? { ...branch.diceGod, jobName: branch.name } : null;
}

/** 戰意集氣設定（狂戰士）：沒有集氣系統的職業回 null */
function getGauge(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.gauge ? { ...branch.gauge, jobName: branch.name } : null;
}

/** 戰鬥畫面最多支援幾顆行動按鈕（槽位固定，前端照 slot 排） */
const MAX_BATTLE_ACTIONS = 4;

/** 預設按鈕：沒有二轉徽章（或該二轉沒宣告）的職業就這一顆 */
const DEFAULT_BATTLE_ACTIONS = [
  { slot: 1, key: "attack", label: "戰鬥開始", icon: "⚔️", tone: "gold", kind: "normal" },
];

/**
 * 取得這個職業徽章在戰鬥畫面要顯示的行動按鈕。
 * 前端只認 slot / label / icon / tone / kind，新增職業不用改前端。
 */
function getBattleActions(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  const list = branch && Array.isArray(branch.battleActions) && branch.battleActions.length > 0
    ? branch.battleActions
    : DEFAULT_BATTLE_ACTIONS;
  const defaultKey = getDefaultStance(jobEq);
  const helpByKind = {
    normal: "使用目前裝備與職業被動進行戰鬥。",
    sacrifice: "消耗目前生命 30%，本場攻擊力提高 25%。",
    combo_burst: "消耗已累積的區域連段，施放本職業的爆發攻擊。",
    shadow_rush: "消耗 5 連段，第一回合發動 7 連擊。",
  };
  const describeStance = (action) => {
    const stance = branch?.stances?.[action.key];
    if (!stance) return `${branch?.name || "職業"}姿態：${branch?.theme || action.label}`;
    const bits = [];
    if (stance.fireCircle) bits.push(`每回合造成 MATK ${Number(stance.fireCircle.matkPct) || 0}% 的火屬性傷害`);
    if (stance.stormVolley) bits.push(`每回合固定 ${Number(stance.stormVolley.hits) || 0} 段，每段為普攻 ${Number(stance.stormVolley.pctPerHit) || 0}%`);
    if (stance.freezeCharge) bits.push("命中時累積區域冰凍值");
    if (stance.guaranteedElement) bits.push(`保證站在屬性優勢方，攻擊屬性最低 ${Number(stance.guaranteedElement.baseLevel) || 0} 級`);
    if (Number.isFinite(Number(stance.blockChance))) bits.push(`格擋率 ${Number(stance.blockChance)}%`);
    if (stance.shieldBashPct) bits.push(`格擋成功追加 ATK ${Number(stance.shieldBashPct)}% 盾擊`);
    if (stance.stanceElement?.element) bits.push(`攻擊附帶 ${stance.stanceElement.level || 0} 級屬性`);
    return bits.length ? bits.join("；") : `${branch?.name || "職業"}姿態：${branch?.theme || action.label}`;
  };
  return list.slice(0, MAX_BATTLE_ACTIONS).map((a) => ({
    ...a,
    description: a.description
      || (a.kind === "stance" ? describeStance(a) : helpByKind[a.kind] || (branch ? `${branch.name}：${branch.theme}` : helpByKind.normal)),
    element: branch?.stances?.[a.key]?.stanceElement?.element || null,
    elementLevel: Number(branch?.stances?.[a.key]?.stanceElement?.level) || 0,
    // 讓 Web 操作環知道哪一招應該先放在中央；伺服器仍會再次驗證實際送來的 stance。
    default: a.kind === "stance" && a.key === defaultKey,
  }));
}

module.exports = {
  MAX_BATTLE_ACTIONS,
  DEFAULT_BATTLE_ACTIONS,
  getBattleActions,
  T2_LEVEL_REQUIREMENT,
  T2_MAX_OWNED,
  T2_TRANSFER_COSTS,
  transferCostFor,
  T2_TRIAL_TARGETS,
  BASE_JOBS,
  T2_BRANCHES,
  battleMetricFor,
  allBattleMetrics,
  isT2BadgeId,
  getT2Branch,
  getBranchesForBase,
  isSeasonLockedT2,
  getBaseKeyByBadgeId,
  countOwnedT2,
  ownedT2BaseKeys,
  trialTargetFor,
  resolveStance,
  getStances,
  getDefaultStance,
  getBloodRage,
  getSacrifice,
  getSpiritThief,
  getGauge,
  getStunMastery,
  getSunSpirit,
  getSniper,
  getSage,
  getSanctum,
  getDiceGod,
  resolveJobKey,
  isJob,
  jobDisplayName,
};
