# NPC 系統實裝整合指南

## 📋 文件清單

已生成的檔案位於 `scripts/npc-templates/`：

1. **npc-design-spec.md** - 完整設計規格書（20個NPC詳細設計）
2. **npc-data.json** - JSON格式的NPC數據（用於導入資料庫）
3. **implementation-guide.md** - 本文檔（實裝指南）

---

## 🎯 20個NPC總覽

### 統計表

| 分類 | 名字 | 數量 | 用途 |
|------|------|------|------|
| **職業任務** | 弓箭手、劍士、戰士、矮人、盜賊、法師、治療師 | 7 | 換取職業徽章 |
| **行商** | 烈流、優月、巖澄、雪乃 | 4 | 販售16種D階裝備 |
| **行旅** | 風見、翔、月蒼 | 3 | BUFF/DEBUFF遭遇 |
| **路人** | 樵太、千紗、源 | 3 | BUFF/DEBUFF遭遇 |
| **村民** | 太郎、綾子 | 2 | 劇情任務相關 |
| **戰士** | 鐵心 | 1 | 傭兵隊相關 |
| **總計** | | **20** | |

---

## 🔧 實裝步驟

### Step 1: 資料庫初始化

#### 1.1 創建NPC集合
```javascript
// scripts/upsert-npc-data.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'equipment_game';
const COLLECTION_NAME = 'npc';

async function upsertNPCData() {
  const client = new MongoClient(URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // 讀取 npc-data.json
    const npcData = require('./npc-data.json');

    // 批量插入或更新
    for (const npc of npcData) {
      await collection.updateOne(
        { npcId: npc.npcId },
        { $set: npc },
        { upsert: true }
      );
    }

    console.log(`✅ 成功插入/更新 ${npcData.length} 個 NPC`);
  } finally {
    await client.close();
  }
}

upsertNPCData().catch(console.error);
```

#### 1.2 執行初始化
```bash
node scripts/upsert-npc-data.js
```

---

### Step 2: 後端API路由

#### 2.1 新增NPC API端點到 `adminMonsterRoutes.js`

```javascript
// routes/admin/adminMonsterRoutes.js

// 獲取所有NPC
router.get('/api/admin/npc', async (req, res) => {
  try {
    const npc = await db.collection('npc').find({}).toArray();
    res.json({ success: true, data: npc });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 獲取單個NPC
router.get('/api/admin/npc/:npcId', async (req, res) => {
  try {
    const npc = await db.collection('npc').findOne({ 
      npcId: req.params.npcId 
    });
    res.json({ success: true, data: npc });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 編輯NPC
router.post('/api/admin/npc/:npcId', async (req, res) => {
  try {
    const result = await db.collection('npc').updateOne(
      { npcId: req.params.npcId },
      { $set: req.body }
    );
    res.json({ success: true, modified: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 刪除NPC
router.delete('/api/admin/npc/:npcId', async (req, res) => {
  try {
    const result = await db.collection('npc').deleteOne({ 
      npcId: req.params.npcId 
    });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

---

### Step 3: Bot處理器

#### 3.1 NPC遭遇邏輯 `monsterZoneHandlers.js`

```javascript
// 新增到 monsterZoneHandlers.js

async function handleNPCEncounter(player, npcId) {
  const npc = await db.collection('npc').findOne({ npcId });
  
  if (!npc) {
    return { success: false, message: 'NPC 不存在' };
  }

  // 職業任務NPC
  if (npc.category === 'job_quest') {
    return handleJobQuestNPC(player, npc);
  }

  // 行商NPC
  if (npc.category === 'merchant') {
    return handleMerchantNPC(player, npc);
  }

  // 遭遇NPC (路人、行旅等)
  if (npc.category === 'encounter') {
    return handleEncounterNPC(player, npc);
  }

  // 村民NPC
  if (npc.category === 'villager') {
    return handleVillagerNPC(player, npc);
  }

  return { success: false, message: '未知的NPC類型' };
}

async function handleJobQuestNPC(player, npc) {
  // 檢查是否有D階+3主手武器
  const mainWeapon = player.equipment?.weapon_main;
  
  if (!mainWeapon || mainWeapon.grade !== 'd') {
    return { 
      success: false, 
      message: '需要D階武器來交換職業徽章' 
    };
  }

  // 檢查武器類型是否符合
  const requiredWeaponTypes = npc.dialogOptions[0].requirement.weaponType;
  if (!requiredWeaponTypes.includes(mainWeapon.weaponType)) {
    return { 
      success: false, 
      message: `需要 ${requiredWeaponTypes.join('/')} 武器` 
    };
  }

  // 執行交換
  player.equipment.weapon_main = null; // 移除主手武器
  player.inventory.push({
    itemId: npc.dialogOptions[0].reward.jobBadge,
    itemName: `${npc.title}的${npc.name}`,
    type: 'job_badge'
  });

  return { 
    success: true, 
    message: `成功獲得 ${npc.title} 職業徽章`,
    jobBadge: npc.dialogOptions[0].reward.jobBadge
  };
}

async function handleMerchantNPC(player, npc) {
  // 行商交互邏輯
  return {
    success: true,
    npc: {
      name: npc.name,
      title: npc.title,
      story: npc.story,
      inventory: npc.inventory
    }
  };
}

async function handleEncounterNPC(player, npc) {
  // 路人/行旅遭遇 - 隨機選擇一個對話選項
  const selectedOption = npc.dialogOptions[
    Math.floor(Math.random() * npc.dialogOptions.length)
  ];

  // 應用獎勵到下場戰鬥
  const battleModifier = parseBattleReward(selectedOption.reward);
  
  return {
    success: true,
    npc: {
      name: npc.name,
      title: npc.title,
      story: npc.story,
      selectedOption: selectedOption
    },
    battleModifier
  };
}

function parseBattleReward(reward) {
  const modifier = {};
  
  if (reward.gold) modifier.gold = reward.gold;
  if (reward.nextBattleDamage) modifier.damageMultiplier = 1 + (reward.nextBattleDamage / 100);
  if (reward.nextBattleExp) modifier.expMultiplier = 1 + (reward.nextBattleExp / 100);
  if (reward.nextBattleDropRate) modifier.dropRateBonus = reward.nextBattleDropRate;

  return modifier;
}
```

---

### Step 4: 前端UI (Admin)

#### 4.1 NPC編輯器 `admin.npc.js`

```javascript
// public/js/admin.npc.js

class NPCEditor {
  constructor() {
    this.npcs = [];
    this.currentNPC = null;
  }

  async loadAllNPCs() {
    try {
      const response = await fetch('/api/admin/npc');
      const data = await response.json();
      this.npcs = data.data;
      this.renderNPCList();
    } catch (error) {
      console.error('載入NPC失敗:', error);
    }
  }

  renderNPCList() {
    const container = document.getElementById('npc-list');
    container.innerHTML = '';

    const categories = {};
    this.npcs.forEach(npc => {
      if (!categories[npc.category]) {
        categories[npc.category] = [];
      }
      categories[npc.category].push(npc);
    });

    Object.entries(categories).forEach(([category, npcs]) => {
      const section = document.createElement('div');
      section.className = 'npc-category';
      section.innerHTML = `<h3>${category}</h3>`;

      npcs.forEach(npc => {
        const item = document.createElement('div');
        item.className = 'npc-item';
        item.innerHTML = `
          <div class="npc-name">${npc.title} - ${npc.name}</div>
          <button onclick="editor.selectNPC('${npc.npcId}')">編輯</button>
        `;
        section.appendChild(item);
      });

      container.appendChild(section);
    });
  }

  async selectNPC(npcId) {
    try {
      const response = await fetch(`/api/admin/npc/${npcId}`);
      const data = await response.json();
      this.currentNPC = data.data;
      this.renderNPCEditor();
    } catch (error) {
      console.error('載入NPC詳情失敗:', error);
    }
  }

  renderNPCEditor() {
    const container = document.getElementById('npc-editor');
    
    // 基本信息
    let html = `
      <div class="npc-editor">
        <h2>${this.currentNPC.title} - ${this.currentNPC.name}</h2>
        
        <div class="form-group">
          <label>故事:</label>
          <textarea id="npc-story">${this.currentNPC.story}</textarea>
        </div>
        
        <div class="form-group">
          <label>分類:</label>
          <select id="npc-category">
            <option value="job_quest" ${this.currentNPC.category === 'job_quest' ? 'selected' : ''}>職業任務</option>
            <option value="merchant" ${this.currentNPC.category === 'merchant' ? 'selected' : ''}>行商</option>
            <option value="encounter" ${this.currentNPC.category === 'encounter' ? 'selected' : ''}>遭遇</option>
            <option value="villager" ${this.currentNPC.category === 'villager' ? 'selected' : ''}>村民</option>
            <option value="warrior" ${this.currentNPC.category === 'warrior' ? 'selected' : ''}>戰士</option>
          </select>
        </div>
    `;

    // 對話選項
    if (this.currentNPC.dialogOptions) {
      html += '<div class="dialog-options"><h3>對話選項</h3>';
      this.currentNPC.dialogOptions.forEach((opt, idx) => {
        html += `
          <div class="dialog-option">
            <input type="text" value="${opt.text}" placeholder="選項文本">
            <textarea placeholder="獎勵JSON">${JSON.stringify(opt.reward, null, 2)}</textarea>
          </div>
        `;
      });
      html += '</div>';
    }

    // 行商庫存
    if (this.currentNPC.inventory) {
      html += '<div class="inventory"><h3>庫存</h3>';
      this.currentNPC.inventory.forEach((item, idx) => {
        html += `
          <div class="inventory-item">
            <input type="text" value="${item.name}" placeholder="物品名稱">
            <input type="number" value="${item.price}" placeholder="價格">
          </div>
        `;
      });
      html += '</div>';
    }

    html += `
      <button onclick="editor.saveNPC()">保存</button>
      <button onclick="editor.deleteNPC()">刪除</button>
    `;

    container.innerHTML = html;
  }

  async saveNPC() {
    const updated = {
      ...this.currentNPC,
      story: document.getElementById('npc-story').value,
      category: document.getElementById('npc-category').value
    };

    try {
      const response = await fetch(`/api/admin/npc/${this.currentNPC.npcId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      
      if (response.ok) {
        alert('NPC 已保存');
        this.loadAllNPCs();
      }
    } catch (error) {
      console.error('保存失敗:', error);
    }
  }

  async deleteNPC() {
    if (!confirm(`確定要刪除 ${this.currentNPC.title} - ${this.currentNPC.name}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/npc/${this.currentNPC.npcId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        alert('NPC 已刪除');
        this.loadAllNPCs();
      }
    } catch (error) {
      console.error('刪除失敗:', error);
    }
  }
}

// 初始化
const editor = new NPCEditor();
document.addEventListener('DOMContentLoaded', () => {
  editor.loadAllNPCs();
});
```

---

### Step 5: 前端HTML (Admin)

在 `public/admin.html` 中添加NPC編輯器區塊：

```html
<div id="admin-tabs">
  <!-- 其他標籤 -->
  
  <div id="npc-tab" class="tab-content">
    <h2>NPC 編輯器</h2>
    
    <div class="npc-container">
      <div id="npc-list" class="npc-list"></div>
      <div id="npc-editor" class="npc-editor"></div>
    </div>
  </div>
</div>

<style>
.npc-container {
  display: flex;
  gap: 20px;
}

.npc-list {
  flex: 0 0 250px;
  border: 1px solid #ddd;
  padding: 10px;
  max-height: 600px;
  overflow-y: auto;
}

.npc-item {
  padding: 8px;
  margin: 5px 0;
  background: #f5f5f5;
  border-radius: 4px;
  cursor: pointer;
}

.npc-editor {
  flex: 1;
  border: 1px solid #ddd;
  padding: 20px;
}

.dialog-option, .inventory-item {
  margin: 10px 0;
  padding: 10px;
  border: 1px solid #eee;
  border-radius: 4px;
}

.dialog-option input,
.dialog-option textarea {
  width: 100%;
  margin: 5px 0;
}

.inventory-item input {
  width: calc(50% - 5px);
  margin-right: 10px;
}
</style>
```

---

## 📊 遊戲整合流程

### NPC遭遇觸發

```
玩家遊戲 → 遭遇NPC事件
           ↓
    Bot調用 handleNPCEncounter()
           ↓
    根據NPC類型分發：
    - 職業任務 → 交換徽章
    - 行商 → 顯示購物界面
    - 遭遇 → 應用BUFF/DEBUFF
    - 村民 → 劇情任務
           ↓
    下場戰鬥應用修飾符
```

---

## ✅ 驗證清單

實裝前檢查：

- [ ] npc-data.json 已導入資料庫
- [ ] API路由已在 adminMonsterRoutes.js 中新增
- [ ] Bot處理器已更新 monsterZoneHandlers.js
- [ ] Admin UI 已添加到 admin.html
- [ ] 前端JS已加載 admin.npc.js
- [ ] 所有20個NPC都能在後台查看
- [ ] 職業任務NPC能正常交換徽章
- [ ] 行商NPC能正常顯示庫存
- [ ] 遭遇NPC能應用BUFF/DEBUFF
- [ ] 資料庫同步到雲端

---

## 🎮 遊戲測試流程

1. **職業任務測試**:
   - 準備D階+弓 → 遭遇弓箭手 → 獲得弓箭手徽章

2. **行商測試**:
   - 遭遇行商 → 查看庫存 → 購買D階武器

3. **遭遇測試**:
   - 遭遇路人 → 選擇對話 → 下場戰鬥有BUFF/DEBUFF

4. **村民測試**:
   - 遭遇村長 → 選擇"我保護妳們的村" → 獲得經驗值+50%

---

## 📝 後續擴展

### 可能的增強
1. **NPC隊伍系統** - 多個NPC共同出現
2. **NPC羈絆系統** - 多次遭遇同一NPC增加親密度
3. **NPC商品更新** - 定期更新行商庫存
4. **NPC任務鏈** - 多個NPC相關的任務序列
5. **NPC敵對系統** - 某些NPC之間有衝突

---

**完成日期**: 2026-04-16  
**更新者**: Claude Code  
**狀態**: 待實裝 ⏳
