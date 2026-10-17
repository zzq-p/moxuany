#!/usr/bin/env bash
# ============================================================================
# 青禾校园点餐 —— 数据库初始化 / 增量迁移
#
# 为什么需要这个脚本：
#   项目自带的 compose.yml 只做 ry_20260417.sql + quartz.sql + 03-food.sql，
#   而 03-food.sql 只是基础表结构；04~07 的后建表和一批 ALTER 新增字段
#   （退款、骑手、预约、评价回复、售罄、recovery_version 等）都不在其中。
#   本地是靠 scripts/upgrade-local.cjs 补的，但那个脚本写死了 Windows 的
#   docker.exe 路径和 moxuany-mysql 容器名，Linux 上无法使用。
#   本脚本是它的 Linux 等价实现，顺序完全一致，并且可重复执行。
#
# 幂等性说明：
#   - ry_20260417.sql / quartz.sql 含 DROP TABLE，重复执行会清库，
#     因此只在 sys_user 表不存在时执行一次。
#   - 03-food.sql 用的是不带 IF NOT EXISTS 的 CREATE TABLE，
#     因此只在 food_store_user 表不存在时执行一次。
#   - 04~07 均为 CREATE TABLE IF NOT EXISTS，本身可重复执行。
#   - 所有 ALTER 都先查 information_schema 再执行。
#   - 两段数据回填由 food_feature_migration 标记表保证只跑一次。
#
# 用法：由 compose.prod.yml 的 migrate 服务调用，一般不用手动执行。
# ============================================================================
set -euo pipefail

DB_HOST="${MYSQL_HOST:-mysql}"
DB_PORT="${MYSQL_PORT:-3306}"
DB_NAME="${MYSQL_DATABASE:-moxuany}"
DB_USER="${MYSQL_ROOT_USER:-root}"
DB_PASS="${MYSQL_ROOT_PASSWORD:?环境变量 MYSQL_ROOT_PASSWORD 未设置}"
SQL_DIR="${SQL_DIR:-/sql}"

# 用 MYSQL_PWD 传密码，避免命令行密码告警
export MYSQL_PWD="$DB_PASS"
MYSQL=(mysql --protocol=TCP -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" --default-character-set=utf8mb4)

log() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------- 连接等待
log "==> 等待 MySQL ${DB_HOST}:${DB_PORT}"
ready=0
for _ in $(seq 1 60); do
  if "${MYSQL[@]}" -e 'SELECT 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [ "$ready" != "1" ]; then
  log "错误：等待 120 秒后仍无法连接 MySQL" >&2
  exit 1
fi

# ---------------------------------------------------------------- 工具函数
q()    { "${MYSQL[@]}" --batch --skip-column-names "$DB_NAME" -e "$1"; }
qmeta(){ "${MYSQL[@]}" --batch --skip-column-names -e "$1"; }

table_exists() {
  [ "$(qmeta "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DB_NAME}' AND TABLE_NAME='$1'")" != "0" ]
}
column_exists() {
  [ "$(qmeta "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${DB_NAME}' AND TABLE_NAME='$1' AND COLUMN_NAME='$2'")" != "0" ]
}
index_exists() {
  [ "$(qmeta "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${DB_NAME}' AND TABLE_NAME='$1' AND INDEX_NAME='$2'")" != "0" ]
}
add_column() {   # add_column 表 列 列定义
  if column_exists "$1" "$2"; then return 0; fi
  log "    + 字段 $1.$2"
  q "ALTER TABLE \`$1\` ADD COLUMN \`$2\` $3"
}
add_index() {    # add_index 表 索引名 列清单
  if index_exists "$1" "$2"; then return 0; fi
  log "    + 索引 $1.$2"
  q "ALTER TABLE \`$1\` ADD INDEX \`$2\`($3)"
}
add_unique_index() {  # add_unique_index 表 索引名 列清单
  if index_exists "$1" "$2"; then return 0; fi
  log "    + 唯一索引 $1.$2"
  q "ALTER TABLE \`$1\` ADD UNIQUE KEY \`$2\`($3)"
}
run_sql() {      # run_sql 文件路径
  log "    > 执行 $(basename "$1")"
  "${MYSQL[@]}" "$DB_NAME" < "$1"
}
marker_applied() {  # marker_applied 迁移标记名（依赖 food_feature_migration，由 06 创建）
  [ "$(q "SELECT COUNT(*) FROM food_feature_migration WHERE name='$1'")" != "0" ]
}

for f in ry_20260417.sql quartz.sql 03-food.sql 04-operations.sql \
         05-delivery.sql 06-fulfillment.sql 07-service-experience.sql; do
  if [ ! -f "$SQL_DIR/$f" ]; then
    log "错误：缺少 SQL 文件 $SQL_DIR/$f" >&2
    exit 1
  fi
done

# 兜底：正常情况下 MySQL 容器已按 MYSQL_DATABASE 建库并授权，
# 这里只是防止库被手工删掉导致后面所有 SQL 都失败。
qmeta "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

# ================================================================ 基础库
if table_exists sys_user; then
  log "==> 若依基础库已存在，跳过 ry_20260417.sql / quartz.sql"
else
  log "==> 初始化若依基础库（含 DROP TABLE，仅首次执行）"
  run_sql "$SQL_DIR/ry_20260417.sql"
  run_sql "$SQL_DIR/quartz.sql"
fi

if table_exists food_store_user; then
  log "==> 点餐基础表已存在，跳过 03-food.sql"
else
  log "==> 初始化点餐基础表"
  run_sql "$SQL_DIR/03-food.sql"
fi

# ================================================================ 增量迁移
log "==> 应用增量迁移"

# ---------------------------------------------------------------- 04 之前
add_column food_product version          "BIGINT NOT NULL DEFAULT 0"
add_column food_store   latitude         "DECIMAL(9,6) NULL"
add_column food_store   longitude        "DECIMAL(10,6) NULL"
add_index  food_order   idx_order_member_filter "member_id,type,status,created_at,id"

add_column food_store   open_time        "VARCHAR(5) NOT NULL DEFAULT ''"
add_column food_store   close_time       "VARCHAR(5) NOT NULL DEFAULT ''"
add_column food_store   delivery_radius  "INT NOT NULL DEFAULT 0"
add_column food_address latitude         "DECIMAL(9,6) NULL"
add_column food_address longitude        "DECIMAL(10,6) NULL"
add_index  food_product idx_product_category "store_id,active,category,id"
add_index  food_order   idx_order_alert      "status,paid_at,id"

run_sql "$SQL_DIR/04-operations.sql"

# ---------------------------------------------------------------- 05 之前
add_column food_store      business_periods  "VARCHAR(200) NOT NULL DEFAULT ''"
add_column food_store      reservation_enabled "TINYINT NOT NULL DEFAULT 0"
add_column food_store      reservation_days  "INT NOT NULL DEFAULT 3"
add_column food_store      lead_minutes      "INT NOT NULL DEFAULT 30"
add_column food_order      completed_at      "DATETIME NULL"
add_column food_order      scheduled_at      "DATETIME NULL"
add_column food_order      prepare_at        "DATETIME NULL"
add_column food_order      refund_status     "VARCHAR(20) NOT NULL DEFAULT 'NONE'"
add_column food_order      refund_id         "VARCHAR(40) NULL"
add_column food_order      expiry_retry_at   "DATETIME NULL"
add_column food_order_item option_ids        "VARCHAR(300) NOT NULL DEFAULT ''"
add_column food_order_item option_text       "VARCHAR(700) NOT NULL DEFAULT ''"
add_index  food_order      idx_order_refund  "store_id,refund_status,created_at,id"

log "    ~ 回填已完成订单的 completed_at"
q "UPDATE food_order SET completed_at=updated_at WHERE status='COMPLETED' AND completed_at IS NULL"

run_sql "$SQL_DIR/05-delivery.sql"

# ---------------------------------------------------------------- 06 之前
add_column food_order rider_id          "BIGINT NULL"
add_column food_order rider_claimed_at  "DATETIME NULL"
add_index  food_order idx_order_rider   "rider_id,status,created_at,id"
add_index  food_order idx_order_report_day "created_at,store_id"
add_index  food_order idx_order_store_day  "store_id,created_at"

run_sql "$SQL_DIR/06-fulfillment.sql"

# ---------------------------------------------------------------- 07 之前
add_column food_store      slot_limit          "INT NOT NULL DEFAULT 20"
add_column food_order      stock_date          "DATE NULL"
add_column food_order      slot_reserved        "TINYINT NOT NULL DEFAULT 0"
add_column food_order      delivery_waiting_at  "DATETIME NULL"
add_column food_order      delivery_version     "BIGINT NOT NULL DEFAULT 0"
add_column food_order      delivery_issue       "VARCHAR(500) NOT NULL DEFAULT ''"
add_column food_order      pickup_verified_at   "DATETIME NULL"
add_column food_order      pickup_verified_by   "BIGINT NULL"
add_column food_rider_user max_active           "INT NOT NULL DEFAULT 5"
add_column food_review     reply                "VARCHAR(500) NOT NULL DEFAULT ''"
add_column food_review     replied_at           "DATETIME NULL"
add_column food_review     replied_by           "BIGINT NULL"
add_index  food_order      idx_delivery_waiting "status,delivery_waiting_at,store_id"

if marker_applied 'fulfillment-v1'; then
  log "    = 数据回填 fulfillment-v1 已执行，跳过"
else
  log "    ~ 数据回填 fulfillment-v1（预约时段库存 / 待配送时间 / 店铺评分）"
  q "START TRANSACTION;
     INSERT INTO food_reservation_slot(store_id,scheduled_at,used)
       SELECT store_id,scheduled_at,COUNT(*) FROM food_order
       WHERE scheduled_at IS NOT NULL AND status NOT IN ('CANCELLED','REFUNDED')
       GROUP BY store_id,scheduled_at
       ON DUPLICATE KEY UPDATE used=VALUES(used);
     UPDATE food_order SET slot_reserved=1
       WHERE scheduled_at IS NOT NULL AND status NOT IN ('CANCELLED','REFUNDED');
     UPDATE food_order SET delivery_waiting_at=updated_at WHERE status='WAITING_DELIVERY';
     UPDATE food_store s SET rating=COALESCE(
       (SELECT ROUND(AVG(r.rating),1) FROM food_review r WHERE r.store_id=s.id),0);
     INSERT INTO food_feature_migration(name) VALUES('fulfillment-v1');
     COMMIT;"
fi

run_sql "$SQL_DIR/07-service-experience.sql"

# ---------------------------------------------------------------- 07 之后
add_column food_store      kitchen_capacity   "INT NOT NULL DEFAULT 3"
add_column food_store      cooking_minutes    "INT NOT NULL DEFAULT 15"
add_column food_product    sale_periods       "VARCHAR(200) NOT NULL DEFAULT ''"
add_column food_product    sold_out           "TINYINT NOT NULL DEFAULT 0"
add_column food_product    sold_out_until     "DATETIME NULL"
add_column food_order      preparing_at       "DATETIME NULL"
add_column food_order      promised_ready_at  "DATETIME NULL"
add_column food_order      refunded_amount    "INT NOT NULL DEFAULT 0"
add_column food_order_item refunded_quantity  "INT NOT NULL DEFAULT 0"
add_column food_refund     kind               "VARCHAR(10) NOT NULL DEFAULT 'FULL'"
add_column food_store_user staff_role         "VARCHAR(20) NOT NULL DEFAULT 'MANAGER'"
add_column food_store_user active             "TINYINT NOT NULL DEFAULT 1"

if marker_applied 'service-experience-v1'; then
  log "    = 数据回填 service-experience-v1 已执行，跳过"
else
  log "    ~ 数据回填 service-experience-v1（退款金额 / 出餐时间）"
  q "START TRANSACTION;
     UPDATE food_order SET refunded_amount=total WHERE status='REFUNDED';
     UPDATE food_order_item i JOIN food_order o ON o.id=i.order_id
       SET i.refunded_quantity=i.quantity WHERE o.status='REFUNDED';
     UPDATE food_order SET preparing_at=updated_at WHERE status='PREPARING';
     INSERT INTO food_feature_migration(name) VALUES('service-experience-v1');
     COMMIT;"
fi

add_column food_member recovery_version "BIGINT NOT NULL DEFAULT 0"

# ---------------------------------------------------------------- 网站账号 / 邀请码
add_column food_member account       "VARCHAR(50) NULL"
add_column food_member password_hash "VARCHAR(100) NULL"
add_unique_index food_member uk_member_account "account"
if table_exists food_invite_code; then
  log "    = 表 food_invite_code 已存在"
else
  log "    + 表 food_invite_code"
  q "CREATE TABLE food_invite_code (
       code VARCHAR(24) PRIMARY KEY,
       note VARCHAR(100) NOT NULL DEFAULT '',
       created_by BIGINT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       expires_at DATETIME NULL,
       used_by BIGINT NULL,
       used_at DATETIME NULL,
       INDEX idx_invite_used(used_by),
       INDEX idx_invite_expires(expires_at)
     ) ENGINE=InnoDB"
fi
if [ "$(q "SELECT COUNT(*) FROM sys_menu WHERE parent_id=2100 AND path='invites'")" = "0" ]; then
  log "    + 菜单 邀请码"
  # 不写死 menu_id：已有数据库的 2106~2111 已被配送、报表等菜单占用，
  # 让自增分配一个空闲 ID，避免与旧菜单冲突。
  q "INSERT INTO sys_menu(menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time)
     SELECT '邀请码',2100,12,'invites','food/invites/index',1,0,'C','0','0','food:manage','peoples','admin',NOW()
     FROM DUAL WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE parent_id=2100 AND path='invites')"
fi

# ================================================================ 自检
log "==> 结构自检"
missing=0
for spec in \
  "food_product.version" "food_store.latitude" "food_store.business_periods" \
  "food_store.kitchen_capacity" "food_store.slot_limit" \
  "food_order.refund_status" "food_order.rider_id" "food_order.refunded_amount" \
  "food_order.delivery_version" "food_order.promised_ready_at" \
  "food_order_item.refunded_quantity" "food_order_item.option_ids" \
  "food_review.reply" "food_refund.kind" "food_rider_user.max_active" \
  "food_store_user.staff_role" "food_member.recovery_version" \
  "food_member.account" "food_member.password_hash" ; do
  t="${spec%%.*}"; c="${spec##*.}"
  if ! column_exists "$t" "$c"; then
    log "    缺少 $spec"
    missing=1
  fi
done
for t in food_feature_migration food_reservation_slot food_reservation_stock \
         food_order_event food_favorite food_evidence food_staff_audit \
         food_message food_message_template food_subscription \
         food_refund_item food_refund_evidence food_product_option \
         food_invite_code; do
  if ! table_exists "$t"; then
    log "    缺少表 $t"
    missing=1
  fi
done
if ! index_exists food_member uk_member_account; then
  log "    缺少唯一索引 food_member.uk_member_account"
  missing=1
fi
if [ "$(q "SELECT COUNT(*) FROM sys_menu WHERE parent_id=2100 AND path='invites'")" = "0" ]; then
  log "    缺少菜单 邀请码"
  missing=1
fi
if [ "$(q "SELECT config_value FROM sys_config WHERE config_key='sys.account.captchaEnabled'")" != "true" ]; then
  log "    警告：sys.account.captchaEnabled 不是 true，网站注册/登录验证码已关闭" >&2
fi

if [ "$missing" != "0" ]; then
  log "错误：结构自检未通过，请检查上面的缺失项。" >&2
  exit 1
fi

log "==> 数据库结构已就绪（基础表 + 03~07 迁移 + 网站账号/邀请码），可以启动后端"
