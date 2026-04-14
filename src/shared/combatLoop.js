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
function runCombatLoop(pStats, mCalc, mName, mHpInit, MAX_ROUNDS = 30) {
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
  const atkVerbs =
    !wt                              ? ["揮拳猛擊", "飛腿踢出", "怒拳轟擊", "突刺重擊"] :
    wt.startsWith("staff")           ? ["施展魔法", "吟唱咒語", "釋放法術", "引導魔力"] :
    wt === "bow"                     ? ["拉弓射擊", "瞄準射出", "急速連射", "精準放箭"] :
    wt === "dagger"                  ? ["快速刺出", "連環割砍", "偷襲突刺", "趁隙猛刺"] :
    wt === "mace_1h" || wt==="mace_2h" ? ["重錘猛砸", "迴旋錘擊", "震地一擊", "猛力橫掃"] :
    wt === "axe_1h"  || wt==="axe_2h"  ? ["斧刃劈砍", "旋風橫斬", "猛力劈下", "破甲一擊"] :
                                      ["揮劍斬擊", "猛力劈下", "側身橫掃", "架勢突刺"];
  const critPhrases  = ["會心一擊", "致命一擊", "弱點命中", "完美命中"];
  const comboPhrases = ["連擊！", "殘影連斬！", "急速追打！", "趁勢猛攻！"];
  const dodgePhrases = ["身形一閃", "靈巧側移", "緊急後退", "巧妙格開"];
  const mDodgePhrases= ["及時閃避", "往旁一跳", "後退一步", "以盾擋下"];
  const mAtkPhrases  = ["猛力衝撞", "揮爪攻擊", "重擊落下", "怒吼突進"];
  const blockPhrases = ["以盾格擋", "舉盾抵擋", "盾牌格開"];
  const stunPhrases  = ["被重擊擊暈", "失去平衡", "陷入眩暈"];

  let mHp = mHpInit;
  let pHp = pStats.maxHp;
  let outcome = null;
  let totalDamage = 0;
  let round = 1;
  let stunRoundsLeft = 0; // 怪物剩餘擊暈回合數

  const roundLogs = [];

  while (round <= MAX_ROUNDS && outcome === null) {
    const log = [`**【第 ${round} 回合】**`];

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
        const isCrit = Math.random() * 100 < pStats.crit;
        // LUK 爆擊：×2.5 且無視怪物 DEF
        if (isCrit) {
          const critBase = Math.round(pStats.atk * (1 - finalDef / 100));
          dmg = Math.round(rollDmg(Math.max(1, critBase)) * 2.5);
        }

        mHp -= dmg;
        totalDamage += dmg;

        const breakNote = isBreak ? "💥**破防**！" : "";
        const critNote  = isCrit  ? `✨**${rand(critPhrases)}**！` : "";
        log.push(`⚔️ ${critNote}${breakNote}${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

        // 擊暈判定（槌，爆擊不額外觸發）
        if (!isCrit && Math.random() * 100 < pStats.stunChance) {
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
            log.push(`🗡️ **斬殺觸發**！${mName} 生命低於 ${pStats.executeThresholdPct}% ，被一擊終結！`);
          }
        }

        if (mHp <= 0) { outcome = "win"; break; }

        // 連擊（匕首+20%，AGI驅動）
        if (Math.random() * 100 < pStats.combo) {
          const comboBase = Math.max(1, Math.round(pStats.atk * (1 - finalDef / 100)));
          const cdmg = Math.max(1, Math.round(rollDmg(comboBase) * (pStats.comboDamageMultiplier || 1)));
          mHp -= cdmg;
          totalDamage += cdmg;
          log.push(`⚡ **${rand(comboPhrases)}** 追加攻擊造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

          if (mHp > 0 && pStats.executeChance > 0 && pStats.executeThresholdPct > 0) {
            const thresholdHp = Math.max(1, Math.floor(mHpInit * (pStats.executeThresholdPct / 100)));
            if (mHp <= thresholdHp && Math.random() * 100 < pStats.executeChance) {
              const executeDamage = mHp;
              mHp = 0;
              totalDamage += executeDamage;
              log.push(`🗡️ **斬殺觸發**！${mName} 生命低於 ${pStats.executeThresholdPct}% ，被一擊終結！`);
            }
          }

          if (mHp <= 0) { outcome = "win"; break; }
        }
      } else {
        log.push(`💨 ${mName} ${rand(dodgePhrases)}，你的攻擊落空了！`);
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
          log.push(`🛡️ ${rand(blockPhrases)}！${mName} 的攻擊被格擋，傷害降至 **1**！`);
          pHp -= 1;
          if (pHp <= 0) { outcome = "lose"; break; }
        } else {
          const dmg = rollMDmg(Math.max(1, Math.round(mCalc.atk * (1 - pStats.def / 100))));
          pHp -= dmg;
          log.push(`💥 ${mName} ${rand(mAtkPhrases)}，造成 **${dmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
      } else {
        log.push(`🛡️ ${mName} 猛撲而來，你${rand(mDodgePhrases)}，躲過了攻擊！`);
      }
    }

    if (outcome === "lose") { roundLogs.push(log.join("\n")); break; }

    // ── 盾格擋反擊（單手劍+盾，必中）──
    if (blockedThisRound && pStats.blockCounter && outcome === null) {
      const isBreak = Math.random() * 100 < pStats.armorBreakChance;
      const finalDef = isBreak ? 0 : mCalc.def;
      let dmg = rollDmg(Math.max(1, Math.round(pStats.atk * (1 - finalDef / 100))));
      const isCrit = Math.random() * 100 < pStats.crit;
      if (isCrit) dmg = Math.round(dmg * 2.5);
      mHp -= dmg;
      totalDamage += dmg;
      log.push(`⚔️✨ **格擋反擊**！${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
          mHp -= cdmg;
          totalDamage += cdmg;
          log.push(`🗡️ **副手追擊**！趁隙刺出，造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
