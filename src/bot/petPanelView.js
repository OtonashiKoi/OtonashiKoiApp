"use strict";

const PET_OPEN_ID = "pet:open";          // 外層：進入我的寵物區
const PET_BACK_ID = "pet:back";          // 子面板返回主面板
const PET_FEED_ID = "pet:feed";          // 開啟餵食選單
const PET_FEED_TIER_PREFIX = "pet:feedtier:"; // 批量餵食某階 pet:feedtier:D
const PET_HATCH_ID = "pet:hatch";        // 從背包孵蛋（選蛋）
const PET_ACTIVE_ID = "pet:active";      // 出戰/更換
const PET_CLAIM_ID = "pet:claim";        // 領取採集
const PET_RENAME_ID = "pet:rename";      // 改名（Modal）
const PET_DEX_ID = "pet:dex";            // 圖鑑
const PET_RELEASE_ID = "pet:release";    // 放生（選寵物）
const PET_RELEASE_CONFIRM_PREFIX = "pet:release_confirm:"; // 放生確認 pet:release_confirm:<uuid>
const PET_SELECT_PREFIX = "pet:select:"; // 選單前綴（孵蛋/出戰選擇）
const PET_RENAME_MODAL_ID = "pet:rename_modal";

const STAGE_LABEL = { egg: "🥚 蛋", grown: "🐾 已孵化" };

// 蛋種 emoji / 蛋名（三線）
const EGG_EMOJI = { dragon: "🐉", slime: "🟢", wolf: "🐺" };
const EGG_NAME = { dragon: "神秘龍蛋", slime: "神秘史萊姆蛋", wolf: "神秘狼牙蛋" };
function eggEmoji(p) { return EGG_EMOJI[p?.eggType] || "🥚"; }
function eggName(p) { return EGG_NAME[p?.eggType] || "神秘寵物蛋"; }
// 階級星星
function tierStars(t) { return { D: "★☆☆☆", C: "★★☆☆", B: "★★★☆", A: "★★★★" }[t] || t || "?"; }

function petDisplayName(p) {
  if (!p) return "未命名";
  if (p.stage === "egg") return eggName(p);
  return p.nickname || p.speciesName || "未命名";
}

function petLine(p) {
  if (!p) return "";
  if (p.stage === "egg") {
    return `${eggEmoji(p)} ${eggName(p)}（孵化中 ${p.hatchPct}%｜${p.hatchProgress}/${p.hatchThreshold}）— 孵化後才揭曉品種`;
  }
  const name = p.nickname || p.speciesName || "未命名";
  const speedTxt = p.gatherIntervalMin ? `每 ${p.gatherIntervalMin} 分採 1 個` : "";
  // 種族特性逐項（後端 traits）；退回舊欄位以防萬一
  const traitList = Array.isArray(p.traits) && p.traits.length
    ? p.traits.map((t) => `${t.icon} ${t.label}：${t.value}`).join("｜")
    : [speedTxt, p.combatBonus ? `⚔️ ${p.combatBonus}` : ""].filter(Boolean).join("｜");
  return `${eggEmoji(p)} ${name}（${p.tier} 階）｜飽食 ${p.satiety}/${p.satietyMax}（可撐 ${p.satietyHours}h）｜採集 ${p.gatherCount}/${p.gatherCap}\n     └ 🧬 ${traitList}${speedTxt ? `｜⏱️ ${speedTxt}` : ""}`;
}

// ─── 外層：公共「寵物採集站」（介紹 + 一顆按鈕進入個人區） ───
function createPetPanelMessage() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PET_OPEN_ID).setLabel("🐾 進入我的寵物區").setStyle(ButtonStyle.Success),
  );
  return {
    content: [
      "🐾 **寵物採集站**",
      "打怪有機會掉落「寵物蛋」，餵裝備孵化後，寵物會幫你採集或並肩作戰。",
      "",
      "🥚 **三種蛋**（孵出的階級＝抽到的稀有度，D～A）",
      "・🟢 史萊姆蛋（史萊姆家族／大史王）— 採集**金幣袋＋強化石**，偶爾撿到怪東西",
      "・🐉 龍蛋（龍族之領）— 採集**裝備＋強化石**",
      "・🐺 狼牙蛋（地獄火焰／地獄狼牙王）— **戰鬥夥伴**，出戰時給你戰鬥加成",
      "",
      "📘 **規則**",
      "・🥚 餵裝備累積孵化（約 20 件 D 裝），孵化瞬間才揭曉品種與階級",
      "・🍖 餵食＝補飽食度（沒有等級／不會進化）；階級越高越會吃",
      "・🐾 同時只能出戰 1 隻，出戰中才會採集／給戰鬥加成",
      "・🎁 採集只撿得到「自身階級含以下」的一般裝備（不會撿到卡片）",
      "・⚠️ 餓肚子會停止採集＋戰鬥加成失效（餵飽即可，不會掉等）",
      "",
      "👇 點下方按鈕進入「我的寵物」面板。",
    ].join("\n"),
    components: [row],
  };
}

// ── 進度條（與怪物面板同風格 █░） ──
function buildBar(cur, max, length = 12) {
  const m = Math.max(1, Number(max) || 1);
  const c = Math.max(0, Math.min(m, Number(cur) || 0));
  const filled = Math.round((c / m) * length);
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, length - filled));
}

// 稀有度顯示
const RARITY_LABEL = { common: "普通", rare: "稀有", epic: "史詩", legendary: "傳說" };
function rarityText(r) {
  if (!r) return "";
  return RARITY_LABEL[String(r).toLowerCase()] || String(r);
}

// ─── 內層：玩家自己的「我的寵物」面板（ephemeral，Embed 屬性面板風格） ───
//   state: { pets, activePetUuid, active }
//   opts.status: 動作結果訊息（字串或字串陣列），顯示在面板頂端
function createPetDashboardMessage(state, opts = {}) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
  const active = state?.active || null;
  const pets = Array.isArray(state?.pets) ? state.pets : [];
  const eggCount = Math.max(0, Number(state?.eggCount) || 0);
  const statusLines = Array.isArray(opts.status) ? opts.status.filter(Boolean) : (opts.status ? [String(opts.status)] : []);

  const embed = new EmbedBuilder().setColor(0x9d174d).setFooter({ text: "寵物採集站" });
  const descLines = [];
  const fields = [];
  const files = [];

  // 頂端動作結果訊息
  if (statusLines.length > 0) {
    descLines.push(...statusLines, "━━━━━━━━━━━━━━━");
  }

  if (!active) {
    embed.setTitle("🐾 我的寵物");
    if (pets.length === 0) {
      descLines.push("（你目前沒有任何寵物）", "", eggCount > 0 ? `你有 **${eggCount}** 顆寵物蛋，按【🥚 孵蛋】開始孵化。` : "👉 去 **龍族之領** 打怪掉「寵物蛋」，再回來按【🥚 孵蛋】開始孵化。");
    } else {
      descLines.push("（目前沒有出戰中的寵物）", "", `你有 **${pets.length}** 隻寵物，請按【🐾 出戰/更換】選一隻出戰才會開始採集。`);
    }
  } else if (active.stage === "egg") {
    // ── 蛋階段 ──
    embed.setTitle(`${eggEmoji(active)} ${eggName(active)}（孵化中）`);
    descLines.push("孵化瞬間才揭曉品種與階級（D～A），並自動開始採集/作戰。", "", "👉 持續餵裝備累積孵化進度。");
    const hatchBar = buildBar(active.hatchProgress, active.hatchThreshold);
    fields.push(
      { name: "孵化進度", value: `${hatchBar} ${active.hatchPct}%\n${active.hatchProgress} / ${active.hatchThreshold}`, inline: false },
      { name: "🍴 餵食對應階級", value: `${active.feedTier} 階`, inline: true },
    );
  } else {
    // ── 已孵化：完整屬性面板 ──
    const name = active.nickname || active.speciesName || "未命名";
    embed.setTitle(`${eggEmoji(active)} ${name}`);
    const subParts = [`${active.speciesName || "?"} 種`, `${active.tier} 階 ${tierStars(active.tier)}`];
    descLines.push(`✨ **${subParts.join("　·　")}**`);
    if (active.combatBonus) descLines.push(`⚔️ **戰鬥夥伴**：出戰時 ${active.combatBonus}`);

    // 情境提示
    const hungry = active.satiety <= 0;
    const full = active.satiety >= active.satietyMax;
    const cap = active.gatherCount >= active.gatherCap;
    const hints = [];
    if (cap) hints.push("⚠️ 採集已滿，請按【🎁 領取採集】清空後才會繼續採");
    if (hungry) hints.push(`⚠️ 寵物餓壞了！採集${active.combatBonus ? "與戰鬥加成" : ""}已停止，請【🍖 餵食】`);
    else if (full) hints.push("✅ 寵物吃飽了（滿飽食即可，餵多了不會浪費也不會升級）");
    if (hints.length > 0) descLines.push("", ...hints);

    // 縮圖（支援 http 絕對網址與 /uploads 本地相對路徑）
    const thumbUrl = String(active.imageThumbnailUrl || active.imageUrl || "").trim();
    if (/^https?:\/\//i.test(thumbUrl)) {
      embed.setThumbnail(thumbUrl);
    } else if (thumbUrl) {
      const fs = require("fs");
      const path = require("path");
      const imagePath = path.resolve(__dirname, "../web/public", thumbUrl.replace(/^\//, ""));
      if (fs.existsSync(imagePath)) {
        const { AttachmentBuilder } = require("discord.js");
        const fileName = path.basename(imagePath);
        files.push(new AttachmentBuilder(imagePath, { name: fileName }));
        embed.setThumbnail(`attachment://${fileName}`);
      }
    }

    const satietyBar = buildBar(active.satiety, active.satietyMax);
    const gatherBar = buildBar(active.gatherCount, active.gatherCap);
    const traitParts = [];
    if (active.gatherIntervalMin) traitParts.push(`每 ${active.gatherIntervalMin} 分採 1 個`);
    if (active.gemBias != null) traitParts.push(`強化石率 ${Math.round(active.gemBias * 100)}%`);
    if (active.qualityUpChance) traitParts.push(`${Math.round(active.qualityUpChance * 100)}% 機率高一階`);
    if (active.combatBonus) traitParts.push(`⚔️ ${active.combatBonus}`);

    fields.push(
      { name: "⭐ 階級", value: `${active.tier} 階 ${tierStars(active.tier)}`, inline: true },
      { name: "🍖 飽食度", value: `${satietyBar}\n${active.satiety} / ${active.satietyMax}${hungry ? "（餓壞了）" : full ? "（已吃飽）" : `　可撐 ${active.satietyHours}h`}`, inline: true },
      { name: "🍴 餵食對應階級", value: `${active.feedTier} 階最划算`, inline: true },
      { name: "📦 採集進度", value: `${gatherBar}\n${active.gatherCount} / ${active.gatherCap}（產 ≤${active.producesTier} 階一般裝備）`, inline: false },
      { name: "✨ 採集特性", value: traitParts.length ? traitParts.join("\n") : "—", inline: false },
    );
  }

  if (pets.length > 0) {
    const activeUuid = state?.activePetUuid || active?.uuid || null;
    const rosterLines = pets.slice(0, 12).map((p) => {
      const mark = p.uuid === activeUuid ? "⭐" : "・";
      if (p.stage === "egg") {
        return `${mark} ${eggEmoji(p)} ${eggName(p)}（孵化中 ${p.hatchPct}%）`;
      }
      const nm = p.nickname || p.speciesName || "未命名";
      const cb = p.combatBonus ? "｜⚔️" : "";
      return `${mark} ${eggEmoji(p)} ${nm}　${p.tier} 階｜飽食 ${p.satiety}/${p.satietyMax}｜採 ${p.gatherCount}/${p.gatherCap}${cb}`;
    });
    if (pets.length > 12) rosterLines.push(`…還有 ${pets.length - 12} 隻`);
    rosterLines.push("", "⭐ = 出戰中（只有出戰中的寵物會採集／可餵食）");
    const maxPets = state?.maxPets || 20;
    const capTxt = pets.length >= maxPets ? `（已滿，放生或上架交易才能再孵）` : "";
    fields.push({ name: `🐾 寵物總覽（${pets.length} / ${maxPets} 隻）${capTxt}`, value: rosterLines.join("\n"), inline: false });
  }
  embed.setDescription(descLines.join("\n") || "​");
  if (fields.length > 0) embed.addFields(...fields);

  const isEgg = active && active.stage === "egg";
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PET_HATCH_ID).setLabel(eggCount > 0 ? `🥚 孵蛋 (${eggCount})` : "🥚 無蛋可孵").setStyle(ButtonStyle.Success).setDisabled(eggCount === 0),
    new ButtonBuilder().setCustomId(PET_FEED_ID).setLabel("🍖 餵食").setStyle(ButtonStyle.Primary).setDisabled(!active),
    new ButtonBuilder().setCustomId(PET_CLAIM_ID).setLabel("🎁 領取採集").setStyle(ButtonStyle.Primary).setDisabled(!active || isEgg),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PET_ACTIVE_ID).setLabel("🐾 出戰/更換").setStyle(ButtonStyle.Secondary).setDisabled(pets.length === 0),
    new ButtonBuilder().setCustomId(PET_RENAME_ID).setLabel("✏️ 改名").setStyle(ButtonStyle.Secondary).setDisabled(!active || isEgg),
    new ButtonBuilder().setCustomId(PET_DEX_ID).setLabel("📋 圖鑑").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PET_RELEASE_ID).setLabel("🕊️ 放生").setStyle(ButtonStyle.Danger).setDisabled(pets.length === 0),
  );

  return { embeds: [embed], components: [row1, row2], files };
}

module.exports = {
  PET_OPEN_ID,
  PET_BACK_ID,
  PET_FEED_ID,
  PET_FEED_TIER_PREFIX,
  PET_HATCH_ID,
  PET_ACTIVE_ID,
  PET_CLAIM_ID,
  PET_RENAME_ID,
  PET_DEX_ID,
  PET_RELEASE_ID,
  PET_RELEASE_CONFIRM_PREFIX,
  PET_SELECT_PREFIX,
  PET_RENAME_MODAL_ID,
  STAGE_LABEL,
  petDisplayName,
  petLine,
  createPetPanelMessage,
  createPetDashboardMessage,
};
