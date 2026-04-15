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

  let mHp = mHpInit;
  let pHp = pStats.maxHp;
  let outcome = null;
  let totalDamage = 0;
  let round = 1;
  let stunRoundsLeft = 0; // 怪物剩餘擊暈回合數

  const roundLogs = [];

  while (round <= MAX_ROUNDS && outcome === null) {
    const log = [`**【第 ${round} 回合】**`];
    if (round === 1 && jobProfile.jobName) {
      log.push(`✨ ${jobProfile.jobName} ${rand(jobFlavor.intro)}`);
    }

    // ── 套用來自隊伍（party）的被動 aura，例如治療師提供的每回合回復 ──
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
            log.push(`💚 ${rand(PARTY_HEAL_PHRASES)}，回復 **${heal}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
          }
        }
        // 支援隊伍傷害加成（每回合生效）
        if (pe.key === 'party_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            const mul = 1 + (val / 100);
            pStats.finalDamageMultiplier = (Number(pStats.finalDamageMultiplier) || 1) * mul;
            log.push(`🔥 ${rand(PARTY_DAMAGE_PHRASES)}，本回合傷害提升 ${(val)}%`);
          }
        }
      }
    } catch (e) {}

    // ── 玩家攻擊 ──
    const attackCount = pStats.isDualWield ? 2 : 1;
    const monsterIsStunned = stunRoundsLeft > 0; // 擊暈中：怪物無法閃避
    for (let a = 0; a < attackCount && outcome === null; a++) {
      const hitChance = pStats.hit - mCalc.dodge;
      if (monsterIsStunned || Math.random() * 100 < hitChance) {
        // 破防判定（斧）
        const isBreak = Math.random() * 100 < pStats.armorBreakChance;
        const effectiveDef = isBreak ? 0 : mCalc.def;
        // 法杖無視怪物 DEF 的 bypassMonsterDefPct%（預設0，法杖50）
        const bypassPct = pStats.bypassMonsterDefPct ?? 0;
        const finalDef = Math.max(0, effectiveDef * (1 - bypassPct / 100));

        let dmg = rollDmg(Math.max(1, Math.round(pStats.atk * (1 - finalDef / 100))));

        // 弓箭手徽章傷害倍率（主武器為弓時）
        if (pStats.hasArcherBadge && pStats.weaponType === "bow") {
          dmg = Math.round(dmg * pStats.archerBowDamageBoost);
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

        // 普通爆擊邏輯（LUK 驅動）
        const effectiveCritChance = (Number(pStats.crit) || 0) + extraHighHpCrit;
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
          dmg = Math.round(rollDmg(Math.max(1, critBase)) * 2.5);

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
          critNote = `✨${rand(critPhrases)}！🎯${rand(['命中要害', '精準破綻', '弱點命中'])}！`;
        } else if (isArcherCrit) {
          // 只觸發要害
          critNote = `🎯**${rand(['命中要害', '精準破綻', '弱點命中', '一擊斃命'])}**！`;
        } else if (isCrit) {
          // 只觸發爆擊
          critNote = `✨**${rand(critPhrases)}**！`;
        }

        log.push(`⚔️ ${critNote}${breakNote}${rand(jobFlavor.hit)}，${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        // 擊暈判定（爆擊不觸發）
        const effectiveStunChance = (Number(pStats.stunChance) || 0) + extraHighHpStun;
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

        // 連擊（匕首+20%，AGI驅動）
        if (Math.random() * 100 < pStats.combo) {
          const comboBase = Math.max(1, Math.round(pStats.atk * (1 - finalDef / 100)));
          let cdmg = Math.max(1, Math.round(rollDmg(comboBase) * (pStats.comboDamageMultiplier || 1)));
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
    const monsterAttackCount = stunRoundsLeft > 0 ? 0 : (pStats.monsterAttackCount || 1);
    if (stunRoundsLeft > 0) {
      stunRoundsLeft--;
          log.push(`😵 ${mName} 仍處於擊暈狀態，無法攻擊！`);
    }

    let blockedThisRound = false;
    for (let ma = 0; ma < monsterAttackCount && outcome === null; ma++) {
      const monsterHitChance = mCalc.hit - pStats.dodge;
      if (Math.random() * 100 < monsterHitChance) {
        // 盾格擋判定
        if (Math.random() * 100 < pStats.blockChance) {
          blockedThisRound = true;
          log.push(`🛡️ ${rand(jobFlavor.block)}！${mName} 的攻擊被格擋，傷害降至 **1**！`);
          pHp -= 1;
          if (pHp <= 0) { outcome = "lose"; break; }
        } else {
          const dmg = rollMDmg(Math.max(1, Math.round(mCalc.atk * (1 - pStats.def / 100))));
          pHp -= dmg;
          log.push(`💥 ${mName} ${rand(mAtkPhrases)}，造成 **${dmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
      } else {
        log.push(`🛡️ ${mName} 猛撲而來，你${rand(jobFlavor.dodge)}，躲過了攻擊！`);

        // 弓箭手迴避後追擊（必定爆擊）
        if (pStats.hasArcherBadge && pStats.weaponType === 'bow' && outcome === null) {
          try {
            const equipped = options.equipped || null;
            const inventory = Array.isArray(options.inventory) ? options.inventory : [];
            if (equipped) {
              // 檢查是否有迴避追擊效果
              const dodgeCounterEffs = collectEquipmentEffects(equipped, 'passive', { equipped, inventory })
                .filter((e) => e && (e.key === 'archer_dodge_counter' || e.key === 'dodge_counter_attack'));

              if (dodgeCounterEffs.length > 0) {
                const eff = dodgeCounterEffs[0];
                const guaranteedCrit = eff.params?.guaranteedCrit ?? true;

                // 弓箭手迴避後追擊：
                // 1. 必定爆擊（如果設定 guaranteedCrit = true）
                // 2. 傷害計算應用弓箭手的傷害倍率

                const isBreak = Math.random() * 100 < pStats.armorBreakChance;
                const finalDef = isBreak ? 0 : mCalc.def;
                let cdmg = rollDmg(Math.max(1, Math.round(pStats.atk * (1 - finalDef / 100))));

                // 應用弓箭手傷害倍率
                cdmg = Math.round(cdmg * pStats.archerBowDamageBoost);

                // 應用爆擊倍率（迴避反擊必定爆擊）
                const critMultiplier = guaranteedCrit ? (pStats.archerCritMultiplier || 1.5) : 1;
                cdmg = Math.round(cdmg * critMultiplier);

                mHp -= cdmg;
                totalDamage += cdmg;
                const critMarker = guaranteedCrit ? '✨ **必定爆擊**！' : '';
                log.push(`🏹 **迴避反擊**！${rand(jobFlavor.counter)}，${critMarker}對 ${mName} 造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

                if (mHp <= 0) { outcome = "win"; }
              }
            }
          } catch (e) {}
        }
      }
    }

    if (outcome === "lose") { roundLogs.push(log.join("\n")); break; }

    // ── 盾格擋反擊（單手劍+盾，必中）──
    if (blockedThisRound && pStats.blockCounter && outcome === null) {
      const isBreak = Math.random() * 100 < pStats.armorBreakChance;
      const finalDef = isBreak ? 0 : mCalc.def;
      let dmg = rollDmg(Math.max(1, Math.round(pStats.atk * (1 - finalDef / 100))));
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
      const isCrit = Math.random() * 100 < pStats.crit;
      if (isCrit) dmg = Math.round(dmg * 2.5);
      mHp -= dmg;
      totalDamage += dmg;
      log.push(`⚔️✨ **格擋反擊**！${rand(jobFlavor.counter)}，${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
      if (mHp <= 0) { outcome = "win"; }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 雙持副手追擊（怪物攻擊後觸發）──
    if (pStats.isDualWield && monsterAttackCount > 0 && outcome === null) {
      if (Math.random() * 100 < pStats.counterChance) {
        const hitChance = pStats.hit - mCalc.dodge;
        if (monsterIsStunned || Math.random() * 100 < hitChance) {
          const isBreak = pStats.counterInheritBreak && Math.random() * 100 < pStats.armorBreakChance;
          const finalDef = isBreak ? 0 : mCalc.def;
          let cdmg = rollDmg(Math.max(1, Math.round(pStats.atk * (1 - finalDef / 100))));
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
        } else {
          log.push(`🗡️ 副手追擊出手，但 ${mName} ${rand(dodgePhrases)}！`);
        }
      }
    }

    roundLogs.push(log.join("\n"));
    if (outcome !== null) break;
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
