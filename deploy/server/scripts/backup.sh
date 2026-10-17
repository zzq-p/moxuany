#!/usr/bin/env bash
# ============================================================================
# 青禾校园点餐 —— 数据库 + 上传图片备份
#
# 用法：./scripts/backup.sh
# 定时：crontab -e
#         0 3 * * * /opt/moxuany/scripts/backup.sh >> /var/log/moxuany-backup.log 2>&1
#
# 环境变量：
#   BACKUP_DIR    备份目录，默认 <部署目录>/backups
#   RETAIN_DAYS   保留天数，默认 14
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "错误：找不到 .env" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a

BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
DB_NAME="${MYSQL_DATABASE:-moxuany}"
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

# 磁盘空间检查：2G 内存的机器通常磁盘也不大，备份写满盘会让 MySQL 直接崩
avail_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')
if [ "${avail_mb:-0}" -lt 1024 ]; then
  log "错误：备份目录剩余空间不足 1GB（当前 ${avail_mb}MB），请先清理" >&2
  exit 1
fi

# ------------------------------------------------------------ 数据库
log "开始备份数据库 $DB_NAME"
dump_file="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

docker compose --env-file .env -f compose.prod.yml exec -T mysql \
  sh -c "exec mysqldump -uroot -p\"\$MYSQL_ROOT_PASSWORD\" \
         --single-transaction --quick --routines --events \
         --default-character-set=utf8mb4 $DB_NAME" \
  | gzip -6 > "$dump_file"

# 校验：gzip 完整性 + 内容非空（导出失败时文件会很小）
gzip -t "$dump_file" || { log "错误：备份文件损坏 $dump_file" >&2; exit 1; }
size_kb=$(du -k "$dump_file" | cut -f1)
if [ "$size_kb" -lt 10 ]; then
  log "错误：备份文件只有 ${size_kb}KB，疑似导出失败，请手工确认" >&2
  exit 1
fi
log "数据库备份完成：$dump_file（${size_kb}KB）"

# ------------------------------------------------------------ 图片
# 两类图片都要备份，否则恢复后订单售后记录会指向不存在的图片：
#   data/uploads        菜品、店铺、头像等后台上传图片
#   data/food-evidence  售后举证的订单图片（FoodEvidence 单独存放）
data_dirs=()
for d in uploads food-evidence; do
  if [ -d "data/$d" ] && [ -n "$(ls -A "data/$d" 2>/dev/null)" ]; then
    data_dirs+=("$d")
  fi
done

if [ "${#data_dirs[@]}" -gt 0 ]; then
  data_file="$BACKUP_DIR/data-${STAMP}.tar.gz"
  tar -czf "$data_file" -C data "${data_dirs[@]}"
  log "图片备份完成：$data_file（$(du -k "$data_file" | cut -f1)KB，包含 ${data_dirs[*]}）"
else
  log "图片目录为空，跳过图片备份"
fi

# ------------------------------------------------------------ 清理过期
deleted=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.gz' -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)
log "清理 ${RETAIN_DAYS} 天前的备份：删除 ${deleted} 个文件"
log "当前备份占用：$(du -sh "$BACKUP_DIR" | cut -f1)"
log "备份结束"
