---
name: Discord 命令與互動規範
description: 統一管理 30+ 斜杠命令、按鈕互動、選單的標準實裝模式
trigger: "When adding new Discord commands, handling button interactions, or debugging command permissions"
---

# Discord 命令與互動規範

## 概述

此 SKILL 涵蓋如何在 Equipment Game 中統一管理 Discord 命令、按鈕互動、選單的實裝標準，確保代碼可維護性與用戶體驗一致。

---

## 1. 檔案結構與分工

### 推薦架構

```
src/bot/
├── commands.js                ← 所有 SlashCommand 定義 + 路由
├── client.js                  ← Discord Client 初始化 + 事件監聽
├── handlers/
│   ├── adminCurrencyHandlers.js
│   ├── adminExpHandler.js
│   ├── coinShopHandlers.js
│   ├── monsterZoneHandlers.js
│   └── ...
├── playerPanel.js             ← 複雜互動邏輯（按鈕 + 選單 + Modal）
├── coinShopView.js            ← 專業視圖邏輯
└── runtimeContext.js          ← Service 層注入
```

### 原則

| 層級 | 責任 | 檔案 |
|------|------|------|
| **Command Router** | 路由 + 權限檢查 | `commands.js` |
| **Handler** | 業務邏輯 | `handlers/*.js` |
| **View** | 訊息/互動生成 | `*View.js`, `playerPanel.js` |
| **Client Setup** | 事件監聽 + 初始化 | `client.js` |

---

## 2. 斜杠命令規範

### 2.1 定義命令（`commands.js`）

```javascript
const definitions = [
  new SlashCommandBuilder()
    .setName("命令名稱")
    .setDescription("簡短中文描述（Discord 用戶看得到）")
    .addUserOption((opt) =>
      opt
        .setName("玩家")
        .setDescription("目標玩家")
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("數量")
        .setDescription("正整數")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption((opt) =>
      opt
        .setName("原因")
        .setDescription("操作原因（可選）")
        .setRequired(false)
    )
].map((d) => d.toJSON());
```

**命名規範**：
- ✅ 中文命令名（用戶友善）：`/管理員加金幣`
- ❌ 英文命令名（難以找到）：`/admin_grant_gold`

### 2.2 命令路由與權限檢查

```javascript
async function handleCommand(interaction) {
  const { commandName } = interaction;

  try {
    // ====== 權限檢查 ======
    // 不同命令有不同的權限需求
    if (requiresAdmin(commandName)) {
      const isAdminUser = await isAdmin(interaction);
      if (!isAdminUser) {
        await interaction.reply({
          content: "❌ 只有管理員可以執行此命令",
          flags: MessageFlags.Ephemeral  // 私密訊息
        });
        return;
      }
    }

    // ====== 長時間操作必須 Defer ======
    // 若操作超過 3 秒，必須先 defer，再 editReply
    if (isLongOperation(commandName)) {
      await interaction.deferReply({ ephemeral: true });
      const result = await performLongOperation(interaction);
      await interaction.editReply(result);
      return;
    }

    // ====== 一般路由 ======
    switch (commandName) {
      case "連線測試":
        await handlePingCommand(interaction);
        break;
      case "管理員加金幣":
        await handleAdminCurrencyCommand(interaction, "grant", "gold");
        break;
      // ... 更多命令
      default:
        await interaction.reply("❌ 未知命令");
    }
  } catch (error) {
    await handleCommandError(interaction, error);
  }
}
```

### 2.3 權限檢查函式

```javascript
// 在 commands.js 頂部定義
async function isAdmin(interaction) {
  return serviceContext.accessControlService.isDiscordAdmin(interaction);
}

function requiresAdmin(commandName) {
  const adminCommands = [
    "管理員加金幣",
    "管理員扣金幣",
    "管理員加經驗",
    "發布玩家面板",
    "發布個人房間面板"
  ];
  return adminCommands.includes(commandName);
}

function isLongOperation(commandName) {
  // DB 查詢 + 複雜計算通常 > 3 秒
  return [
    "管理員加金幣",  // 涉及 wallet, progress, audit log 更新
    "發布玩家面板"   // 涉及大量訊息操作
  ].includes(commandName);
}
```

### 2.4 錯誤處理

```javascript
async function handleCommandError(interaction, error) {
  console.error(`[Command Error] ${interaction.commandName}:`, error);

  const isAppError = error.name === "AppError";  // 你的自訂錯誤類別
  const message = isAppError
    ? error.message  // 用戶友善訊息
    : "❌ 系統錯誤，請稍後重試";

  // 判斷是否已 reply
  if (interaction.replied) {
    await interaction.followUp({
      content: message,
      flags: MessageFlags.Ephemeral
    });
  } else if (interaction.deferred) {
    await interaction.editReply(message);
  } else {
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral
    });
  }
}
```

---

## 3. 按鈕互動規範

### 3.1 按鈕 ID 約定

```javascript
// ✅ 推薦格式：`功能_操作_識別符`
const buttonIds = {
  // 玩家面板
  PLAYER_PANEL_CREATE: "player_create",
  PLAYER_PANEL_VIEW_PROFILE: "player_profile",
  PLAYER_PANEL_VIEW_WALLET: "player_wallet",
  PLAYER_PANEL_CLAIM_REWARD: "player_claim",

  // 怪物區域
  MONSTER_ZONE_ENTER: "monster_enter",
  MONSTER_ZONE_START: "monster_start_",      // 後綴加 monsterId
  MONSTER_ZONE_QUIT: "monster_quit",

  // 商店
  COIN_SHOP_BUY: "shop_buy_",                // 後綴加 itemId
  COIN_SHOP_REFRESH: "shop_refresh"
};

// ❌ 避免：過長、無意義
// "btn_12345", "action_xyz_abc_def_ghi"
```

### 3.2 Defer + EditReply 模式（重要！）

**問題**：Discord 要求 3 秒內回應，若業務邏輯複雜（DB 查詢、多個 API 呼叫），會超時。

**解決方案**：
```javascript
async function handleButton(interaction) {
  const { customId } = interaction;

  try {
    // 1️⃣ 立即 Defer（告訴 Discord「正在處理」）
    await interaction.deferReply({ ephemeral: true });

    // 2️⃣ 執行業務邏輯（不受 3 秒限制）
    const result = await performComplexLogic(interaction);

    // 3️⃣ 更新回應（可在任何時間點）
    await interaction.editReply(result);
  } catch (error) {
    // 若已 defer，用 editReply；未 defer，用 reply
    if (interaction.deferred) {
      await interaction.editReply(`❌ 錯誤: ${error.message}`);
    } else {
      await interaction.reply({
        content: `❌ 錯誤: ${error.message}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
}
```

**時序圖**：
```
用戶點擊按鈕
    ↓
deferReply() ← 0.1秒（立即）
    ↓
performComplexLogic() ← 可以耗時 5-10 秒
    ↓
editReply() ← 回應用戶（任何時間點）
```

### 3.3 按鈕回應內容規範

```javascript
// ✅ 好範例
const response = {
  content: "✅ 金幣已發放\n玩家: Alice\n數量: 100 金幣",
  flags: MessageFlags.Ephemeral  // 只有命令者看得到
};

// ❌ 避免
// content: "operation_success_true_grant_gold_to_player_id_123_amount_100"
```

### 3.4 複雜互動（Modal）模式

```javascript
// 當需要多步驟輸入時，使用 Modal（類似表單）

async function showConfirmModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("confirm_grant_modal")
    .setTitle("確認發放獎勵")
    .addActionRow(
      new TextInputBuilder()
        .setCustomId("confirm_text")
        .setLabel("輸入 '確認' 來確認操作")
        .setStyle(TextInputStyle.Short)
    );

  await interaction.showModal(modal);
}

// 監聽 Modal 提交
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "confirm_grant_modal") {
      const input = interaction.fields.getTextInputValue("confirm_text");
      if (input === "確認") {
        // 執行操作
      }
    }
  }
});
```

---

## 4. 選單互動（Select Menu）規範

### 4.1 單選選單

```javascript
const selectMenu = new StringSelectMenuBuilder()
  .setCustomId("shop_category_select")
  .setPlaceholder("選擇商品類別")
  .addOptions(
    { label: "武器", value: "weapon" },
    { label: "防具", value: "armor" },
    { label: "飾品", value: "accessory" }
  );

const row = new ActionRowBuilder().addComponents(selectMenu);
await interaction.reply({
  content: "請選擇商品類別：",
  components: [row],
  flags: MessageFlags.Ephemeral
});
```

### 4.2 選單值路由

```javascript
async function handleSelectMenu(interaction) {
  const { customId, values } = interaction;

  await interaction.deferReply({ ephemeral: true });

  try {
    if (customId === "shop_category_select") {
      const category = values[0];  // 單選模式，取第一個
      const items = await getShopItems(category);
      await interaction.editReply({
        content: `📦 ${category} 類商品：\n${items.join("\n")}`
      });
    }
  } catch (error) {
    await interaction.editReply(`❌ 錯誤: ${error.message}`);
  }
}
```

---

## 5. 事件監聽設定（`client.js`）

### 5.1 標準設定

```javascript
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    // 注意：MessageContent 需要在 Discord 開發者面板啟用
  ]
});

// 命令互動
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isCommand()) {
    await handleCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButton(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModal(interaction);
  }
});

// 訊息事件
client.on(Events.MessageCreate, async (message) => {
  // 不回應 bot 訊息
  if (message.author.bot) return;
  // 自訂邏輯...
});

// 成員加入事件
client.on(Events.GuildMemberAdd, async (member) => {
  await ensureMemberPlayerProfile(member, "member_add");
});
```

### 5.2 自動初始化

```javascript
async function loginBot(client) {
  await client.login(config.discord.token);

  client.once(Events.ClientReady, async () => {
    console.log(`[Discord] 機器人已登入: ${client.user.tag}`);

    // 初始化工作
    await setupPersonalRoomChannel(client);      // 設定個人房間
    await setupLockedChannels(client);           // 鎖定特定頻道
    await syncChannelBindings(client);           // 同步版位配置
    await startIdleRotateTimer();                // 啟動自動輪換
  });
}
```

---

## 6. 新增命令的完整步驟

### 步驟 1：定義命令（`commands.js`）

```javascript
// 在 definitions 陣列中新增
new SlashCommandBuilder()
  .setName("新命令")
  .setDescription("描述")
  .addStringOption(opt => opt.setName("參數").setRequired(true))
```

### 步驟 2：路由與權限（`commands.js`）

```javascript
async function handleCommand(interaction) {
  switch (commandName) {
    case "新命令":
      // 檢查權限
      if (needsAdmin && !(await isAdmin(interaction))) {
        await interaction.reply("❌ 無權限");
        return;
      }
      // 長操作需 defer
      await interaction.deferReply({ ephemeral: true });
      await handleNewCommand(interaction);
      break;
  }
}
```

### 步驟 3：具體邏輯（`handlers/newCommandHandlers.js`）

```javascript
async function handleNewCommand(interaction) {
  const param = interaction.options.getString("參數");

  try {
    const result = await someService.doSomething(param);
    await interaction.editReply(`✅ 完成: ${result}`);
  } catch (error) {
    throw error;  // 讓上層 catch
  }
}
```

### 步驟 4：註冊命令

```bash
npm run discord:register
```

---

## 7. 常見錯誤與排除

| 問題 | 原因 | 解決 |
|------|------|------|
| "Interaction failed" | 超過 3 秒未回應 | 使用 `deferReply()` |
| 訊息沒有更新 | 用錯方法（reply vs editReply） | 檢查互動狀態再選方法 |
| 按鈕無反應 | 沒有監聽 `isButton()` | 在 client.js 新增 handler |
| 權限檢查失效 | accessControlService 配置錯誤 | 驗證 ADMIN_ROLE_IDS / ADMIN_USER_IDS |
| Modal 未出現 | 沒有 `showModal()` | 改用 `showModal()` 不是 `reply()` |

---

## 8. 測試清單

新增命令後驗證：

- [ ] 命令在 Discord 客戶端出現（可能需 15 分鐘同步）
- [ ] 權限檢查正常（Admin 可執行，玩家無法）
- [ ] 短操作立即回應（< 3秒）
- [ ] 長操作已 defer（不超時）
- [ ] 錯誤訊息友善（用戶可理解）
- [ ] 選項驗證正常（數字範圍、必填等）
- [ ] 按鈕互動無 crash（檢查日誌）

---

## 9. 效能最佳實踐

```javascript
// ✅ 並行操作（快速）
await Promise.all([
  walletService.grant(playerId, 100),
  progressService.grantExp(playerId, 50),
  auditService.log(...)
]);

// ❌ 順序操作（慢）
await walletService.grant(playerId, 100);
await progressService.grantExp(playerId, 50);
await auditService.log(...);
```

---

## 相關文檔

- [API 與資料驗證](../docs/API_VALIDATION.md)（待建）
- [Admin 後台開發](../docs/ADMIN_DEVELOPMENT.md)（待建）
- [Discord.js 官方文檔](https://discord.js.org/)

---

## 更新記錄

| 日期 | 變更 |
|------|------|
| 2026-04-15 | 初始化 Discord 命令規範 SKILL |
