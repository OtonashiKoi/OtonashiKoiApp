#!/usr/bin/env node

/**
 * 快速檢查 token 使用比例
 * 用法: node quick-check.js <ADMIN_API_KEY> <API_KEY_ID1> <API_KEY_ID2> ...
 *
 * 範例:
 * node quick-check.js sk-ant-admin-xxx sk-ant-explore-xxx sk-ant-plan-xxx sk-ant-general-xxx
 */

const https = require('https');

const adminKey = process.argv[2];
const apiKeyIds = process.argv.slice(3);

if (!adminKey || apiKeyIds.length === 0) {
  console.log(`
📊 Anthropic Token 快速檢查工具

用法: node quick-check.js <ADMIN_API_KEY> <API_KEY_ID1> [<API_KEY_ID2> ...]

範例:
  node quick-check.js sk-ant-admin-xxx sk-ant-explore-xxx sk-ant-plan-xxx sk-ant-general-xxx

說明:
  - ADMIN_API_KEY: 需要 Admin 權限的 API key（在 Anthropic 控制台取得）
  - API_KEY_ID: 要查詢的 API key ID（可以多個）

取得 API key:
  1. 登入 https://console.anthropic.com
  2. 建立新的 API key（每個 subagent 一個）
  3. 複製 key ID 到上面的命令

輸出:
  - 本月目前為止的 token 使用量
  - 各 key 的百分比分配
  `);
  process.exit(0);
}

async function queryUsage(keyId) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const startDate = monthStart.toISOString().split('T')[0] + 'T00:00:00Z';
    const endDate = new Date().toISOString().split('T')[0] + 'T23:59:59Z';

    const params = new URLSearchParams({
      starting_at: startDate,
      ending_at: endDate,
      'api_key_ids[]': keyId,
      'group_by[]': 'api_key_id',
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: `/v1/organizations/usage_report/messages?${params}`,
      method: 'GET',
      headers: {
        'x-api-key': adminKey,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API 錯誤 ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve({
            keyId,
            data: parsed,
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('\n⏳ 查詢 token 使用量中...\n');

  const results = {};
  let totalTokens = 0;

  for (const keyId of apiKeyIds) {
    try {
      const result = await queryUsage(keyId);

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreateTokens = 0;
      let cacheReadTokens = 0;

      if (result.data.data && Array.isArray(result.data.data)) {
        result.data.data.forEach(bucket => {
          inputTokens += bucket.input_tokens || 0;
          outputTokens += bucket.output_tokens || 0;
          cacheCreateTokens += bucket.cache_creation_input_tokens || 0;
          cacheReadTokens += bucket.cache_read_input_tokens || 0;
        });
      }

      const agentTotal = inputTokens + outputTokens + cacheCreateTokens + cacheReadTokens;
      results[keyId] = {
        input: inputTokens,
        output: outputTokens,
        cacheCreate: cacheCreateTokens,
        cacheRead: cacheReadTokens,
        total: agentTotal,
      };
      totalTokens += agentTotal;

      console.log(`✅ ${keyId.substring(0, 20)}...`);
      console.log(`   Input: ${inputTokens} | Output: ${outputTokens}`);
      console.log(`   Cache: ${cacheCreateTokens + cacheReadTokens}`);
      console.log(`   小計: ${agentTotal}\n`);
    } catch (err) {
      console.error(`❌ ${keyId}: ${err.message}\n`);
    }
  }

  if (totalTokens === 0) {
    console.log('❌ 無法查詢 token 數據。請檢查:');
    console.log('   1. Admin API Key 是否正確');
    console.log('   2. API Key ID 是否正確');
    console.log('   3. 這些 key 本月是否有使用記錄');
    process.exit(1);
  }

  console.log('━'.repeat(50));
  console.log('📊 本月 Token 分配比例\n');

  for (const [keyId, data] of Object.entries(results)) {
    const pct = ((data.total / totalTokens) * 100).toFixed(1);
    const barLength = Math.round(pct / 2);
    const bar = '█'.repeat(barLength) + '░'.repeat(50 - barLength);
    console.log(`${keyId.substring(0, 15)}: ${bar} ${pct}% (${data.total})`);
  }

  console.log('\n合計: ' + totalTokens + ' tokens\n');
}

main().catch(err => {
  console.error('❌ 錯誤:', err.message);
  process.exit(1);
});
