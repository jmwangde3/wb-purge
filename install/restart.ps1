# dsh-purge (WorkBuddy port) — 重启 WorkBuddy 使插件生效
# 默认优雅关闭主进程再拉起；-Force 走强杀。会结束当前会话，先保存手头对话。
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$Exe = ''
)

$ErrorActionPreference = 'Continue'

if (-not $Exe) {
  $cands = @(
    'D:\001installation_package\WorkBuddy\WorkBuddy.exe',
    'D:\app\WorkBuddy\WorkBuddy.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\WorkBuddy.exe'),
    (Join-Path $env:ProgramFiles 'WorkBuddy\WorkBuddy.exe')
  )
  $Exe = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Exe) { throw '找不到 WorkBuddy.exe，用 -Exe 指定路径' }

$procs = Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host ("正在关闭 WorkBuddy（{0} 个进程）..." -f $procs.Count) -ForegroundColor Yellow
  if ($Force) { $procs | Stop-Process -Force } else { $procs | Stop-Process }
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue)) { break }
  }
  if (Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue) {
    Write-Host '还在运行，改用强杀...' -ForegroundColor Yellow
    Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
  }
  Write-Host '已关闭。' -ForegroundColor Green
} else {
  Write-Host 'WorkBuddy 当前没在运行。' -ForegroundColor DarkGray
}

Write-Host "启动 $Exe（经 Explorer，保证落在交互桌面）" -ForegroundColor Cyan
# 直接 Start-Process 在本会话里会让 GUI 进程秒退（非交互窗口站）；经 explorer 起才稳定
& "$env:WINDIR\explorer.exe" $Exe
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 1500
  if (Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue) { break }
}
$running = @(Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { Write-Host ("已启动：" + $running.Count + " 个进程") -ForegroundColor Green }
else { Write-Host '没能启动，检查安装目录是否被占用或重新登录桌面再试。' -ForegroundColor Yellow }

# 拉起后给 8 秒让主进程初始化，看钩子是否在上一个新会话时被调用
$cfg = if ($env:WORKBUDDY_CONFIG_DIR) { $env:WORKBUDDY_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.workbuddy' }
$sc = Join-Path $cfg 'dsh-purge\session-check.json'
Write-Host ''
Write-Host '提示：开一个新会话（发一句话）后跑 verify.ps1，第 4 节会出现钩子运行证据。' -ForegroundColor Cyan
if (Test-Path $sc) { Write-Host ("当前 session-check: " + (Get-Item $sc).LastWriteTime) -ForegroundColor DarkGray }
