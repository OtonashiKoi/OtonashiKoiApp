// 修正 town_chat 綁定 + 新增 broadcast 綁定
require("dotenv").config();
const { MongoClient } = require("mongodb");

const LOBBY_CHAT_ID = "1498608950671839263";       // 聊天大廳
const BROADCAST_ID  = "1450062298076151952";       // 廣播掉落物（強化/PK 公告）

// 其餘類別下未綁定頻道 → 對應的新 feature key
const AUTO_BIND_MAP = {
  general_chat:      "1492184193265045644",  // 樂園聊天頻道
  beginner_tutorial: "1497786256669671435",  // 新手教學頻道
  trade_discussion:  "1506222653944631397",  // 玩家收購討論版
  feedback:          "1491846870505492640",  // 樂園建議回報專區
  pk_arena:          "1486423293044068392",  // 【pk爽】大亂鬥
  pk_report:         "1501890000000913479",  // 【pk爽】戰報
  party_lobby:       "1503635545832558632",  // 【組隊爽】大廳
  party_guide:       "1503635643488796682",  // 【組隊爽】組隊攻略區
};

async function main() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbn = process.env.MONGODB_DB_NAME || "equipmentGame";
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const col = client.db(dbn).collection("channelLayout");
    const doc = await col.findOne({ _id: "default" });
    if (!doc?.value?.discord?.bindings) {
      console.error("❌ 找不到 channelLayout default");
      process.exit(1);
    }

    const bindings = doc.value.discord.bindings;

    // 1) town_chat 改指到聊天大廳
    const townIdx = bindings.findIndex((b) => b.featureKey === "town_chat");
    if (townIdx >= 0) {
      const before = bindings[townIdx].channelId;
      bindings[townIdx].channelId = LOBBY_CHAT_ID;
      bindings[townIdx].visibleTo = { player: true, admin: true };  // 玩家可見
      console.log(`✏️  town_chat: ${before} → ${LOBBY_CHAT_ID} (聊天大廳)，visibleTo.player=true`);
    }

    // 2) broadcast 新增（如果還沒有）
    const broadcastIdx = bindings.findIndex((b) => b.featureKey === "broadcast");
    if (broadcastIdx < 0) {
      bindings.push({
        featureKey: "broadcast",
        channelId: BROADCAST_ID,
        enabled: true,
        note: "強化/PK 排行/掉落公告等系統廣播",
        panelMessageId: "",
        visibleTo: { player: true, admin: true }
      });
      console.log(`➕ broadcast 已新增 → ${BROADCAST_ID} (廣播掉落物)`);
    } else {
      bindings[broadcastIdx].channelId = BROADCAST_ID;
      bindings[broadcastIdx].enabled = true;
      bindings[broadcastIdx].visibleTo = { player: true, admin: true };
      console.log(`✏️  broadcast 已更新 → ${BROADCAST_ID}`);
    }

    // 3) 其他社群/PK/組隊頻道：若 binding 不存在則新增（預設 enabled=true, visibleTo 都開）
    for (const [featureKey, channelId] of Object.entries(AUTO_BIND_MAP)) {
      const idx = bindings.findIndex((b) => b.featureKey === featureKey);
      if (idx < 0) {
        bindings.push({
          featureKey, channelId, enabled: true, note: "", panelMessageId: "",
          visibleTo: { player: true, admin: true }
        });
        console.log(`➕ ${featureKey} → ${channelId}`);
      } else if (!bindings[idx].channelId) {
        bindings[idx].channelId = channelId;
        bindings[idx].enabled = true;
        console.log(`✏️  ${featureKey} 補上 channelId → ${channelId}`);
      }
    }

    await col.updateOne(
      { _id: "default" },
      { $set: { "value.discord.bindings": bindings, updatedAt: new Date().toISOString() } }
    );
    console.log("\n✅ channelLayout 已更新");
  } finally {
    await client.close();
  }
}

main().catch((err) => { console.error("❌", err.message); process.exit(1); });
