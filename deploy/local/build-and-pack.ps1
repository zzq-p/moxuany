<#
.SYNOPSIS
    在本机（Windows）构建青禾校园点餐的全部产物，并打成一个可直接上传服务器的压缩包。

.DESCRIPTION
    为什么要在本机构建：
      目标服务器是 2 核 2G，跑 Maven 编译若依多模块工程会和 MySQL、Redis 抢内存，
      极容易 OOM，所以 jar 一律在本机构建好再上传。

    产物位置：deploy\dist\moxuany-<时间戳>.tar.gz

.PARAMETER SkipBuild
    跳过编译，直接复用已有产物（server\ruoyi-admin\target\ruoyi-admin.jar、
    admin\dist、miniapp\dist\build\h5）。适合只改配置、不改代码时重新打包。

.PARAMETER SkipClean
    编译前不清理各模块的 target 目录。默认会清理（等价于 mvn clean），
    这样就不依赖本地 Maven 仓库里有没有 maven-clean-plugin。

.PARAMETER MavenPath
    mvn.cmd 的完整路径。默认先在 PATH 里找，再尝试已知的安装位置。

.PARAMETER ServerName
    可选。首次生成 .env 时写入 SERVER_NAME（域名，不要带 https://）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File deploy\local\build-and-pack.ps1 -ServerName order.example.com

.EXAMPLE
    # 只改了 Nginx 配置或 .env，不想重新编译
    powershell -NoProfile -ExecutionPolicy Bypass -File deploy\local\build-and-pack.ps1 -SkipBuild
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipClean,
    [string]$MavenPath,
    [string]$ServerName
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# ----------------------------------------------------------------- 路径
$LocalDir  = $PSScriptRoot                             # deploy\local
$DeployDir = Split-Path $LocalDir -Parent              # deploy
$RepoRoot  = Split-Path $DeployDir -Parent             # 仓库根目录
$ServerDir = Join-Path $DeployDir 'server'
$StageRoot = Join-Path $DeployDir 'dist'
$StageDir  = Join-Path $StageRoot 'moxuany'

# ----------------------------------------------------------------- 输出助手
function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "    $msg" }
function Write-Warn($msg) { Write-Host "    [警告] $msg" -ForegroundColor Yellow }
function Fail($msg)       { Write-Host "`n[错误] $msg" -ForegroundColor Red; exit 1 }

Write-Step "构建青禾校园点餐部署包"
Write-Info "仓库根目录：$RepoRoot"

# ----------------------------------------------------------------- 工具定位
function Resolve-Exe {
    param([string]$Name, [string[]]$Fallbacks, [string]$Explicit, [string]$Hint)
    if ($Explicit) {
        if (Test-Path $Explicit) { return $Explicit }
        Fail "指定的 $Name 路径不存在：$Explicit"
    }
    foreach ($candidate in @($Name) + $Fallbacks) {
        if (Test-Path $candidate) { return $candidate }
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    Fail "未找到 $Name。$Hint"
}

$maven = Resolve-Exe -Name 'mvn.cmd' -Explicit $MavenPath -Fallbacks @(
    'D:\java\apache-maven-3.9.16\apache-maven-3.9.16\bin\mvn.cmd',
    'D:\java\apache-maven-3.9.16\bin\mvn.cmd',
    'D:\java\maven\bin\mvn.cmd',
    'C:\Program Files\apache-maven\bin\mvn.cmd'
) -Hint "请安装 Maven，或用 -MavenPath 指定 mvn.cmd 的完整路径。"

$node = Resolve-Exe -Name 'node.exe' -Fallbacks @('D:\java\node\node.exe') `
    -Hint "请安装 Node.js 20+。"

# 优先用 npm.cmd：npm.ps1 会受 PowerShell 执行策略限制
$npm = Resolve-Exe -Name 'npm.cmd' -Fallbacks @(
    (Join-Path (Split-Path $node -Parent) 'npm.cmd'),
    'D:\java\node\npm.cmd'
) -Hint "请安装 Node.js 20+。"

$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tar)) { Fail "找不到 $tar，无法打包（需要 Windows 10 1803 及以上）。" }

Write-Info "maven : $maven"
Write-Info "node  : $node"
Write-Info "npm   : $npm"

# ----------------------------------------------------------------- 构建
function Invoke-NpmBuild {
    param([string]$ProjectDir, [string]$ScriptName, [string]$Label)
    Write-Info "构建 $Label ..."
    Push-Location $ProjectDir
    try {
        if (-not (Test-Path (Join-Path $ProjectDir 'node_modules'))) {
            Write-Info "  安装依赖（首次较慢）"
            & $npm install
            if ($LASTEXITCODE -ne 0) { Fail "$Label 的 npm install 失败（退出码 $LASTEXITCODE）" }
        }
        & $npm run $ScriptName
        if ($LASTEXITCODE -ne 0) { Fail "$Label 构建失败（退出码 $LASTEXITCODE）" }
    } finally {
        Pop-Location
    }
}

if ($SkipBuild) {
    Write-Step "1/5 跳过编译（-SkipBuild），复用已有产物"
} else {
    Write-Step "1/5 编译后端 jar"

    $javaProcs = Get-Process -Name java -ErrorAction SilentlyContinue
    if ($javaProcs) {
        Write-Warn "检测到 $($javaProcs.Count) 个 java 进程。若有本项目的后端在运行，"
        Write-Warn "请先停止（Windows 会锁定运行中的 jar，导致打包失败）。"
    }

    # 用 PowerShell 删掉各模块的 target，效果等同于 mvn clean，
    # 但不需要 maven-clean-plugin —— 这个仓库的本地 Maven 仓库里可能并没有它
    # （项目自带的 scripts/start.ps1 只跑 package，从没下载过 clean 插件）。
    if (-not $SkipClean) {
        Get-ChildItem (Join-Path $RepoRoot 'server') -Directory -Filter 'target' -Recurse -Depth 1 -ErrorAction SilentlyContinue |
            ForEach-Object {
                Write-Info "  清理 $($_.FullName.Substring($RepoRoot.Length + 1))"
                Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
    }

    & $maven -f (Join-Path $RepoRoot 'server\pom.xml') package -DskipTests
    if ($LASTEXITCODE -ne 0) { Fail "Maven 构建失败（退出码 $LASTEXITCODE）" }

    Write-Step "2/5 构建管理端（总后台 + 商家后台，/admin/ 基础路径）"
    Invoke-NpmBuild -ProjectDir (Join-Path $RepoRoot 'admin') -ScriptName 'build:prod' -Label '管理端'

    Write-Step "3/5 构建网站前台 H5"
    Invoke-NpmBuild -ProjectDir (Join-Path $RepoRoot 'miniapp') -ScriptName 'build:h5' -Label 'H5'
}

# ----------------------------------------------------------------- 校验产物
Write-Step "4/5 校验构建产物"

$jar = Join-Path $RepoRoot 'server\ruoyi-admin\target\ruoyi-admin.jar'
if (-not (Test-Path $jar)) { Fail "找不到后端 jar：$jar" }

$adminDist = Join-Path $RepoRoot 'admin\dist'
if (-not (Test-Path (Join-Path $adminDist 'index.html'))) { Fail "管理端产物不完整：$adminDist" }

$h5Dist = Join-Path $RepoRoot 'miniapp\dist\build\h5'
if (-not (Test-Path (Join-Path $h5Dist 'index.html'))) { Fail "网站前台 H5 产物不完整：$h5Dist（请先执行 npm run build:h5）" }

foreach ($p in @($jar, (Join-Path $adminDist 'index.html'), (Join-Path $h5Dist 'index.html'))) {
    Write-Info ("{0,-42} {1,8:N1} MB" -f (Split-Path $p -Leaf), ((Get-Item $p).Length / 1MB))
}

# 入口基础路径检查：管理端必须在 /admin/ 下，网站前台必须在根路径。
$adminIndex = [System.IO.File]::ReadAllText((Join-Path $adminDist 'index.html'), [System.Text.Encoding]::UTF8)
if ($adminIndex -notmatch '/admin/static/') { Fail "管理端产物没有使用 /admin/ 基础路径，请重新执行 npm run build:admin" }
$h5Index = [System.IO.File]::ReadAllText((Join-Path $h5Dist 'index.html'), [System.Text.Encoding]::UTF8)
if ($h5Index -notmatch '/assets/') { Fail "H5 产物资源路径异常，请重新执行 npm run build:h5" }
Write-Info "入口路径：/ = 网站前台，/admin/ = 管理后台"

# ----------------------------------------------------------------- 组装
Write-Step "5/5 组装并打包"

if (Test-Path $StageRoot) { Remove-Item $StageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

# 服务端骨架（compose / 脚本 / 配置）
Copy-Item (Join-Path $ServerDir '*') -Destination $StageDir -Recurse -Force

# jar
$backendDir = Join-Path $StageDir 'backend'
New-Item -ItemType Directory -Path $backendDir -Force | Out-Null
Copy-Item $jar (Join-Path $backendDir 'ruoyi-admin.jar') -Force

# SQL（从仓库快照一份，保证与本次代码版本一致；服务器上不需要整份仓库）
$sqlDir = Join-Path $StageDir 'sql'
New-Item -ItemType Directory -Path $sqlDir -Force | Out-Null
foreach ($f in @(
    'server\sql\ry_20260417.sql',
    'server\sql\quartz.sql',
    'database\03-food.sql',
    'database\04-operations.sql',
    'database\05-delivery.sql',
    'database\06-fulfillment.sql',
    'database\07-service-experience.sql'
)) {
    $src = Join-Path $RepoRoot $f
    if (-not (Test-Path $src)) { Fail "缺少 SQL 文件：$src" }
    Copy-Item $src (Join-Path $sqlDir (Split-Path $src -Leaf)) -Force
}

# 前端静态产物
New-Item -ItemType Directory -Path (Join-Path $StageDir 'web') -Force | Out-Null
Copy-Item $adminDist (Join-Path $StageDir 'web\admin-dist') -Recurse -Force
Copy-Item $h5Dist (Join-Path $StageDir 'web\h5-dist') -Recurse -Force

# ---- .env ---------------------------------------------------------------------
function New-Hex {
    param([int]$ByteCount)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buf = New-Object byte[] $ByteCount
        $rng.GetBytes($buf)
        return (($buf | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally { $rng.Dispose() }
}

$stageEnv   = Join-Path $StageDir '.env'
$localEnv   = Join-Path $ServerDir '.env'
$envExample = Join-Path $StageDir '.env.production.example'

# 必须显式用 UTF-8 读写：PowerShell 5.1 的 Get-Content -Raw 默认按系统 ANSI
# 代码页（简体中文是 GBK）解码，会把 UTF-8 的中文注释读成乱码；更糟的是某些
# 中文字节被当成 GBK 双字节字符时会把行尾换行一起吃掉，导致
# "SERVER_NAME=..." 被并进上一行注释里而失效。这里全部绕开 Get-Content。
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (Test-Path $localEnv) {
    Copy-Item $localEnv $stageEnv -Force
    if ($ServerName) {
        $existing = [System.IO.File]::ReadAllText($stageEnv, [System.Text.Encoding]::UTF8)
        $existing = $existing -replace '(?m)^SERVER_NAME=.*$', "SERVER_NAME=$ServerName"
        [System.IO.File]::WriteAllText($stageEnv, $existing, $utf8NoBom)
        Copy-Item $stageEnv $localEnv -Force
    }
    Write-Info "已使用 deploy\server\.env 作为部署配置"
} else {
    $content = [System.IO.File]::ReadAllText($envExample, [System.Text.Encoding]::UTF8)
    $content = $content -replace '(?m)^MYSQL_ROOT_PASSWORD=.*$', "MYSQL_ROOT_PASSWORD=$(New-Hex 24)"
    $content = $content -replace '(?m)^MYSQL_PASSWORD=.*$',      "MYSQL_PASSWORD=$(New-Hex 24)"
    $content = $content -replace '(?m)^TOKEN_SECRET=.*$',        "TOKEN_SECRET=$(New-Hex 32)"
    if ($ServerName) {
        $content = $content -replace '(?m)^SERVER_NAME=.*$', "SERVER_NAME=$ServerName"
    }
    [System.IO.File]::WriteAllText($stageEnv, $content, $utf8NoBom)
    # 持久化到 deploy\server\.env（已被 .gitignore 忽略）。下次重新打包复用同一组
    # 数据库密码，否则随机新密码会和已有 MySQL 数据卷的认证信息对不上。
    [System.IO.File]::WriteAllText($localEnv, $content, $utf8NoBom)
    Write-Info "已生成 .env 并自动填入随机数据库密码与 TOKEN_SECRET"
    Write-Info "密钥已保存到 deploy\server\.env，后续打包会复用"
}

# 校验生成的 .env 确实可被 compose 读到：每个键都必须有独立且未被注释的行。
# 上面提到的换行被吃掉的问题就会在这里被挡下来，而不是等到服务器上才发现。
$finalEnv = [System.IO.File]::ReadAllText($stageEnv, [System.Text.Encoding]::UTF8)
$missingKeys = @()
foreach ($key in @('SERVER_NAME', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'TOKEN_SECRET', 'FOOD_DEMO_ENABLED', 'FOOD_WEB_LOGIN_ENABLED', 'FOOD_MOCK_PAYMENT_ENABLED')) {
    if ($finalEnv -notmatch "(?m)^$key=") { $missingKeys += $key }
}
if ($missingKeys.Count -gt 0) {
    Fail ".env 生成异常，以下配置项没有独立成行（可能被并进注释）：$($missingKeys -join ', ')"
}

if ($finalEnv -match 'your-domain\.example\.com') {
    Write-Warn ".env 里的 SERVER_NAME 仍是示例域名，上传前请改掉"
}

# ---- 换行符统一为 LF、去掉 BOM -------------------------------------------------
# Windows 上编辑过的 shell 脚本如果带 CRLF，在 Linux 上会报
# "bash: /migrate.sh: /bin/bash^M: bad interpreter"，这是最难排查的坑之一。
# 放在 .env 生成之后，确保打包进归档的每个文本文件都过一遍。
$textExtensions = @('.sh', '.yml', '.yaml', '.conf', '.cnf', '.sql', '.template',
                   '.env', '.example', '.md', '.properties', '.json')
$normalized = 0
foreach ($file in Get-ChildItem $StageDir -Recurse -File) {
    $isText = ($file.Name -eq 'Dockerfile') -or
              ($file.Name -like '.env*') -or
              ($textExtensions -contains $file.Extension.ToLower())
    if (-not $isText) { continue }

    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ($hasBom) { $text = $text.Substring(1) }
    $lf = $text.Replace("`r`n", "`n").Replace("`r", "`n")

    if ($hasBom -or $lf -ne $text) {
        [System.IO.File]::WriteAllText($file.FullName, $lf, $utf8NoBom)
        Write-Info "    ~ $($file.FullName.Substring($StageDir.Length + 1))"
        $normalized++
    }
}
Write-Info "已规范化换行符的文件：$normalized 个"

# ---- 打包 ---------------------------------------------------------------------
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $StageRoot "moxuany-$stamp.tar.gz"
& $tar -czf $archive -C $StageRoot 'moxuany'
if ($LASTEXITCODE -ne 0) { Fail "tar 打包失败（退出码 $LASTEXITCODE）" }

$sizeMb = [math]::Round((Get-Item $archive).Length / 1MB, 1)

Write-Host ""
Write-Host "部署包已生成" -ForegroundColor Green
Write-Host "  文件   : $archive"
Write-Host "  大小   : $sizeMb MB"
Write-Host ""
Write-Host "上传并部署：" -ForegroundColor Cyan
Write-Host "  scp `"$archive`" root@<服务器IP>:/opt/"
Write-Host "  ssh root@<服务器IP>"
Write-Host "  cd /opt && tar -xzf $(Split-Path $archive -Leaf) && cd moxuany"
Write-Host "  sed -i 's/\r$//' deploy.sh mysql/migrate.sh scripts/*.sh   # 保险起见"
Write-Host "  chmod +x deploy.sh mysql/migrate.sh scripts/*.sh"
Write-Host "  ./deploy.sh"
Write-Host ""
Write-Host "详细说明见 deploy\README.md" -ForegroundColor Cyan
