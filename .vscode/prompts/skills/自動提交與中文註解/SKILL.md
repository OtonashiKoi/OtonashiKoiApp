**名稱**：自動提交與中文註解

**目的**：在遇到「重大變更」時，能在遵守審批與稽核機制下，自動產生中文 commit 訊息並執行 `git push`，以減少人為漏推或忘記加中文註解的情況。

**觸發條件**：當 agent 或流程偵測到標記為 `重大變更`（例如資料結構更新、schema migration、核心資料修正）且已取得下列任一授權：
- PR 已通過指定 reviewer 並在 PR 描述中包含 `approved-by:` 標記；或
- 提供明確的 `approver-token`（由維運人員簽發且有效）

**檢查規則**：
- 只有在分支名稱符合 `feature/`、`fix/`、`chore/` 或 `ops/` 模式時進行自動 commit/push。
- 自動 commit 必須使用下列中文範本之一：
  - `feat(範疇): <中文重點說明>`
  - `fix(範疇): <中文重點說明>`
  - `chore(說明): <中文重點說明>`
  commit body 最多三行，列出「為何變更」與「後續步驟（若有）」。
- 在執行 `git push` 前，必須通過 CI 檢查或標示 `ci-passed=true`（若 CI 尚未完成，推送改為建立草稿 PR）。
- 每次自動 commit/push 都必須生成 `audit-id`，並將 `audit-id`、執行者、分支、commit hash、來源 SKILL 名稱記入稽核系統。

**拒絕策略**：
- 未取得 approver-token、PR 未通過或 CI 未通過時，拒絕自動 push，並回傳清楚步驟說明（白話）：如何取得授權、如何手動建立 PR、或如何等待 CI。

**稽核**：
- 寫入集中稽核日誌：{ audit-id, actor, branch, commit, message, timestamp, reason }
- 若為自動推送，稽核紀錄需保存至少 90 天並可搜尋。

**實作注意**：
- 建議實作為一個守護程序或 CI step（例如 `scripts/auto-git-push.js`），而非直接由 agent 在未檢查條件下呼叫 `git push`。
- 強制使用 commit 範本生成器（範例在下），確保 commit message 為中文且包含變更重點。
- JS 範例與自動化腳本應限制在 400 行以內，且需先在 sandbox 測試環境驗證。

**範例 commit 範本（中文）**：
- 標題：`feat(npc): 更新 NPC 掉落機制以支援新道具`  
  內容：
  - 為何：修正掉落邏輯以支援道具 X 的掉落率計算。  
  - 後續：請部署後執行 `npm run migrate-drops`。

**範例拒絕回應（白話）**：
- "拒絕自動推送：CI 尚未通過。請等待 CI 完成或手動建立 PR 並指定 approver。 audit-id=..."

**安全備註**：此 SKILL 旨在自動化流程但不放棄審核；禁止無條件自動推送到 `main` 或 `production` 分支。