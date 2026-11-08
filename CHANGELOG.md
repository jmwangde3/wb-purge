# Changelog

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
