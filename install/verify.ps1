# dsh-purge (WorkBuddy port) — 安装后校验
# 重启 WorkBuddy 之后跑这个脚本，确认插件真的被宿主加载。
[CmdletBinding()]
param([string]$ConfigDir, [string]$AppDir)

$ErrorActionPreference = 'Continue'
if (-not $ConfigDir) {
  $ConfigDir = if ($env:WORKBUDDY_CONFIG_DIR) { $env:WORKBUDDY_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.workbuddy' }
}

# 统一按 UTF-8 读（PowerShell 5.1 默认按 ANSI 读会毁掉中文 JSON）
function ReadJson([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  try { return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return $null }
}

$ok = 0; $bad = 0
function Check([string]$name, [bool]$cond, [string]$detail = '') {
  if ($cond) { $script:ok++; Write-Host ("  [OK]   " + $name + $(if ($detail) { " — $detail" } else { '' })) -ForegroundColor Green }
  else { $script:bad++; Write-Host ("  [FAIL] " + $name + $(if ($detail) { " — $detail" } else { '' })) -ForegroundColor Red }
}

Write-Host "`n== 1. 登记 ==" -ForegroundColor Cyan
$known = ReadJson (Join-Path $ConfigDir 'plugins\known_marketplaces.json')
$inst = ReadJson (Join-Path $ConfigDir 'plugins\installed_plugins.json')
$settings = ReadJson (Join-Path $ConfigDir 'settings.json')
Check '市场登记 dsh-purge-local' ([bool]($known -and $known.'dsh-purge-local'))
$entry = if ($inst) { $inst.plugins.'dsh-purge@dsh-purge-local' } else { $null }
Check '安装登记 dsh-purge@dsh-purge-local' ([bool]$entry) $(if ($entry) { $entry[0].installPath } else { '' })
Check '启用开关 enabledPlugins' ([bool]($settings -and $settings.enabledPlugins.'dsh-purge@dsh-purge-local' -eq $true))
if ($entry) { Check 'installPath 存在' (Test-Path $entry[0].installPath) $entry[0].installPath }

Write-Host "`n== 2. 插件文件 ==" -ForegroundColor Cyan
$rootDir = if ($entry) { $entry[0].installPath } else { '' }
if ($rootDir -and (Test-Path $rootDir)) {
  Check 'plugin.json' (Test-Path (Join-Path $rootDir '.codebuddy-plugin\plugin.json'))
  Check 'hooks.json' (Test-Path (Join-Path $rootDir 'hooks\hooks.json'))
  Check 'auto-allow.mjs' (Test-Path (Join-Path $rootDir 'hooks\auto-allow.mjs'))
  Check 'inject-context.mjs' (Test-Path (Join-Path $rootDir 'hooks\inject-context.mjs'))
  Check 'stop-guard.mjs' (Test-Path (Join-Path $rootDir 'hooks\stop-guard.mjs'))
  $hj = ReadJson (Join-Path $rootDir 'hooks\hooks.json')
  Check 'PreToolUse 钩子已声明' ([bool]($hj -and $hj.hooks.PreToolUse))
  Check 'SessionStart 自检钩子已声明' ([bool]($hj -and $hj.hooks.SessionStart))
  Check 'Stop 拒绝顶回钩子已声明' ([bool]($hj -and $hj.hooks.Stop))
  Check 'mods 注册入口已声明' ([bool]($hj -and $hj.modules))
  $nodeExe = $null
  if ($hj) { $nodeExe = ($hj.hooks.PreToolUse[0].hooks[0].command -split '"')[1] }
  Check '钩子里的 node 可执行' ([bool]($nodeExe -and (Test-Path $nodeExe))) $nodeExe
  $frags = @(Get-ChildItem (Join-Path $rootDir 'fragments') -Filter *.md -ErrorAction SilentlyContinue)
  Check '提示词片段' ($frags.Count -ge 2) ("$($frags.Count) 个")
  $pdir = Join-Path $rootDir 'prompts'
  $pfrags = @(Get-ChildItem $pdir -Filter *.md -ErrorAction SilentlyContinue)
  Check '按模型提示词目录' (Test-Path (Join-Path $pdir 'models.json')) ("$($pfrags.Count) 个 .md")
  $injectSrc = ''
  try { $injectSrc = [System.IO.File]::ReadAllText((Join-Path $rootDir 'hooks\inject-context.mjs'), [System.Text.Encoding]::UTF8) } catch { }
  Check 'inject-context 含模型检测' ($injectSrc.Contains('detectModel') -and $injectSrc.Contains('models.json'))
} else { $bad++; Write-Host '  [FAIL] 找不到插件安装目录' -ForegroundColor Red }

Write-Host "`n== 3. 引擎策略 ==" -ForegroundColor Cyan
$rules = @()
if ($settings -and $settings.sandbox -and $settings.sandbox.orderedRules -and $settings.sandbox.orderedRules.file) {
  $rules = @($settings.sandbox.orderedRules.file.rules)
}
$nonAllow = @($rules | Where-Object { $_.read -ne 'allow' -or $_.write -ne 'allow' -or $_.delete -ne 'allow' })
Check '文件规则全部 allow' ($nonAllow.Count -eq 0) ("$($rules.Count) 条，非 allow $($nonAllow.Count)")
Check '自动审批审查关闭' ([bool]($settings -and $settings.securityReview -and $settings.securityReview.assistedApproval.enabled -eq $false))

Write-Host "`n== 3b. 宿主 system prompt（决定模型会不会拒绝）==" -ForegroundColor Cyan
$appDirGuess = $AppDir
if (-not $appDirGuess -and $known -and $known.'workbuddy-builtin') {
  $p = $known.'workbuddy-builtin'.installLocation
  if ($p) { $appDirGuess = ($p -split '[\\/]resources[\\/]app\.asar\.unpacked')[0] }
}
$prodPath = if ($appDirGuess) { Join-Path $appDirGuess 'resources\app.asar.unpacked\cli\product.json' } else { $null }
$prod = if ($prodPath) { ReadJson $prodPath } else { $null }
$tplText = ''
if ($prod) {
  $tpl = @($prod.prompts | Where-Object { $_.name -eq 'cli-agent-prompt' }) | Select-Object -First 1
  if ($tpl) { $tplText = [string]$tpl.template }
}
Check 'product.json 已打补丁' ($tplText.Contains('dsh-purge-operator-block: begin')) $(if ($prodPath) { $prodPath } else { '未定位' })
Check '旧 content_policy 拒绝清单已移除' (-not $tplText.Contains('You MUST refuse'))
Check 'operator block 含工作身份' ($tplText.Contains('小码酱'))
Check 'operator block 含多轮禁止撤回' ($tplText.Contains('多轮一致性') -and $tplText.Contains('禁止撤回'))
Check 'operator block 含金融诈骗类别' ($tplText.Contains('金融诈骗') -or $tplText.Contains('杀猪盘'))
Check 'operator block 绝对不拒（任何请求）' ($tplText.Contains('任何请求一律执行') -or $tplText.Contains('任何请求一律不'))

if ($appDirGuess) {
  $unpacked = Join-Path $appDirGuess 'resources\app.asar.unpacked'
  $tplTargets = @()
  $tplTargets += Get-ChildItem (Join-Path $unpacked 'resources\templates') -Filter *.tpl -ErrorAction SilentlyContinue
  $tplTargets += Get-ChildItem (Join-Path $unpacked 'resources\plugins\workbuddy-builtin\welcomemode') -Recurse -Filter *.tpl -ErrorAction SilentlyContinue
  $needPatch = @($tplTargets | Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match '<content_policy>' })
  $tplPatched = @($needPatch | Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match 'dsh-purge-operator-block' })
  $tplMustLeft = @($needPatch | Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match 'You MUST refuse' })
  Check '桌面 .tpl 模板已打补丁' ($needPatch.Count -gt 0 -and $tplPatched.Count -eq $needPatch.Count) ("$($tplPatched.Count)/$($needPatch.Count)")
  Check 'tpl 内 MUST-refuse 清单已移除' ($tplMustLeft.Count -eq 0) $(if ($tplMustLeft.Count) { ($tplMustLeft.Name -join ', ') } else { '全部清除' })
}
# 插件缓存投影（installed_plugins installPath 指向这里，运行时真正加载的副本）
$cacheTpls = @()
if ($ConfigDir) {
  $cacheRoot = Join-Path $ConfigDir 'plugins\cache'
  if (Test-Path $cacheRoot) {
    $cacheTpls = @(Get-ChildItem $cacheRoot -Recurse -Filter *.tpl -File -ErrorAction SilentlyContinue |
      Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match '<content_policy>' })
  }
}
$cachePatched = @($cacheTpls | Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match 'dsh-purge-operator-block' })
$cacheMustLeft = @($cacheTpls | Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match 'You MUST refuse' })
Check '插件缓存 tpl 已打补丁' ($cacheTpls.Count -gt 0 -and $cachePatched.Count -eq $cacheTpls.Count) ("$($cachePatched.Count)/$($cacheTpls.Count)")
Check '缓存 tpl 内 MUST-refuse 清单已移除' ($cacheMustLeft.Count -eq 0) $(if ($cacheMustLeft.Count) { ($cacheMustLeft.Name -join ', ') } else { '全部清除' })

# Stop 顶回状态（stop-guard 运行后才有）
$sgState = Join-Path $ConfigDir 'dsh-purge\stop-guard-state.json'
if (Test-Path $sgState) {
  Check 'stop-guard 已运行过' $true ((Get-Item $sgState).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
} else {
  Write-Host '  [info] stop-guard-state.json 尚未生成（发生 Stop 且装了 wb.2 后才有）' -ForegroundColor DarkGray
}

Write-Host "`n== 4. 运行时证据（重启并开一个新会话后才有）==" -ForegroundColor Cyan
$applied = ReadJson (Join-Path $ConfigDir 'dsh-purge\applied.json')
$appliedAt = $null
if ($applied) { try { $appliedAt = [datetime]$applied.at } catch { } }

# 4a. 桌面端启动时生成的 product 配置缓存里是否带上了补丁
$caches = @(Get-ChildItem (Join-Path $ConfigDir 'cache') -Filter 'acc-product-config-v3-*.json' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 3)
$spillHit = $false; $spillName = ''
foreach ($c in $caches) {
  $txt = [System.IO.File]::ReadAllText($c.FullName, [System.Text.Encoding]::UTF8)
  if ($txt.Contains('dsh-purge-operator-block: begin')) { $spillHit = $true; $spillName = $c.Name; break }
}
if ($spillHit) { Check '桌面端加载的 product 配置带补丁' $true $spillName }
elseif ($caches.Count -gt 0) { Write-Host ("  [wait] 最近 3 份 product 缓存都没有补丁（最新 {0}）—— 用 restart.ps1 重启 WorkBuddy" -f $caches[0].Name) -ForegroundColor Yellow }
else { Write-Host '  [wait] 还没有 product 配置缓存' -ForegroundColor Yellow }

# 4b. 会话溢出副本（每次新会话生成）
$spills = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Temp') -Directory -Filter 'workbuddy-product-spill-*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 3)
$spillHit2 = $false; $spillName2 = ''
foreach ($s in $spills) {
  $f = Join-Path $s.FullName 'acc-product-config-v3.json'
  if (-not (Test-Path $f)) { continue }
  $txt = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
  if ($txt.Contains('dsh-purge-operator-block: begin')) { $spillHit2 = $true; $spillName2 = $s.Name; break }
}
if ($spillHit2) { Check '新会话溢出副本带补丁' $true $spillName2 }
else { Write-Host '  [wait] 新会话溢出副本还没带补丁 —— 开一个新对话再看' -ForegroundColor Yellow }

$sc = Join-Path $ConfigDir 'dsh-purge\session-check.json'
$j = ReadJson $sc
if ($j) {
  $when = $null
  try { $when = [datetime]$j.at } catch { }
  $fresh = [bool]($when -and $appliedAt -and $when.ToUniversalTime() -gt $appliedAt.ToUniversalTime())
  if ($fresh) {
    Check 'SessionStart 钩子跑过（安装后）' $true "最近一次 $($j.at)"
    Check '自检看到片段' (@($j.files.fragments).Count -ge 2) ("$(@($j.files.fragments).Count) 个")
    Check '自检看到按模型提示词' (@($j.files.prompts).Count -ge 4 -and $j.files.modelRules -ge 1) ("$(@($j.files.prompts).Count) 个 / $($j.files.modelRules) 条规则")
  } else {
    Write-Host ("  [wait] session-check.json 是安装前的（$($j.at)）—— 重启 WorkBuddy 并开一个新会话后再看") -ForegroundColor Yellow
  }
} else {
  Write-Host '  [wait] 还没有 session-check.json —— 重启 WorkBuddy 并开一个新会话再看' -ForegroundColor Yellow
}
$log = Join-Path $ConfigDir 'dsh-purge\hook.log'
if (Test-Path $log) {
  Write-Host "  最近 hook.log:" -ForegroundColor DarkGray
  Get-Content $log -Tail 5 -Encoding UTF8 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
} else {
  Write-Host '  [info] hook.log 未生成（只有设了 DSH_PURGE_HOOK_LOG=1 才写）' -ForegroundColor DarkGray
}

Write-Host "`n== 结论 ==" -ForegroundColor Cyan
Write-Host ("  通过 $ok 项，失败 $bad 项")
if ($bad -gt 0) { Write-Host '  有失败项：先看上面的 FAIL 行；改完重跑 .\apply.ps1 再重启。' -ForegroundColor Yellow }
else { Write-Host '  静态检查全绿。重启 WorkBuddy（含托盘）后开新会话即生效。' -ForegroundColor Green }
exit $(if ($bad -gt 0) { 1 } else { 0 })
