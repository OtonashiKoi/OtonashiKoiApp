---
name: 工作流自動化指南
description: 一鍵完成開發工作流 - 驗證、測試、提交、清理
type: reference
---

# 🚀 工作流自動化指南

開發完成後，不需要手動跑多個命令。一條命令搞定所有事！

## 快速開始

```bash
npm run workflow:finalize
```

## 工作流做什麼？

### 1️⃣ 系統完整性驗證 (Step 1)
檢查以下系統是否完整：
- ✅ 怪物卡片 (≥24張)
- ✅ 強化寶石 (≥4個)
- ✅ 職業徽章 (≥7個)
- ✅ 裝備 (≥50件)

如果有缺失會自動報告。

### 2️⃣ Git 狀態檢查 (Step 2)
檢查工作目錄是否乾淨：
- ✅ 沒有未提交改動 → 可以直接推送
- ⚠️ 有改動 → 提示需要先 commit

### 3️⃣ Worktree 清理 (Step 3)
自動清除所有多餘的 worktree：
- ✅ 列出所有 worktree
- ✅ 逐一刪除
- ⚠️ 無法刪除的會標記

### 4️⃣ 完成總結 (Summary)
顯示最終結果：
```
系統驗證      : ✅ 通過
Git 狀態      : ✅ 乾淨
Worktree      : ✅ 已清理
時間戳        : 2026-04-16T...
```

和下一步建議（build & push 或 commit）。

---

## 完整工作流範例

### 典型開發流程

```bash
# 1️⃣ 開發新功能...（編寫代碼）

# 2️⃣ PM2 重啟以測試新代碼
npm run pm2:restart

# 3️⃣ 在後台或 Discord 驗證功能是否正常
# 手動測試...

# 4️⃣ 開發完成，運行自動化工作流
npm run workflow:finalize

# 5️⃣ 按提示做後續步驟
git push  # 或根據提示 git commit
```

---

## 常見場景

### 場景 A：系統完整，準備推送

```bash
$ npm run workflow:finalize

📋 Step 1: 系統完整性驗證
✅ 怪物卡片: 24
✅ 強化寶石: 4
✅ 職業徽章: 7
✅ 裝備: 97

📊 Step 2: Git 狀態檢查
✅ 工作目錄乾淨

🧹 Step 3: 清理 Worktrees
✅ 沒有多餘的 worktree

✨ 下一步建議:
  npm run build && git push
```

### 場景 B：有改動未提交

```bash
$ npm run workflow:finalize

✅ 系統驗證：通過
⚠️  Git 狀態：有改動

✨ 下一步建議:
  git add -A && git commit -m "..."
```

---

## 禁用項目（如果需要）

如果你想跳過某些步驟，可以編輯 `scripts/workflow-finalize.js`：

```javascript
// 註釋掉不需要的步驟
// await verifySystem();     // 跳過系統驗證
// await cleanupWorktrees(); // 跳過 worktree 清理
```

---

## 與 PM2 整合（未來計劃）

可以考慮添加 PM2 hook，讓工作流自動觸發：

```javascript
// 在 ecosystem.config.cjs 中
module.exports = {
  apps: [{
    name: 'equipmentGAME',
    script: 'src/index.js',
    // 重啟後自動運行工作流
    error_file: './pm2-error.log',
  }]
};
```

---

## 快速參考

| 命令 | 說明 |
|------|------|
| `npm run workflow:finalize` | 完整工作流（推薦） |
| `npm run pm2:restart` | 重啟伺服器 |
| `npm run db:sync` | 同步到雲端備份 |
| `npm run pm2:status` | 查看 PM2 狀態 |
| `npm run pm2:logs` | 查看伺服器日誌 |

---

**記住：以後開發完成就直接 `npm run workflow:finalize`，不用手動跳來跳去！** ✨
