"use strict";

// Event-only card skills. Monster attacks retain their separate original skills.
const KEY = Object.freeze({ wisp: 'mistwood_wisp_store', tree: 'mistwood_tree_rings', panther: 'mistwood_panther_counter', wizard: 'mistwood_wizard_echo', raider: 'mistwood_raider_steal', beast: 'mistwood_beast_stomp', guardian: 'mistwood_guardian_cleanse' });
const STEAL_CAPS = Object.freeze({ atk_up: 10, def_up: 10, crit_rate_up: 10, crit_damage_up: 10, dodge_up: 5, hit_up: 10, damage_reduction: 8, final_damage_up: 10, lifesteal: 3, def_ignore: 10 });
const DEBUFFS = new Set(['poison','burn','bleed','shock_dot','curse_dot','stun','freeze','sleep','silence','slow','blind','fear','root','disarm','confuse','charm','dark_curse','atk_down','def_down','hit_down','hit_rate_down','agi_down']);
const removable = e => e && e.removable !== false && e.dispellable !== false && e.params?.removable !== false && e.params?.dispellable !== false && !e.unremovable && !e.params?.unremovable && !e.mechanic && !e.params?.mechanic;
const active = (e, round) => e.params?.duration?.mode === 'turns' && round <= (e.appliedAt ?? 1) + Number(e.params.duration.value || 1);

function createMistwoodCards(equipped = {}, maxHp = 1) {
  const enabled = new Set(['special_1','special_2','special_3'].map(s => equipped[s]?.monsterCardSkill?.key).filter(k => Object.values(KEY).includes(k)));
  const state = { storage: 0, heals: 0, rings: 0, ringReady: false, treeUntil: 0, pantherUntil: 0, hits: 0, stolenUntil: 0, cleansed: false, shield: 0, shieldUntil: 0 };
  const metrics = { storedHeal: 0, treePrevented: 0, counterDamage: 0, echoDamage: 0, stompDamage: 0, steals: 0, cleanses: 0, shieldAbsorbed: 0, echoChecks: 0 };
  let ctx = null;
  const has = name => enabled.has(KEY[name]);
  const log = line => ctx?.log.push(line);
  const damage = (pct, name, metric) => {
    if (!ctx || ctx.enemyHp() <= 0 || ctx.silenced()) return 0;
    const dealt = ctx.damage(Math.max(1, Math.round(ctx.atk * pct / 100)));
    metrics[metric] += dealt;
    if (dealt > 0) log(`✨ **${ctx.playerName}** 發動【${name}】，對 ${ctx.enemyName} 造成 **${dealt}** 點傷害！（怪物剩 ${Math.max(0, ctx.enemyHp())} HP）`);
    return dealt;
  };
  const onCardDamage = (sourceKey, actualDamage) => {
    if (!has('wizard') || sourceKey === KEY.wizard || actualDamage <= 0 || !ctx || ctx.silenced() || ctx.enemyHp() <= 0) return;
    metrics.echoChecks++;
    if (Math.random() < 0.30) damage(45, '霧雷共鳴', 'echoDamage');
  };
  return {
    enabled: enabled.size > 0, state, metrics, has,
    setContext(value) { ctx = value; },
    beforeDamage(raw, round) {
      let value = raw;
      if (has('tree') && state.ringReady && value > 0) {
        state.ringReady = false; state.rings = 0; state.treeUntil = round + 2;
        value = Math.max(1, Math.round(value * 0.65)); metrics.treePrevented += raw - value;
        log(`🛡️ **三重年輪**！本次傷害降低35%（減免 ${raw - value}）。`);
      }
      if (has('guardian') && value > 0 && round <= state.shieldUntil && state.shield > 0) {
        const absorbed = Math.min(state.shield, value); state.shield -= absorbed; value -= absorbed; metrics.shieldAbsorbed += absorbed;
      }
      return value;
    },
    onTaken(actual, round) {
      if (actual <= 0) return;
      if (has('wisp') && state.heals < 2) state.storage = Math.min(maxHp * 0.08, state.storage + actual * 0.20);
      if (has('tree') && !state.ringReady && round > state.treeUntil) {
        state.rings++;
        if (state.rings >= 3) { state.ringReady = true; log('🛡️ **三重年輪**蓄滿！下一次承傷降低35%。'); }
      }
    },
    onDebuff(effect, round) {
      if (!has('guardian') || state.cleansed || !DEBUFFS.has(effect?.key) || !removable(effect)) return false;
      state.cleansed = true; metrics.cleanses++; state.shield = Math.floor(maxHp * 0.08); state.shieldUntil = round + 1;
      log(`🛡️ **森域淨界**！取消負面狀態，獲得 **${state.shield}** 點護盾，持續2回合。`);
      return true;
    },
    onCardDamage,
    onSuccessfulHit(actual) {
      if (actual <= 0 || !ctx || ctx.silenced()) return;
      if (has('wisp') && state.heals < 2 && state.storage >= 1 && ctx.playerHp() > 0) {
        const amount = Math.floor(state.storage); state.storage = 0; state.heals++;
        const healed = ctx.heal(amount); metrics.storedHeal += healed;
        log(`💚 **霧魂儲能**！回復 **${healed}** HP！（你剩 ${ctx.playerHp()} HP）`);
      }
    },
    onBasicHit(actual, round, monsterEffects, playerEffects) {
      if (actual <= 0 || !ctx || ctx.silenced()) return false;
      this.onSuccessfulHit(actual);
      if (has('beast') && ++state.hits % 4 === 0) {
        damage(45, '四步重踏', 'stompDamage');
      }
      if (!has('raider') || ctx.boss || ctx.enemyHp() <= 0 || round <= state.stolenUntil) return false;
      const candidates = monsterEffects.filter(e => STEAL_CAPS[e.key] && removable(e) && active(e, round) && Number(e.params?.value) > 0 && !['flat','caster_atk_pct'].includes(e.params?.mode));
      if (!candidates.length || Math.random() >= 0.20) return false;
      const stolen = candidates[Math.floor(Math.random() * candidates.length)];
      monsterEffects.splice(monsterEffects.indexOf(stolen), 1);
      const value = Math.min(STEAL_CAPS[stolen.key], Number(stolen.params.value));
      playerEffects.push({ key: stolen.key, params: { value, duration: { mode: 'turns', value: 2 }, sourceName: '竊取強化' }, appliedAt: round, sourceType: 'player_card', sourceId: KEY.raider });
      state.stolenUntil = round + 2; metrics.steals++;
      log(`🎴 **竊取強化**！偷走 ${ctx.enemyName} 的【${stolen.params.sourceName || stolen.key}】，獲得 ${value}% 效果，持續2回合。`);
      return true;
    },
    onDodge(round) {
      if (!has('panther') || round < state.pantherUntil || !ctx || ctx.silenced()) return;
      const dealt = damage(60, '影後追獵', 'counterDamage');
      if (dealt > 0) state.pantherUntil = round + 2;
    },
  };
}
module.exports = { KEY, STEAL_CAPS, DEBUFFS, createMistwoodCards };
