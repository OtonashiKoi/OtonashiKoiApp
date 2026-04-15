#!/bin/bash
# 一键重置所有玩家数据

cd "$(dirname "$0")/.."

echo "🎮 装备游戏 - 玩家数据重置工具"
echo "=================================="
echo ""
echo "此工具将执行以下操作："
echo "  1. 清除所有普通道具（保留特殊道具）"
echo "  2. 金币重置：100 + 打卡天数×100"
echo "  3. 钻石重置：按tier分配"
echo "  4. 等级重置：全部→1"
echo "  5. 属性重置：全部→1"
echo ""

read -p "确认执行？(yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "❌ 已取消"
  exit 0
fi

echo ""
echo "第1步：重置基础数据..."
echo "yes" | node scripts/reset-players.js

echo ""
echo "第2步：查询Discord角色并分配tier..."
node scripts/assign-tiers-and-diamonds.js

echo ""
echo "✅ 所有玩家已重置完毕！"
