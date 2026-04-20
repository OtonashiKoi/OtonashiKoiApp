---
name: 裝備道具設計工作流程
description: 設計任何涉及道具的NPC/事件時必須先驗證資料庫
type: feedback
originSessionId: 5a6f9748-887c-4122-8659-6a7a14e57109
---
# ⚠️ 裝備道具設計工作流程

## 重要原則

**任何涉及道具交換、販售、獎勵的設計都必須「先查詢資料庫」，確保道具真的存在，再進行設計。**

## 工作流程

### ❌ 錯誤做法（之前犯過的錯誤）

1. 先設計20個NPC
2. 定義它們需要的道具ID（d_sword_iron, d_dagger_steel 等）
3. 導入NPC模板卡
4. 驗證時才發現：**道具庫裡完全沒有這些道具**
5. 被迫重新更新所有20個NPC的道具ID

**浪費**: 大量時間重複工作

---

### ✅ 正確做法

#### Step 1: 查詢現有道具
```bash
# 檢查現有主手武器、防具、職業徽章
db.items.find({ type: 'weapon_main' }).limit(50)
db.items.find({ type: 'armor' }).limit(50)  
db.items.find({ id: { $regex: '^job_' } }).toArray()
```

#### Step 2: 建立道具映射表
根據查詢結果，創建道具ID映射：
```javascript
const weaponMap = {
  'bow': 'a314493c-efcd-43e5-bebc-935ef1d588a5',      // 精鋼弓
  'sword': 'e3bcdb33-4a28-499e-9c65-50240368550f',    // 精鋼單手劍
  'staff': 'd08f99f6-6a4f-4afb-a02d-ec1a2cd69b2e',    // 高級雙手法杖
  // ...
};
```

#### Step 3: 設計NPC時直接使用正確的道具ID
從Step 2的映射表中選擇道具，不要編造虛擬ID

#### Step 4: 導入並驗證
導入後再驗證一次道具是否真的能在遊戲中獲得

---

## 檢查清單

- [ ] 在任何NPC/事件設計之前先查詢資料庫
- [ ] 列出現有的該類型道具
- [ ] 建立道具ID映射表
- [ ] 使用真實存在的道具ID進行設計
- [ ] 導入後驗證道具確實存在

---

## 常用查詢

### 查詢所有武器
```bash
db.items.find({ type: 'weapon_main' }).sort({ name: 1 }).toArray()
```

### 查詢所有防具
```bash
db.items.find({ type: 'armor' }).sort({ name: 1 }).toArray()
```

### 查詢所有職業徽章
```bash
db.items.find({ id: { $regex: '^job_' } }).toArray()
```

### 查詢某個等級的道具
```bash
db.items.find({ grade: 'd' }).toArray()
```

---

**建檔日期**: 2026-04-16  
**經驗教訓**: 設計20個NPC時因為虛擬道具ID導致全部需要重新更新
