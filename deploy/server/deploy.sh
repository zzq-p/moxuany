#!/usr/bin/env bash
# ============================================================================
# 青禾校园点餐 —— 服务器端一键部署
#
# 在部署目录（含 compose.prod.yml 的目录）下以 root 执行：
#   ./deploy.sh                  全量部署（数据库 + 后端 + 静态站 + Nginx）
#   ./deploy.sh --refresh-nginx  同上，并用部署包里的模板覆盖现有 Nginx 配置
#   ./deploy.sh --skip-nginx     只更新数据库与后端，不动 Nginx 和静态文件
#   ./deploy.sh --migrate-only   只跑数据库迁移
#
# 可重复执行：迁移脚本幂等，容器重建不影响数据卷。
#
# Nginx 配置默认【不覆盖】：首次部署写入模板；之后手工加的 HTTPS 配置、
# 限流规则都会保留。只有显式传 --refresh-nginx 才会覆盖（覆盖前先备份）。
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

SKIP_NGINX=0
MIGRATE_ONLY=0
REFRESH_NGINX=0
for arg in "$@"; do
  case "$arg" in
    --skip-nginx)    SKIP_NGINX=1 ;;
    --migrate-only)  MIGRATE_ONLY=1 ;;
    --refresh-nginx) REFRESH_NGINX=1 ;;
    -h|--help)       sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（可用：--skip-nginx / --migrate-only / --refresh-nginx）" >&2; exit 1 ;;
  esac
done

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn(){ printf '\n\033[1;33m[警告] %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m错误：%s\033[0m\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------ 0. 前置检查
log "0/5 检查前置条件"

[ -f .env ] || die "缺少 .env，请先执行：cp .env.production.example .env 并填写所有空值"
chmod 600 .env

command -v docker >/dev/null 2>&1 || die "未安装 docker"
docker compose version >/dev/null 2>&1 || die "未安装 docker compose v2 插件"
dc_version=$(docker compose version --short 2>/dev/null || echo "0.0.0")
log "    docker compose $dc_version"

# 校验 .env 里的必填项确实填了（不是留着空值）
check_env() {
  local key=$1
  local val
  val=$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- || true)
  [ -n "$val" ] || die ".env 中的 ${key} 还是空的，必须填写"
}
for k in SERVER_NAME MYSQL_ROOT_PASSWORD MYSQL_PASSWORD TOKEN_SECRET; do check_env "$k"; done

server_name=$(grep -E '^SERVER_NAME=' .env | head -1 | cut -d= -f2- | tr -d '\r\n')

token_len=$(grep -E '^TOKEN_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '\r\n' | wc -c)
[ "$token_len" -ge 32 ] || die "TOKEN_SECRET 太短（当前 ${token_len} 位），必须 ≥32 位。生成：openssl rand -hex 32"

if grep -qE '^FOOD_DEMO_ENABLED=true' .env; then
  warn "FOOD_DEMO_ENABLED=true，任何人不登录就能拿到随机账号。"
  warn "仅限演示环境，正式对外服务前务必改为 false。"
fi
if grep -qE '^FOOD_MOCK_PAYMENT_ENABLED=false' .env; then
  warn "FOOD_MOCK_PAYMENT_ENABLED=false，但项目尚未接入真实微信支付，"
  warn "下单后将无法完成支付。除非已自行实现真实支付，否则请保持 true。"
fi
[ -f backend/ruoyi-admin.jar ] || die "缺少 backend/ruoyi-admin.jar，请先在本机执行 deploy/local/build-and-pack.ps1"

# 静态产物：网站前台在 /，管理端在 /admin/，两套都必须有
[ -f web/h5-dist/index.html ] || die "缺少 web/h5-dist/index.html，请先在本机执行 deploy/local/build-and-pack.ps1"
[ -f web/admin-dist/index.html ] || die "缺少 web/admin-dist/index.html，请先在本机执行 deploy/local/build-and-pack.ps1"

compose() { docker compose --env-file .env -f compose.prod.yml "$@"; }

# ------------------------------------------------------------ 1. 目录属主
# Dockerfile 里后端以 uid 10001 运行，挂载宿主机目录后必须让这个 uid 能写，
# 否则菜品图片上传、售后举证图片和日志写入都会失败。
log "1/5 准备数据目录"
mkdir -p data/uploads data/logs data/food-evidence
chown -R 10001:10001 data/uploads data/logs data/food-evidence
chmod 750 data/uploads data/logs data/food-evidence

# ------------------------------------------------------------ 2. 中间件
log "2/5 启动 MySQL 与 Redis"
compose up -d --wait mysql redis
log "    MySQL、Redis 已就绪"

# ------------------------------------------------------------ 3. 迁移
log "3/5 初始化 / 迁移数据库"
compose --profile migrate run --rm migrate

if [ "$MIGRATE_ONLY" = "1" ]; then
  log "已按要求只执行迁移，结束。"
  exit 0
fi

# ------------------------------------------------------------ 4. 后端
log "4/5 构建并启动后端"
compose build backend
compose up -d --wait backend
log "    后端已就绪：http://127.0.0.1:8080/food/app/config"

# ------------------------------------------------------------ 5. 静态站 + Nginx
if [ "$SKIP_NGINX" = "1" ]; then
  log "5/5 已跳过静态站与 Nginx（--skip-nginx）"
else
  log "5/5 部署静态站与 Nginx"

  mkdir -p /srv/moxuany/web
  # 用 --delete 保证下线的旧文件不会残留（换 hash 文件名的场景）。
  # 注意站点目录名是 h5 / admin，不是包内的 h5-dist / admin-dist：
  # Nginx 里 /admin/ 需要 root /srv/moxuany/web + 相对路径 admin/，
  # 目录名与 URL 前缀不一致时只能写 alias，而 alias 和 try_files 搭配很容易出错。
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete web/h5-dist/    /srv/moxuany/web/h5/
    rsync -a --delete web/admin-dist/ /srv/moxuany/web/admin/
  else
    rm -rf /srv/moxuany/web/h5 /srv/moxuany/web/admin
    cp -r web/h5-dist    /srv/moxuany/web/h5
    cp -r web/admin-dist /srv/moxuany/web/admin
  fi
  # 旧版目录，升级后不再使用；留着只会让旧文件被误访问
  rm -rf /srv/moxuany/web/h5-dist /srv/moxuany/web/admin-dist
  chmod -R a+rX /srv/moxuany/web
  log "    网站前台 → /srv/moxuany/web/h5"
  log "    管理后台 → /srv/moxuany/web/admin"

  if ! command -v nginx >/dev/null 2>&1; then
    log "    未检测到 nginx，跳过站点配置。请自行安装后手动部署 nginx/moxuany.conf.template"
  elif [ ! -f /etc/nginx/conf.d/moxuany.conf ]; then
    sed "s/__SERVER_NAME__/${server_name}/g" nginx/moxuany.conf.template \
      > /etc/nginx/conf.d/moxuany.conf
    if nginx -t 2>/dev/null; then
      if systemctl is-active --quiet nginx 2>/dev/null; then
        systemctl reload nginx
      else
        systemctl restart nginx || nginx
      fi
      log "    Nginx 站点配置已创建（来自 nginx/moxuany.conf.template）"
    else
      rm -f /etc/nginx/conf.d/moxuany.conf
      die "nginx 配置校验失败，已移除本次写入的配置（nginx -t 查看详情）"
    fi
  elif [ "$REFRESH_NGINX" = "1" ]; then
    # 显式刷新：先备份，校验失败则还原，绝不把线上配置搞坏
    stamp=$(date +%Y%m%d-%H%M%S)
    backup=/etc/nginx/conf.d/moxuany.conf.bak-${stamp}
    cp -a /etc/nginx/conf.d/moxuany.conf "$backup"
    sed "s/__SERVER_NAME__/${server_name}/g" nginx/moxuany.conf.template \
      > /etc/nginx/conf.d/moxuany.conf
    if nginx -t 2>/dev/null; then
      if systemctl is-active --quiet nginx 2>/dev/null; then
        systemctl reload nginx
      else
        systemctl restart nginx || nginx
      fi
      log "    Nginx 站点配置已刷新（旧配置备份在 ${backup}）"
      warn "若你手工加过 HTTPS / 限流配置，请检查新配置是否仍然需要（${backup} 里有旧内容）。"
    else
      cp -a "$backup" /etc/nginx/conf.d/moxuany.conf
      die "新 Nginx 配置校验失败，已还原旧配置（nginx -t 查看详情）"
    fi
  else
    # 默认保留现有配置：手工加的 TLS 不会被抹掉。
    # 把模板渲染到临时文件，方便与线上配置对比。
    sed "s/__SERVER_NAME__/${server_name}/g" nginx/moxuany.conf.template \
      > /etc/nginx/conf.d/moxuany.conf.new
    log "    已保留现有 /etc/nginx/conf.d/moxuany.conf（未覆盖）"
    log "    本次部署包的新模板在 /etc/nginx/conf.d/moxuany.conf.new"
    if diff -q /etc/nginx/conf.d/moxuany.conf /etc/nginx/conf.d/moxuany.conf.new >/dev/null 2>&1; then
      log "    与现有配置一致，无需处理"
      rm -f /etc/nginx/conf.d/moxuany.conf.new
    else
      warn "与现有配置不同。确认差异后执行："
      warn "  diff -u /etc/nginx/conf.d/moxuany.conf /etc/nginx/conf.d/moxuany.conf.new"
      warn "  要直接采用新模板：./deploy.sh --refresh-nginx（会先备份旧配置）"
      warn "  或手工合并到 /etc/nginx/conf.d/moxuany.conf 后 nginx -t && systemctl reload nginx"
    fi
  fi
fi

# ------------------------------------------------------------ 完成
log "部署完成"
cat <<EOF

  网站前台          http://${server_name}/
  管理后台          http://${server_name}/admin/
  后端本机自检      curl -s http://127.0.0.1:8080/food/app/config
  容器状态          docker compose -f compose.prod.yml ps
  后端日志          docker compose -f compose.prod.yml logs -f backend
  MySQL 日志        docker compose -f compose.prod.yml logs -f mysql

  ⚠️  上线前还必须手工完成（脚本不会代做）：
     1. 登录总后台 /admin/ 改掉 admin 默认密码，并停用/删除 ry 账号
     2. 确认 sys_config 里 sys.account.captchaEnabled = true（验证码开启）
     3. 不要导入 merchant_demo / rider_demo 等演示账号
     4. 网站注册需要邀请码：总后台 → 外卖管理 → 邀请码，生成后发给用户
     5. 配好 HTTPS 证书（微信小程序强制要求 HTTPS + 已备案域名）
     6. 在微信公众平台把 https://${server_name} 加入 request 合法域名
     7. 配置数据库 + 图片定时备份：crontab -e 加入
        0 3 * * * $(pwd)/scripts/backup.sh >> /var/log/moxuany-backup.log 2>&1

  备份说明：data/uploads（菜品/店铺图片）、data/food-evidence（售后举证图片）
  都在 ./data 下，backup.sh 会与数据库一起打包。

EOF
