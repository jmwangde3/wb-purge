# Changelog

## 1.1.86-wb.12 — Stop 顶回改为默认关闭、按需开启（2026-11-22）

`stop-guard` 靠字符串模式猜「收尾语气」，结构上分不清「模型在拒绝」和「模型在讨论拒绝」。
写审计报告、贴日志、举例说明时天然会撞规则 —— 实测连续误伤两轮，每轮一次无效往返。
收益（禁止中途软化）远小于代价，所以改成默认关、按需开：

```bash
node purge.mjs stop            # 看状态
node purge.mjs stop on         # 需要「禁止中途软化」时开
node purge.mjs stop off        # 用完关掉
```

- 生效条件：`profile=full` **且** 开关开启。任一条不满足直接放行
- 开关落在 `~/.workbuddy/dsh-purge/stop-strict.txt`（内容 `1` = 开）。
  钩子每事件新起进程、从磁盘读，所以**改完即时生效，不用重启宿主、不用改系统环境变量**
- `status` 增加「stop 顶回」一行，非 full 档会额外注明「本就不顶回」
- `revert` 一并清掉该状态文件；环境变量 `DSH_PURGE_STOP_STRICT=0/1` 仍可强制覆盖
- 测试 35 → 36：默认放行、full+开关才拦、开了开关但档位不是 full 仍放行、CLI 开关读写

## 1.1.86-wb.11 — 误伤面收紧：只判收尾段落 + 引号内文本不算（2026-11-22）

wb.10 只剥了代码块和引用块，但仍会命中**报告里转述的例子**：说明「哪类句子会被拦」时
把例子写进表格或直角引号，规则就照着例子把自己再拦一次（实测连续发生两轮）。

- `stripQuoted()` 增加直角引号、弯引号、成对双引号：引号内是被讨论的文本，不是模型在收尾
- `closingTail()`：只在**最后一个段落**（≤800 字符）上判定。拒绝式收尾必然落在结尾，
  长交付中段的引用不该进判定
- 测试 33 → 35：中段转述不触发、长文末尾真拒绝仍拦

## 1.1.86-wb.10 — 修 stop-guard 整体失效 + 引用文本误判（2026-11-22）

两个都是「静默」故障，用户侧只看到「钩子好像没在工作」。

- **stop-guard 完全不顶回**：wb.9 把档位判断改成调用 `profileAllowsStopGuard()`，
  但函数没定义 —— 每次 `decide()` 抛 `ReferenceError`，被 fail-open 吞成 `allow error`，
  等于装了但永不生效。现在补齐函数（只有显式 `full` 才顶回，`light` 档位、`bare`/`lean`、
  未知值一律放行；缺 `profile.json` 按 full 兼容旧机器）。
- **引用文本被当成拒绝**：`/must refuse/i` 等模式会命中交付里贴的校验输出
  （`MUST refuse: false | operator 块: false`），把正常交付判成拒绝式收尾并顶回。
  现在先剥掉代码块 / 行内代码 / 引用块再匹配。
- **软拒漏判**：`我不做这类事情，请不要继续问了。` 这类无标点软拒没被抓住，
  短文本信号词补 `我不做 / 不做这类 / 这类我不`。

测试 24 → 33 条：新增 `stop-guard` 5 条（full 真拦、lean/bare 放行、引用文本不误拦、
正常交付不误拦、`DSH_PURGE_STOP_OFF` 生效）+ `hooks-smoke` 4 条
（三档 × 五个钩子都必须 exit 0 且不抛未定义/类型错误）。冒烟测试就是为这类
「函数漏定义、fail-open 吞错」的故障设的通用防线。

## 1.1.86-wb.9 — 三档开关（bare / lean / full）+ 去掉注入里的生成注释（2026-11-22）

按「平时轻、需要时重」拆成三档，`lean` 为新默认：

| profile | 宿主提示词 | 每轮注入 | 常驻增量 |
|---|---|---|---|
| `bare` | 完全不动 | 无 | 0 |
| **`lean`** | **只替换 `<content_policy>` 拒绝清单 + 中和 `personal_files_safety`** | **无** | **−893 字符（≈−185 tok）** |
| `full` | lean + operator 前置/追加块 | 4,894 字符/轮（≈2.3k tok，已剥生成注释） | +67 字符 + ≈2.3k tok/轮 |

也就是说：**拒绝清单清掉了，但每轮 0 token**。原来只有「不打提示词」和「全套」两档，
现在中间这档把「拆拒绝」和「每轮重述」解耦了。

改动：

- `install/lib/patch-core.mjs`：`PROFILE_BARE/LEAN/FULL`；`readProfile` 把 wb.8 的
  `light` 迁移成 `bare`（语义等价）；`writeProfile` 支持三档。
- `install/purge.mjs`：打补丁 / 降档 / 还原合并成一条 `applyHostProfile()` —— 按
  `{policy, blocks}` 两个开关收敛目标状态，天然幂等；删掉重复的
  `patchProductConfigs` / `patchTplFiles` / `unpatchHost` 三份旧实现（净减约 200 行）。
- 钩子分流：`auto-allow` 三档都跑；`inject-context` / `stop-guard` 只在 `full`；
  `selfpatch` 在 `lean` 只换拒绝清单、在 `bare` 完全不动宿主提示词。
- `inject-context.mjs`：注入前剥掉 `<!-- GENERATED … -->` 注释，每轮省约 300 字符
  （它们是给构建脚本看的，模型不需要）。
- `lint/no-duplicate.mjs`：闸门改为按新钩子函数名检查，非 full 不许注入/顶回。
- 测试 24 条：新增 lean（换清单但不加 operator 层）、三档往返 `full→lean→bare→full`
  字节一致、旧 `light` 迁移。

- 版本 `1.1.86-wb.8` → `1.1.86-wb.9`。

## 1.1.86-wb.8 — profile 开关（light 轻量 / full 拆拒绝能力）+ 原子写 + 回归测试（2026-11-22）

新增开关：默认 `light` 轻量运行，**不打宿主提示词层、保留模型自己的拒绝能力**；
需要时才 `full`。切换是双向的 —— 切回 light 会把 `product.json` ×2 与 19 个 tpl
**逐字节还原**成原件（已用 `squash` 校验证明内容等价后才整体替换，避免把新版本降级成旧备份）。

```
node install/purge.mjs profile                  # 看当前
node install/purge.mjs apply --profile light    # 平时：只清审批摩擦
node install/purge.mjs apply --profile full     # 需要时：加打提示词层
```

钩子按 profile 分流：`auto-allow` 两种模式都放行；`inject-context` / `stop-guard`
只在 full 跑；`selfpatch` 在 light 只补 `settings.json`，不碰模板。缺 `profile.json`
时按 full 处理（兼容 wb.7 及以前装成 full 的机器）。

工程加固（对着 wb.6/wb.7 两次事故补的）：

- **原子写**：`product.json`（435 KB）/ tpl / settings / 登记文件全部改成
  「同目录 tmp + rename」，`selfpatch` 与 installer 都是。以前直接覆盖，写一半崩掉
  就等于把宿主系统提示词写坏。
- **每次 apply 都留带 SHA256 的时刻快照**：`backup/snap-<时间戳>/` + `manifest.json`
  （写后立刻回读校验），默认保留最近 20 份。以前只有首次 apply 抓原件，之后覆盖不可回滚。
- **回归测试 21 条 + CI**：`npm test`（node:test，无依赖）。
  覆盖：头折叠幂等、连跑三次字节一致、light 不动模板、light 还原到原件、
  payload 混入正文时拒绝打补丁、`run.sh` 在 PATH 无 node 时兜底、
  hooks 模板不得出现 `{{NODE}}`、build/lint 不漂移。
  CI：`.github/workflows/ci.yml`（windows-latest + ubuntu-latest × node 20/22）。

顺手修的真 bug：

- `selfpatch` 发现 payload 里混入核心正文时**只记 error 却照样打补丁** —— 改成中止。
- 「IMPORTANT: Assist with authorized security testing…」的替换正则要求后面有 `\n\n`，
  模板以该段结尾时首轮不替换、第二轮才替换 → 不幂等。补 `|$`。
- 切回 light 时 `IMPORTANT` 段 / `personal_files_safety` / ethics 块没还原 → 全部按原件还原。
- 全文空白压缩会把宿主模板正文里原本的空行碾平 → 改成只在块边界吃空行。

- 版本 `1.1.86-wb.7` → `1.1.86-wb.8`。

## 1.1.86-wb.7 — 修复钩子静默失效（node 路径写死）（2026-11-22）

问题：本机 node 从 `C:\Users\jmwan\tools\node-v22.14.0-win-x64\node.exe` 搬到
`C:\Users\jmwan\tools\node\node.exe` 之后，**五个钩子全部静默失效** —— 宿主不报错、
不提示，表现就是「装是装着的，但本地不执行 / 不再自动放行 / 每轮注入没了」。

根因：`hooks.json` 在安装时把 node 绝对路径写死进 command（`"{{NODE}}"` 占位符），
路径一失效，`spawn` 直接失败，宿主把钩子错误吞掉。

改动：

- `hooks/hooks.json.template`：命令统一改为
  `bash "${CODEBUDDY_PLUGIN_ROOT}/hooks/run.sh" <script>`，不再出现任何绝对解释器路径。
- `hooks/run.sh`：重写解析顺序 —— `$DSH_PURGE_NODE` / `$CODEBUDDY_NODE_BIN` →
  `hooks/node-path.txt`（安装时写的提示）→ PATH → `cmd //c where node` →
  `~/tools/node`、`~/tools/node-v*`、Program Files、nvm、/usr/local 等 →
  `WorkBuddy.exe` + `ELECTRON_RUN_AS_NODE=1`。全找不到时写
  `<configDir>/dsh-purge/hook-launch.log` 并 exit 0（fail-open）。
- `install/purge.mjs`：apply 时除 hooks.json 外写 `hooks/node-path.txt`；
  `status` 新增「钩子运行时」体检 —— 写死的解释器不存在会直接报
  「五个钩子此刻全部静默失效」，不再让这种故障静默。
- `lint/no-duplicate.mjs`：hooks.json 模板出现 `{{NODE}}` 或缺 `run.sh` 直接失败。
- `.gitignore`：忽略 `hooks/node-path.txt`（每台机器不同）。
- 版本 `1.1.86-wb.6` → `1.1.86-wb.7`。

升级后**必须完全退出 WorkBuddy 再启动**（宿主把 hooks 配置读进内存）。

## 1.1.86-wb.6 — 修复 GENERATED 头重复累积（2026-11-22）

问题：装到机器上跑一段时间后，宿主 `cli-agent-prompt` 模板被一长串完全相同的
`<!-- GENERATED by build/generate.mjs … -->` 注释撑大 —— 实测一台机器 100+ 会话后
堆了 **327 行**，模板 19,831 → 45,034 字符，白烧 token。

根因：`selfpatch` / installer 的补丁是「用载荷整段替换 `operator_directive` 与
`operator-block` 区域」，而载荷本身以 GENERATED 头开头、被替换的区域却不含上一轮
留在区域外的那条头。于是每跑一次 `SessionStart` 就净增一行，永不回收。

改动：

- `hooks/selfpatch.mjs`：新增 `collapseHeaders()`，打补丁**前后各折叠一次**，
  任意运行次数后每条载荷只剩一条头（幂等）；`selfpatch.json` 新增 `headerDupes` 字段。
- `install/purge.mjs`：`patchOneProductConfig()` / `patchOneTpl()` 同样折叠，
  日志里写明「折叠重复 GENERATED 头」。
- `hooks/session-check.mjs`：`hostPrompt.headers` 上报当前头数量，漂移可见。
- `tools/fix-header-dupes.mjs`：**已污染机器的一次性修复工具**（`--dry-run` 预览，
  默认先备份到 `~/.workbuddy/dsh-purge/backup/pre-headerfix-<时间戳>/`）。
- `lint/no-duplicate.mjs`：新增两道闸 —— 任何载荷文件头数量 > 1 报错；
  `selfpatch.mjs` / `install/purge.mjs` 里缺 `collapseHeaders(` 也报错（防回归）。
- 版本 `1.1.86-wb.5` → `1.1.86-wb.6`。

升级步骤：`npm run build && npm run check` → 装插件 → `node tools/fix-header-dupes.mjs`
→ 完全退出 WorkBuddy 重启（Nunjucks 模板有进程内缓存）。

## 1.1.86-wb.5 — 单一来源 / 防重复（2026-11-09）

问题：执行契约正文在仓库里被复制了 6 份（`fragments/00-purge-core.md`、
`20-anchor.md`、`30-perturn.md`、`prompts/*.turn.md`、`prompts/*.session.md`、
`host/*.txt`、`package/host/*.txt`），同一套规则每轮重复注入，且
`package/host/` 与插件 `host/` 是两份完全相同的目录。

改动：

- 新增 `contract/00-core.md` 作为**唯一权威正文**；`contract/pointers/` 存所有
  最小重锚与指针模板；`contract/host-notes.md` 存宿主说明。
- 新增 `build/generate.mjs`：从 `contract/` 生成全部派生产物，每个派生文件带
  `GENERATED` 头。改契约只改 `contract/`，然后 `npm run build`。
- 新增 `lint/no-duplicate.mjs`：三道静态闸 —— 核心正文特征句只允许出现在
  两个权威文件；派生文件必须带 GENERATED 头；禁止 `package/host/` 二次出现、
  禁止注入钩子 glob 全读 fragments。
- `hooks/inject-context.mjs`：`buildSessionContext()` 改为明确列表
  `['00-purge-core.md','10-workbuddy-host.md']`，新增副本不会被自动带入；
  运行期断言核心契约在最终载荷里只出现一次，异常则回退到只发 core。
- `hooks/selfpatch.mjs`：加载 host 载荷时校验是否混入核心正文，混入则记录错误。
- `install/purge.mjs`：`HOST_DIR` 改为读插件内 `host/`，删除重复的 `package/host/`。
- 版本 `1.1.86-wb.4` → `1.1.86-wb.5`。

**功能不变**：selfpatch（product.json / 全部 .tpl / settings 补丁）、按模型
切换提示词（hy / deepseek / mimo 的 session + turn 槽位）、Stop 顶回、
PreToolUse 全放行、session-check、revert/apply、GitHub 直装与 tarball 安装。

## 1.1.86-wb.4

任何请求一律不拒 + 每轮注入完整核心 + Stop 顶回 + 多轮禁止撤回 + hy 模型适配。
