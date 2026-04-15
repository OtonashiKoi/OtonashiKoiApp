---
name: skill-format-guidelines
description: 規範 SKILL.md 的前置欄位與檔案結構，供自動化工具與 CI 驗證使用。
---

主要規範：
- 必要欄位：`name`（slug，僅小寫英數與中線）、`description`（一句話中文描述）。
- 檔案路徑：`.vscode/prompts/skills/<slug>/SKILL.md`。
- 檔案內容：前置欄位後應有中文說明、用途、使用方式、限制與範例輸出格式。

CI 建議：新增一個檢查步驟，驗證所有子資料夾中存在 `SKILL.md`，且其 `name` 與資料夾名稱一致。
