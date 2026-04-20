---
name: Worktree 工作流程規則
description: 使用 worktree 時的重要注意事項 - PM2 和 .env 只改主目錄
type: feedback
originSessionId: 4002bcd1-9b2a-479a-bc7e-3b4d6fd16019
---
# Worktree 工作流程規則

## 允許使用 Worktree
可以在多個特性同時開發時使用 worktree，這樣不會互相干擾。

## ⚠️ 關鍵規則

### 1. PM2 配置只改主目錄
```
❌ 不要改：.claude/worktrees/*/ecosystem.config.cjs
✅ 只改：C:/Users/appsk/Documents/Github/equipmentGAME/ecosystem.config.cjs
```
- PM2 是從主目錄啟動的
- Worktree 的 PM2 設定會被忽略

### 2. .env 環境變數只改主目錄
```
❌ 不要改：.claude/worktrees/*/.env
✅ 只改：C:/Users/appsk/Documents/Github/equipmentGAME/.env
```
- 運行中的 PM2 讀的是主目錄的 .env
- Worktree 的 .env 不會影響正在運行的機器人

### 3. 應用程式代碼可以在 Worktree 改
```
✅ 可以改：.claude/worktrees/*/src/**/*.js
   （之後 cherry-pick 或合併回主目錄）
```

## 工作流程

1. **在 worktree 開發新功能**
   ```bash
   cd .claude/worktrees/feature-name/
   # 改 src/ 目錄下的代碼
   git commit -m "新功能"
   ```

2. **測試完成後合併到主目錄**
   ```bash
   git cherry-pick <commit-hash>
   # 或手動複製代碼到主目錄
   ```

3. **PM2 重啟以使用新代碼**
   ```bash
   cd 主目錄
   pm2 restart equipmentGAME
   ```

4. **確認無問題後刪除 worktree**
   ```bash
   rm -rf .claude/worktrees/feature-name/
   ```

## 記住

- **PM2 和 .env** → 只改主目錄
- **應用代碼** → 可以在 worktree 改，做完再合併
- **機器人正在運行** → 改 worktree 不會影響它
