# Equipment Game Platform

Discord-first game platform skeleton with JSON development storage and planned MongoDB production storage.

## Current Phase

This repository is now in Phase 1:
- Player profile bootstrap
- Dual-currency wallet (`gold`, `diamond`)
- Transaction log model
- JSON storage adapter
- Minimal admin API and Discord chat panel flow
- 400-line file limit check

## Setup

1. Copy `.env.example` to `.env`.
2. Fill these values:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
   - `ADMIN_ROLE_IDS` (optional, comma-separated Discord role IDs)
   - `ADMIN_USER_IDS` (optional, comma-separated Discord user IDs)
   - `PLAYER_ROLE_IDS` (optional, comma-separated Discord role IDs)
   - `PLAYER_USER_IDS` (optional, comma-separated Discord user IDs)
   - `API_PORT`
   - `STORAGE_DRIVER`
   - `JSON_DATA_PATH`
   - `ADMIN_API_KEY`
   - `ADMIN_API_CALLER_IDS` (optional, comma-separated caller IDs)
   - `MONGODB_URI` and `MONGODB_DB_NAME` for future Mongo mode
3. Install dependencies:
   - `npm install`

## Run

1. Register slash commands:
   - `npm run discord:register`
2. Start bot + API:
   - `npm start`
3. Open admin console:
   - `http://localhost:5566/admin`
4. Run checks:
   - `npm run check`

## Run With PM2

Use PM2 when you want the bot/API to stay alive and be easy to restart after config/data changes.

1. First start with PM2:
   - `npm run pm2:start`
2. Restart with latest env/config:
   - `npm run pm2:restart`
3. Reset (delete + recreate process):
   - `npm run pm2:reset`
4. Check status:
   - `npm run pm2:status`
5. Check logs:
   - `npm run pm2:logs`
6. Stop process:
   - `npm run pm2:stop`

## Discord Commands

- `/連線測試`: show bot response latency
- `/help`: show current command list
- `/發布玩家面板`: admin publishes a clickable player panel into the current channel
- `/管理員加金幣`: admin grant gold to a target player
- `/管理員加鑽石`: admin grant diamond to a target player
- `/管理員扣金幣`: admin deduct gold from a target player (no negative balance)
- `/管理員扣鑽石`: admin deduct diamond from a target player (no negative balance)
- `/管理員加經驗`: admin grant exp to a target player

## Discord Chat Panel

Players do not use slash commands directly.

Admin flow:
- Run `/發布玩家面板` in the target channel.

Player flow:
- Click `建立玩家`
- Click `我的資料`
- Click `我的錢包`
- Click `交易紀錄`
- Click `測試獎勵`
- Click `測試經驗`

All player button results are returned as ephemeral replies.

## Admin Console

- `GET /admin`: 後台頁面入口
- `GET /admin/console/bootstrap`: 載入 Discord 頻道、身分組、權限與版位設定
- `PUT /admin/channel-layout`: 儲存 Discord 版位功能綁定
- `POST /admin/channel-layout/publish-player-panel`: 直接把玩家面板發到指定頻道

目前後台可做的事：
- 指定哪個 Discord 頻道負責玩家操作面板
- 預留設定管理通知與審計紀錄版位
- 管理 Discord 管理員與玩家白名單
- 直接從 Web 後台發布玩家面板

## API

- `GET /health`
- `GET /admin/access-control`
- `PUT /admin/access-control/discord-roles`
- `PUT /admin/access-control/discord-users`
- `PUT /admin/access-control/player-roles`
- `PUT /admin/access-control/player-users`
- `GET /admin/players/:discordId/profile`
- `GET /admin/players/:discordId/wallet`
- `GET /admin/players/:discordId/transactions?limit=10`
- `POST /admin/players/:discordId/grant`
- `POST /admin/players/:discordId/grant-exp`
- `GET /admin/audit-logs?limit=20`

Admin routes require header:
- `x-admin-key: <ADMIN_API_KEY>`
- `x-admin-id: <caller_id>` when `ADMIN_API_CALLER_IDS` is configured

Discord admin command permission:
- If `ADMIN_USER_IDS` includes your user ID, you are admin directly.
- Otherwise `ADMIN_ROLE_IDS` or `ManageGuild` permission can still grant admin access.

Discord player panel permission:
- If no player whitelist is configured, player panel buttons are open to everyone.
- If `PLAYER_USER_IDS` or backend `playerUserIds` contains the user, that user can use player panel buttons.
- If `PLAYER_ROLE_IDS` or backend `playerRoleIds` contains one of the member roles, that member can use player panel buttons.
- Admins always bypass player whitelist.

Example admin grant payload:

```json
{
   "displayName": "target-user",
   "currencyType": "gold",
   "amount": 250,
   "reason": "event reward",
   "adminId": "discord-admin-id"
}
```

Example access control payloads:

```json
{
   "adminRoleIds": ["123456789012345678", "987654321098765432"]
}
```

```json
{
   "adminUserIds": ["111111111111111111", "222222222222222222"]
}
```

```json
{
   "playerRoleIds": ["333333333333333333", "444444444444444444"]
}
```

```json
{
   "playerUserIds": ["555555555555555555", "666666666666666666"]
}
```

## Engineering Rules

- Business rules belong in `src/services`
- Discord and API are only interface layers
- Any file over 400 lines must be split
