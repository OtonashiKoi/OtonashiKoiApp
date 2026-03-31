// 統一 API 回應格式工具
// ----------------------

// 成功回應格式
function ok(data, message = "ok") {
  return {
    status: "ok",      // 狀態：成功
    code: "OK",        // 狀態碼
    message,           // 訊息
    data               // 回傳資料
  };
}

// 失敗回應格式
function fail(code, message, data = null) {
  return {
    status: "error",   // 狀態：錯誤
    code,              // 錯誤代碼
    message,           // 錯誤訊息
    data               // 附加資料（可選）
  };
}

// 匯出回應格式工具
module.exports = {
  ok,
  fail
};