"use strict";

/**
 * 共用戰鬥迴圈
 * 供 playerAppRoutes（quick-battle）與 monsterZoneHandlers（Discord 戰鬥）共用
 *
 * @param {object} pStats   calcPlayerStats() 的回傳值
 * @param {object} mCalc    monster.calc（effectiveCalc 的回傳值）
 * @param {string} mName    怪物名稱
 * @param {number} mHpInit  怪物起始 HP
 * @param {number} MAX_ROUNDS 最大回合數
 * @returns {{ outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp }}
 */
const { collectEquipmentEffects, isEffectConditionMet } = require("./effectEngine");

const WEAPON_PHRASE_BANK = {
  default: ["揮拳猛擊", "飛腿踢出", "怒拳轟擊", "突刺重擊", "橫掃一擊", "沉肩衝撞"],
  sword_1h: ["揮劍斬擊", "劍鋒突刺", "斜斬破風", "連續快斬", "踏步橫掃", "收劍再斬"],
  sword_2h: ["重劍劈落", "雙手斬下", "劍身破空", "大開大闔地橫斬", "蓄力重劈", "狂斬壓制"],
  dagger: ["迅捷刺出", "連環割襲", "貼身突刺", "趁隙猛刺", "回身偷切", "影步短刃連擊"],
  mace_1h: ["重錘猛砸", "迴旋錘擊", "震地一擊", "猛力橫掃", "錘面直落", "寸勁敲擊"],
  mace_2h: ["巨錘轟落", "雙手錘擊", "地裂重鎚", "全力震擊", "狂猛砸落", "鐵鎚破陣"],
  axe_1h: ["斧刃劈砍", "破甲一擊", "側身橫斬", "旋身揮砍", "碎盾斜切", "怒斧下劈"],
  axe_2h: ["巨斧狂劈", "雙手劈落", "開山斬擊", "裂地重砍", "狂暴橫掃", "全力破陣"],
  staff: ["施展魔法", "吟唱咒語", "釋放法術", "引導魔力", "凝聚咒陣", "驅使元素"],
  bow: ["拉弓射擊", "瞄準放箭", "急速連射", "精準狙擊", "拉弦破空", "連珠齊射"]
};
const CRIT_PHRASES = ["會心一擊", "致命一擊", "弱點命中", "完美命中", "要害洞穿", "破綻捕捉"];
const COMBO_PHRASES = ["連擊！", "殘影連斬！", "急速追打！", "趁勢猛攻！", "流暢追擊！", "壓迫連段！"];
const DODGE_PHRASES = ["身形一閃", "靈巧側移", "急速後撤", "俐落閃身", "錯步避開", "滑步拉開距離"];
const MONSTER_DODGE_PHRASES = ["及時閃避", "往旁一跳", "後退一步", "扭身躲開", "側翻避過", "驚險卸力"];
const MONSTER_ATK_PHRASES = ["猛力衝撞", "揮爪攻擊", "重擊落下", "怒吼突進", "野蠻撲擊", "全身壓來"];
const BLOCK_PHRASES = ["以盾格擋", "舉盾抵擋", "盾牌格開", "穩穩架住", "橫盾卸力", "硬生生擋下"];
const STUN_PHRASES = ["被重擊擊暈", "失去平衡", "陷入眩暈", "腦中一陣空白", "身形踉蹌", "暫時失去反應"];
const COUNTER_PHRASES = ["抓準破綻", "順勢回擊", "趁勢反撲", "借力反打", "逆勢追擊", "回敬一擊"];
const EXECUTE_PHRASES = ["一擊終結", "致命收尾", "毫不留情地帶走", "斬落最後一口氣", "乾脆俐落收場", "直接送回老家"];
const PARTY_HEAL_PHRASES = ["暖流湧上", "生命回到體內", "治癒波動拂過", "體力稍微回穩", "來自隊伍的守護生效", "你穩住了陣腳"];
const PARTY_DAMAGE_PHRASES = ["隊伍氣勢高漲", "攻勢被推上頂點", "同伴的鬥志加持在身", "戰意一路飆升", "你感到火力被放大", "鋒芒更盛"];

// AGI 優勢敘述
const AGI_FIRST_STRIKE_PHRASES = ["反應不及，你太快了", "無法跟上你的速度", "被你的敏捷完全壓制", "你的速度超乎預料", "來不及反應"];
const AGI_SLOWED_ATTACK_PHRASES = ["有點跟不上節奏", "被你的速度牽著鼻子走", "招架不住你的敏捷", "無力應對你的攻勢"];

function pickWeaponPhrases(weaponType) {
  if (!weaponType) return WEAPON_PHRASE_BANK.default;
  if (weaponType.startsWith("staff")) return WEAPON_PHRASE_BANK.staff;
  if (weaponType === "bow") return WEAPON_PHRASE_BANK.bow;
  if (weaponType === "dagger") return WEAPON_PHRASE_BANK.dagger;
  if (weaponType === "mace_1h") return WEAPON_PHRASE_BANK.mace_1h;
  if (weaponType === "mace_2h") return WEAPON_PHRASE_BANK.mace_2h;
  if (weaponType === "axe_1h") return WEAPON_PHRASE_BANK.axe_1h;
  if (weaponType === "axe_2h") return WEAPON_PHRASE_BANK.axe_2h;
  if (weaponType === "sword_2h") return WEAPON_PHRASE_BANK.sword_2h;
  if (weaponType === "sword_1h") return WEAPON_PHRASE_BANK.sword_1h;
  return WEAPON_PHRASE_BANK.default;
}

function detectJobBattleProfile(equipped = {}, inventory = []) {
  const jobEq = equipped?.job_eq || null;
  const context = { equipped, inventory };
  const allJobEffects = [
    ...(Array.isArray(jobEq?.passiveEffects) ? jobEq.passiveEffects : []),
    ...(Array.isArray(jobEq?.procEffects) ? jobEq.procEffects : []),
    ...(Array.isArray(jobEq?.combatEffects) ? jobEq.combatEffects : [])
  ];
  const activeJobEffects = allJobEffects.filter((effect) => isEffectConditionMet(effect, context));
  const id = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const name = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();

  const has = (needle) => id.includes(needle) || name.includes(needle);
  let archetype = "default";
  if (has("swordsman")) archetype = "swordsman";
  else if (has("warrior") && has("dwarf")) archetype = "dwarf_warrior";
  else if (has("warrior")) archetype = "warrior";
  else if (has("archer")) archetype = "archer";
  else if (has("healer")) archetype = "healer";
  else if (has("mage")) archetype = "mage";
  else if (has("rogue")) archetype = "rogue";
  else {
    const weaponType = equipped?.weapon?.weaponType || "";
    if (weaponType.startsWith("staff")) archetype = activeJobEffects.some((e) => e.target === "party") ? "healer" : "mage";
    else if (weaponType === "bow") archetype = "archer";
    else if (weaponType === "dagger") archetype = "rogue";
    else if (weaponType.startsWith("mace")) archetype = "dwarf_warrior";
    else if (weaponType.startsWith("axe")) archetype = "warrior";
    else if (weaponType.startsWith("sword")) archetype = "swordsman";
  }

  return {
    jobId: jobEq?.itemId || jobEq?.id || null,
    jobName: jobEq?.itemName || jobEq?.name || null,
    archetype,
    activeJobEffects
  };
}

const JOB_FLAVOR = {
  default: {
    intro: ["戰意升起，準備迎擊。", "氣息收束，正面迎戰。", "握緊武器，進入戰鬥狀態。"],
    hit: ["硬碰硬地壓上去", "全力施壓", "不留空隙地攻擊"],
    crit: ["抓住破綻，狠狠補上一擊", "以精準一擊撕開防線", "將破綻直接放大"],
    combo: ["趁勢追打", "連續壓上", "不給喘息機會"],
    dodge: ["輕巧避開", "側身閃過", "拉開距離重整架勢"],
    block: ["穩穩擋下", "用防線吃住", "將攻擊卸開"],
    counter: ["立刻反咬回去", "順著破口追擊", "抓準時機反手一擊"],
    execute: ["直接收掉", "乾脆終結", "不留活口"],
    lowHp: ["越戰越兇", "開始拼命反撲", "火力不減反增"]
  },
  swordsman: {
    intro: ["劍鋒出鞘，節奏俐落。", "腳步一沉，劍路已定。", "鋒芒收束，準備斬出第一線。"],
    hit: ["以劍鋒劃破攻勢", "利落斬開空氣", "劍路直取要害"],
    crit: ["劍光一閃，乾淨俐落地切入破綻", "刀口般的劍鋒直接命中死角", "斬擊精準到讓人無法反應"],
    combo: ["劍勢連段不斷壓上", "連斬像浪潮一樣逼近", "劍光接續收割空隙"],
    dodge: ["以步法閃過", "收劍側身避開", "劍士身法俐落轉位"],
    block: ["橫劍格開", "穩穩架住攻擊", "劍身硬吃下衝擊"],
    counter: ["劍尖立刻回敬", "斬勢順著破綻追上", "反手一劍逼退對方"],
    execute: ["一劍斬落", "收劍收尾，直接終結", "以最短的劍路結束戰鬥"],
    lowHp: ["劍意反而更冷", "在壓力下越斬越準", "進入決勝節奏"]
  },
  warrior: {
    intro: ["斧刃壓陣，戰線向前推進。", "戰士踏步向前，氣勢先行。", "斧光與殺意一起壓來。"],
    hit: ["以斧勢硬壓", "斧刃猛然劈落", "靠蠻力正面開路"],
    crit: ["斧鋒直接破開防守", "一斧砸出致命空隙", "把破綻砍成裂口"],
    combo: ["斧勢接續碾壓", "連砍逼得對方連退", "攻擊像風暴一樣續上"],
    dodge: ["厚重身形硬是錯開", "踏步讓過攻擊", "以戰士節奏避開"],
    block: ["硬生生擋下", "靠身體與武器接住", "把攻勢頂回去"],
    counter: ["立刻甩斧回敬", "抓著空檔反劈", "順勢反打得很兇"],
    execute: ["一斧收割", "乾脆劈落", "把戰鬥直接砍停"],
    lowHp: ["越危險越兇猛", "進入血性狂潮", "斧鋒反而更重"]
  },
  dwarf_warrior: {
    intro: ["鐵錘沉沉落地，震得地面發麻。", "矮人戰士抬錘，這一擊不是開玩笑。", "工具與武器合一，準備重錘破陣。"],
    hit: ["用錘面把對手砸回去", "重鎚轟得對方站不穩", "以工匠般精準的力量敲擊要點"],
    crit: ["一錘敲進骨節與破綻之間", "鍛造般的重擊直接定型勝負", "震盪過後只剩倒地聲"],
    combo: ["重錘接重錘，壓得對方喘不過氣", "每一下都像在打鐵", "錘擊連續落下，節奏無法阻擋"],
    dodge: ["用厚實步伐避開", "側身讓開重擊", "靠重心轉移卸掉衝撞"],
    block: ["把攻擊硬頂回去", "像鐵砧一樣接下", "用厚重防線扛住"],
    counter: ["回敬一記更沉的", "趁對方失衡直接補錘", "反手就是工匠級重擊"],
    execute: ["一錘定音", "敲碎最後一口氣", "重錘收工"],
    lowHp: ["越接近極限越狂", "鐵匠之魂全面燃起", "進入不講理的敲擊模式"]
  },
  archer: {
    intro: ["弓弦拉滿，目標已鎖定。", "箭袋與呼吸同步，等待放箭。", "弓手站位穩住，下一箭不會落空。"],
    hit: ["精準放箭", "箭矢直奔破綻", "拉弓射出俐落一擊"],
    crit: ["箭頭穿過防線的瞬間幾乎聽不見聲音", "一箭命中最脆弱的位置", "像獵人一樣精準收網"],
    combo: ["連珠齊射，逼得對方連喘都難", "箭雨一路追上", "追射不給空隙"],
    dodge: ["箭步退開", "輕快地拉開距離", "利用身位閃避"],
    block: ["用臨機反應卸掉衝擊", "弓身與步伐一起格開", "以流動身法化解"],
    counter: ["迴避後立刻回射", "趁對方失位補上一箭", "以反擊箭雨回敬"],
    execute: ["一箭封喉", "箭落定勝負", "乾淨俐落地射穿結局"],
    lowHp: ["冷靜到更像獵手", "越危急越能穩住準星", "呼吸一沉，箭更準了"]
  },
  healer: {
    intro: ["治癒的氣息先穩住了戰線。", "聖光與呼吸同步，節奏慢下來了。", "治療師站位穩定，隊伍像被縫合起來。"],
    hit: ["以杖光推進", "溫和卻不退讓地擊出", "用祝福與力道一起向前"],
    crit: ["光芒忽然收束成刺點", "治癒之中帶出精準打擊", "安定的節奏裡藏著致命一擊"],
    combo: ["連續施壓，讓對方無法亂動", "治療節奏帶動攻勢", "隊伍氣息越來越穩"],
    dodge: ["以平穩步伐退開", "在光暈中滑過攻擊", "穩穩錯開來勢"],
    block: ["靠祝福把衝擊擋下", "把攻勢化成震盪", "用聖光緩衝傷害"],
    counter: ["守住後順勢反推", "把節奏拉回自己手上", "反擊像替隊伍重新接線"],
    execute: ["替戰局劃下句點", "穩穩收尾", "把局面安放到結束"],
    lowHp: ["越緊張越把大家拉回來", "治療本能完全啟動", "守護慾望變得更強"]
  },
  mage: {
    intro: ["元素已經在指尖聚攏。", "咒語起伏，戰場開始失衡。", "法師抬手，魔力順著空氣流轉。"],
    hit: ["把魔力直接推進去", "讓元素在目標身上炸開", "以術式切開距離"],
    crit: ["咒陣瞬間收縮，爆出一口元素風暴", "魔力壓縮成最精準的一擊", "術式找到最脆的那一點"],
    combo: ["連續咒文像迴圈一樣壓來", "元素串連爆發", "魔法追擊層層堆疊"],
    dodge: ["法袍一轉錯開攻擊", "借元素推開身位", "滑步拉出安全距離"],
    block: ["用法力障壁接住", "術式偏轉衝擊", "讓能量在周圍散開"],
    counter: ["立刻補上下一段咒式", "順著破綻再丟一輪元素", "把反擊寫進術式裡"],
    execute: ["元素完成終章", "術式直接封死退路", "把對方燒成結局"],
    lowHp: ["危局反而讓咒式更亮", "魔力進入高速運轉", "術式開始不講理地爆發"]
  },
  rogue: {
    intro: ["腳步壓低，影子先一步進場。", "匕首在暗處閃了一下。", "盜賊已經站在看不見的位置。"],
    hit: ["匕首快速切入", "趁縫隙貼身一刺", "以短刃連續偷襲"],
    crit: ["命中陰影裡的要害", "短刃像消失一樣穿過破綻", "把對方的反應直接切斷"],
    combo: ["連環偷襲像細雨一樣落下", "影子追著影子進攻", "節奏越來越快"],
    dodge: ["身影一晃就不見了", "貼地滑開", "利用視線死角消失"],
    block: ["短刃一橫卸掉力道", "以最小動作接下", "把衝擊轉進步伐裡"],
    counter: ["從背後補上一刀", "順著空隙反咬", "一口氣把距離吃回來"],
    execute: ["乾淨地收尾", "匕首落下，戰鬥停在這裡", "影子直接劃開終局"],
    lowHp: ["越危險越冷靜", "本能進入狩獵狀態", "殺意反而更靜了"]
  }
};

function getJobFlavor(jobProfile = {}, pStats = {}) {
  const archetype = jobProfile.archetype || "default";
  const bank = JOB_FLAVOR[archetype] || JOB_FLAVOR.default;
  const weaponBank = pickWeaponPhrases(pStats.weaponType);
  return {
    intro: bank.intro,
    hit: bank.hit,
    crit: bank.crit,
    combo: bank.combo,
    dodge: bank.dodge,
    block: bank.block,
    counter: bank.counter,
    execute: bank.execute,
    lowHp: bank.lowHp,
    atkVerbs: weaponBank
  };
}

// 應用怪物 activeEffects 到屬性計算
function applyMonsterEffects(mCalc, activeEffects = [], currentRound = 1) {
  const adjusted = { ...mCalc };

  for (const effect of activeEffects) {
    if (!effect || !effect.key) continue;

    const params = effect.params || {};
    const duration = params.duration || {};

    // 檢查持續時間（"turns" 模式）
    if (duration.mode === 'turns') {
      const appliedRound = effect.appliedAt || 1;
      const endRound = appliedRound + (duration.value || 1);
      if (currentRound > endRound) continue; // 效果已過期
    }

    // 應用各種 Buff 效果
    switch (effect.key) {
      case 'str_up':
        // STR 提升（百分比，value=30 表示 ATK +30%）
        adjusted.atk = Math.round((adjusted.atk || 0) * (1 + Math.abs(params.value || 0) / 100));
        break;
      case 'atk_up':
        // ATK 提升（百分比）
        adjusted.atk = Math.round((adjusted.atk || 0) * (1 + (params.value || 0) / 100));
        break;
      case 'def_up':
        // DEF 提升（百分比，value=25 表示 +25%）
        adjusted.def = Math.round((adjusted.def || 0) * (1 + Math.abs(params.value || 0) / 100));
        break;
      case 'dodge_up':
        // 迴避提升（百分比）
        adjusted.dodge = Math.min(100, (adjusted.dodge || 0) + (params.value || 0));
        break;
      case 'speed_up':
        // AGI 提升 → 提升迴避率
        adjusted.dodge = Math.min(100, (adjusted.dodge || 0) + (params.value || 0) * 4); // AGI 1 = dodge 4
        break;
      case 'block_chance_up':
        // 格擋率提升（新屬性，暫不實現）
        break;
      case 'crit_rate_up':
        // 爆擊率提升（百分比，value=20 表示 +20% 爆擊率）
        adjusted.crit = Math.min(100, (adjusted.crit || 0) + Math.abs(params.value || 0));
        break;
      case 'lifesteal':
        // 吸血：記錄百分比，戰鬥攻擊時處理
        adjusted.lifestealPct = (adjusted.lifestealPct || 0) + Math.abs(params.value || 0);
        break;
      case 'life_steal_strong':
        // 強力吸血：記錄百分比，戰鬥攻擊時處理
        adjusted.lifestealPct = (adjusted.lifestealPct || 0) + Math.abs(params.value || 0);
        break;
      case 'counter':
        // 反擊：記錄反擊機率，被擊中時處理
        adjusted.counterChance = (adjusted.counterChance || 0) + Math.abs(params.value || 0);
        break;
      case 'ancient_power':
        // 遠古力量：怪物增強自身 ATK value%
        adjusted.atk = Math.round((adjusted.atk || 0) * (1 + Math.abs(params.value || 0) / 100));
        break;
      case 'atk_down':
        // 攻擊力下降（百分比，value 為正數代表降低）
        adjusted.atk = Math.max(0, Math.round((adjusted.atk || 0) * (1 - Math.abs(params.value || 0) / 100)));
        break;
      case 'def_down':
        // 防禦力下降（百分比，value 為正數代表降低）
        adjusted.def = Math.max(0, Math.round((adjusted.def || 0) * (1 - Math.abs(params.value || 0) / 100)));
        break;
      case 'hit_rate_down':
        // 麻痺：命中率下降（固定值）
        adjusted.hit = Math.max(0, (adjusted.hit || 0) - Math.abs(params.value || 0));
        break;
      case 'charm':
        // 魅惑：怪物攻擊力降低 value%（混亂）
        adjusted.atk = Math.max(0, Math.round((adjusted.atk || 0) * (1 - Math.abs(params.value || 0) / 100)));
        break;
    }
  }

  return adjusted;
}

// 清理過期的 activeEffects
function cleanExpiredEffects(activeEffects = [], currentRound = 1) {
  return activeEffects.filter((effect) => {
    if (!effect || !effect.key) return false;

    const params = effect.params || {};
    const duration = params.duration || {};

    // 檢查持續時間（"turns" 模式）
    if (duration.mode === 'turns') {
      const appliedRound = effect.appliedAt || 1;
      const endRound = appliedRound + (duration.value || 1);
      if (currentRound > endRound) return false; // 效果已過期，移除
    }

    return true;
  });
}

function runCombatLoop(pStats, mCalc, mName, mHpInit, MAX_ROUNDS = 15, options = {}) {
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 傷害浮動：min~1.3，INT 縮小下限
  const rollDmg = (base) => {
    const roll = pStats.dmgMin + Math.random() * (pStats.dmgMax - pStats.dmgMin);
    return Math.max(1, Math.round(base * roll));
  };
  // 怪物攻擊固定 0.8~1.2 浮動
  const rollMDmg = (base) => Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));

  // 攻擊描述詞
  const wt = pStats.weaponType;
  const jobProfile = detectJobBattleProfile(options.equipped || {}, options.inventory || []);
  const jobFlavor = getJobFlavor(jobProfile, pStats);
  const atkVerbs = jobFlavor.atkVerbs || pickWeaponPhrases(wt);
  const critPhrases = CRIT_PHRASES;
  const comboPhrases = COMBO_PHRASES;
  const dodgePhrases = DODGE_PHRASES;
  const mDodgePhrases = MONSTER_DODGE_PHRASES;
  const mAtkPhrases = MONSTER_ATK_PHRASES;
  const blockPhrases = BLOCK_PHRASES;
  const stunPhrases = STUN_PHRASES;
  const agiFirstStrikePhrases = AGI_FIRST_STRIKE_PHRASES;
  const agiSlowedAttackPhrases = AGI_SLOWED_ATTACK_PHRASES;

  // ── AGI 優勢判定 ──
  const playerAgi = pStats.agi || 1;
  const monsterAgi = mCalc.agi || 1;
  const agiDiff = playerAgi - monsterAgi;
  const hasAgiFirstStrike = agiDiff > 2;   // 第1回合玩家先手，怪物無法反擊
  const hasAgiSlowedMonster = agiDiff > 5; // 怪物只在偶數回合反擊

  let mHp = mHpInit;
  let pHp = pStats.maxHp;
  let outcome = null;
  let totalDamage = 0;
  let round = 1;
  let stunRoundsLeft = 0; // 怪物剩餘擊暈回合數
  let monsterActiveEffects = []; // 怪物的 active effects（Buff/Debuff）
  let warriorRageTriggered = false; // 戰士激怒只提示一次

  const roundLogs = [];

  while (round <= MAX_ROUNDS && outcome === null) {
    const log = [`**【第 ${round} 回合】**`];
    if (round === 1 && jobProfile.jobName) {
      log.push(`✨ ${jobProfile.jobName} ${rand(jobFlavor.intro)}`);
      // 職業配武器效果提示（只顯示本場實際生效的）
      const wt = pStats.weaponType || "";
      const jobHints = [];
      if (pStats.hasMageBadge && wt.startsWith("staff")) {
        const tier = wt === "staff_2h" ? "屬性攻擊(中)" : "屬性攻擊(小)";
        jobHints.push(`🔮 **(法師)** ${tier}：法杖傷害提升，命中後有機率觸發燒傷/麻痺/冰凍`);
      }
      if (pStats.hasArcherBadge && wt === "bow") {
        jobHints.push(`🏹 **(弓箭手)** 命中要害(中)：弓傷害提升，命中要害機制啟動`);
      }
      if (pStats.hasWarriorBadge && (wt === "axe_1h" || wt === "axe_2h")) {
        const tier = wt === "axe_2h" ? "低血爆發(中)" : "低血爆發(小)";
        jobHints.push(`🪓 **(戰士)** ${tier}：低血量時傷害爆發${wt === "axe_2h" ? "，爆擊傷害加深" : ""}`);
      }
      if (pStats.hasDwarfBadge && wt.startsWith("mace")) {
        const tier = wt === "mace_2h" ? "擊暈(中)" : "擊暈(小)";
        jobHints.push(`🔨 **(矮人)** ${tier}：高血量時擊暈機率提升${wt === "mace_2h" ? "，命中後有機率額外擊暈" : ""}`);
      }
      if (pStats.hasRogueBadge && wt === "dagger") {
        jobHints.push(`🗡️ **(盜賊)** 中毒(小)＋連擊強化：命中後有機率中毒疊加，連擊傷害提升`);
      }
      if (pStats.hasSwordsmanBadge && wt === "sword_1h" && pStats.blockChance > 0) {
        jobHints.push(`⚔️ **(劍士)** 盾反強化(小)：格擋反擊命中率與爆擊率提升`);
      }
      if (pStats.hasHealerBadge) {
        if (wt === "staff_1h") jobHints.push(`💚 **(治療師)** 回血(小)＋輸出提升：單手杖傷害提升，每回合自我回血`);
        else if (wt === "staff_2h") jobHints.push(`💚 **(治療師)** 回血(小)＋輸出提升(中)：雙手杖傷害提升，每回合自我回血`);
        else jobHints.push(`💚 **(治療師)** 回血(小)：每回合自我回血`);
      }
      for (const hint of jobHints) log.push(hint);
    }

    // ── 應用怪物的 activeEffects（Buff/Debuff） ──
    const adjustedMCalc = applyMonsterEffects(mCalc, monsterActiveEffects, round);

    // ── 應用怪物的恢復效果（heal_over_time） ──
    if (Array.isArray(monsterActiveEffects)) {
      for (const healEff of monsterActiveEffects) {
        if (!healEff || !healEff.key) continue;
        const healParams = healEff.params || {};
        const healDuration = healParams.duration || {};

        // 檢查效果是否仍在持續
        if (healDuration.mode === 'turns') {
          const appliedRound = healEff.appliedAt || 1;
          const endRound = appliedRound + (healDuration.value || 1);
          if (round > endRound) continue;
        }

        // 應用怪物恢復
        if (healEff.key === 'heal_over_time') {
          const mode = String(healParams.mode || 'pct').toLowerCase();
          const val = Number(healParams.value ?? 0);
          if (!Number.isFinite(val) || val === 0) continue;
          const heal = mode === 'pct' ? Math.max(0, Math.round(mHpInit * (val / 100))) : Math.max(0, Math.round(val));
          if (heal > 0) {
            mHp = Math.min(mHpInit, mHp + heal);
            log.push(`💚 ${mName} 生命力逐漸恢復，回復 **${heal}** HP！（${mName} 剩 ${mHp} HP）`);
          }
        }
      }
    }

    // ── 應用怪物的 DOT 效果（燒傷/freeze/麻痺） ──
    let monsterFrozenThisRound = false;
    if (Array.isArray(monsterActiveEffects)) {
      for (const mEff of monsterActiveEffects) {
        if (!mEff || !mEff.key) continue;
        const mParams = mEff.params || {};
        const mDur = mParams.duration || {};

        if (mDur.mode === 'turns') {
          const appliedRound = mEff.appliedAt || 1;
          const endRound = appliedRound + (mDur.value || 1);
          if (round > endRound) continue;
        }

        // 燒傷：每回合扣怪物最大 HP 的 value%（DB params，預設 1%）
        if (mEff.key === 'burn') {
          const burnPct = Number(mParams.value ?? 1);
          const burnBase = mParams.mode === 'current' ? mHp : mHpInit;
          const burnDmg = Math.max(1, Math.round(burnBase * (burnPct / 100)));
          mHp -= burnDmg;
          totalDamage += burnDmg;
          log.push(`🔥 燒傷持續！${mName} 受到 **${burnDmg}** 點灼燒傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 中毒：每回合扣怪物最大 HP 的 value%（盜賊疊加）
        if (mEff.key === 'poison') {
          const poisonPct = Number(mParams.value ?? 0.5);
          const poisonDmg = Math.max(1, Math.round(mHpInit * (poisonPct / 100)));
          mHp -= poisonDmg;
          totalDamage += poisonDmg;
          log.push(`☠️ 中毒持續！${mName} 受到 **${poisonDmg}** 點毒素傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 冰凍：此回合怪物無法攻擊（一次性，appliedAt 回合消耗）
        if (mEff.key === 'freeze') {
          if (round === (mEff.appliedAt || round)) {
            monsterFrozenThisRound = true;
          }
        }

        // 擊暈（卡片觸發）：設定 stunRoundsLeft
        if (mEff.key === 'stun') {
          const stunTurns = Number(mParams.duration?.value ?? 1);
          // appliedAt 回合起持續 stunTurns 回合
          const stunEnd = (mEff.appliedAt || 1) + stunTurns;
          if (round <= stunEnd && stunRoundsLeft < stunTurns) {
            stunRoundsLeft = Math.max(stunRoundsLeft, stunEnd - round + 1);
          }
        }

        // 流血：每回合扣怪物最大 HP 的 value%
        if (mEff.key === 'bleed') {
          const bleedPct = Number(mParams.value ?? 10);
          const bleedDmg = Math.max(1, Math.round(mHpInit * (bleedPct / 100)));
          mHp -= bleedDmg;
          totalDamage += bleedDmg;
          log.push(`🩸 流血持續！${mName} 受到 **${bleedDmg}** 點流血傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 閃電：每回合對怪物造成 value% 最大 HP 電擊傷害
        if (mEff.key === 'lightning') {
          const lightPct = Number(mParams.value ?? 20);
          const lightDmg = Math.max(1, Math.round(mHpInit * (lightPct / 100)));
          mHp -= lightDmg;
          totalDamage += lightDmg;
          log.push(`⚡ 閃電持續！${mName} 受到 **${lightDmg}** 點雷電傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }
      }
    }
    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 應用玩家的 DOT 效果（如中毒） ──
    if (Array.isArray(options.playerActiveEffects)) {
      for (const dotEffect of options.playerActiveEffects) {
        if (!dotEffect || !dotEffect.key) continue;
        const dotParams = dotEffect.params || {};
        const dotDuration = dotParams.duration || {};

        // 檢查效果是否仍在持續（"turns" 模式）
        if (dotDuration.mode === 'turns') {
          const appliedRound = dotEffect.appliedAt || 1;
          const endRound = appliedRound + (dotDuration.value || 1);
          if (round > endRound) continue; // 效果已過期
        }

        // 應用 DOT 傷害
        if (dotEffect.key === 'poison') {
          const damagePercent = Number(dotParams.damagePercent ?? dotParams.value ?? 5);
          const dotDmg = Math.max(1, Math.round((pStats.maxHp || 1) * (damagePercent / 100)));
          pHp -= dotDmg;
          log.push(`☠️ 中毒傷害！造成 **${dotDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
        // 流血 DOT（怪物施加給玩家）
        if (dotEffect.key === 'bleed') {
          const bleedPct = Number(dotParams.value ?? 10);
          const bleedDmg = Math.max(1, Math.round((pStats.maxHp || 1) * (bleedPct / 100)));
          pHp -= bleedDmg;
          log.push(`🩸 流血持續！你受到 **${bleedDmg}** 點流血傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
        // 燒傷 DOT（怪物施加給玩家）
        if (dotEffect.key === 'burn') {
          const burnPct = Number(dotParams.value ?? 5);
          const burnDmg = Math.max(1, Math.round((pStats.maxHp || 1) * (burnPct / 100)));
          pHp -= burnDmg;
          log.push(`🔥 燒傷持續！你受到 **${burnDmg}** 點灼燒傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
        // 閃電 DOT（怪物施加給玩家）
        if (dotEffect.key === 'lightning') {
          const lightPct = Number(dotParams.value ?? 20);
          const lightDmg = Math.max(1, Math.round((pStats.maxHp || 1) * (lightPct / 100)));
          pHp -= lightDmg;
          log.push(`⚡ 閃電傷害！你受到 **${lightDmg}** 點雷電傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
      }
    }

    // ── 套用來自隊伍（party）的被動 aura，例如治療師提供的每回合回復 ──
    let roundDmgMultiplier = 1; // 每回合重置，累積本回合所有 party_damage_up
    try {
      const partyEffects = Array.isArray(options.partyEffects) ? options.partyEffects : [];
      for (const pe of partyEffects) {
        if (!pe || !pe.key) continue;
        // 支援治療 over-time 的簡單實作：key 可為 'heal_over_time' 或自訂 'party_heal'
        if (pe.key === 'heal_over_time' || pe.key === 'party_heal') {
          const mode = String(pe.params?.mode || '').toLowerCase();
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (!Number.isFinite(val) || val === 0) continue;
          const heal = mode === 'pct' ? Math.max(0, Math.round((pStats.maxHp || 0) * (val / 100))) : Math.max(0, Math.round(val));
          if (heal > 0) {
            pHp = Math.min(pStats.maxHp, pHp + heal);
            const healerTag = pe.sourceName ? `（${pe.sourceName}）` : "";
            log.push(`💚 **(治療師)** 光環${healerTag} 回復 **${heal}** HP`);
          }
        }
        // 支援隊伍傷害加成（每回合生效）
        if (pe.key === 'party_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundDmgMultiplier *= (1 + val / 100);
            const healerTag = pe.sourceName ? `（${pe.sourceName}）` : "";
            log.push(`🔥 **(治療師)** 光環${healerTag} 傷害提升 ${val}%`);
          }
        }
      }
    } catch (e) {}

    // ── 治療師自我回血（每回合 3% 最大 HP） ──
    if (pStats.hasHealerBadge) {
      const selfHeal = Math.max(1, Math.round(pStats.maxHp * 0.03));
      if (pHp < pStats.maxHp) {
        pHp = Math.min(pStats.maxHp, pHp + selfHeal);
        log.push(`💚 **(治療師)** 自我回復 **${selfHeal}** HP`);
      }
    }

    // ── 卡片技能觸發 ──
    // 怪物卡片 30% 觸發，玩家裝備卡片 10% 觸發
    // 每張卡片獨立判定，所以三個槽位都可能在同一回合觸發

    // 怪物自身的卡片技能
    const monsterEquipped = options.monsterEquipped || {};
    // 沉默：怪物無法發動卡片技能
    const monsterIsSilenced = Array.isArray(monsterActiveEffects) && monsterActiveEffects.some(e => {
      if (e?.key !== 'silence') return false;
      const dur = e.params?.duration || {};
      if (dur.mode === 'turns') {
        const end = (e.appliedAt || 1) + (dur.value || 1);
        return round <= end;
      }
      return true;
    });
    const monsterHasCardSkill = !!(monsterEquipped.special_1?.monsterCardSkill?.key);
    if (monsterIsSilenced && monsterHasCardSkill) {
      log.push(`🔇 ${mName} 陷入沉默，無法發動技能！`);
    }
    if (!monsterIsSilenced && monsterEquipped.special_1 && monsterEquipped.special_1.monsterCardSkill && monsterEquipped.special_1.monsterCardSkill.key) {
      const equippedCard = monsterEquipped.special_1;
      const skill = equippedCard.monsterCardSkill;
      const cardName = equippedCard.itemName || equippedCard.name || '卡片';

      // 怪物增益效果（施加給怪物自己）
      const MONSTER_BUFF_KEYS = new Set(['str_up', 'def_up', 'atk_up', 'lifesteal', 'life_steal_strong', 'crit_rate_up', 'atk_multiplier_up', 'counter', 'ancient_power']);
      // 怪物DEBUFF效果（施加給玩家）
      const MONSTER_DEBUFF_KEYS = new Set(['poison', 'bleed', 'burn', 'atk_down', 'def_down', 'silence', 'freeze', 'stun', 'charm', 'lightning', 'dark_curse']);

      if (Math.random() * 100 < 30) {
        log.push(`🎴 **${mName}** 發動【${skill.name || cardName}】！${skill.description ? skill.description : ''}`);

        if (skill.procEffects && Array.isArray(skill.procEffects)) {
          for (const procEffect of skill.procEffects) {
            if (!procEffect || !procEffect.key) continue;
            const effectEntry = {
              key: procEffect.key,
              params: procEffect.params || {},
              appliedAt: round,
              source: 'monster_skill'
            };
            // 根據效果類型決定施加對象
            if (MONSTER_BUFF_KEYS.has(procEffect.key)) {
              // 怪物增益 → 施加給怪物（同 key 先清舊的，防止乘法疊加）
              for (let i = monsterActiveEffects.length - 1; i >= 0; i--) {
                if (monsterActiveEffects[i].key === procEffect.key && monsterActiveEffects[i].source === 'monster_skill') {
                  monsterActiveEffects.splice(i, 1);
                }
              }
              monsterActiveEffects.push(effectEntry);
            } else if (MONSTER_DEBUFF_KEYS.has(procEffect.key)) {
              // 怪物DEBUFF → 施加給玩家（同 key 先清舊的，防止 DOT 疊加）
              if (!options.playerActiveEffects) options.playerActiveEffects = [];
              for (let i = options.playerActiveEffects.length - 1; i >= 0; i--) {
                if (options.playerActiveEffects[i].key === procEffect.key && options.playerActiveEffects[i].source === 'monster_skill') {
                  options.playerActiveEffects.splice(i, 1);
                }
              }
              options.playerActiveEffects.push(effectEntry);
            }
          }
        }
      }
    }

    // ── 玩家攻擊 ──
    const attackCount = pStats.isDualWield ? 2 : 1;
    const monsterIsStunned = stunRoundsLeft > 0; // 擊暈中：怪物無法閃避

    // ── 檢查玩家受到的狀態效果（怪物施加的 debuff）──
    let playerIsStunned = false;
    let playerIsFrozen = false;
    let playerIsSilenced = false;
    if (Array.isArray(options.playerActiveEffects)) {
      for (const pEff of options.playerActiveEffects) {
        if (!pEff || !pEff.key) continue;
        const pDur = pEff.params?.duration || {};
        if (pDur.mode === 'turns') {
          const pEnd = (pEff.appliedAt || 1) + (pDur.value || 1);
          if (round > pEnd) continue;
        }
        // stun：value 為觸發機率（40% = 40），每回合重新判定
        if (pEff.key === 'stun') {
          const stunChance = Number(pEff.params?.value ?? 100);
          if (Math.random() * 100 < stunChance) playerIsStunned = true;
        }
        // freeze：攻速 -50% → 每 2 回合跳過 1 次攻擊（偶數回合才攻擊）
        if (pEff.key === 'freeze') {
          if (round % 2 !== 0) playerIsFrozen = true;
        }
        if (pEff.key === 'silence') playerIsSilenced = true;
      }
    }
    if (playerIsStunned) {
      log.push(`😵 **擊暈**！你無法行動，此回合無法攻擊！`);
    } else if (playerIsFrozen) {
      log.push(`🧊 **冰凍**！行動遲緩，此回合無法攻擊！`);
    }

    // 玩家裝備的卡片技能（special_1/2/3 獨立觸發）
    // 沉默（怪物施加）：玩家無法發動卡片技能
    if (playerIsSilenced) {
      log.push(`🔇 你陷入沉默，此回合無法發動卡片技能！`);
    }
    // 攻擊型效果（施加給怪物）；其餘增益型效果施加給玩家
    const PLAYER_CARD_OFFENSIVE_KEYS = new Set([
      'atk_down', 'def_down', 'poison', 'bleed', 'burn', 'freeze', 'stun',
      'silence', 'charm', 'lightning', 'freeze_slow'
      // dark_curse / life_steal_strong / ancient_power → 施加給玩家，見下方 playerActiveEffects
    ]);
    const specialSlots = ['special_1', 'special_2', 'special_3'];
    for (const slot of specialSlots) {
      const slotItem = options.equipped?.[slot];
      if (!playerIsSilenced && slotItem && slotItem.monsterCardSkill && slotItem.monsterCardSkill.key) {
        const skill = slotItem.monsterCardSkill;
        const cardName = slotItem.itemName || slotItem.name || '卡片';

        if (Math.random() * 100 < 5) {
          log.push(`🎴 【${skill.name || cardName}】發動！${skill.description ? skill.description : ''}`);

          if (skill.procEffects && Array.isArray(skill.procEffects)) {
            for (const procEffect of skill.procEffects) {
              if (!procEffect || !procEffect.key) continue;
              const effectEntry = {
                key: procEffect.key,
                params: procEffect.params || {},
                appliedAt: round,
                source: 'player_card_skill'
              };
              // 攻擊型效果 → 施加給怪物；增益型效果 → 施加給玩家
              if (PLAYER_CARD_OFFENSIVE_KEYS.has(procEffect.key)) {
                monsterActiveEffects.push(effectEntry);
              } else {
                if (!options.playerActiveEffects) options.playerActiveEffects = [];
                options.playerActiveEffects.push(effectEntry);
              }
            }
          }
        }
      }
    }

    // ── 計算玩家主動效果倍率 ──
    let playerAtkMultiplier = 1;
    let playerCritRateBonus = 0;
    let playerLifestealPct = 0;
    let playerLifestealStrongPct = 0;
    if (Array.isArray(options.playerActiveEffects)) {
      for (const eff of options.playerActiveEffects) {
        if (!eff) continue;
        const effParams = eff.params || {};
        const effValue = Number(effParams.value ?? 0);
        // 過期檢查
        if (effParams.duration?.mode === 'turns') {
          const end = (eff.appliedAt || 1) + (effParams.duration.value || 1);
          if (round > end) continue;
        }
        if (eff.key === 'atk_down') {
          // 從怪物施加的攻擊力下降
          if (effValue > 0) playerAtkMultiplier *= (1 - effValue / 100);
          else if (effValue < 0) playerAtkMultiplier *= (1 - Math.abs(effValue) / 100);
        } else if (eff.key === 'charm') {
          // 魅惑（米拉桑）：玩家攻擊力降低 value%
          playerAtkMultiplier *= (1 - Math.abs(effValue) / 100);
        } else if (eff.key === 'dark_curse') {
          // 黑暗詛咒（森林盜賊）：玩家攻擊力降低 |value|%
          playerAtkMultiplier *= (1 - Math.abs(effValue) / 100);
        } else if (eff.key === 'crit_rate_up') {
          // 玩家爆擊率提升（來自玩家卡片技能）
          playerCritRateBonus += effValue;
        } else if (eff.key === 'lifesteal') {
          // 玩家吸血（來自玩家卡片技能）
          playerLifestealPct += effValue;
        } else if (eff.key === 'life_steal_strong') {
          // 強力吸血：傷害的 value% 回復為 HP（來自玩家卡片技能）
          playerLifestealStrongPct += effValue;
        }
      }
    }

    for (let a = 0; a < attackCount && outcome === null && !playerIsStunned && !playerIsFrozen; a++) {
      const hitChance = pStats.hit - adjustedMCalc.dodge;
      if (monsterIsStunned || Math.random() * 100 < hitChance) {
        // 破防判定（斧）
        const isBreak = Math.random() * 100 < pStats.armorBreakChance;
        const effectiveDef = isBreak ? 0 : adjustedMCalc.def;
        // 法杖無視怪物 DEF 的 bypassMonsterDefPct%（預設0，法杖50）
        const bypassPct = pStats.bypassMonsterDefPct ?? 0;
        const finalDef = Math.max(0, effectiveDef * (1 - bypassPct / 100));

        let dmg = rollDmg(Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * (1 - finalDef / 100))));

        // 職業傷害倍率
        // 弓箭手：弓傷害 ×1.2
        if (pStats.hasArcherBadge && pStats.weaponType === "bow") {
          dmg = Math.round(dmg * pStats.archerBowDamageBoost);
        }

        // 法師：法杖傷害 ×1.15
        if (pStats.hasMageBadge && pStats.weaponType && pStats.weaponType.startsWith("staff")) {
          dmg = Math.round(dmg * pStats.mageDamageMultiplier);
        }

        // 戰士：低血量傷害 ×1.15（<35%）
        if (pStats.hasWarriorBadge && pHp <= Math.floor((pStats.maxHp || 1) * 0.35)) {
          pStats.warriorLowHpMultiplier = 1.15;
          dmg = Math.round(dmg * 1.15);
          if (!warriorRageTriggered) {
            warriorRageTriggered = true;
            log.push(`🔱 **(戰士)** 血氣上湧，傷害爆發！`);
          }
        }

        // --- Compute on_high_hp bonuses (per-effect threshold) early so they affect crit checks ---
        let extraHighHpCrit = 0;
        let extraHighHpStun = 0;
        try {
          const equippedCtx = options.equipped || null;
          if (equippedCtx) {
            const highEffects = collectEquipmentEffects(equippedCtx, 'on_high_hp', { equipped: equippedCtx, inventory: options.inventory || [] });
            for (const he of highEffects) {
              if (!he || !he.params) continue;
              const thresholdPct = Number.isFinite(Number(he.params.thresholdPct)) ? Number(he.params.thresholdPct) : 90;
              if (pHp >= Math.ceil((pStats.maxHp || 1) * (thresholdPct / 100))) {
                if (he.key === 'stun_chance_up' && Number.isFinite(Number(he.params.value))) {
                  extraHighHpStun += Number(he.params.value);
                }
                if (he.key === 'crit_rate_up' && Number.isFinite(Number(he.params.value))) {
                  extraHighHpCrit += Number(he.params.value);
                }
              }
            }
          }
        } catch (e) {}

        // Crit check：獨立判斷普通爆擊和弓箭手命中要害（可同時發生 - 疊加機制）
        let isCrit = false;
        let isArcherCrit = false;

        // 普通爆擊邏輯（LUK 驅動 + 卡片技能加成）
        const effectiveCritChance = (Number(pStats.crit) || 0) + extraHighHpCrit + playerCritRateBonus;
        isCrit = Math.random() * 100 < effectiveCritChance;

        // 弓箭手命中要害邏輯（獨立判斷，可與爆擊同時發生）
        if (pStats.hasArcherBadge && pStats.weaponType === "bow" && pStats.archerCritRate > 0) {
          isArcherCrit = Math.random() * 100 < pStats.archerCritRate;
        }

        // 應用傷害倍率：
        // 1. 基礎傷害已套用弓箭手傷害倍率（×1.2）
        // 2. 如果觸發爆擊，再乘以 2.5
        // 3. 如果觸發要害，再乘以 1.5
        // 4. 如果同時觸發，傷害疊加
        if (isCrit) {
          const critBase = Math.round(pStats.atk * (1 - finalDef / 100));
          const critMultiplier = 2.5 + (pStats.warriorCritDamageBonus || 0); // 戰士雙手斧 +0.2 → 2.7
          dmg = Math.round(rollDmg(Math.max(1, critBase)) * critMultiplier);

          // 弓箭手傷害倍率也應用於爆擊
          if (pStats.hasArcherBadge && pStats.weaponType === "bow") {
            dmg = Math.round(dmg * pStats.archerBowDamageBoost);
          }
        }

        // 要害傷害倍率（獨立疊加）
        if (isArcherCrit) {
          dmg = Math.round(dmg * (pStats.archerCritMultiplier || 1.5));
        }

        // 低血量傷害加成（若 equipped 傳入且玩家 HP <= 35%）
        try {
          const equipped = options.equipped || null;
          if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.35)) {
            const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
            for (const eff of lowHpEffects) {
              if (!eff || !eff.params) continue;
              if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
                dmg = Math.max(1, Math.round(dmg * Number(eff.params.value)));
              }
            }
          }
        } catch (e) {}

        mHp -= dmg;
        totalDamage += dmg;
        const breakNote = isBreak ? "💥**破防**！" : "";
        let critNote = "";

        // 顯示爆擊和要害的組合
        if (isCrit && isArcherCrit) {
          // 同時觸發爆擊和要害
          critNote = `✨${rand(critPhrases)}！🎯**(弓箭手)** ${rand(['命中要害', '精準破綻', '弱點命中'])}！`;
        } else if (isArcherCrit) {
          // 只觸發要害
          critNote = `🎯**(弓箭手)** **${rand(['命中要害', '精準破綻', '弱點命中', '一擊斃命'])}**！`;
        } else if (isCrit) {
          // 只觸發爆擊
          critNote = `✨**${rand(critPhrases)}**！`;
        }

        log.push(`⚔️ ${critNote}${breakNote}${rand(jobFlavor.hit)}，${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

        // ── 玩家吸血效果（來自卡片技能）──
        if (playerLifestealPct > 0) {
          const healAmt = Math.max(1, Math.round(dmg * (playerLifestealPct / 100)));
          pHp = Math.min(pStats.maxHp, pHp + healAmt);
          log.push(`💚 吸取生命力！恢復 **${healAmt}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
        }
        // ── 強力吸血效果（林地妖靈卡）──
        if (playerLifestealStrongPct > 0) {
          const sHeal = Math.max(1, Math.round(dmg * (playerLifestealStrongPct / 100)));
          pHp = Math.min(pStats.maxHp, pHp + sHeal);
          log.push(`💜 強力吸血！恢復 **${sHeal}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
        }

        // ── 檢查怪物反彈傷害效果 ──
        if (Array.isArray(monsterActiveEffects)) {
          for (const reflectEff of monsterActiveEffects) {
            if (reflectEff && reflectEff.key === 'reflect_damage') {
              const reflectParams = reflectEff.params || {};
              const reflectPercent = Number(reflectParams.reflectPercent ?? reflectParams.value ?? 50);
              const reflectDmg = Math.max(1, Math.round(dmg * (reflectPercent / 100)));
              pHp -= reflectDmg;
              log.push(`🛡️ ${mName} 的甲殼反彈！你受到 **${reflectDmg}** 點反彈傷害！（你剩 ${Math.max(0, pHp)} HP）`);
              if (pHp <= 0) { outcome = "lose"; break; }
            }
          }
        }
        // ── 怪物反擊（counter）：被玩家攻擊時，value% 機率反擊造成受到傷害的 20%──
        if (outcome === null && Array.isArray(monsterActiveEffects)) {
          for (const ctEff of monsterActiveEffects) {
            if (!ctEff || ctEff.key !== 'counter') continue;
            const ctParams = ctEff.params || {};
            const ctDur = ctParams.duration || {};
            if (ctDur.mode === 'turns') {
              const ctEnd = (ctEff.appliedAt || 1) + (ctDur.value || 1);
              if (round > ctEnd) continue;
            }
            const counterChance = Number(ctParams.value || 30);
            if (Math.random() * 100 < counterChance) {
              const counterDmg = Math.max(1, Math.round(dmg * 0.2));
              pHp -= counterDmg;
              log.push(`🦀 ${mName} **反擊**！以受到傷害的 20% 回擊，造成 **${counterDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
              if (pHp <= 0) { outcome = "lose"; }
            }
            break; // 只處理第一個 counter 效果
          }
        }
        // 擊暈判定（爆擊不觸發）
        let stunBonus = extraHighHpStun;
        // 矮人：高血量擊暈加成（>90%）
        if (pStats.hasDwarfBadge && pStats.weaponType && pStats.weaponType.startsWith("mace")) {
          if (pHp >= Math.ceil((pStats.maxHp || 1) * 0.9)) {
            stunBonus += pStats.dwarfHighHpStunBoost;
          }
        }
        const effectiveStunChance = (Number(pStats.stunChance) || 0) + stunBonus;
        if (!isCrit && Math.random() * 100 < effectiveStunChance) {
          stunRoundsLeft = 3;
          log.push(`😵 ${mName} ${rand(stunPhrases)}！接下來 3 回合無法攻擊！`);
        }

        // 斬殺判定（例：雙手劍職業被動）
        if (mHp > 0 && pStats.executeChance > 0 && pStats.executeThresholdPct > 0) {
          const thresholdHp = Math.max(1, Math.floor(mHpInit * (pStats.executeThresholdPct / 100)));
          if (mHp <= thresholdHp && Math.random() * 100 < pStats.executeChance) {
            const executeDamage = mHp;
            mHp = 0;
            totalDamage += executeDamage;
            log.push(`🗡️ **斬殺觸發**！${mName} 生命低於 ${pStats.executeThresholdPct}% ，${rand(EXECUTE_PHRASES)}！`);
          }
        }

        if (mHp <= 0) { outcome = "win"; break; }

        // ── 職業徽章 on_hit proc（直接讀 DB procEffects，不 hardcode）──
        const jobEqForProc = options.equipped?.job_eq;
        if (jobEqForProc && Array.isArray(jobEqForProc.procEffects)) {
          for (const pe of jobEqForProc.procEffects) {
            if (!pe || pe.trigger !== 'on_hit' || pe.target !== 'enemy') continue;
            // 武器條件
            if (pe.condition?.weaponType && pe.condition.weaponType !== wt) continue;
            if (Math.random() * 100 >= (pe.chance || 0)) continue;

            const pp = pe.params || {};
            const dur = { ...pp.duration } || { mode: 'turns', value: 3 };

            switch (pe.key) {
              case 'burn': {
                monsterActiveEffects = monsterActiveEffects.filter(e => e.key !== 'burn');
                monsterActiveEffects.push({ key: 'burn', params: { value: pp.value ?? 1, mode: pp.mode ?? 'pct', duration: dur }, appliedAt: round, source: 'job_proc' });
                log.push(`🔥 **(法師)** **燒傷**！${mName} 陷入燃燒狀態，持續 ${dur.value ?? 3} 回合！`);
                break;
              }
              case 'hit_down': {
                monsterActiveEffects = monsterActiveEffects.filter(e => e.key !== 'hit_rate_down');
                monsterActiveEffects.push({ key: 'hit_rate_down', params: { value: pp.value ?? 15, duration: dur }, appliedAt: round, source: 'job_proc' });
                log.push(`⚡ **(法師)** **麻痺**！${mName} 行動遲緩，命中率下降，持續 ${dur.value ?? 3} 回合！`);
                break;
              }
              case 'freeze': {
                const recentFreeze = monsterActiveEffects.find(e => e.key === 'freeze' && e.appliedAt >= round - 1);
                if (!recentFreeze) {
                  monsterActiveEffects = monsterActiveEffects.filter(e => e.key !== 'freeze');
                  monsterActiveEffects.push({ key: 'freeze', params: { duration: dur, bossImmune: pp.bossImmune ?? true }, appliedAt: round + 1, source: 'job_proc' });
                  log.push(`🧊 **(法師)** **冰凍**！${mName} 被凍結，下回合無法攻擊！`);
                }
                break;
              }
              case 'proc_stun': {
                stunRoundsLeft = Math.max(stunRoundsLeft, dur.value ?? 1);
                log.push(`😵 **(矮人)** **槌擊暈眩**！${mName} 被重擊擊暈，下回合無法攻擊！`);
                break;
              }
              case 'proc_poison': {
                const existing = monsterActiveEffects.find(e => e.key === 'poison');
                const prevPct = existing ? Number(existing.params?.value ?? 0) : 0;
                const nextPctRaw = Math.min(pp.maxPct ?? 3, prevPct + (existing ? (pp.stackAdd ?? 1) : (pp.value ?? 0.5)));
                const nextPct = Math.ceil(nextPctRaw * 10) / 10;
                monsterActiveEffects = monsterActiveEffects.filter(e => e.key !== 'poison');
                monsterActiveEffects.push({ key: 'poison', params: { value: nextPct, mode: 'pct', duration: dur }, appliedAt: round, source: 'job_proc' });
                if (existing) {
                  log.push(`☠️ **(盜賊)** **中毒加深**！${mName} 毒性增強至每回合 ${nextPct}% HP 傷害！`);
                } else {
                  log.push(`☠️ **(盜賊)** **中毒**！${mName} 陷入中毒狀態，每回合損失 ${nextPct}% HP！`);
                }
                break;
              }
            }
          }
        }

        // 連擊（匕首+20%，AGI驅動）
        // 盜賊：連擊機率加成（+10%）
        let comboChance = pStats.combo;
        if (pStats.hasRogueBadge && pStats.weaponType === "dagger") {
          comboChance = Math.min(80, comboChance + 10);
        }

        if (Math.random() * 100 < comboChance) {
          const comboBase = Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * (1 - finalDef / 100)));
          let cdmg = Math.max(1, Math.round(rollDmg(comboBase) * (pStats.comboDamageMultiplier || 1)));

          // 盜賊：連擊傷害倍率加成（+10%）
          if (pStats.hasRogueBadge && pStats.weaponType === "dagger") {
            cdmg = Math.round(cdmg * 1.1);
          }

          try {
            const equipped = options.equipped || null;
            if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.35)) {
              const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
              for (const eff of lowHpEffects) {
                if (!eff || !eff.params) continue;
                if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
                  cdmg = Math.max(1, Math.round(cdmg * Number(eff.params.value)));
                }
              }
            }
          } catch (e) {}
          mHp -= cdmg;
          totalDamage += cdmg;
          log.push(`⚡ **${rand(jobFlavor.combo)}** 追加攻擊造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

          if (mHp > 0 && pStats.executeChance > 0 && pStats.executeThresholdPct > 0) {
            const thresholdHp = Math.max(1, Math.floor(mHpInit * (pStats.executeThresholdPct / 100)));
            if (mHp <= thresholdHp && Math.random() * 100 < pStats.executeChance) {
              const executeDamage = mHp;
              mHp = 0;
              totalDamage += executeDamage;
              log.push(`🗡️ **斬殺觸發**！${mName} 生命低於 ${pStats.executeThresholdPct}% ，${rand(EXECUTE_PHRASES)}！`);
            }
          }

          if (mHp <= 0) { outcome = "win"; break; }
        }
      } else {
        log.push(`💨 ${mName} ${rand(jobFlavor.dodge)}，你的攻擊落空了！`);
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 怪物攻擊 ──
    // AGI 優勢判定：第1回合先手，或偶數回合才反擊
    let monsterAttackCount = 0;
    let monsterDmgThisRound = 0; // 怪物本回合總傷害（甲蟹反擊用）
    let skipMonsterAttackReason = null;

    if (stunRoundsLeft > 0) {
      stunRoundsLeft--;
      skipMonsterAttackReason = "stun";
    } else if (monsterFrozenThisRound) {
      skipMonsterAttackReason = "freeze";
    } else if (hasAgiFirstStrike && round === 1) {
      skipMonsterAttackReason = "agi_first_strike";
    } else if (hasAgiSlowedMonster && round % 2 !== 0) {
      // 如果 AGI 差 > 5，奇數回合怪物不攻擊
      skipMonsterAttackReason = "agi_slowed";
    } else {
      monsterAttackCount = pStats.monsterAttackCount || 1;
    }

    if (skipMonsterAttackReason === "stun") {
      log.push(`😵 ${mName} 仍處於擊暈狀態，無法攻擊！`);
    } else if (skipMonsterAttackReason === "freeze") {
      log.push(`🧊 ${mName} 被冰凍住，此回合無法攻擊！`);
    } else if (skipMonsterAttackReason === "agi_first_strike") {
      log.push(`⚡ ${mName} ${rand(agiFirstStrikePhrases)}，無法反擊！`);
    } else if (skipMonsterAttackReason === "agi_slowed") {
      log.push(`⚡ ${mName} ${rand(agiSlowedAttackPhrases)}，無法即時反擊！`);
    }

    let blockedThisRound = false;
    for (let ma = 0; ma < monsterAttackCount && outcome === null; ma++) {
      const monsterHitChance = adjustedMCalc.hit - pStats.dodge;
      if (Math.random() * 100 < monsterHitChance) {
        // 盾格擋判定
        if (Math.random() * 100 < pStats.blockChance) {
          blockedThisRound = true;
          log.push(`🛡️ ${rand(jobFlavor.block)}！${mName} 的攻擊被格擋，傷害降至 **1**！`);
          pHp -= 1;
          if (pHp <= 0) { outcome = "lose"; break; }
        } else {
          let dmg = rollMDmg(Math.max(1, Math.round(adjustedMCalc.atk * (1 - pStats.def / 100))));

          // ── 檢查怪物的要害率 ──
          let hasWeaknessCrit = false;
          let weaknessCritRate = 0;
          if (Array.isArray(monsterActiveEffects)) {
            for (const wEff of monsterActiveEffects) {
              if (wEff && wEff.key === 'weakness_hit_rate') {
                const wParams = wEff.params || {};
                weaknessCritRate += Number(wParams.value || 0);
              }
            }
          }
          if (weaknessCritRate > 0 && Math.random() * 100 < weaknessCritRate) {
            hasWeaknessCrit = true;
            dmg = Math.round(dmg * 1.5);
          }

          // ── 檢查怪物的爆擊率 ──
          let hasMonsterCrit = false;
          let monsterCritRate = 0;
          if (Array.isArray(monsterActiveEffects)) {
            for (const cEff of monsterActiveEffects) {
              if (cEff && cEff.key === 'crit_rate_up') {
                const cParams = cEff.params || {};
                monsterCritRate += Number(cParams.value || 0);
              }
            }
          }
          if (monsterCritRate > 0 && Math.random() * 100 < monsterCritRate) {
            hasMonsterCrit = true;
            dmg = Math.round(dmg * 2.5);
          }

          // 構建傷害敘述
          let mAtkNote = "";
          if (hasWeaknessCrit && hasMonsterCrit) {
            mAtkNote = "🎯✨**要害爆擊**！";
          } else if (hasWeaknessCrit) {
            mAtkNote = "🎯**要害命中**！";
          } else if (hasMonsterCrit) {
            mAtkNote = "✨**會心一擊**！";
          }

          pHp -= dmg;
          monsterDmgThisRound += dmg;
          log.push(`💥 ${mAtkNote}${mName} ${rand(mAtkPhrases)}，造成 **${dmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);

          // ── 檢查怪物吸血效果 ──
          if (Array.isArray(monsterActiveEffects)) {
            for (const lifeEff of monsterActiveEffects) {
              if (lifeEff && lifeEff.key === 'lifesteal') {
                const lifeParams = lifeEff.params || {};
                const lifePercent = Number(lifeParams.value || 0);
                const healAmount = Math.max(1, Math.round(dmg * (lifePercent / 100)));
                mHp = Math.min(mHpInit, mHp + healAmount);
                log.push(`💚 ${mName} 吸取生命力，恢復 **${healAmount}** HP！（${mName} 剩 ${mHp} HP）`);
              }
            }
          }

          if (pHp <= 0) { outcome = "lose"; break; }
        }
      } else {
        log.push(`🛡️ ${mName} 猛撲而來，你${rand(jobFlavor.dodge)}，躲過了攻擊！`);

        // 弓：閃躲後追擊
        if (pStats.weaponType === 'bow' && outcome === null) {
          const isBreak = Math.random() * 100 < pStats.armorBreakChance;
          const finalDef = isBreak ? 0 : adjustedMCalc.def;
          let cdmg = rollDmg(Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * (1 - finalDef / 100))));

          // 應用弓的傷害倍率（1.2）
          cdmg = Math.round(cdmg * (pStats.archerBowDamageBoost || 1.2));

          // 檢查追擊要害（獨立判定）
          const hasCounterCrit = Math.random() * 100 < (pStats.bowDodgeCounterCritRate || 5);
          if (hasCounterCrit) {
            const counterCritMultiplier = pStats.bowDodgeCounterCritMultiplier || 1.2;
            cdmg = Math.round(cdmg * counterCritMultiplier);
          }

          mHp -= cdmg;
          totalDamage += cdmg;
          const archerTag = pStats.hasArcherBadge ? " **(弓箭手)**" : "";
          const critMarker = hasCounterCrit ? '🎯 **命中要害**！' : '';
          log.push(`🏹 **閃躲後追擊**${archerTag}！${rand(jobFlavor.counter)}，${critMarker}對 ${mName} 造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

          if (mHp <= 0) { outcome = "win"; }
        }
      }
    }

    if (outcome === "lose") { roundLogs.push(log.join("\n")); break; }

    // ── 甲蟹卡反擊（怪物攻擊後，30% 觸發，傷害為怪物本回合傷害的 20%）──
    if (monsterAttackCount > 0 && outcome === null) {
      const counterEff = (options.playerActiveEffects || []).find(e => e && e.key === 'counter');
      if (!counterEff) {
        // 也檢查 equipped special 槽位的 procEffects
        const specialSlotKeys = ['special_1', 'special_2', 'special_3'];
        for (const slot of specialSlotKeys) {
          const slotItem = options.equipped?.[slot];
          if (slotItem?.procEffects?.some(e => e.key === 'counter')) {
            const triggerChance = Number(slotItem.procEffects.find(e => e.key === 'counter')?.params?.value ?? 30);
            if (Math.random() * 100 < triggerChance) {
              const counterDmg = Math.max(1, Math.round(monsterDmgThisRound * 0.2));
              mHp -= counterDmg;
              totalDamage += counterDmg;
              log.push(`🦀 **甲蟹反擊**！以受到傷害的 20% 反彈，對 ${mName} 造成 **${counterDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              if (mHp <= 0) { outcome = "win"; }
            }
            break;
          }
        }
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 盾格擋反擊（單手劍+盾，必中）──
    if (blockedThisRound && pStats.blockCounter && outcome === null) {
      const isBreak = Math.random() * 100 < pStats.armorBreakChance;
      const finalDef = isBreak ? 0 : adjustedMCalc.def;
      let dmg = rollDmg(Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * (1 - finalDef / 100))));
      try {
        const equipped = options.equipped || null;
        if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.35)) {
          const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
          for (const eff of lowHpEffects) {
            if (!eff || !eff.params) continue;
            if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
              dmg = Math.max(1, Math.round(dmg * Number(eff.params.value)));
            }
          }
        }
      } catch (e) {}

      // 劍士：格擋反擊命中率加成（+20%）
      let counterHitChance = pStats.hit;
      if (pStats.hasSwordsmanBadge && pStats.weaponType === "sword_1h") {
        counterHitChance = Math.min(100, counterHitChance + pStats.swordsmanBlockCritBoost);
      }

      // 劍士：格擋反擊必定爆擊檢測
      let isCrit = Math.random() * 100 < pStats.crit;
      if (pStats.hasSwordsmanBadge && pStats.weaponType === "sword_1h") {
        // 單手劍時，格擋反擊有額外爆擊機率（+10%）
        isCrit = isCrit || Math.random() * 100 < 10;
      }
      if (isCrit) dmg = Math.round(dmg * 2.5);

      mHp -= dmg;
      totalDamage += dmg;
      const swordsmanTag = pStats.hasSwordsmanBadge ? " **(劍士)**" : "";
      log.push(`⚔️✨ **格擋反擊**${swordsmanTag}！${rand(jobFlavor.counter)}，${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
      if (mHp <= 0) { outcome = "win"; }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 雙持副手追擊（怪物攻擊後觸發）──
    if (pStats.isDualWield && monsterAttackCount > 0 && outcome === null) {
      if (Math.random() * 100 < pStats.counterChance) {
        const hitChance = pStats.hit - adjustedMCalc.dodge;
        if (monsterIsStunned || Math.random() * 100 < hitChance) {
          // 法杖雙持：副手只觸發 proc 效果，傷害為 0
          if (pStats.counterIsStaffProc) {
            log.push(`🔮 副手接觸，魔力灌注！`);
            // 觸發法師屬性 proc（燒傷/麻痺/冰凍）—— 需要法師徽章
            if (pStats.hasMageBadge) {
              const procChance = 10;
              if (Math.random() * 100 < procChance) {
                monsterActiveEffects = monsterActiveEffects.filter(e => e.key !== 'burn');
                monsterActiveEffects.push({ key: 'burn', params: { damagePercent: 10, duration: { mode: 'turns', value: 3 } }, appliedAt: round, source: 'mage_offhand' });
                log.push(`🔥 **(法師)** **燒傷**！${mName} 陷入燃燒狀態，持續 3 回合！`);
              }
              if (Math.random() * 100 < procChance) {
                monsterActiveEffects = monsterActiveEffects.filter(e => e.key !== 'hit_rate_down');
                monsterActiveEffects.push({ key: 'hit_rate_down', params: { value: 30, duration: { mode: 'turns', value: 3 } }, appliedAt: round, source: 'mage_offhand' });
                log.push(`⚡ **(法師)** **麻痺**！${mName} 行動遲緩，命中率下降，持續 3 回合！`);
              }
              const recentFreeze = monsterActiveEffects.find(e => e.key === 'freeze' && e.appliedAt >= round - 1);
              if (!recentFreeze && Math.random() * 100 < procChance) {
                monsterActiveEffects = monsterActiveEffects.filter(e => e.key !== 'freeze');
                monsterActiveEffects.push({ key: 'freeze', params: { duration: { mode: 'turns', value: 1 } }, appliedAt: round + 1, source: 'mage_offhand' });
                log.push(`🧊 **(法師)** **冰凍**！${mName} 被凍結，下回合無法攻擊！`);
              }
            }
          } else {
            const isBreak = pStats.counterInheritBreak && Math.random() * 100 < pStats.armorBreakChance;
            const finalDef = isBreak ? 0 : adjustedMCalc.def;
            let cdmg = rollDmg(Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * (1 - finalDef / 100))));
            try {
              const equipped = options.equipped || null;
              if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.35)) {
                const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
                for (const eff of lowHpEffects) {
                  if (!eff || !eff.params) continue;
                  if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
                    cdmg = Math.max(1, Math.round(cdmg * Number(eff.params.value)));
                  }
                }
              }
            } catch (e) {}
            mHp -= cdmg;
            totalDamage += cdmg;
            log.push(`🗡️ **副手追擊**！${rand(jobFlavor.counter)}，造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
            // 副手擊暈繼承（劍/匕首）
            if (pStats.counterInheritStun && Math.random() * 100 < pStats.stunChance) {
              stunRoundsLeft = 3;
              log.push(`😵 ${mName} ${rand(stunPhrases)}！接下來 3 回合無法攻擊！`);
            }
            if (mHp <= 0) { outcome = "win"; }
          }
        } else {
          log.push(`🗡️ 副手追擊出手，但 ${mName} ${rand(dodgePhrases)}！`);
        }
      }
    }

    roundLogs.push(log.join("\n"));
    if (outcome !== null) break;

    // ── 清理過期的 activeEffects ──
    monsterActiveEffects = cleanExpiredEffects(monsterActiveEffects, round);
    if (options.playerActiveEffects) {
      options.playerActiveEffects = cleanExpiredEffects(options.playerActiveEffects, round);
    }

    round++;
  }

  if (outcome === null) outcome = "timeout";

  return {
    outcome,
    roundLogs,
    totalDamage,
    finalMonsterHp: Math.max(0, mHp),
    finalPlayerHp:  Math.max(0, pHp)
  };
}

module.exports = { runCombatLoop };
