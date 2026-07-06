// 把 HIGGSFIELD(gpt_image_2) 去背立繪下載 → 上 Cloudinary → 寫回 storyNpcs.portraitUrl
// 一次性內容匯入(第一章功能型/串場 NPC 立繪)。
require("dotenv").config();
const https = require("https");
const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { uploadImage } = require("../src/shared/cloudinaryUpload");

const MAP = [
  { id: "npc-ch1-examiner", name: "測驗教官", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070840_2e3db30f-ae18-4ec7-b653-ffbd21d1b328.png" },
  { id: "npc-ch1-registrar", name: "報到人員", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070842_e8075d30-aba3-4803-a5e2-8fe19163f206.png" },
  { id: "npc-ch1-staff", name: "工作人員", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070844_536cc3ea-af30-4ce1-9e29-106e1f4519d0.png" },
  { id: "npc-ch1-student", name: "路人學員", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070846_ecb36750-ad49-472b-b852-07fd84ee49f5.png" },
  { id: "npc-ch1-passerby-a", name: "路人A", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070848_1a9f42e8-94d1-4b86-b725-a2d3ddebe7ad.png" },
  { id: "npc-ch1-passerby-b", name: "路人B", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070849_734f4a8c-bce9-4542-8bcf-ea1aa865908d.png" },
  { id: "npc-player-sister", name: "玩家妹妹", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070851_647925b7-9f38-4a6b-8f62-8b46fb4676c5.png" },
  { id: "npc-unknown-adventurer", name: "不明冒險家", url: "https://d8j0ntlcm91z4.cloudfront.net/user_36y6GL2Pdj0fzwaq2fubuJvlyXB/hf_20260706_070853_8d710185-68ed-461d-a1e6-0727f5e227c0.png" }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
      res.pipe(f); f.on("finish", () => f.close(() => resolve(dest)));
    }).on("error", reject);
  });
}

(async () => {
  const db = await getMongoDb();
  const tmp = "/tmp/npc-portraits"; fs.mkdirSync(tmp, { recursive: true });
  for (const m of MAP) {
    try {
      const file = path.join(tmp, m.id + ".png");
      await download(m.url, file);
      const { imageUrl, imageThumbnailUrl } = await uploadImage(file, "story-npcs");
      await db.collection("storyNpcs").updateOne(
        { id: m.id },
        { $set: { portraitUrl: imageUrl, portraitThumbnailUrl: imageThumbnailUrl, updatedAt: new Date().toISOString() } }
      );
      console.log(`OK ${m.name} (${m.id}) -> ${imageUrl}`);
    } catch (e) {
      console.log(`FAIL ${m.name} (${m.id}): ${e.message}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
