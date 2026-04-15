# 玩家数据重置工具使用指南

## 快速开始

### 一键重置所有玩家数据
```bash
bash scripts/reset-all-players.sh
```

## 详细步骤

### 步骤1：重置基础数据
```bash
node scripts/reset-players.js
```
这个脚本会：
- 清除所有普通道具（保留特殊道具）
- 重置金币：`打卡天数 × 100 + 100`
- 清空钻石（设为0）
- 重置等级为1
- 重置属性为1 (str/agi/vit/int/dex/luk)

### 步骤2：分配tier和钻石
```bash
node scripts/assign-tiers-and-diamonds.js
```
这个脚本会：
- 查询Discord角色
- 自动判定每个玩家的tier等级
- 根据tier分配钻石：
  - **A级/S级/SS级**: 10颗
  - **B级**: 3颗
  - **C级**: 1颗
  - **无等级**: 0颗

## 各脚本说明

### reset-players.js
- **功能**: 清除道具、重置金币/等级/属性
- **耗时**: ~10秒（277个玩家）
- **必需**: MongoDB连接
- **可选**: Discord（用于验证）

### assign-tiers-and-diamonds.js
- **功能**: 查询Discord角色并分配tier+钻石
- **耗时**: ~3分钟（277个玩家，含速率限制）
- **必需**: MongoDB + Discord Token
- **注意**: 有速率限制（每批3个玩家，间隔500ms）

## 环境要求

- Node.js >= 14
- MongoDB 运行中
- `.env` 文件配置正确：
  - `MONGODB_URI`
  - `MONGODB_DB_NAME`
  - `DISCORD_TOKEN`
  - `DISCORD_GUILD_ID`

## 数据恢复

**警告**: 这些脚本修改是不可逆的！运行前请备份数据库。

如果需要恢复，使用MongoDB备份：
```bash
mongorestore --uri="mongodb://localhost:27017" ./backup/equipment_game
```

## 常见问题

### Q: 为什么我的玩家显示为"无等级"？
A: 他们在Discord中没有被分配任何tier角色。在Discord中给他们分配C/B/A级角色，然后重新运行step2。

### Q: 可以只重置部分玩家吗？
A: 可以，修改脚本中的`players.find({})`为`players.find({ discordId: "xxx" })`。

### Q: 打卡数字为什么都是0？
A: 这次周期内（过去7天）没有人打卡。打卡数据来自`checkins`集合。

### Q: 如何更改金币或钻石的分配规则？
A: 编辑脚本中的对应函数：
- `reset-players.js`: 修改 `goldAmount = checkinCount * 100 + 100`
- `assign-tiers-and-diamonds.js`: 修改 `getDiamondAmount()` 函数

## 脚本位置

- 📄 `scripts/reset-players.js` - 基础重置
- 📄 `scripts/assign-tiers-and-diamonds.js` - Tier分配
- 📄 `scripts/reset-all-players.sh` - 一键脚本
