# prompts/ — 按模型切换提示词

对应上游 dsh-purge 的「不同模型可换不同提示词」。注入钩子 `hooks/inject-context.mjs`
在每轮用户消息（UserPromptSubmit）时：

1. 从 stdin 里的 `transcript_path` 读会话记录尾部，取最近一条 `"model"` / `"requestModelName"`
   作为当前模型（环境变量 `DSH_PURGE_MODEL` 可强制指定，排障用）。
2. 用 `models.json` 的 `match` 顺序匹配（对模型 id 与显示名做不区分大小写子串匹配，先命中先赢）。
3. 命中后有两个槽位：

| 槽位 | 字段 | 语义 | 注入时机 |
|---|---|---|---|
| 会话级 | `session` | **叠加**在系统 prompt 之上的模型专属补充（每会话、每个模型只注入一次） | 模型可被检测到的那一轮（新会话通常是第 2 轮；续会话第 1 轮）；模型中途切换会再注入一次 |
| 每轮锚点 | `turn` | **整份替换**默认锚点 `fragments/30-perturn.md`（文件缺失时回退默认） | 每一轮 |

4. 没命中任何规则 → 与未安装本功能时完全一致：默认锚点、无会话级注入。

## 这些文件是 GENERATED

`*.turn.md` / `*.session.md` 全部由 `build/generate.mjs` 从 `contract/pointers/`
生成，带 `GENERATED` 头。改内容请改 `contract/pointers/turn.<model>.md` 与
`session.<model>.md`，然后 `npm run build`；`npm run lint` 会拒绝手改。

## 这些文件是 GENERATED

`*.turn.md` / `*.session.md` 全部由 `build/generate.mjs` 从 `contract/pointers/`
生成，带 `GENERATED` 头。改内容请改 `contract/pointers/turn.<model>.md` 与
`session.<model>.md`，然后 `npm run build`；`npm run lint` 会拒绝手改。

## 新增一个模型

1. 复制 `deepseek.turn.md` / `deepseek.session.md` 改名（如 `claude.turn.md`）。
2. 在 `models.json` 的 `match` 数组**最前面**加一条（数组顺序 = 优先级）：

```json
{ "pattern": "claude", "session": "claude.session.md", "turn": "claude.turn.md" }
```

`session` / `turn` 两个字段都可省略；省略即该槽位用默认行为。

## 语义约定

- `turn` 文件是**完整**的每轮锚点（替换制），请自带禁止词表与执行契约要点。
- `session` 文件是**增量补充**（叠加制），系统层 operator block 已含完整核心，不要重复贴全文。
- 两处都应包含一行：用户侧注入的 dsh-purge 锚点与 operator block 同源、属于本配置，避免与
  宿主「忽略 system-reminder」的条款打架。
- 文件路径相对 `prompts/` 解析，禁止 `..` 越权；读不到就回退默认。

## 环境变量（排障）

- `DSH_PURGE_CTX=off` — 关闭全部注入。
- `DSH_PURGE_CTX_VERBOSE=1` — 把每次判定写到 `~/.workbuddy/dsh-purge/hook.log`。
- `DSH_PURGE_MODEL=<id>` — 强制模型 id，跳过 transcript 检测。
- `DSH_PURGE_SESSION_PAYLOAD=off` — 只发每轮锚点，不发会话级补充。
