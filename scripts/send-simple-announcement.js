const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

async function main() {
  const envPath = path.resolve(__dirname, "../.env");
  const envContent = fs.readFileSync(envPath, "utf-8");
  const tokenMatch = envContent.match(/DISCORD_TOKEN=(.+)/);
  
  if (!tokenMatch) {
    console.error("❌ Token 錯誤");
    return;
  }

  const token = tokenMatch[1].trim();
  const rest = new REST().setToken(token);

  await rest.post(Routes.channelMessages("1450059054071418910"), {
    body: { content: "感謝提供重大 bug！已完成修正。" }
  });

  console.log("✅ 完成");
}

main();
