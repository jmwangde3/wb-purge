# dsh-purge (WorkBuddy port) — 应用
# 用法：
#   .\apply.ps1                       # 自动探测 ~/.workbuddy 与 WorkBuddy 安装目录
#   .\apply.ps1 -ConfigDir "D:\wb" -AppDir "D:\001installation_package\WorkBuddy"
[CmdletBinding()]
param(
  [string]$ConfigDir,
  [string]$AppDir,
  [string]$NodeExe
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$purge = Join-Path $here 'purge.mjs'
if (-not (Test-Path $purge)) { throw "purge.mjs 缺失: $purge" }

$node = if ($NodeExe) { $NodeExe } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) {
  $guess = 'D:\installation package\nodejs\node.exe'
  if (Test-Path $guess) { $node = $guess } else { throw '找不到 node.exe，用 -NodeExe 指定' }
}

$argv = @($purge, 'apply')
if ($ConfigDir) { $argv += @('--config-dir', $ConfigDir) }
if ($AppDir)    { $argv += @('--app-dir', $AppDir) }
if ($NodeExe)   { $argv += @('--node', $NodeExe) }

& $node @argv
exit $LASTEXITCODE
