# SKILL 總覽

此目錄包含專案共用的 Agent SKILL，每個 SKILL 為一個資料夾，內含 `SKILL.md`。

- **僅使用即時資料**：強制以雲端 API/DB 作為資料來源，拒絕未授權本地快照。  
  路徑：[.vscode/prompts/skills/僅使用即時資料/SKILL.md](.vscode/prompts/skills/僅使用即時資料/SKILL.md)

- **資料庫唯讀保護**：防止 agent 直接寫入生產資料庫，需人工授權。  
  路徑：[.vscode/prompts/skills/資料庫唯讀保護/SKILL.md](.vscode/prompts/skills/資料庫唯讀保護/SKILL.md)

- **道具目錄參照**：道具/裝備需以中央 catalog 為單一來源。  
  路徑：[.vscode/prompts/skills/道具目錄參照/SKILL.md](.vscode/prompts/skills/道具目錄參照/SKILL.md)

- **NPC 目錄參照**：NPC 定義必須來自 NPC 中央庫並標示版本。  
  路徑：[.vscode/prompts/skills/NPC%20目錄參照/SKILL.md](.vscode/prompts/skills/NPC%20目錄參照/SKILL.md)

- **模擬測試模式**：模擬/測試必須在 sandbox 或 test 模式下執行。  
  路徑：[.vscode/prompts/skills/模擬測試模式/SKILL.md](.vscode/prompts/skills/模擬測試模式/SKILL.md)

- **結構版本檢查**：在讀寫前比對 schema/version，避免不相容。  
  路徑：[.vscode/prompts/skills/結構版本檢查/SKILL.md](.vscode/prompts/skills/結構版本檢查/SKILL.md)

- **部署安全檢查**：部署前驗證環境、遷移與依賴服務狀態。  
  路徑：[.vscode/prompts/skills/部署安全檢查/SKILL.md](.vscode/prompts/skills/部署安全檢查/SKILL.md)

- **資料變更審批流程**：核心資料變更需走 PR + reviewer 流程。  
  路徑：[.vscode/prompts/skills/資料變更審批流程/SKILL.md](.vscode/prompts/skills/資料變更審批流程/SKILL.md)

- **稽核記錄**：每次讀寫或重大決策需產生可查詢的稽核記錄。  
  路徑：[.vscode/prompts/skills/稽核記錄/SKILL.md](.vscode/prompts/skills/稽核記錄/SKILL.md)

- **封存存取政策**：封存/備份資料存取需授權與記錄。  
  路徑：[.vscode/prompts/skills/封存存取政策/SKILL.md](.vscode/prompts/skills/封存存取政策/SKILL.md)
