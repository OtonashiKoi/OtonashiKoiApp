---
name: 自動暫存記憶規則
description: 完成任務後3分鐘無回覆時自動存暫存記憶；每次新對話優先讀取暫存記憶
type: feedback
---

## 規則一：完成任務後 3 分鐘無回覆 → 自動暫存

完成一個任務後，如果用戶 3 分鐘內沒有回覆，立即執行以下暫存：

1. 寫入 `memory/session_checkpoint.md`（固定檔名，每次覆蓋）
2. 內容包含：
   - 本次對話完成了什麼
   - 修改了哪些檔案（路徑 + 一句話說明改了什麼）
   - 尚未完成或待確認的事項
   - 任何重要的設計決策或 bug 修正原因
3. 更新 MEMORY.md 確保有指向 session_checkpoint.md 的索引行

## 規則二：每次新對話開始時優先讀取

新對話開始時的順序：
1. 先讀 `memory/session_checkpoint.md`（上次暫存）
2. 再讀 `memory/feedback_context_save_policy.md`（90% token 規則）
3. 有需要再查其他記憶

**Why:** 避免每次新對話都要重新讀大量程式碼才能恢復上下文，節省 token。

**How to apply:** 暫存要夠精簡，只記「做了什麼、改了哪裡、還有什麼沒做」，不要把程式碼內容塞進去。
