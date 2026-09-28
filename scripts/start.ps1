param([switch]$Build)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
Set-Location $taskRoot
$dockerCmd=Get-Command docker -ErrorAction SilentlyContinue
$dockerExe=if($dockerCmd){$dockerCmd.Source}else{'D:\Docker\Desktop\resources\bin\docker.exe'}
$mavenCmd=Get-Command mvn -ErrorAction SilentlyContinue
$mavenExe=if($mavenCmd){$mavenCmd.Source}else{'D:\java\apache-maven-3.9.16\apache-maven-3.9.16\bin\mvn.cmd'}
node scripts/configure.cjs
& $dockerExe compose up -d --wait
if($LASTEXITCODE -ne 0){throw 'Docker dependencies failed to start'}
node scripts/upgrade-local.cjs
if($LASTEXITCODE -ne 0){throw 'Database migration failed'}
if(!(Test-Path 'admin/node_modules')){npm install --prefix admin --cache .runtime/npm-cache --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Admin install failed'}}
if(!(Test-Path 'miniapp/node_modules')){npm install --prefix miniapp --cache .runtime/npm-cache --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Miniapp install failed'}}
if($Build -or !(Test-Path 'server/ruoyi-admin/target/ruoyi-admin.jar')){
 if(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue){throw 'Stop the backend before rebuilding its JAR on Windows.'}
 & $mavenExe -f server/pom.xml -q -DskipTests package
 if($LASTEXITCODE -ne 0){throw 'Java build failed'}
}
New-Item -ItemType Directory -Force '.runtime' | Out-Null
if(!(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)){
 $taskBackendScript=Join-Path $taskRoot 'scripts/start-backend.ps1'
 Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$taskBackendScript+'"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot '.runtime/backend.log') -RedirectStandardError (Join-Path $taskRoot '.runtime/backend-error.log') | Out-Null
}
$taskNode=(Get-Command node).Source
if(!(Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue)){
 Start-Process $taskNode -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1') -WorkingDirectory (Join-Path $taskRoot 'admin') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot '.runtime/admin.log') -RedirectStandardError (Join-Path $taskRoot '.runtime/admin-error.log') | Out-Null
}
if(!(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)){
 Start-Process $taskNode -ArgumentList @('node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--host','127.0.0.1') -WorkingDirectory (Join-Path $taskRoot 'miniapp') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot '.runtime/miniapp.log') -RedirectStandardError (Join-Path $taskRoot '.runtime/miniapp-error.log') | Out-Null
}
Write-Host 'Waiting for the API and both frontends to become ready...'
$taskDeadline=(Get-Date).AddSeconds(60)
$taskReady=$false
do {
 try {
  $taskHealth=Invoke-RestMethod 'http://127.0.0.1:8080/food/app/config' -TimeoutSec 2
  if($taskHealth.code -eq 200 -and $taskHealth.data.brand){
   $taskMini=Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2
   $taskAdmin=Invoke-WebRequest 'http://127.0.0.1:5174' -UseBasicParsing -TimeoutSec 2
   $taskReady=($taskMini.StatusCode -eq 200 -and $taskAdmin.StatusCode -eq 200)
  }
 } catch { $taskReady=$false }
 if(!$taskReady){Start-Sleep -Seconds 1}
} until($taskReady -or (Get-Date) -ge $taskDeadline)
if(!$taskReady){throw 'Services did not become ready within 60 seconds. Check .runtime logs and port conflicts.'}
Write-Host 'Services ready. Miniapp: http://127.0.0.1:5173  Admin: http://127.0.0.1:5174'
