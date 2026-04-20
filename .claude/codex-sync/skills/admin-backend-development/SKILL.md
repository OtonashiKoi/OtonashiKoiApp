---
name: admin-backend-development
description: 開發後台功能時使用——怪物編輯、道具管理、NPC 事件、圖片上傳的前後端標準實裝。涵蓋 Express 路由、原生 JS 前端、Cloudinary 整合、表單驗證。
when_to_use: 新增或修改後台 Admin 功能、管理遊戲內容（怪物/道具/任務）、整合 Cloudinary 圖片上傳時使用。
---

# Admin 後台開發規範

## 概述

此 SKILL 涵蓋如何在 Equipment Game 中開發 Admin 後台功能，包含：
- Express API 路由設計
- 原生 JavaScript 前端 UI（無框架）
- 圖片上傳與 Cloudinary 整合
- 資料驗證與錯誤處理
- 複雜表單編輯（怪物、道具、NPC 事件）

---

## 1. 架構總覽

### 前後端分層

```
前端（src/web/public/）
  ├─ admin.core.js            ← 核心工具（API 呼叫、驗證、快取）
  ├─ admin.monsters.js        ← 怪物編輯器
  ├─ admin.items.js           ← 道具管理
  ├─ admin.effects.js         ← NPC 效果編輯
  └─ adminLayout.js           ← 頁面佈局與導航

後端（src/api/routes/）
  ├─ adminMonsterRoutes.js    ← 怪物 CRUD + 狀態管理
  ├─ adminMonsterEventRoutes.js ← NPC 事件 API
  ├─ adminConsoleRoutes.js    ← 通用後台 API
  └─ ...

服務層（src/services/）
  ├─ monsterService.js        ← 怪物業務邏輯
  ├─ itemService.js           ← 道具業務邏輯
  └─ ...
```

### 驗證流程

```
API 請求
  ↓
後端驗證 Authorization header（Bearer token）
  ↓
檢查 token = config.api.adminPassword
  ↓
有效 → 執行業務邏輯
無效 → 401 Unauthorized
```

---

## 2. 後端 API 規範

### 2.1 認證中間件

```javascript
// src/api/routes/adminMonsterRoutes.js

function createAdminMonsterRoutes(serviceContext) {
  const router = Router();

  // 所有 /admin/* 路由都需驗證
  router.use("/admin/monsters", (req, res, next) => {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    const config = require("../../config");
    
    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }
    next();  // ✅ 驗證通過，繼續
  });
}
```

### 2.2 標準 CRUD 端點

```javascript
// ========== GET（讀取列表或單項）==========
router.get("/admin/monsters", async (_req, res, next) => {
  try {
    const monsters = await serviceContext.monsterService.listMonsters({
      includeDisabled: true  // 管理員可看已禁用的
    });
    res.json(ok(monsters, "monsters fetched"));
  } catch (error) {
    next(error);  // 交給全域錯誤處理
  }
});

// ========== POST（建立）==========
router.post("/admin/monsters", async (req, res, next) => {
  try {
    const monster = await serviceContext.monsterService.createMonster(req.body);
    res.json(ok(monster, "monster created"));
  } catch (error) {
    next(error);
  }
});

// ========== PUT（更新）==========
router.put("/admin/monsters/:id", async (req, res, next) => {
  try {
    const updated = await serviceContext.monsterService.updateMonster(
      req.params.id,
      req.body
    );
    res.json(ok(updated, "monster updated"));
  } catch (error) {
    next(error);
  }
});

// ========== DELETE（刪除）==========
router.delete("/admin/monsters/:id", async (req, res, next) => {
  try {
    await serviceContext.monsterService.deleteMonster(req.params.id);
    res.json(ok({}, "monster deleted"));
  } catch (error) {
    next(error);
  }
});
```

### 2.3 回應格式

```javascript
// ✅ 成功回應
{
  status: "ok",
  code: "SUCCESS",
  message: "monsters fetched",
  data: [ { id: "...", name: "...", ... } ]
}

// ❌ 失敗回應
{
  status: "fail",
  code: "VALIDATION_ERROR",
  message: "怪物名稱不能為空",
  data: null
}
```

### 2.4 圖片上傳與 Cloudinary

```javascript
// src/api/routes/adminMonsterRoutes.js

const multer = require("multer");
const { uploadImage } = require("../../shared/cloudinaryUpload");

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 },  // 25MB 限制
  fileFilter(_req, file, cb) {
    // 只允許圖片
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("只允許上傳圖片檔案"));
    }
    cb(null, true);
  }
});

router.post("/admin/monsters/upload-image", upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json(fail("NO_FILE", "No file uploaded."));
    }

    // 上傳至 Cloudinary
    const cloudinaryUrl = await uploadImage(req.file.path, `monsters/${Date.now()}`);
    
    res.json(ok({
      imageUrl: cloudinaryUrl,
      originalName: req.file.originalname
    }, "image uploaded"));
  } catch (error) {
    next(error);
  }
});
```

---

## 3. 前端 JavaScript 規範

### 3.1 核心工具函式（`admin.core.js`）

```javascript
function apiHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + (window.getAdminToken ? window.getAdminToken() : "")
  };
}

// API 呼叫統一格式
async function apiCall(method, path, body = null) {
  const options = {
    method,
    headers: apiHeaders()
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch("/admin" + path, options);
  const json = await res.json();

  if (!res.ok || json.status !== "ok") {
    throw new Error(json.message || "API 失敗");
  }

  return json.data;
}

// 常用快捷函式
const api = {
  get: (path) => apiCall("GET", path),
  post: (path, body) => apiCall("POST", path, body),
  put: (path, body) => apiCall("PUT", path, body),
  delete: (path) => apiCall("DELETE", path)
};
```

### 3.2 怪物編輯器結構（`admin.monsters.js`）

```javascript
(function () {
  const BASE = "/admin";
  let monsters = [];      // 快取怪物列表
  let itemLib = [];       // 快取道具庫
  let activeZone = "normal";
  let zoneState = {};     // 目前哪隻怪物正在作戰

  // ========== 載入資料 ==========
  async function loadMonsters() {
    try {
      monsters = await api.get("/monsters");
      renderMonsterList();
    } catch (error) {
      showError("載入怪物失敗: " + error.message);
    }
  }

  async function loadItems() {
    try {
      itemLib = await api.get("/items");
    } catch (error) {
      showError("載入道具失敗: " + error.message);
    }
  }

  // ========== 建立怪物 ==========
  async function createMonster(data) {
    try {
      const newMonster = await api.post("/monsters", {
        name: data.name,
        level: parseInt(data.level),
        maxHp: parseInt(data.maxHp),
        def: parseInt(data.def),
        str: parseInt(data.str),
        agi: parseInt(data.agi),
        // ... 其他欄位
        enabled: true,
        zone: activeZone
      });

      monsters.push(newMonster);
      renderMonsterList();
      showSuccess("怪物已建立");
    } catch (error) {
      showError("建立失敗: " + error.message);
    }
  }

  // ========== 更新怪物 ==========
  async function updateMonster(id, data) {
    try {
      const updated = await api.put(`/monsters/${id}`, data);
      const idx = monsters.findIndex(m => m.id === id);
      if (idx >= 0) monsters[idx] = updated;
      renderMonsterList();
      showSuccess("怪物已更新");
    } catch (error) {
      showError("更新失敗: " + error.message);
    }
  }

  // ========== 刪除怪物 ==========
  async function deleteMonster(id) {
    if (!confirm("確定要刪除此怪物？")) return;

    try {
      await api.delete(`/monsters/${id}`);
      monsters = monsters.filter(m => m.id !== id);
      renderMonsterList();
      showSuccess("怪物已刪除");
    } catch (error) {
      showError("刪除失敗: " + error.message);
    }
  }

  // ========== UI 渲染 ==========
  function renderMonsterList() {
    const container = document.getElementById("monster-list");
    container.innerHTML = monsters.map(m => `
      <div class="monster-card">
        <h3>${esc(m.name)}</h3>
        <p>等級: ${m.level} | HP: ${m.maxHp} | DEF: ${m.def}</p>
        <div class="actions">
          <button onclick="editMonster('${m.id}')">編輯</button>
          <button onclick="deleteMonster('${m.id}')">刪除</button>
        </div>
      </div>
    `).join("");
  }

  // 初始化
  loadMonsters();
  loadItems();
})();
```

### 3.3 圖片上傳

```javascript
async function uploadMonsterImage(file) {
  const formData = new FormData();
  formData.append("image", file);

  try {
    const res = await fetch("/admin/monsters/upload-image", {
      method: "POST",
      headers: { "Authorization": "Bearer " + getAdminToken() },
      body: formData
    });

    const json = await res.json();
    if (json.status !== "ok") {
      throw new Error(json.message);
    }

    return json.data.imageUrl;  // Cloudinary URL
  } catch (error) {
    showError("上傳失敗: " + error.message);
  }
}

// 在表單中使用
document.getElementById("monster-image-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = await uploadMonsterImage(file);
  if (url) {
    document.getElementById("monster-image-preview").src = url;
    currentMonsterData.imageUrl = url;
  }
});
```

---

## 4. 複雜編輯器模式

### 4.1 掉落物品選擇（Modal + Combobox）

```javascript
// 怪物可掉落多項物品，每項有掉落機率
function showDropItemsModal(monsterId) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <h3>設定掉落物品</h3>
      
      <!-- 搜尋式下拉菜單 -->
      <div class="drop-combo-wrap">
        <input type="hidden" id="selected-item-id">
        <input type="text" id="item-search" placeholder="搜尋物品...">
        <div id="item-options" class="combo-options"></div>
      </div>

      <!-- 掉落機率輸入 -->
      <input type="number" id="drop-chance" min="0" max="100" placeholder="掉落機率 %">
      
      <button onclick="addDropItem()">新增掉落物品</button>
      <button onclick="closeModal()">關閉</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function setupItemCombobox(selectedItemId = "") {
  const searchInput = document.getElementById("item-search");
  const optionsDiv = document.getElementById("item-options");
  const hiddenInput = document.getElementById("selected-item-id");

  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = itemLib.filter(i => i.name.toLowerCase().includes(query));

    optionsDiv.innerHTML = filtered.map(item => `
      <div class="option" onclick="selectItem('${item.id}', '${esc(item.name)}')">
        ${esc(item.name)}
      </div>
    `).join("");
  });
}

function selectItem(itemId, itemName) {
  document.getElementById("selected-item-id").value = itemId;
  document.getElementById("item-search").value = itemName;
  document.getElementById("item-options").innerHTML = "";
}
```

### 4.2 NPC 效果編輯（Multiplier ↔ Percent 轉換）

```javascript
// NPC 效果有時用倍數（1.1 = 110%），有時用百分比（110）
function normalizeEffectValue(input, type) {
  if (type === "multiplier") {
    // 1.1 → 110
    return Math.round(parseFloat(input) * 100);
  } else if (type === "percent") {
    // 110 → 1.1
    return parseFloat(input) / 100;
  }
  return input;
}

// 提示用戶轉換結果
function showEffectHint(value, fromType, toType) {
  const converted = normalizeEffectValue(value, fromType);
  const hint = `${value} ${fromType === "multiplier" ? "倍" : "%"} = ${converted} ${toType === "multiplier" ? "倍" : "%"}`;
  document.getElementById("effect-hint").textContent = hint;
}

// 在輸入時即時轉換
document.getElementById("effect-value").addEventListener("input", (e) => {
  const value = e.target.value;
  showEffectHint(value, "multiplier", "percent");
  
  // 自動轉為百分比存儲
  const percentage = normalizeEffectValue(value, "multiplier");
  currentEffect.value = percentage;
});
```

---

## 5. 表單驗證規範

### 5.1 前端驗證

```javascript
function validateMonsterData(data) {
  const errors = [];

  // 必填欄位
  if (!data.name || data.name.trim() === "") {
    errors.push("怪物名稱不能為空");
  }

  // 數值範圍
  if (!Number.isInteger(data.level) || data.level < 1 || data.level > 100) {
    errors.push("等級必須介於 1-100");
  }

  if (!Number.isInteger(data.maxHp) || data.maxHp < 1) {
    errors.push("最大 HP 必須 > 0");
  }

  // 圖片
  if (!data.imageUrl) {
    errors.push("必須上傳怪物圖片");
  }

  return errors;
}

// 提交前驗證
async function submitMonster(data) {
  const errors = validateMonsterData(data);
  if (errors.length > 0) {
    showError("表單錯誤:\n" + errors.join("\n"));
    return;
  }

  // 驗證通過，提交
  await createMonster(data);
}
```

### 5.2 後端驗證（Service 層）

```javascript
// src/services/monsterService.js

async function createMonster(data) {
  // 驗證
  if (!data.name) throw new AppError("VALIDATION_ERROR", "怪物名稱不能為空");
  if (data.level < 1 || data.level > 100) throw new AppError("VALIDATION_ERROR", "等級範圍錯誤");

  // 檢查重複
  const existing = await monsterRepository.findByName(data.name);
  if (existing) throw new AppError("DUPLICATE_NAME", "此怪物名稱已存在");

  // 建立
  const monster = createMonsterModel({
    ...data,
    createdAt: new Date().toISOString()
  });

  return await monsterRepository.save(monster);
}
```

---

## 6. 狀態管理

### 6.1 怪物狀態（目前作戰的怪物）

```javascript
// 後端追蹤每個區域目前在戰的怪物
router.get("/admin/monsters/state", async (req, res, next) => {
  try {
    const zone = req.query.zone || "normal";
    const state = await serviceContext.monsterService.getState(zone);
    const monsters = await serviceContext.monsterService.listMonsters({ zone });
    const active = monsters.find(m => m.seq === state.activeMonsterSeq);

    res.json(ok({
      state,        // { activeMonsterSeq: "...", participants: {...} }
      active        // 目前怪物的完整資料
    }));
  } catch (error) {
    next(error);
  }
});

// 前端顯示
async function updateMonsterStateUI() {
  const state = await api.get("/monsters/state?zone=" + activeZone);
  document.getElementById("active-monster").textContent = 
    state.active ? `${state.active.name} (${state.active.level})` : "無";
}
```

---

## 7. 檢查清單（新增內容功能）

- [ ] **後端路由**：在 `src/api/routes/` 新增對應檔案
- [ ] **驗證中間件**：確保路由有 Bearer token 驗證
- [ ] **Service 層**：在 `src/services/` 實作業務邏輯
- [ ] **前端模塊**：在 `src/web/public/` 新增 `admin.feature.js`
- [ ] **前端驗證**：表單提交前檢查有效性
- [ ] **後端驗證**：Service 層再驗證一次
- [ ] **錯誤處理**：用 AppError 拋出用戶友善訊息
- [ ] **快取更新**：前端列表更新後要同步快取
- [ ] **UI 反饋**：showSuccess/showError 提示用戶
- [ ] **圖片上傳**：若涉及圖片，確保 Cloudinary 配置正確

---

## 8. 常見坑點

| 問題 | 原因 | 修正 |
|------|------|------|
| 401 Unauthorized | 忘記傳 Authorization header | 檢查 `apiHeaders()` 函式 |
| 圖片上傳失敗 | Cloudinary 未設定 | 確認 .env 有 CLOUDINARY_* |
| 快取不同步 | 更新後未重新載入 | 更新本地 monsters 陣列 |
| Modal 表單提交失敗 | 驗證未通過但訊息不清楚 | 實裝詳細的驗證錯誤訊息 |
| Combobox 搜尋卡頓 | 大量物品時篩選緩慢 | 實裝防抖（debounce） |

---

## 9. 效能最佳實踐

```javascript
// ✅ 緩存列表，不要重複查詢
let cachedMonsters = null;

async function getMonsters(forceRefresh = false) {
  if (cachedMonsters && !forceRefresh) {
    return cachedMonsters;
  }
  cachedMonsters = await api.get("/monsters");
  return cachedMonsters;
}

// ✅ 大列表使用虛擬滾動（若有 100+ 項）
// 使用 IntersectionObserver 或函式庫如 vue-virtual-scroller

// ✅ 圖片懶載入
<img src="..." loading="lazy">

// ✅ 防抖搜尋輸入
function debounce(fn, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

const debouncedSearch = debounce((query) => {
  renderFilteredItems(query);
}, 300);

searchInput.addEventListener("input", (e) => {
  debouncedSearch(e.target.value);
});
```

---

## 相關文檔

- [Discord 命令規範](../docs/DISCORD_CONVENTIONS.md)
- [MongoDB 標準化](../docs/MONGODB_STANDARDIZATION.md)
- [效能優化](../docs/PERFORMANCE_OPTIMIZATION.md)

---

## 更新記錄

| 日期 | 變更 |
|------|------|
| 2026-04-15 | 初始化 Admin 後台開發 SKILL |
