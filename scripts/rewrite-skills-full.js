const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', '.vscode', 'prompts', 'skills');
const backupBase = path.join(base, 'backups-full');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function listSkillDirs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'backups' && e.name !== 'backups-full')
    .map(d => ({ name: d.name, dir: path.join(dir, d.name) }));
}

function frontmatter(name, description) {
  return `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  pattern: tool-wrapper\n  domain: equipmentgame\n---\n\n`;
}

const templates = {
  '專案架構與後台檢查': {
    title: '專案架構與後台檢查',
    description: '修改遊戲內容前的全面檢查清單，包含後台、API、DB 與資產位置對照',
    body: `目的：在對怪物、道具、效果、任務或掉落進行新增/修改/刪除前，提供一套必做檢查流程。

觸發條件：任何變更會影響遊戲內容或 admin API 時。

檢查規則：
- 列出變更項目（id、key、檔案）。
- 搜尋 repo 中所有引用（後端 service、前端 admin、bot publish、scripts）。
- 檢查 DB collections（使用 scripts/check-db-collections.js）。
- 檢查圖片/資產路徑（assets/, player-web/public/, Cloudinary）。
- 更新 admin 前端表單與 API，並加入驗證與稽核紀錄。

拒絕策略：若發現未授權的 collection、缺失的前端欄位或無 migration/backfill 策略，拒絕合併並在 PR 列明要求。

稽核：每次變更需呼叫 adminActionLogRepository，並在 PR 列出已執行的檢查項目與備份位置。

實作注意：提供搜尋命令範例與 migration 範本；在 staging 完整驗證後再上 production。`
  },

  '部署安全檢查': {
    title: '部署安全檢查',
    description: '部署前的環境與安全檢查清單',
    body: `目的：在 release 或重啟服務前驗證環境與遷移，避免造成中斷或資安風險。

觸發條件：CI 部署、manual go-live、或執行 pm2 重啟時。

檢查規則：
- 檢查必要 env（MONGO_URL、JWT_SECRET、CLOUDINARY_URL）是否存在且指向正確環境。
- 確認 migration 已在 staging 成功執行且備份已產生（exports/ 或 mongodump）。
- 驗證外部服務可用性（cloudinary, mail, 3rd party API）。

拒絕策略：任一重要檢查失敗即停止部署並通知 maintainer，PR 中需列出修正步驟與 rollback 計畫。

實作注意：將檢查腳本加入 CI pre-deploy，並在 Discord/CI 中回報 audit-id。`
  },

  '檔案索引與定位': {
    title: '檔案索引與定位',
    description: '為大型文件建立 index 以支援分塊檢索與按需載入',
    body: `目的：降低查詢成本並只載入必要 chunk。

檢查規則：建立 index JSON（headings、token-estimate、offset），查詢時先搜尋 index 決定 chunk。

實作注意：chunk 大小應符合 LLM token 限制（例如 ≤400 行或 token budget），並提供 fallback 路徑。`
  },

  '重複查詢去重': {
    title: '重複查詢去重',
    description: '查詢去重策略，避免在短時間內重複進行昂貴檢索',
    body: `目的：辨識相似查詢並回用舊回應以節省成本。

檢查規則：以向量或字串相似度比較歷史查詢，超過閾值則回用並標記 dedup=true；提供重新查詢按鈕。

稽核：記錄來源、相似度、audit-id。`
  },

  '自動提交與中文註解': {
    title: '自動提交與中文註解',
    description: '自動提交規範與中文註解格式化慣例',
    body: `目的：規範自動化產生 commit 的格式與審核流程。

規範：commit message 使用 conventional commit（type(scope): summary），PR 需清楚說明自動來源與變更範圍。

實作注意：自動提交應建立分支並以 PR 方式讓維護者確認，不直接合併到 main。`
  },

  // default fallback template for other skills
};

function defaultTemplate(folder) {
  return `目的：針對 ${folder} 提供行動指南與檢查清單。

觸發條件：參照專案變更政策。

檢查規則：
- 列出預期行為。
- 檢查引用與前端/後端影響。

實作注意：請在此填入範例與程式碼片段（≤400 行）。`;
}

function writeSkill(folder, tpl) {
  const skillPath = path.join(base, folder, 'SKILL.md');
  const original = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : '';
  // backup
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bakDir = path.join(backupBase, folder);
  ensureDir(bakDir);
  fs.writeFileSync(path.join(bakDir, `SKILL.md.bak.${ts}`), original, 'utf8');

  const nameSlug = folder.replace(/[^a-zA-Z0-9\s\u4e00-\u9fff]/g, '').trim();
  const fm = frontmatter(nameSlug, tpl.description || folder);
  const content = fm + `You are an expert in ${tpl.title}.\n\n## Core Conventions\n\n` + tpl.body + '\n\n## Maintainer\n\n- 更新者：專案維護者\n';
  fs.writeFileSync(skillPath, content, 'utf8');
  console.log('Wrote', skillPath);
}

function main() {
  ensureDir(backupBase);
  const dirs = listSkillDirs(base);
  for (const d of dirs) {
    const key = d.name;
    const tpl = templates[key] || { title: key, description: key, body: defaultTemplate(key) };
    writeSkill(d.name, tpl);
  }
  console.log('All skills rewritten. Backups under', backupBase);
}

main();
