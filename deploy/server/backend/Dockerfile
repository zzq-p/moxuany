# ============================================================
# 后端运行镜像
#
# 注意：这里【不做 Maven 构建】。
# 2 核 2G 的机器上跑 Maven 编译若依多模块工程（还要和 MySQL、Redis 抢内存）
# 极容易 OOM，所以 jar 一律在本机 Windows 上构建好，再连同本目录一起上传。
# 构建命令见 deploy/local/build-and-pack.ps1
# ============================================================
FROM eclipse-temurin:21-jre-jammy

ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata curl \
 && rm -rf /var/lib/apt/lists/* \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo "$TZ" > /etc/timezone

WORKDIR /app

# 由 build-and-pack.ps1 放到 backend/ruoyi-admin.jar
COPY ruoyi-admin.jar /app/app.jar

# 以非 root 运行。uid 固定为 10001，./deploy.sh 会把宿主机
# data/uploads、data/logs 的属主改成同一个 uid，否则挂载后无法写入。
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin appuser \
 && mkdir -p /app/uploads /app/.runtime/logs \
 && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

# 用 sh -c 让 $JAVA_OPTS 生效；末尾的 "$@" 用于接收 compose 里 command 传入的
# --spring.profiles.active 等参数（-- 是 $0 占位符）。
ENTRYPOINT ["/bin/sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar \"$@\"", "--"]
