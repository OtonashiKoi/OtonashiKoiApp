// 直播留言指令偵測與處理器
// 偵測觀眾在直播間輸入的特定指令（打卡、查詢等）
// ------------------------------------------------

const { serviceContext } = require("../runtimeContext");

// 可自訂偵測的指令關鍵字
const STREAM_COMMANDS = {
  CHECKIN: ["打卡", "+1", "check-in", "checkin"],
  QUERY:   ["查詢", "我的資料", "我的錢包"]
};

/**
 * 判斷留言是否符合某個指令群組
 * @param {string} text
 * @param {string[]} keywords
 */
function matchCommand(text, keywords) {
  const t = text.trim().toLowerCase();
  return keywords.some((kw) => t === kw.toLowerCase() || t.startsWith(kw.toLowerCase()));
}

/**
 * 處理打卡指令
 * 若玩家有資料則 log，否則略過（不強制建立）
 * @param {{ name: string, text: string, service: string, raw: object }} comment
 */
async function handleCheckin(comment) {
  const displayName = comment.name;
  const service = comment.service;

  // 目前打卡只做 log 記錄，後續可接 rewardService 發放打卡獎勵
  console.log(`[Stream] ⭐ 打卡 | ${service} | ${displayName} | "${comment.text}"`);

  // TODO: 若需要發放打卡獎勵，在此呼叫 serviceContext.rewardService
  // 範例（保留備用）：
  // try {
  //   const result = await serviceContext.rewardService.grantCurrency({
  //     discordId: ???,           // 需要玩家 Discord ID，直播間留言暫無此資訊
  //     displayName,
  //     currencyType: "gold",
  //     amount: 10,
  //     source: "stream:checkin",
  //     operator: "stream-bot"
  //   });
  //   console.log(`[Stream] 打卡獎勵已發放給 ${displayName}`);
  // } catch (err) {
  //   console.error(`[Stream] 打卡獎勵失敗：`, err.message);
  // }
}

/**
 * 處理資料查詢指令（留言間接觸發）
 * @param {{ name: string, text: string, service: string }} comment
 */
async function handleQuery(comment) {
  console.log(`[Stream] 🔍 查詢指令 | ${comment.service} | ${comment.name} | "${comment.text}"`);
  // TODO: 未來可結合 Discord 用戶對應機制，返回玩家資料到 OBS 或 Discord
}

/**
 * 主要留言處理入口，由 commentFetcher 呼叫
 * @param {{ name: string, text: string, service: string, raw: object }} comment
 */
async function handleStreamComment(comment) {
  if (!comment.text) return;

  // 全部留言 log（方便監控）
  console.log(`[Stream] 💬 ${comment.service} | ${comment.name}：${comment.text}`);

  // 指令偵測
  if (matchCommand(comment.text, STREAM_COMMANDS.CHECKIN)) {
    await handleCheckin(comment).catch((err) =>
      console.error("[Stream] 打卡處理失敗：", err.message)
    );
    return;
  }

  if (matchCommand(comment.text, STREAM_COMMANDS.QUERY)) {
    await handleQuery(comment).catch((err) =>
      console.error("[Stream] 查詢處理失敗：", err.message)
    );
  }
}

module.exports = {
  handleStreamComment,
  STREAM_COMMANDS
};
