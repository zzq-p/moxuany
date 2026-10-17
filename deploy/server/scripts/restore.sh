#!/usr/bin/env bash
# ============================================================================
# 青禾校园点餐 —— 从备份恢复数据库（以及可选的图片目录）
#
# 用法：./scripts/restore.sh backups/moxuany-20260101-030000.sql.gz [图片包]
#
#   图片包可选：backup.sh 会把 data/uploads 和 data/food-evidence 打成一个
#   data-<时间戳>.tar.gz。不传时会尝试自动找同一时间戳的 data-*.tar.gz。
#   只恢复数据库时图片保持原样。
#
# ⚠️ 会覆盖当前库中的同名表数据，恢复前请先停掉后端：
#      docker compose --env-file .env -f compose.prod.yml stop backend
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:-}"
DATA_ARCHIVE="${2:-}"
[ -n "$DUMP" ] || { echo "用法：$0 <备份文件.sql.gz> [data-时间戳.tar.gz]" >&2; exit 1; }
[ -f "$DUMP" ] || { echo "错误：找不到文件 $DUMP" >&2; exit 1; }

[ -f .env ] || { echo "错误：找不到 .env" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a

DB_NAME="${MYSQL_DATABASE:-moxuany}"
COMPOSE=(docker compose --env-file .env -f compose.prod.yml)

# 未显式指定图片包时，按数据库备份名推导同批的 data-<时间戳>.tar.gz
if [ -z "$DATA_ARCHIVE" ]; then
  dir=$(dirname "$DUMP")
  base=$(basename "$DUMP")
  stamp="${base#"${DB_NAME}"-}"
  stamp="${stamp%.sql.gz}"
  candidate="$dir/data-${stamp}.tar.gz"
  if [ -f "$candidate" ]; then
    DATA_ARCHIVE="$candidate"
  fi
fi
if [ -n "$DATA_ARCHIVE" ] && [ ! -f "$DATA_ARCHIVE" ]; then
  echo "错误：找不到图片包 $DATA_ARCHIVE" >&2
  exit 1
fi

echo "即将把 $DUMP 恢复到数据库 $DB_NAME。"
echo "当前库内已有数据会被同名表覆盖。"
if [ -n "$DATA_ARCHIVE" ]; then
  echo "图片目录将用 $DATA_ARCHIVE 覆盖（data/uploads、data/food-evidence）。"
else
  echo "未指定图片包，只恢复数据库，图片目录保持原样。"
fi
printf '确认请输入 yes：'
read -r answer
[ "$answer" = "yes" ] || { echo "已取消"; exit 0; }

echo "==> 恢复前先做一次当前状态快照"
bash "$(dirname "$0")/backup.sh"

echo "==> 开始恢复数据库"
gzip -dc "$DUMP" | "${COMPOSE[@]}" exec -T mysql \
  sh -c "exec mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 $DB_NAME"

if [ -n "$DATA_ARCHIVE" ]; then
  echo "==> 恢复图片目录"
  mkdir -p data/uploads data/food-evidence
  # 先清空再解包：--delete 的语义，避免旧 hash/旧举证图残留
  rm -rf data/uploads/* data/food-evidence/*
  tar -xzf "$DATA_ARCHIVE" -C data
  # 后端以 uid 10001 运行，恢复出来的文件必须重新交给它
  chown -R 10001:10001 data/uploads data/food-evidence
  echo "    图片已恢复到 data/uploads 与 data/food-evidence"
fi

echo "==> 恢复完成，请重启后端并检查业务："
echo "    ${COMPOSE[*]} start backend"
