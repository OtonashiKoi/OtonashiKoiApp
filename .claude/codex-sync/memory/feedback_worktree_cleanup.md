---
name: Worktree 自動清理規則
description: 完成開發工作後自動合併並刪除 worktree，讓主目錄保持淨空
type: feedback
---

**核心規則：任何工作 OK（測試通過、驗證完成）就立即合併清除 worktree**

不要等待推送或其他時機。工作完成 = 立即清理。

**Why:** 
- 用戶無法在有 worktree 時在主目錄工作
- 大量未清理的 worktree 會造成混亂和阻塞
- 保持主目錄乾淨是開發效率的關鍵

**How to apply:**
1. 工作完成 → 確保所有改動已 commit
2. 驗證系統完整性（測試通過、功能驗證）
3. 立即執行 worktree 合併：
   - 從 worktree 返回主目錄
   - 刪除 worktree 分支和目錄
   - 確認 `git worktree list` 只顯示 master
4. 推送代碼到遠端

**習慣養成：** 任何「完成」就要馬上清，不留尾巴
