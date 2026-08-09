# API Contract v1

Last updated: 2026-04-19

> ⚠️ **過時提示（更新 2026-08-07）**：本文件只鎖定 Core 10 基線；2026-04 之後新增的端點群一律未涵蓋，
> 包含（但不限於）：賭鬼強化 `mode=gamble`、爬塔/組隊、單人世界王 `soloBossRoutes.js`、主線劇情 `storyRoutes.js`、
> 鍛造 `playerForgeRoutes.js`、附魔 `playerEnchantRoutes.js`、圖鑑 `playerCollectionRoutes.js`、
> 商品兌換 `merchRoutes.js`、金流 `ecpayRoutes.js`。
> **現況系統索引請見 [`SYSTEMS.md`](./SYSTEMS.md)**（`NEW_SYSTEMS_V1_INDEX.md` 已標記為歷史索引）。

## Goal

Lock current API behavior for existing clients while allowing safe future expansion.

Core endpoint baseline (request/response examples):

- `docs/API_CONTRACT_V1_CORE10.md`

## Contract Identity

- Name: `equipmentGAME-public-api`
- Version: `v1`
- Compatibility rule: `additive-only`

Every API response now includes:

- `X-API-Contract-Name`
- `X-API-Contract-Version`
- `X-API-Contract-Compatibility`

## Stable Response Envelope

Standard envelope (already used by most endpoints):

```json
{
  "status": "ok|error",
  "code": "OK|ERROR_CODE",
  "message": "human readable message",
  "data": {}
}
```

## Existing Legacy Endpoints

Some legacy endpoints still return custom payloads. These are temporarily allowed for compatibility and should be migrated only in a planned version bump.

Known legacy areas:

- `src/api/routes/mahjongRoutes.js`
- Several read-only utility responses in `src/api/routes/playerAppRoutes.js`

## Safe Extension Rules (Can Add Later)

Allowed without version bump:

1. Add new endpoints.
2. Add optional fields in `data`.
3. Add optional query params with default behavior unchanged.
4. Add new error codes while keeping existing codes/meanings.

Not allowed in `v1`:

1. Rename or remove existing fields.
2. Change existing field types.
3. Change auth semantics of existing endpoints.
4. Change success/error envelope meaning.

## Recommended Versioning Policy

1. Keep current routes as `v1`.
2. If a breaking change is needed, add `v2` route namespace or dedicated endpoint version path.
3. Keep `v1` available during migration window.

## Change Checklist Before Release

1. Existing frontend pages still parse old responses.
2. Admin panel calls still work without payload rewrites.
3. Added fields are optional and backward compatible.
4. Contract headers still return `v1`.
