# API Contract v1 - Core 10 Endpoints

Last updated: 2026-04-19  
Contract: `equipmentGAME-public-api` / `v1`

## Fixed Rules

1. Response envelope for core endpoints:
```json
{
  "status": "ok|error",
  "code": "OK|ERROR_CODE",
  "message": "text",
  "data": {}
}
```
2. Auth endpoints are marked per route below.
3. Non-breaking change policy: additive only (new optional fields / new endpoints allowed).

## Core 10

### 1) POST `/api/auth/discord`
Auth: None

Request example:
```json
{
  "code": "mock:1450019975031951370",
  "redirect_uri": "http://localhost:5566/chat.html"
}
```

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": {
    "token": "jwt-token",
    "discordId": "1450019975031951370",
    "displayName": "WebPlayer"
  }
}
```

Common errors: `NOT_GUILD_MEMBER`, OAuth error text, missing `redirect_uri`.

### 2) GET `/api/me/profile`
Auth: `Authorization: Bearer <jwt>`

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": {
    "player": {
      "discordId": "1450019975031951370",
      "displayName": "Player",
      "avatarUrl": "https://..."
    },
    "wallet": {
      "gold": 1000,
      "diamond": 10
    },
    "progress": {
      "level": 12,
      "maxLevel": 50,
      "jobLevel": 3,
      "job": "Novice",
      "exp": 340,
      "nextLevelExp": 500,
      "isMaxLevel": false,
      "statusPoints": 2,
      "playerTier": "E",
      "attributes": {
        "str": 1,
        "agi": 1,
        "vit": 1,
        "int": 1,
        "dex": 1,
        "luk": 1
      },
      "equipment": {},
      "jobSpecialDisplay": {
        "jobName": null,
        "activeSpecials": [],
        "summary": "無（未裝備職業裝）"
      }
    }
  }
}
```

### 3) GET `/api/me/inventory`
Auth: Bearer JWT

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": {
    "inventory": [],
    "equipped": {}
  }
}
```

### 4) POST `/api/me/inventory/equip/:uuid`
Auth: Bearer JWT

Request body example:
```json
{
  "targetSlot": "weapon"
}
```

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": {
    "inventory": [],
    "equipment": {}
  }
}
```

### 5) POST `/api/me/inventory/use/:uuid`
Auth: Bearer JWT

Request body: `{}` (not required)

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": {
    "effectDesc": "📊 +1 屬性點",
    "walletDelta": null,
    "expDelta": null
  }
}
```

Common errors: `ITEM_NOT_FOUND`, `INVALID_ARGUMENT`.

### 6) GET `/api/shop/items`
Auth: Bearer JWT

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": [
    {
      "id": "shop-item-id",
      "itemLibraryId": "lib-item-id",
      "name": "Potion",
      "price": 100,
      "currency": "gold",
      "stock": -1,
      "enabled": true
    }
  ]
}
```

### 7) POST `/api/shop/buy/:itemId`
Auth: Bearer JWT

Request body: `{}` (not required)

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": {
    "item": {
      "id": "shop-item-id",
      "name": "Potion"
    }
  }
}
```

Common errors: `SHOP_ITEM_DISABLED`, `ITEM_OUT_OF_STOCK`, `FORBIDDEN`, `INSUFFICIENT_BALANCE`.

### 8) GET `/api/combat/zones`
Auth: Bearer JWT

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": [
    {
      "zone": "beginner",
      "monsterId": "monster-1",
      "monsterName": "Slime",
      "monsterImageUrl": "https://...",
      "monsterLevel": 1,
      "expReward": 10,
      "goldReward": 5,
      "drops": ["Small Potion"],
      "currentHp": 100,
      "maxHp": 100,
      "participantCount": 0,
      "activeMonsterSeq": 1,
      "damageLeaderboard": [],
      "nextBattleAt": null
    }
  ]
}
```

### 9) POST `/api/combat/quick-battle`
Auth: Bearer JWT

Request example:
```json
{
  "zone": "beginner"
}
```

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "ok",
  "data": {
    "outcome": "win",
    "monsterName": "Slime",
    "logs": ["..."],
    "rewardLines": ["..."],
    "rewardSummary": null,
    "totalDamage": 42,
    "finalPlayerHp": 88,
    "finalMonsterHp": 0,
    "nextBattleAt": 1760000000000
  }
}
```

Common errors: cooldown `429`, insufficient gold, zone level restriction.

### 10) POST `/api/me/enhance/:itemUuid`
Auth: Bearer JWT

Request body: `{}` (not required)

Success response example:
```json
{
  "status": "ok",
  "code": "OK",
  "message": "強化成功",
  "data": {
    "success": true,
    "newLevel": 1
  }
}
```

Common errors: `INVALID_ARGUMENT`, enhancement rule failures from `enhanceService`.

Additive since v1: `GET/POST /api/me/enhance/:itemUuid/element`（屬性洞查詢／補洞，與寶石強化分流；
`playerAppRoutes.js:5272` / `:5283`）。

## Diff Workflow (What to Check Every Time)

1. Compare changed routes against this file.
2. If only optional fields are added, keep `v1`.
3. If field removal/rename/type change is needed, prepare `v2` endpoint instead.
4. Update this file examples in the same PR as route changes.

## How to Add More APIs Later

Yes, you can keep adding APIs after this is fixed.

Allowed now:
- Add endpoint #11, #12... in this document.
- Add optional response fields in existing endpoints.
- Add optional query params with default behavior unchanged.

Not allowed in `v1`:
- Breaking existing frontend parsing of these Core 10 responses.

