$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path '.env')) { node scripts/configure.cjs }
Get-Content '.env' | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process') } }
# 本机默认开演示登录；.env 显式写了 FOOD_DEMO_ENABLED=false 时尊重该值
# （用于验证正式网站模式：只有注册/登录后才能下单）。
if ([string]::IsNullOrEmpty($env:FOOD_DEMO_ENABLED)) { $env:FOOD_DEMO_ENABLED='true' }
if (!$env:WECHAT_APPID) { $env:WECHAT_APPID='wxc2e0a745fac5e8ec' }
$env:FOOD_UPLOAD_PATH=(Join-Path (Get-Location) '.runtime/uploads').Replace('\','/')
java -jar server/ruoyi-admin/target/ruoyi-admin.jar --spring.profiles.active=druid,food
