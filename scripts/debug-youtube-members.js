require("dotenv").config();
process.env.DEV_MIRROR = "1";

(async () => {
  const { startDevMirror } = require("../src/dev/devMirror");
  const localUri = await startDevMirror({
    sourceUri: process.env.MONGODB_URI,
    dbName: process.env.MONGODB_DB_NAME || "equipmentGame"
  });
  process.env.MONGODB_URI = localUri;

  const { createCreatorTokenRepository } = require("../src/adapters/creatorTokens/createCreatorTokenRepository");
  const { CreatorTokenService } = require("../src/services/creatorAuth/creatorTokenService");
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

  const collection = async (name) => (await getMongoDb()).collection(name);
  const repo = createCreatorTokenRepository({ collection });
  const svc = new CreatorTokenService({ creatorTokenRepository: repo });

  console.log("\n=== 取 broadcaster access token ===");
  const token = await svc.getValidToken("youtube");
  console.log("token prefix:", token.slice(0, 30) + "...");

  console.log("\n=== 打 members.list 看完整回應 ===");
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/members?part=snippet&maxResults=5",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log("HTTP:", res.status, res.statusText);
  const body = await res.text();
  console.log("body:", body);

  console.log("\n=== 試另一個 endpoint：channels/mine（最基本，看 token 有沒有效）===");
  const ch = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log("channels HTTP:", ch.status, ch.statusText);
  const chBody = await ch.text();
  console.log("channels body:", chBody.slice(0, 500));

  process.exit(0);
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
