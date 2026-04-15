# Subagent Token 分離追蹤實施方案

## Context（為什麼做這個）

用戶現有的 Sub Agent 工作流（Explore、Plan、General-purpose）已經配置完成，目標是節省 45-50% 的 token。但目前**沒有機制能夠區分各個 subagent 分別消耗了多少 token**，導致無法驗證優化成效、無法識別低效的 agent、無法進行精細的成本控制。

**痛點**：
- SUB_AGENT_STRATEGY.md 中設定了優化目標，但無法衡量實際成效
- 每月 1 號的 Token 審計現在只能看全局，無法按 agent 分解
- 無法判斷 Explore vs Plan vs General-purpose 各消耗多少

**目標**：
- 為各 subagent 配置獨立的 API key（或標籤）
- 建立一個 scheduled task 定期查詢 Claude API 的 Usage & Cost API
- 生成月度 token 報告，按 agent 分解

---

## 實施方案

### 第一步：API Key 配置（settings.json 擴展）

在現有的 `.claude/settings.json` 中擴展 `agents` 配置，為各 subagent 分配 API key ID：

```json
"agents": {
  "explore": {
    "enabled": true,
    "apiKeyId": "sk-ant-explore-prod-xxx",  // 用於 Usage API 分組
    "apiKeyName": "Explore Agent Key",
    "description": "快速掃描代碼 & 檔案查找"
  },
  "plan": {
    "enabled": true,
    "apiKeyId": "sk-ant-plan-prod-xxx",
    "apiKeyName": "Plan Agent Key",
    "description": "設計 & 架構規劃"
  },
  "general-purpose": {
    "enabled": true,
    "apiKeyId": "sk-ant-general-prod-xxx",
    "apiKeyName": "General Purpose Agent Key",
    "description": "代碼實現"
  }
},
"tokenTracking": {
  "enabled": true,
  "apiAdminKey": "sk-ant-admin-xxx",  // 用於 Usage & Cost API（需要 Admin 權限）
  "trackingLocation": ".claude/token-tracking",
  "reportInterval": "monthly"  // 可選 weekly/daily
}
```

**實施步驟**：
1. 在 Anthropic 控制台為各 subagent 建立新的 API key
2. 在 settings.json 中配置上述結構
3. 準備一個 Admin API key（用於查詢 Usage API）

---

### 第二步：Token 查詢腳本

建立 `.claude/token-tracking/query-usage.js`，呼叫 Claude API 的 Usage & Cost API：

```javascript
// .claude/token-tracking/query-usage.js
const https = require('https');
const fs = require('fs');
const path = require('path');

const ADMIN_API_KEY = process.env.CLAUDE_ADMIN_API_KEY;
if (!ADMIN_API_KEY) {
  console.error('❌ 缺少 CLAUDE_ADMIN_API_KEY 環境變數');
  process.exit(1);
}

const apiKeyIds = {
  explore: process.env.CLAUDE_EXPLORE_KEY_ID,
  plan: process.env.CLAUDE_PLAN_KEY_ID,
  'general-purpose': process.env.CLAUDE_GENERAL_KEY_ID,
};

/**
 * 查詢指定 API key 的 token 使用量
 * @param {string} keyId - API key ID
 * @param {string} startDate - ISO 8601 格式，如 2026-04-01T00:00:00Z
 * @param {string} endDate - ISO 8601 格式，如 2026-04-30T23:59:59Z
 */
async function queryUsage(keyId, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      starting_at: startDate,
      ending_at: endDate,
      'api_key_ids[]': keyId,
      'group_by[]': 'api_key_id',
      bucket_width: '1d',
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: `/v1/organizations/usage_report/messages?${params}`,
      method: 'GET',
      headers: {
        'x-api-key': ADMIN_API_KEY,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * 主函式：查詢本月所有 agent 的 token 使用量
 */
async function main() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const startDate = monthStart.toISOString().split('T')[0] + 'T00:00:00Z';
  const endDate = monthEnd.toISOString().split('T')[0] + 'T23:59:59Z';

  console.log(`📊 查詢 ${startDate} 到 ${endDate} 的 token 使用量...\n`);

  const report = {
    timestamp: new Date().toISOString(),
    period: { start: startDate, end: endDate },
    agents: {},
  };

  for (const [agentName, keyId] of Object.entries(apiKeyIds)) {
    if (!keyId) {
      console.log(`⚠️  ${agentName}: 未配置 API key ID`);
      continue;
    }

    try {
      const usage = await queryUsage(keyId, startDate, endDate);
      
      // 解析回應，計算總 token 數
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheCreationTokens = 0;
      let totalCacheReadTokens = 0;

      if (usage.data && Array.isArray(usage.data)) {
        usage.data.forEach((bucket) => {
          totalInputTokens += bucket.input_tokens || 0;
          totalOutputTokens += bucket.output_tokens || 0;
          totalCacheCreationTokens += bucket.cache_creation_input_tokens || 0;
          totalCacheReadTokens += bucket.cache_read_input_tokens || 0;
        });
      }

      report.agents[agentName] = {
        keyId,
        tokens: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheCreationTokens: totalCacheCreationTokens,
          cacheReadTokens: totalCacheReadTokens,
          totalTokens: totalInputTokens + totalOutputTokens + totalCacheCreationTokens + totalCacheReadTokens,
        },
      };

      console.log(`✅ ${agentName.toUpperCase()}`);
      console.log(`   Input: ${totalInputTokens} | Output: ${totalOutputTokens}`);
      console.log(`   Cache Creation: ${totalCacheCreationTokens} | Cache Read: ${totalCacheReadTokens}`);
      console.log(`   Total: ${report.agents[agentName].tokens.totalTokens}\n`);
    } catch (err) {
      console.error(`❌ ${agentName}: ${err.message}`);
    }
  }

  // 保存報告到檔案
  const reportPath = path.join(__dirname, `token-report-${now.toISOString().split('T')[0]}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 報告已保存至: ${reportPath}`);

  // 計算總和和百分比
  const totals = Object.values(report.agents).reduce(
    (sum, agent) => ({
      totalTokens: sum.totalTokens + (agent.tokens.totalTokens || 0),
      inputTokens: sum.inputTokens + (agent.tokens.inputTokens || 0),
      outputTokens: sum.outputTokens + (agent.tokens.outputTokens || 0),
    }),
    { totalTokens: 0, inputTokens: 0, outputTokens: 0 }
  );

  console.log('\n📊 月度匯總');
  console.log(`   Total Input Tokens: ${totals.inputTokens}`);
  console.log(`   Total Output Tokens: ${totals.outputTokens}`);
  console.log(`   Total: ${totals.totalTokens}`);

  for (const [agentName, agentData] of Object.entries(report.agents)) {
    const pct = ((agentData.tokens.totalTokens / totals.totalTokens) * 100).toFixed(1);
    console.log(`   - ${agentName}: ${agentData.tokens.totalTokens} tokens (${pct}%)`);
  }
}

main().catch((err) => {
  console.error('❌ 查詢失敗:', err);
  process.exit(1);
});
```

---

### 第三步：Scheduled Task 配置

建立一個 scheduled task，每月 1 號 10:00 自動執行上述查詢腳本：

使用 `/schedule` skill（或 mcp__scheduled-tasks__create_scheduled_task）：

```yaml
taskId: monthly-token-audit
description: Monthly token usage report by subagent
cronExpression: "0 10 1 * *"  # 每月 1 號 10:00（本地時區）
notifyOnCompletion: true

prompt: |
  執行 .claude/token-tracking/query-usage.js 查詢本月 token 使用量。
  
  環境變數已配置：
  - CLAUDE_ADMIN_API_KEY
  - CLAUDE_EXPLORE_KEY_ID
  - CLAUDE_PLAN_KEY_ID
  - CLAUDE_GENERAL_KEY_ID
  
  任務：
  1. 執行 node .claude/token-tracking/query-usage.js
  2. 讀取生成的 JSON 報告
  3. 生成簡潔的月度總結（包含每個 agent 的百分比）
  4. 保存為 .claude/token-tracking/MONTH_SUMMARY.md
  5. 對比上月的數據（如果存在），標記增減趨勢
```

---

### 第四步：環境變數配置

在用戶的環境中設置必要的環境變數：

```bash
# .env（不要提交到 git）
CLAUDE_ADMIN_API_KEY=sk-ant-admin-xxxxx
CLAUDE_EXPLORE_KEY_ID=explore-key-id-xxxxx
CLAUDE_PLAN_KEY_ID=plan-key-id-xxxxx
CLAUDE_GENERAL_KEY_ID=general-key-id-xxxxx
```

**或者**在 Claude Code 的配置中（更安全）：
```json
// .claude/settings.json
"environment": {
  "CLAUDE_ADMIN_API_KEY": "${CLAUDE_ADMIN_API_KEY}",
  "CLAUDE_EXPLORE_KEY_ID": "${CLAUDE_EXPLORE_KEY_ID}",
  "CLAUDE_PLAN_KEY_ID": "${CLAUDE_PLAN_KEY_ID}",
  "CLAUDE_GENERAL_KEY_ID": "${CLAUDE_GENERAL_KEY_ID}"
}
```

---

### 第五步：整合到現有 Memory

在 `memory/TOKEN_OPTIMIZATION.md` 中添加一個新段落記錄 token 追蹤的配置：

```markdown
## Subagent Token 分離追蹤

**配置日期**: 2026-04-16
**報告位置**: `.claude/token-tracking/`
**查詢腳本**: `.claude/token-tracking/query-usage.js`
**月度自動審計**: 每月 1 號 10:00

### API Key 分配
- **Explore Agent**: ${CLAUDE_EXPLORE_KEY_ID}
- **Plan Agent**: ${CLAUDE_PLAN_KEY_ID}
- **General-purpose Agent**: ${CLAUDE_GENERAL_KEY_ID}

### 查詢方法
```bash
node .claude/token-tracking/query-usage.js
```

### 最新報告
- [2026-04-01 報告](token-tracking/token-report-2026-04-01.json)
```

---

## 驗證方案

**手動驗證**（第一次實施後立即測試）：
1. 確認 API key 已在 Anthropic 控制台建立
2. 確認環境變數已設置
3. 運行 `node .claude/token-tracking/query-usage.js` 測試
4. 檢查返回的 JSON 報告格式是否正確
5. 驗證百分比計算無誤

**自動驗證**（scheduled task 運行後）：
1. 檢查 `.claude/token-tracking/` 目錄是否生成報告
2. 查看最新的 JSON 報告，確認各 agent 的數據
3. 對比 `/insights` 報告中的全局 token 數，應該相符

**對標驗證**（持續監控）：
- 比較本月 vs 上月的 token 使用
- 檢查 Explore/Plan agent 是否節省了預期的 20-30% token
- 驗證整體是否接近 45-50% 的優化目標

---

## 實施步驟清單

1. **前置準備**
   - [ ] 在 Anthropic 控制台建立 3 個新的 API key（分別給 Explore、Plan、General）
   - [ ] 準備 1 個 Admin API key（用於查詢 Usage API）

2. **配置**
   - [ ] 擴展 `.claude/settings.json`，加入 apiKeyId 和 tokenTracking 配置
   - [ ] 設置環境變數（.env 或 Claude Code settings）

3. **代碼**
   - [ ] 建立 `.claude/token-tracking/` 目錄
   - [ ] 創建 `query-usage.js` 腳本
   - [ ] 測試腳本是否能正確查詢 API

4. **自動化**
   - [ ] 使用 `/schedule` 或 mcp__scheduled-tasks__create_scheduled_task 建立月度任務
   - [ ] 驗證 scheduled task 已啟用

5. **文檔**
   - [ ] 更新 `memory/TOKEN_OPTIMIZATION.md`
   - [ ] 在 `QUICK_REFERENCE.md` 中添加查詢命令

6. **首次運行驗證**
   - [ ] 手動運行查詢腳本測試
   - [ ] 檢查生成的報告
   - [ ] 等待首次自動審計（下月 1 號）

---

## 後續優化機會

1. **可視化儀表板**（可選）
   - 將 JSON 報告轉換為 Markdown 表格或簡單圖表
   - 可在 `.claude/token-tracking/DASHBOARD.md` 中定期更新

2. **告警機制**（高級）
   - 如果某個 agent 的 token 增長超過 10%，發送警告
   - 在月度報告中標記異常

3. **成本分析**（進階）
   - 根據 Anthropic 的定價，計算各 agent 的實際成本
   - 定期成本審計

---

## 現有配置同步

- **settings.json**: 需擴展 agents 配置和新增 tokenTracking 段落
- **SUB_AGENT_STRATEGY.md**: 在「後續優化點」中添加「子 agent token 分離追蹤已實施」
- **TOKEN_OPTIMIZATION.md**: 在「Token 優化成效」表格中補充「Subagent 分離追蹤機制」
