#!/bin/sh
# 自動備份本機 MongoDB（線上正在使用的 DB），並清除超過 12 小時的舊備份。
# 由 cron 每 6 小時呼叫一次。
set -e

PROJECT_DIR="/Users/riuchen/Documents/otonashiKoi_game"
MONGODUMP="/opt/homebrew/bin/mongodump"
BACKUP_ROOT="$PROJECT_DIR/backups"
RETENTION_MIN=720   # 12 小時

cd "$PROJECT_DIR"

# 從 .env 取本機連線字串
URI=$(grep '^MONGODB_URI=' .env | cut -d= -f2-)
if [ -z "$URI" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') ❌ 找不到 MONGODB_URI" >&2
  exit 1
fi

STAMP=$(date '+%Y%m%d-%H%M%S')
OUT="$BACKUP_ROOT/auto-$STAMP"

echo "$(date '+%Y-%m-%d %H:%M:%S') ▶ 備份開始 → $OUT"
"$MONGODUMP" --uri="$URI" --out="$OUT" --quiet

# 清除超過 12 小時的自動備份（只動 auto-* 目錄，不碰手動備份）
find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'auto-*' -mmin +$RETENTION_MIN -exec rm -rf {} +

REMAIN=$(find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'auto-*' | wc -l | tr -d ' ')
echo "$(date '+%Y-%m-%d %H:%M:%S') ✅ 備份完成；現存自動備份 $REMAIN 份（保留 12 小時內）"
