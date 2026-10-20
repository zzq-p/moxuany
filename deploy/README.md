# 青禾校园点餐 —— 腾讯云部署手册

面向 **已有一台云服务器，只要把项目装上去** 的场景。目标机器：**2 核 2G**，Linux。

整包只需要在服务器上执行一条 `./deploy.sh`。但**构建必须在你的 Windows 本机做**，原因见下面第 1 节。

---

## 目录

1. [先读：2 核 2G 的实话](#1-先读2-核-2g-的实话)
2. [部署后长什么样](#2-部署后长什么样)
3. [服务器准备（一次性）](#3-服务器准备一次性)
4. [部署流程](#4-部署流程)
5. [已内置的内存调优](#5-已内置的内存调优)
6. [上线前必做的安全清单](#6-上线前必做的安全清单)
7. [HTTPS 与微信小程序上线](#7-https-与微信小程序上线)
8. [日常运维命令](#8-日常运维命令)
9. [备份与恢复](#9-备份与恢复)
10. [故障排查](#10-故障排查)
11. [必须知道的缺口](#11-必须知道的缺口)

---

## 1. 先读：2 核 2G 的实话

**能跑，但没有余量。** 这个项目要同时驻留 MySQL 8.4、Redis、一个若依 Spring Boot 应用和 Nginx。
2G 内存下真实占用大概是：

| 组件 | 实际占用 | 我在配置里设的上限 |
| --- | --- | --- |
| 系统 + sshd | ~200 MB | — |
| Docker 守护进程 | ~120 MB | — |
| MySQL 8.4（已调优） | ~400 MB | 700 MB |
| Redis（maxmemory 128MB） | ~150 MB | 320 MB |
| 后端 JVM（-Xmx512m） | ~700 MB | 900 MB |
| Nginx（装在宿主机） | ~20 MB | — |
| **合计** | **约 1.6 GB** | — |

剩下约 400MB 给文件缓存和突发流量，**必须配 swap 兜底**（第 3 节有命令），否则一次构建缓存抖动或并发高峰就可能触发 OOM Killer 把 MySQL 或后端杀掉。

因此：

- **做试点 / 内部演示 / 几十人在线** → 按本手册部署没问题。
- **要真实对外接单** → 建议升到 **2 核 4G**（MySQL 和 JVM 都能松一口气）。内存是不可压缩的硬约束，CPU 反而没那么紧张。
- 如果暂时不能升配，**务必配 2G swap**，并且把第 6 节的定时备份配起来——OOM 杀掉 MySQL 不是不可能。

另外两个必须做的动作：

1. **关掉演示模式**（`FOOD_DEMO_ENABLED=false`）。开着的话任何人不用登录就能拿到随机账号。
2. **改掉 admin 默认密码**、删掉 `ry` 账号。

---

## 2. 部署后长什么样

```
                    Nginx :80 / :443（宿主机）
   ┌──────────────┬───────────────┬──────────────┬────────────────┐
   │ /            │ /admin/       │ /prod-api/   │ /food/         │
   │ 网站前台 H5   │ 管理端静态     │ → :8080/     │ → :8080/food/  │
   └──────────────┴───────────────┴──────────────┴────────────────┘
                          /profile/ → :8080/profile/（上传图片）
                                    │
                    ┌───────────────┴───────────────┐
                    │  moxuany-backend  127.0.0.1:8080 │
                    └───────────────┬───────────────┘
                          ┌─────────┴─────────┐
                   moxuany-mysql        moxuany-redis
                   127.0.0.1:3306       127.0.0.1:6379
```

- 三个容器（MySQL / Redis / 后端）由 `compose.prod.yml` 编排，Nginx 装在宿主机上——少一层容器开销，证书续期也更省事。
- **所有容器端口只绑 `127.0.0.1`**，外网唯一入口是 Nginx。
- 云服务器安全组**只需要放行 22 / 80 / 443**。3306、6379、8080 一律不要开。
- 顾客入口是 `http://域名/`，管理员入口是 `http://域名/admin/`。旧链接 `/h5/` 会 301 回 `/`。

路由为什么这么配（前端里写死的，不能改 Nginx 之外的地方）：

| 路径 | 原因 |
| --- | --- |
| `/admin/` | 管理端 `vite.config.js` 生产 `base = '/admin/'`，路由使用 `import.meta.env.BASE_URL` |
| `/prod-api/` | `admin/.env.production` 里 `VITE_APP_BASE_API = '/prod-api'` |
| `/food/` | H5 产物 base 为空串，请求直接打同源 `/food/app/**` |
| `/profile/` | 若依把上传目录映射在 `/profile/**` |
| `/assets/` | H5 产物引用绝对路径 `/assets/...` |
| `/static/` | H5 产物里的图片（种子数据引用 `/static/food/*.jpg`） |
| `/admin/static/` | 管理端产物引用 `/admin/static/...` |

站点目录（`deploy.sh` 从部署包同步，目录名与 URL 前缀刻意保持一致）：

```
/srv/moxuany/web/h5      ← 部署包 web/h5-dist
/srv/moxuany/web/admin   ← 部署包 web/admin-dist
```

> 目录名不直接叫 `h5-dist`，是因为 Nginx 里 `/admin/` 用 `root /srv/moxuany/web` + `try_files` 最稳妥；
> 目录名和 URL 前缀不一致就只能写 `alias`，而 `alias` 与 `try_files` 搭配很容易出现 404/循环回退。

---

## 3. 服务器准备（一次性）

### 3.1 安全组

腾讯云控制台 → 轻量应用服务器/CVM → 防火墙/安全组，**只放行**：

| 端口 | 用途 |
| --- | --- |
| 22 | SSH |
| 80 | HTTP |
| 443 | HTTPS |

**不要**放行 3306、6379、8080。

### 3.2 配置 swap（2G 机器必做）

```bash
fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
# 尽量少用 swap，只在真正吃紧时兜底
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf
free -h    # 确认 Swap 一行有 2.0Gi
```

### 3.3 安装 Docker 与 Nginx

**Ubuntu / Debian：**

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

apt update && apt install -y nginx rsync
```

**CentOS / OpenCloudOS / TencentOS：**

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

yum install -y nginx rsync
systemctl enable --now nginx
```

验证：

```bash
docker compose version    # 需要 v2.20+（deploy.sh 用了 --wait）
nginx -v
```

> 如果买的是「宝塔面板」或「Docker CE」应用镜像，Docker 可能已经装好，跳过对应步骤即可。
> 用宝塔的话，Nginx 配置不要放 `/etc/nginx/conf.d/`，而要粘贴到宝塔站点配置里，并给 `deploy.sh` 加 `--skip-nginx`。

### 3.4 国内机器建议配 Docker 镜像加速

拉 `mysql:8.4`、`redis:8` 可能很慢：

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"],
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
```

`mirror.ccs.tencentyun.com` 是腾讯云内网镜像源，只有腾讯云机器能用。

---

## 4. 部署流程

### 4.1 在本机（Windows）构建并打包

```powershell
cd D:\ideaproject\moxuany
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\local\build-and-pack.ps1 -ServerName 你的域名
```

脚本会做这些事：

1. `mvn package -DskipTests` 编译后端 jar（**构建必须在本地做**，2G 服务器跑 Maven 会和 MySQL 抢内存）
2. `npm run build:prod` 构建管理端（`/admin/` 基础路径）
3. `npm run build:h5` 构建网站前台 H5（**必需产物，不再是可选预览**）
4. 快照一份 SQL、复制 jar 和前端产物到一个自包含目录
5. **把所有文本文件的换行符统一成 LF 并去掉 BOM**（否则 Linux 上会报 `bash: /migrate.sh: /bin/bash^M: bad interpreter`）
6. 首次自动生成 `.env`，随机填好数据库密码和 `TOKEN_SECRET`；之后保存在 `deploy\server\.env`（已被 `.gitignore` 忽略）并复用，避免每次换密码导致已有 MySQL 数据卷认证失败
7. 打成 `deploy\dist\moxuany-<时间戳>.tar.gz`

> 若本机后端正在运行，Windows 会锁定 jar 导致打包失败，先停掉。
> 只改配置不改代码时，加 `-SkipBuild` 可以秒级重新打包（会复用已有的两套前端产物）。

### 4.2 上传

```bash
scp deploy/dist/moxuany-20260101-120000.tar.gz root@<服务器IP>:/opt/
```

### 4.3 解压并检查 .env

```bash
ssh root@<服务器IP>
cd /opt
tar -xzf moxuany-*.tar.gz
cd moxuany

chmod +x deploy.sh mysql/migrate.sh scripts/*.sh
```

编辑 `.env`，**至少确认这三项**：

```bash
vi .env
```

| 变量 | 要求 |
| --- | --- |
| `SERVER_NAME` | 你的域名（不带 `https://`）。没有域名就先填公网 IP |
| `FOOD_DEMO_ENABLED` | **必须是 `false`** |
| `FOOD_WEB_LOGIN_ENABLED` | 网站账号登录开关，保持 `true` |
| `FOOD_MOCK_PAYMENT_ENABLED` | 项目尚未接入真实支付，保持 `true`，否则下单后无法完成支付 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 小程序微信登录需要；不填时网站账号登录仍可正常使用 |
| `FOOD_TRUST_PROXY_HEADER` | 用本套 Nginx 时必须为 `true`，否则后端把 Nginx 地址当成访客 IP，登录/注册/验证码额度会被全站共用。若把 8080 直接暴露公网，必须改回 `false` |

数据库密码和 `TOKEN_SECRET` 脚本已经随机生成好了，不用改。

> 网站用户注册需要**邀请码**：先用 `admin` 登录 `/admin/`，进入「校园点餐 → 邀请码」生成，
> 再把邀请码发给要注册的人。每个邀请码只能注册一个账号，可设置有效期。

### 4.4 一键部署

```bash
./deploy.sh
```

脚本按顺序做：

```
0/5  检查 docker、compose、.env 必填项、TOKEN_SECRET 长度 ≥32、两套前端产物
1/5  创建 data/uploads、data/logs、data/food-evidence 并把属主改成 uid 10001
2/5  docker compose up -d --wait mysql redis
3/5  docker compose --profile migrate run --rm migrate   ← 数据库初始化/迁移
4/5  构建后端镜像并启动
5/5  同步 H5 到 /srv/moxuany/web/h5、管理端到 /srv/moxuany/web/admin，
     首次安装 Nginx 配置并 reload
```

`--skip-nginx` 可跳过第 5 步；`--migrate-only` 只跑数据库迁移。

**Nginx 配置默认不覆盖。** 首次部署会写入模板；之后你手工加的 HTTPS、限流规则都会保留，
新模板渲染到 `/etc/nginx/conf.d/moxuany.conf.new` 供对比。确实要采用新模板时：

```bash
./deploy.sh --refresh-nginx     # 先备份旧配置；nginx -t 失败会自动还原
```

### 4.5 验证

```bash
docker compose -f compose.prod.yml ps
curl -s http://127.0.0.1:8080/food/app/config
curl -sI http://127.0.0.1/          # 网站前台
curl -sI http://127.0.0.1/admin/    # 管理端
```

浏览器打开：

- `http://<域名或IP>/` → 网站前台。注册需要邀请码，注册成功后直接登录，可加购、结算、模拟支付。
- `http://<域名或IP>/admin/` → 管理端，用 `admin` / `admin123` 登录 —— **登进去第一件事就是改密码**，
  然后到「校园点餐 → 邀请码」生成注册邀请码。

---

## 5. 已内置的内存调优

这些都是针对 2G 机器预设好的，不用你再调。

### MySQL —— `mysql/my.cnf`

| 参数 | 值 | 理由 |
| --- | --- | --- |
| `innodb_buffer_pool_size` | 128M | 默认 128M，2G 机器不要加 |
| `performance_schema` | OFF | **省 150~200MB**，本项目用不到 |
| `max_connections` | 100 | 后端 Druid 最大 40，默认 151 纯属浪费 |
| `mysqlx` | OFF | 8.4 默认多监听一个 33060 端口 |
| `innodb_flush_log_at_trx_commit` | 1 | **订单是资金数据，不要为了性能改成 2** |

### Redis —— `compose.prod.yml`

`--maxmemory 128mb --maxmemory-policy noeviction`。
保持 `noeviction` 是有意的：内存满了宁可写失败，也不能静默淘汰会话把用户踢下线。

### 后端 JVM —— `compose.prod.yml` 的 `JAVA_OPTS`

```
-Xms256m -Xmx512m                 堆固定住，容器里比 MaxRAMPercentage 更可预测
-XX:MaxMetaspaceSize=192m         若依类多，给够但设上限
-XX:ReservedCodeCacheSize=64m
-Xss512k                          线程栈减半
-XX:+UseSerialGC                  2 核上 GC 线程少反而更快更省
-XX:+ExitOnOutOfMemoryError       OOM 直接退出让 docker 重启，避免半死不活
-Dspring.devtools.restart.enabled=false
```

另外用命令行参数把 Tomcat 线程数从默认的 200/20 压到 **100/10**（`application-food.yml` 里写的是 200，不改源码，走启动参数覆盖）。

> 如果之后升配到 4G，把 `JAVA_OPTS` 里的 `-Xmx512m` 改成 `-Xmx1024m` 会明显更从容。

---

## 6. 上线前必做的安全清单

脚本**不会**代做这些，必须手工完成：

| # | 事项 | 原因 |
| --- | --- | --- |
| 1 | 登录总后台改掉 `admin` 密码，停用或删除 `ry` 账号 | 种子 SQL 里两个账号都是 `admin123` |
| 2 | 确认 `sys_config` 里 `sys.account.captchaEnabled = 'true'` | 关掉验证码等于给爆破开门 |
| 3 | 不要导入 `merchant_demo` / `rider_demo` 演示账号和演示数据 | 见 `scripts/seed-operations-demo.cjs` |
| 4 | 确认 `.env` 里 `FOOD_DEMO_ENABLED=false` | 开着=任何人免登录拿账号 |
| 5 | 确认 `.env` 里 `FOOD_WEB_LOGIN_ENABLED=true`、`FOOD_MOCK_PAYMENT_ENABLED=true` | 前者关掉网站就无法登录；后者关掉下单后无法支付 |
| 6 | 用总后台生成注册邀请码，不要公开张贴 | 邀请码是网站注册的唯一门槛 |
| 7 | 确认 `TOKEN_SECRET` 是 ≥32 位随机值 | `deploy.sh` 会校验长度 |
| 8 | 配置 HTTPS 证书 | 微信小程序强制要求 |
| 9 | 在微信公众平台配置 request 合法域名 | 否则体验版/正式版调不通接口 |
| 10 | 配好数据库 + 图片定时备份 | 见第 9 节 |
| 11 | `.env` 权限 600，绝不提交 Git、绝不外传 | 里面有全部密钥 |
| 12 | 安全组只开 22/80/443 | 3306/6379/8080 暴露到公网会被扫 |

> Druid 监控台和 springdoc 接口文档都已经处理好了：
> `application-food.yml` 把 `statViewServlet.enabled` 设为 false，
> Nginx 另外把 `/v3/api-docs`、`/swagger-ui*`、`/druid` 及其 `/prod-api/` 前缀版本全部 403。
> 需要临时查看接口文档时，注释掉 `nginx/moxuany.conf.template` 里那两段 `deny all` 再 reload。

---

## 7. HTTPS 与微信小程序上线

微信小程序要求接口域名 **HTTPS + 已完成 ICP 备案**，所以这一步不能省。

### 7.1 申请证书

腾讯云控制台 → SSL 证书 → 申请免费证书 → 填域名 → 下载 **Nginx 格式**：

```bash
mkdir -p /etc/nginx/ssl
# 把下载得到的 .crt 和 .key 上传到这里
scp your-domain.crt your-domain.key root@<服务器IP>:/etc/nginx/ssl/
```

### 7.2 启用 HTTPS

编辑 `/etc/nginx/conf.d/moxuany.conf`，参考文件末尾注释里的模板：

1. 把 80 端口那个 server 块的内容复制一份到新的 443 块
2. 改 `listen 443 ssl;`、加上 `http2 on;` 和证书路径
3. 把原来的 80 端口块改成只做跳转：

```nginx
server {
    listen 80;
    server_name 你的域名;
    return 301 https://$host$request_uri;
}
```

```bash
nginx -t && systemctl reload nginx
```

或者用 certbot 自动签发 + 自动续期：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名
```

### 7.3 发布微信小程序

```powershell
# 本机
npm run build:miniapp
```

用微信开发者工具**打开 `miniapp/dist/build/mp-weixin` 作为项目目录**，然后：

1. 上传代码 → 提交审核 → 发布
2. 公众平台 → 开发管理 → 开发设置 → **服务器域名 → request 合法域名** 填 `https://你的域名`

注意：`miniapp/src/manifest.json` 里 `urlCheck: false` **只对开发者工具有效**，体验版和正式版仍然会校验合法域名。

---

## 8. 日常运维命令

在部署目录（`/opt/moxuany`）下执行：

```bash
# 服务状态
docker compose -f compose.prod.yml ps

# 日志
docker compose -f compose.prod.yml logs -f backend
docker compose -f compose.prod.yml logs -f mysql
tail -f data/logs/sys-info.log

# 重启 / 停止
docker compose -f compose.prod.yml restart backend
docker compose -f compose.prod.yml down          # 数据在命名卷里，不会丢

# 进 MySQL 命令行
docker compose -f compose.prod.yml exec mysql \
  mysql -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" moxuany

# 更新版本（本机重新打包上传后）
./deploy.sh

# 只更新后端不动数据库
./deploy.sh --skip-nginx
```

**升级代码后要不要跑迁移？** `./deploy.sh` 默认就会跑，而且 `mysql/migrate.sh` 是幂等的，重复执行安全，所以直接跑就对了。

---

## 9. 备份与恢复

### 配置定时备份

```bash
chmod +x scripts/backup.sh scripts/restore.sh
crontab -e
```

加入：

```
0 3 * * * /opt/moxuany/scripts/backup.sh >> /var/log/moxuany-backup.log 2>&1
```

备份内容：数据库全量 dump（gzip）+ 图片目录，默认保留 14 天，写到 `backups/`。
图片包含两类，缺一不可：

- `data/uploads`：菜品、店铺、头像等后台上传图片
- `data/food-evidence`：售后举证的订单图片（单独存放在 uploads 的兄弟目录）

脚本会检查磁盘剩余空间（不足 1GB 直接失败退出）并校验 dump 完整性——磁盘写满会让 MySQL 直接崩。

### 手动恢复

```bash
docker compose -f compose.prod.yml stop backend
./scripts/restore.sh backups/moxuany-20260101-030000.sql.gz
# 图片包可选；不传会自动找同时间戳的 data-*.tar.gz，只恢复数据库
# ./scripts/restore.sh backups/moxuany-....sql.gz backups/data-20260101-030000.tar.gz
docker compose -f compose.prod.yml start backend
```

恢复前脚本会自动先做一次当前状态的快照。图片包会覆盖 `data/uploads` 与
`data/food-evidence` 并重新设置属主；不传图片包时图片目录保持原样。

> **强烈建议**：定期把 `backups/` 拉到别的地方（本地电脑、对象存储）。备份和数据库在同一台机器上，机器没了就一起没了。

---

## 10. 故障排查

### 后端起来就退出，日志报表或字段不存在

说明迁移没成功。单独重跑一次看输出：

```bash
docker compose --profile migrate run --rm migrate
```

脚本结尾有结构自检，会列出缺哪张表、缺哪个字段。

### 报 `permission denied` 写不了日志或图片

宿主机目录属主不对。容器内后端以 uid 10001 运行：

```bash
chown -R 10001:10001 data/uploads data/logs data/food-evidence
docker compose -f compose.prod.yml restart backend
```

### 报 `bash: /migrate.sh: /bin/bash^M: bad interpreter`

换行符是 CRLF。本机打包脚本会处理，如果手工改过文件：

```bash
sed -i 's/\r$//' deploy.sh mysql/migrate.sh scripts/*.sh
```

### 容器被 OOM Killer 杀掉

```bash
dmesg | grep -i "killed process"     # 确认是不是 OOM
free -h                              # 看 swap 有没有生效
docker stats --no-stream             # 看谁在吃内存
```

应急止血：把 `JAVA_OPTS` 里的 `-Xmx512m` 降到 `-Xmx384m` 并重启后端。
根治办法是升配到 4G。

### Nginx 502

```bash
curl -s http://127.0.0.1:8080/food/app/config    # 后端活着吗
docker compose -f compose.prod.yml logs --tail=100 backend
```

### `docker compose up` 报 `.env` 变量未设置

`compose.prod.yml` 里带了 `:?` 断言，缺哪个变量会直接点名。补齐 `.env` 即可。

### 上传图片后小程序里显示不出来

检查三点：`data/uploads` 属主、Nginx 的 `/profile/` 转发、`FOOD_UPLOAD_PATH=/app/uploads` 是否被改过。

---

## 11. 必须知道的缺口

部署上线 ≠ 功能完整。以下是这个项目当前的真实边界，别被"部署成功了"误导：

| 事项 | 现状 |
| --- | --- |
| **生产用户入口** | **网站 `/` + 微信小程序。** 网站支持用户名 + 密码 + 图片验证码登录，注册需管理员生成的一次性邀请码；小程序仍走微信登录。 |
| **忘记密码** | **未实现。** 没有短信/邮件找回，忘记只能由管理员在后台处理或重新注册。 |
| **微信支付** | **模拟的，真实支付未实现。** 下单支付不扣款。`FOOD_MOCK_PAYMENT_ENABLED` 必须保持 `true`。 |
| **订阅消息** | 默认关闭（`FOOD_SUBSCRIPTIONS_ENABLED=false`），需要自己申请模板后开启。 |
| **退款** | 部分退款是模拟资金流程。 |
| **单点故障** | MySQL、Redis、后端都在同一台机器，挂了全挂。 |
| **图片存本地磁盘** | 后端暂时不能横向扩多实例（多实例会读到不同磁盘）。 |
| **并发容量** | `docs/test-report.json` 是本机短时压测结果，**不是生产容量承诺**。 |
| **本机脚本** | `npm start`、`scripts/*.ps1`、`scripts/upgrade-local.cjs` 都是 Windows 专用，生产不要用；Linux 上用 `deploy.sh` 和 `mysql/migrate.sh`。 |

---

## 附：部署包文件清单

```
moxuany/
├── .env                          由本机打包脚本生成，含全部密钥（权限 600）
├── .env.production.example       变量说明与模板
├── compose.prod.yml              MySQL + Redis + 后端（+ 一次性 migrate 服务）
├── deploy.sh                     服务器端一键部署
├── backend/
│   ├── Dockerfile                只装 jar，容器内不做 Maven 构建
│   └── ruoyi-admin.jar           本机编译产物
├── mysql/
│   ├── my.cnf                    2G 内存专用调优
│   └── migrate.sh                幂等的数据库初始化/迁移（03~07 + ALTER + 回填 + 自检）
├── nginx/
│   └── moxuany.conf.template     站点配置，含 HTTPS 模板
├── scripts/
│   ├── backup.sh                 数据库+图片备份，带空间检查与完整性校验
│   └── restore.sh                恢复
├── sql/                          本次代码版本对应的 SQL 快照
└── web/
    ├── admin-dist/               管理端（总后台 + 商家后台），部署到 /srv/moxuany/web/admin
    └── h5-dist/                  网站前台 H5，部署到 /srv/moxuany/web/h5
```

数据库迁移为什么需要单独的脚本，而不是直接用项目自带的 `compose.yml`：
项目自带的初始化只跑 `ry_20260417.sql` + `quartz.sql` + `03-food.sql`，而 `03-food.sql` 只是基础表结构，
04~07 的后建表（退款、骑手、预约、评价回复、消息模板等）和十几处 `ALTER TABLE` 新增字段都不在其中。
本地是靠 `scripts/upgrade-local.cjs` 补的，但那个脚本写死了 Windows 的 `docker.exe` 路径和容器名，
Linux 上跑不了。`mysql/migrate.sh` 是它的 Linux 等价实现，顺序完全一致，并且可重复执行。
