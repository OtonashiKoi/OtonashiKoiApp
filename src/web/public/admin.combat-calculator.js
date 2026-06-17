"use strict";

(function () {
  const state = { players: [], monsters: [] };
  const statFields = [["str", "STR"], ["agi", "AGI"], ["vit", "VIT"], ["int", "INT"], ["dex", "DEX"], ["luk", "LUK"]];
  const bonusNumberFields = [
    ["atk-pct", "ATK %"], ["damage-pct", "一般傷害 %"], ["final-pct", "終傷 %"], ["boss-pct", "Boss 傷害 %"],
    ["crit-rate", "爆擊率 +"], ["crit-damage-pct", "爆傷 %"], ["def-ignore", "無視 DEF %"],
  ];

  const weaponConfig = {
    none: { label: "空手", mult: 1, main: "str" },
    sword_1h: { label: "單手劍", mult: 4, main: "str" },
    sword_2h: { label: "雙手劍", mult: 5, main: "str", block: 10 },
    mace_1h: { label: "單手槌", mult: 3, main: "str", stun: 10, stunDuration: 3 },
    mace_2h: { label: "雙手槌", mult: 4, main: "str", stun: 8, stunDuration: 3, block: 0 },
    axe_1h: { label: "單手斧", mult: 3, main: "str", armorBreak: 15, crit: 10 },
    axe_2h: { label: "雙手斧", mult: 5, main: "str", armorBreak: 15, crit: 20 },
    dagger: { label: "匕首", mult: 2, main: "str", combo: 20 },
    staff_1h: { label: "單手杖", mult: 3, main: "int", bypass: 15 },
    staff_2h: { label: "雙手杖", mult: 4, main: "int", bypass: 25 },
    bow: { label: "弓", mult: 4, main: "dex", dodge: 20 },
  };

  const tierOptions = {
    none: { label: "無套裝", stats: {}, hit: 0, dodge: 0, crit: 0, critDamage: 0, damage: 0, finalDamage: 0, bossDamage: 0 },
    D: { label: "D", stats: { str: 3, int: 3, dex: 3 }, hit: 0, dodge: 0, crit: 0, critDamage: 0, damage: 0, finalDamage: 0, bossDamage: 0 },
    C: { label: "C", stats: {}, hit: 15, dodge: 10, crit: 0, critDamage: 0, damage: 5, finalDamage: 0, bossDamage: 0 },
    B: { label: "B", stats: {}, hit: 0, dodge: 0, crit: 5, critDamage: 10, damage: 10, finalDamage: 0, bossDamage: 0 },
    A: { label: "A", stats: {}, hit: 0, dodge: 0, crit: 0, critDamage: 0, damage: 0, finalDamage: 5, bossDamage: 10 },
  };

  const $ = (id) => document.getElementById(id);
  const numberValue = (id, fallback = 0) => {
    const value = Number($(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round1 = (value) => Math.round(value * 10) / 10;
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  function parseStatPair(value) {
    const raw = String(value ?? "").trim().replace(/[＋]/g, "+");
    if (!raw) return { base: 0, equip: 0 };
    const [baseRaw, equipRaw = "0"] = raw.split("+");
    const base = Number(baseRaw);
    const equip = Number(equipRaw);
    return { base: Number.isFinite(base) ? base : 0, equip: Number.isFinite(equip) ? equip : 0 };
  }

  function statPairField(key, label, value) {
    return `<label><span>${label}</span><input id="combat-custom-${key}-pair" class="sheet-input combat-pair-input" value="${esc(value)}" inputmode="decimal" /></label>`;
  }

  function numberField(id, label, value, attrs = "") {
    return `<label><span>${label}</span><input id="${id}" class="sheet-input" type="number" step="any" value="${esc(value)}" ${attrs} /></label>`;
  }

  function bonusStatFields(prefix) {
    return statFields.map(([key, label]) => numberField(`combat-custom-${prefix}-${key}`, label, 0)).join("");
  }

  function bonusNumberInputs(prefix) {
    return bonusNumberFields.map(([key, label]) => numberField(`combat-custom-${prefix}-${key}`, label, 0)).join("");
  }

  function setActiveCustomTab(tab) {
    document.querySelectorAll("[data-combat-custom-tab]").forEach((button) => button.classList.toggle("active", button.dataset.combatCustomTab === tab));
    document.querySelectorAll("[data-combat-custom-panel]").forEach((panel) => { panel.hidden = panel.dataset.combatCustomPanel !== tab; });
  }

  function buildCustomFields() {
    const root = $("combat-calc-custom-fields");
    if (!root || root.childElementCount) return;
    const weaponOptions = Object.entries(weaponConfig).map(([key, cfg]) => `<option value="${esc(key)}">${esc(cfg.label)}</option>`).join("");
    const statInputs = [
      statPairField("str", "STR 自身+裝備", "10+20"), statPairField("agi", "AGI 自身+裝備", "10+0"),
      statPairField("vit", "VIT 自身+裝備", "10+0"), statPairField("int", "INT 自身+裝備", "10+0"),
      statPairField("dex", "DEX 自身+裝備", "10+0"), statPairField("luk", "LUK 自身+裝備", "10+0"),
    ].join("");
    const advancedInputs = [
      ["extra-hp", "額外 HP", 0], ["extra-atk", "額外 ATK", 0], ["extra-def", "額外 DEF %", 0],
      ["extra-flat-def", "額外固定防禦", 0], ["hit-bonus", "命中 +", 0], ["dodge-bonus", "閃避 +", 0],
      ["combo-bonus", "連擊率 +", 0], ["block-bonus", "格擋率 +", 0], ["dmg-min", "傷害浮動下限", 0.8, 'min="0.1" max="1"'],
      ["stun-bonus", "擊暈率 +", 0], ["armor-break-bonus", "破防率 +", 0], ["execute-chance", "斬殺率 %", 0], ["execute-threshold", "斬殺門檻 %", 0],
    ].map(([key, label, value, attrs]) => numberField(`combat-custom-${key}`, label, value, attrs || "")).join("");
    root.innerHTML = [
      `<div class="combat-custom-tabs combat-wide">${["base:基礎", "tier:套裝", "card:卡片", "title:稱號", "advanced:進階"].map((row, i) => {
        const [key, label] = row.split(":");
        return `<button class="${i === 0 ? "active" : ""}" type="button" data-combat-custom-tab="${key}">${label}</button>`;
      }).join("")}</div>`,
      `<div class="combat-custom-panel combat-wide" data-combat-custom-panel="base"><div class="combat-field-grid">
        <label class="combat-wide"><span>玩家名稱</span><input id="combat-custom-player-name" class="sheet-input" value="自訂玩家" /></label>
        ${numberField("combat-custom-player-level", "玩家等級", 1, 'min="1"')}
        <label><span>武器</span><select id="combat-custom-weapon-type" class="sheet-input">${weaponOptions}</select></label>
        ${statInputs}<label class="combat-check"><input id="combat-custom-has-shield" type="checkbox" />裝備盾牌</label>
      </div></div>`,
      `<div class="combat-custom-panel combat-wide" data-combat-custom-panel="tier" hidden><div class="combat-field-grid">
        <label><span>套裝階級</span><select id="combat-custom-tier-rank" class="sheet-input"><option value="none">無</option><option value="D">D 階</option><option value="C">C 階</option><option value="B">B 階</option><option value="A">A 階</option></select></label>
        <label><span>啟用件數</span><select id="combat-custom-tier-pieces" class="sheet-input"><option value="0">0 件</option><option value="3">3 件</option><option value="5">5 件</option><option value="7">7 件</option></select></label>
        <div id="combat-custom-tier-preview" class="combat-derived combat-wide"></div>
      </div></div>`,
      `<div class="combat-custom-panel combat-wide" data-combat-custom-panel="card" hidden>
        <div class="combat-field-grid">${bonusStatFields("card")}${bonusNumberInputs("card")}</div>
      </div>`,
      `<div class="combat-custom-panel combat-wide" data-combat-custom-panel="title" hidden>
        <div class="combat-field-grid">${bonusStatFields("title")}${bonusNumberInputs("title")}</div>
      </div>`,
      `<div class="combat-custom-panel combat-wide" data-combat-custom-panel="advanced" hidden>
        <div class="combat-field-grid">${advancedInputs}<div id="combat-custom-derived" class="combat-derived combat-wide"></div></div>
      </div>`,
    ].join("");
    root.querySelectorAll("[data-combat-custom-tab]").forEach((button) => {
      button.addEventListener("click", () => setActiveCustomTab(button.dataset.combatCustomTab));
    });
    root.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", renderCustomPreview);
      input.addEventListener("change", renderCustomPreview);
    });
    renderCustomPreview();
  }

  function readBonusStats(prefix) {
    return Object.fromEntries(statFields.map(([key]) => [key, numberValue(`combat-custom-${prefix}-${key}`)]));
  }

  function addStats(...rows) {
    const total = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
    for (const row of rows) {
      for (const key of Object.keys(total)) total[key] += Number(row?.[key]) || 0;
    }
    return total;
  }

  function activeTierBonus() {
    const rank = $("combat-custom-tier-rank")?.value || "none";
    const pieces = Math.max(0, numberValue("combat-custom-tier-pieces"));
    const source = tierOptions[rank] || tierOptions.none;
    const bonus = { ...tierOptions.none, stats: { ...(source.stats || {}) }, label: source.label };
    if (rank === "none" || pieces <= 0) return tierOptions.none;
    if (rank === "D") {
      if (pieces < 3) bonus.stats = {};
    } else if (rank === "C") {
      bonus.dodge = pieces >= 3 ? source.dodge : 0;
      bonus.damage = pieces >= 5 ? source.damage : 0;
      bonus.hit = pieces >= 7 ? source.hit : 0;
    } else if (rank === "B") {
      bonus.damage = pieces >= 3 ? source.damage : 0;
      bonus.crit = pieces >= 5 ? source.crit : 0;
      bonus.critDamage = pieces >= 7 ? source.critDamage : 0;
    } else if (rank === "A") {
      bonus.finalDamage = pieces >= 3 ? source.finalDamage : 0;
      bonus.bossDamage = pieces >= 5 ? source.bossDamage : 0;
    }
    return bonus;
  }

  function multiplierFromPct(...values) {
    return Math.max(0.1, 1 + values.reduce((sum, value) => sum + (Number(value) || 0), 0) / 100);
  }

  function renderPlayers() {
    const select = $("combat-calc-player");
    if (!select) return;
    select.innerHTML = state.players.map((player) =>
      `<option value="${esc(player.discordId)}">${esc(player.displayName)} (${esc(player.discordId)})</option>`
    ).join("");
  }

  function renderZones() {
    const select = $("combat-calc-zone");
    if (!select) return;
    const zones = [...new Set(state.monsters.map((monster) => monster.zone))];
    select.innerHTML = zones.map((zone) => `<option value="${esc(zone)}">${esc(zone)}</option>`).join("");
    if (zones.includes("normal")) select.value = "normal";
    renderMonsters();
  }

  function renderMonsters() {
    const zone = $("combat-calc-zone")?.value;
    const select = $("combat-calc-monster");
    if (!select) return;
    const monsters = state.monsters.filter((monster) => monster.zone === zone);
    select.innerHTML = monsters.map((monster) =>
      `<option value="${esc(monster.id)}">${esc(monster.name)}${monster.isBoss ? " [Boss]" : ""}</option>`
    ).join("");
    updateWorldBossVisibility();
  }

  function selectedMonster() {
    return state.monsters.find((monster) => monster.id === $("combat-calc-monster")?.value) || null;
  }

  function updateWorldBossVisibility() {
    const monster = selectedMonster();
    const visible = Boolean(monster?.isBoss && ["elite", "dragon_king_lair"].includes(monster.zone));
    $("combat-calc-world-boss").hidden = !visible;
    const wings = $("combat-calc-wb-part")?.querySelector('option[value="wings"]');
    if (wings) wings.hidden = monster?.zone !== "dragon_king_lair";
    if (monster?.zone !== "dragon_king_lair" && $("combat-calc-wb-part")?.value === "wings") {
      $("combat-calc-wb-part").value = "body";
    }
  }

  function updateMode() {
    const custom = $("combat-calc-mode")?.value === "custom";
    $("combat-calc-player-wrap").hidden = custom;
    $("combat-calc-custom").hidden = !custom;
    if (custom) renderCustomPreview();
  }

  function readCustomStats() {
    const pairRows = Object.fromEntries(statFields.map(([key]) => [key, parseStatPair($(`combat-custom-${key}-pair`)?.value)]));
    const baseStats = Object.fromEntries(statFields.map(([key]) => [key, pairRows[key].base]));
    const equipStats = Object.fromEntries(statFields.map(([key]) => [key, pairRows[key].equip]));
    const cardStats = readBonusStats("card");
    const titleStats = readBonusStats("title");
    const tier = activeTierBonus();
    const tierStats = tier.stats || {};
    const totalStats = addStats(baseStats, equipStats, cardStats, titleStats, tierStats);
    const weaponType = $("combat-custom-weapon-type")?.value || "none";
    const weapon = weaponConfig[weaponType] || weaponConfig.none;
    const mainStatValue = totalStats[weapon.main] || totalStats.str || 0;
    const atkPct = numberValue("combat-custom-card-atk-pct") + numberValue("combat-custom-title-atk-pct");
    const atk = Math.max(1, Math.round((mainStatValue * weapon.mult) * (1 + atkPct / 100) + numberValue("combat-custom-extra-atk")));
    const equipVit = Math.max(0, equipStats.vit + cardStats.vit + titleStats.vit);
    const hasShield = Boolean($("combat-custom-has-shield")?.checked) && !["sword_2h", "mace_2h", "axe_2h", "staff_2h", "bow"].includes(weaponType);
    const blockBase = (hasShield ? 20 : 0) + (weapon.block || 0);

    return {
      ...totalStats,
      maxHp: Math.max(1, Math.round(totalStats.vit * 15 + 50 + numberValue("combat-custom-extra-hp"))),
      atk,
      def: clamp(equipVit / 2 + numberValue("combat-custom-extra-def"), 0, 85),
      flatDef: Math.max(0, baseStats.vit + numberValue("combat-custom-extra-flat-def")),
      dodge: clamp(totalStats.agi * 0.5 + (weapon.dodge || 0) + (tier.dodge || 0) + numberValue("combat-custom-dodge-bonus"), 0, 95),
      hit: clamp(70 + totalStats.dex + (tier.hit || 0) + numberValue("combat-custom-hit-bonus"), 0, 100),
      crit: clamp(totalStats.luk * 0.3 + (weapon.crit || 0) + (tier.crit || 0) + numberValue("combat-custom-card-crit-rate") + numberValue("combat-custom-title-crit-rate"), 0, 100),
      combo: clamp(3 + totalStats.agi * 0.5 + (weapon.combo || 0) + numberValue("combat-custom-combo-bonus"), 0, 100),
      comboDamageMultiplier: 1,
      blockChance: clamp(blockBase + numberValue("combat-custom-block-bonus"), 0, 95),
      weaponMainStatValue: Math.max(0, mainStatValue),
      weaponType: weaponType === "none" ? null : weaponType,
      dmgMin: clamp(numberValue("combat-custom-dmg-min", 0.8), 0.1, 1),
      dmgMax: 1,
      bypassMonsterDefPct: clamp((weapon.bypass || 0) + numberValue("combat-custom-card-def-ignore") + numberValue("combat-custom-title-def-ignore"), 0, 100),
      armorBreakChance: clamp((weapon.armorBreak || 0) + numberValue("combat-custom-armor-break-bonus"), 0, 100),
      stunChance: clamp((weapon.stun || 0) + numberValue("combat-custom-stun-bonus"), 0, 100),
      stunDuration: weapon.stunDuration || 3,
      monsterAttackCount: 1,
      tierDamageMultiplier: multiplierFromPct(tier.damage, numberValue("combat-custom-card-damage-pct"), numberValue("combat-custom-title-damage-pct")),
      tierFinalDamageMultiplier: multiplierFromPct(tier.finalDamage, numberValue("combat-custom-card-final-pct"), numberValue("combat-custom-title-final-pct")),
      tierBossDamageMultiplier: multiplierFromPct(tier.bossDamage, numberValue("combat-custom-card-boss-pct"), numberValue("combat-custom-title-boss-pct")),
      tierCritDamageMultiplier: multiplierFromPct(tier.critDamage, numberValue("combat-custom-card-crit-damage-pct"), numberValue("combat-custom-title-crit-damage-pct")),
      executeChance: clamp(numberValue("combat-custom-execute-chance"), 0, 100),
      executeThresholdPct: clamp(numberValue("combat-custom-execute-threshold"), 0, 100),
    };
  }

  function renderCustomPreview() {
    const tierPreview = $("combat-custom-tier-preview");
    const derived = $("combat-custom-derived");
    if (!tierPreview && !derived) return;
    const tier = activeTierBonus();
    if (tierPreview) {
      const parts = [];
      for (const [key, value] of Object.entries(tier.stats || {})) {
        if (value) parts.push(`${key.toUpperCase()}+${value}`);
      }
      if (tier.hit) parts.push(`HIT+${tier.hit}`);
      if (tier.dodge) parts.push(`DODGE+${tier.dodge}`);
      if (tier.crit) parts.push(`爆擊+${tier.crit}`);
      if (tier.critDamage) parts.push(`爆傷+${tier.critDamage}%`);
      if (tier.damage) parts.push(`傷害+${tier.damage}%`);
      if (tier.finalDamage) parts.push(`終傷+${tier.finalDamage}%`);
      if (tier.bossDamage) parts.push(`Boss+${tier.bossDamage}%`);
      tierPreview.textContent = parts.length ? parts.join(" / ") : "未啟用套裝加成";
    }
    if (derived) {
      const stats = readCustomStats();
      derived.innerHTML = [
        `<span>HP <b>${Math.round(stats.maxHp)}</b></span>`,
        `<span>ATK <b>${Math.round(stats.atk)}</b></span>`,
        `<span>DEF <b>${round1(stats.def)}%</b></span>`,
        `<span>固定防禦 <b>${round1(stats.flatDef)}</b></span>`,
        `<span>武器主屬 <b>${round1(stats.weaponMainStatValue)}</b></span>`,
        `<span>終傷後追加 <b>${Math.round(stats.weaponMainStatValue * 1.5)}</b></span>`,
        `<span>HIT <b>${round1(stats.hit)}</b></span>`,
        `<span>DODGE <b>${round1(stats.dodge)}</b></span>`,
        `<span>爆擊 <b>${round1(stats.crit)}%</b></span>`,
        `<span>連擊 <b>${round1(stats.combo)}%</b></span>`,
      ].join("");
    }
  }

  function summaryCard(label, value, tone = "") {
    return `<div class="combat-metric ${tone}"><span>${label}</span><strong>${esc(value)}</strong></div>`;
  }

  function renderResult(data) {
    const summary = data.summary;
    $("combat-calc-summary").innerHTML = [
      summaryCard("平均傷害", summary.averageDamage, "primary"),
      summaryCard("傷害範圍", `${summary.minDamage} - ${summary.maxDamage}`),
      summaryCard("勝率", `${summary.winRate}%`, summary.winRate >= 50 ? "good" : "warn"),
      summaryCard("勝 / 敗 / 超時", `${summary.wins} / ${summary.losses} / ${summary.timeouts}`),
      summaryCard("平均攻擊次數", summary.averageAttacks),
      summaryCard("模擬次數", summary.iterations),
    ].join("");

    const p = data.player;
    const m = data.monster;
    $("combat-calc-matchup").innerHTML = `
      <div><b>${esc(p.name)}</b><span>Lv.${p.level} · HP ${Math.round(p.stats.maxHp)} · ATK ${Math.round(p.stats.atk)} · DEF ${Math.round(p.stats.def)}%</span></div>
      <div class="combat-versus">VS</div>
      <div><b>${esc(m.name)}</b><span>Lv.${m.stats.level} · HP ${Math.round(m.maxHp)} · ATK ${Math.round(m.stats.atk)} · DEF ${Math.round(m.stats.def)}%</span></div>
    `;
    $("combat-calc-log").textContent = (data.sample.roundLogs || []).join("\n\n");
  }

  async function loadOptions() {
    $("combat-calc-status").textContent = "載入資料中";
    const data = await request("/admin/combat-calculator/options");
    state.players = data.players || [];
    state.monsters = data.monsters || [];
    renderPlayers();
    renderZones();
    $("combat-calc-status").textContent = `已載入 ${state.players.length} 位玩家、${state.monsters.length} 隻怪物`;
  }

  async function runSimulation() {
    const button = $("combat-calc-run");
    const status = $("combat-calc-status");
    button.disabled = true;
    status.textContent = "模擬計算中";
    try {
      const mode = $("combat-calc-mode").value;
      const body = {
        mode,
        discordId: $("combat-calc-player").value,
        monsterId: $("combat-calc-monster").value,
        iterations: numberValue("combat-calc-iterations", 30),
        maxRounds: numberValue("combat-calc-rounds", 15),
        bestiaryBonusPct: numberValue("combat-calc-bestiary", 0),
        worldBossHpPct: numberValue("combat-calc-wb-hp", 100),
        worldBossPart: $("combat-calc-wb-part").value,
        brokenParts: {
          legs: $("combat-calc-broken-legs").checked,
          body: $("combat-calc-broken-body").checked,
          wings: $("combat-calc-broken-wings").checked,
        },
      };
      if (mode === "custom") {
        body.playerName = $("combat-custom-player-name").value;
        body.playerLevel = numberValue("combat-custom-player-level", 1);
        body.customStats = readCustomStats();
      }
      const data = await request("/admin/combat-calculator/simulate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      renderResult(data);
      status.textContent = "模擬完成";
    } catch (error) {
      status.textContent = `失敗：${error.message}`;
      $("combat-calc-log").textContent = error.stack || error.message;
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    buildCustomFields();
    $("combat-calc-mode")?.addEventListener("change", updateMode);
    $("combat-calc-zone")?.addEventListener("change", renderMonsters);
    $("combat-calc-monster")?.addEventListener("change", updateWorldBossVisibility);
    $("combat-calc-run")?.addEventListener("click", runSimulation);
    updateMode();
  }

  document.addEventListener("DOMContentLoaded", bind);
  document.addEventListener("adminConnected", () => {
    loadOptions().catch((error) => {
      $("combat-calc-status").textContent = `載入失敗：${error.message}`;
    });
  });
})();
