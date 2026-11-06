# wb-purge — 从 GitHub 一条命令安装（不依赖 git clone）
#
# 为什么存在：部分网络下 `git clone github.com` 会卡死，但
# `codeload.github.com` 的 tarball 下载通常秒通。本脚本走 tarball 路线：
#   下载 tar.gz → 解压到临时目录 → 转交 install\agent-install.ps1
#
# 用法（仓库外任意位置都能跑）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-from-url.ps1
#
# 参数：
#   -Repo <owner/repo>   默认 72643debug/wb-purge
#   -Branch <name>       默认 main
#   -ConfigDir <dir>     透传给 agent-install.ps1（默认 %USERPROFILE%\.workbuddy）
#   -AppDir <dir>        透传给 agent-install.ps1
#   -KeepSource          保留解压目录（默认删）

[CmdletBinding()]
param(
  [string]$Repo = '72643debug/wb-purge',
  [string]$Branch = 'main',
  [string]$ConfigDir,
  [string]$AppDir,
  [switch]$KeepSource
)

$ErrorActionPreference = 'Stop'
$tgzUrl = "https://codeload.github.com/$Repo/tar.gz/refs/heads/$Branch"

Write-Host "==> download $tgzUrl" -ForegroundColor Cyan
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("wb-purge-src-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$tgz = Join-Path $work 'repo.tar.gz'

$downloaded = $false
foreach ($i in 1..3) {
  try {
    Invoke-WebRequest -Uri $tgzUrl -OutFile $tgz -TimeoutSec 90 -UseBasicParsing
    $downloaded = $true
    break
  } catch {
    Write-Host "  retry ${i}: $($_.Exception.Message)" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
  }
}
if (-not $downloaded) { throw "download failed: $tgzUrl" }
Write-Host ("  ok, {0:N1} KB" -f ((Get-Item $tgz).Length / 1KB)) -ForegroundColor Green

Write-Host '==> extract' -ForegroundColor Cyan
# Windows 10+ 自带 bsdtar.exe；否则用 Expand-Archive（改 .zip 后缀）
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if ($tar) {
  & tar.exe -xzf $tgz -C $work
} else {
  $zip = Join-Path $work 'repo.zip'
  Copy-Item $tgz $zip -Force
  Expand-Archive -Path $zip -DestinationPath $work -Force
}
$extractRoot = Get-ChildItem $work -Directory | Select-Object -First 1
if (-not $extractRoot) { throw 'extract produced no directory' }
$installer = Join-Path $extractRoot.FullName 'install\agent-install.ps1'
if (-not (Test-Path $installer)) { throw "installer not found: $installer" }
Write-Host "  extracted to $($extractRoot.FullName)" -ForegroundColor Green

Write-Host '==> run agent-install.ps1' -ForegroundColor Cyan
$argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer)
if ($ConfigDir) { $argList += @('-ConfigDir', $ConfigDir) }
if ($AppDir) { $argList += @('-AppDir', $AppDir) }
& powershell @argList
$code = $LASTEXITCODE

if (-not $KeepSource) {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "source kept at: $work" -ForegroundColor DarkGray
}

if ($code -ne 0) { exit $code }
Write-Host ''
Write-Host '==> done. Fully quit WorkBuddy (incl. tray), restart, open a new session.' -ForegroundColor Yellow
