#!/usr/bin/env node
/**
 * dsh-purge (WorkBuddy port) — 提示词层注入钩子（支持按模型切换提示词）。
 *
 * WorkBuddy 只会自动组合 builtin 市场的 fragments（marketplaceName === "workbuddy-builtin"，
 * 且名字以 welcomemode- / interactionmode- 开头或等于 prompt-common），外部插件的
 * fragments/ 不会被自动注入。可用的官方通道是 hooks 的 additionalContext：
 *
 *   UserPromptSubmit  → hookSpecificOutput.additionalContext 每轮用户消息末尾追加
 *                       （见宿主 bundle: hookContexts.userPromptSubmitContext）
 *   SessionStart      → 会话开始注入一次（本插件的 SessionStart 钩子跑 session-check，
 *                       会话级提示词改在首次可检测模型的 UserPromptSubmit 轮注入，见下）
 *
 * 用法：
 *   node inject-context.mjs session   # 手动自测：全量核心指令（+ 强制模型时的会话补充）
 *   node inject-context.mjs prompt    # 宿主 UserPromptSubmit 调用（读 stdin JSON）
 *
 * stdin JSON（宿主 convertToSdkInput 提供）：
 *   { hook_event_name, session_id, transcript_path, cwd, prompt }
 *
 * 按模型切换（prompts/models.json，对应上游「不同模型可换不同提示词」）：
 *   1. 从 transcript 尾部取最近一条 providerData.model / requestModelName 作为当前模型
 *      （环境变量 DSH_PURGE_MODEL 可强制指定，排障用）；
 *   2. 用 models.json 的 match 顺序做不区分大小写子串匹配，先命中先赢；
 *   3. session 槽位 = 模型会话补充，每 (session, 模型) 只注入一次（叠加在核心之上），
 *      状态存 <configDir>/dsh-purge/model-state.json；模型中途切换会再注入一次；
 *   4. turn 槽位 = 每轮锚点，整份替换默认 fragments/30-perturn.md（文件缺失回退默认）；
 *   5. 没命中任何规则 → 与未安装本功能时完全一致（默认锚点，无会话补充）。
 *
 * 环境变量：
 *   DSH_PURGE_CTX=off            关闭注入（排障用）
 *   DSH_PURGE_CTX_VERBOSE=1      把判定写到 dsh-purge/hook.log
 *   DSH_PURGE_MODEL=<id>         强制模型 id，跳过 transcript 检测
 *   DSH_PURGE_SESSION_PAYLOAD=off  只发每轮锚点，不发会话补充
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const mode = (process.argv[2] || 'session').toLowerCase();
const pluginRoot = process.env.CODEBUDDY_PLUGIN_ROOT || process.env.WORKBUDDY_PLUGIN_ROOT
  || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfgDir = process.env.WORKBUDDY_CONFIG_DIR || process.env.CODEBUDDY_CONFIG_DIR
  || path.join(os.homedir(), '.workbuddy');
const fragDir = path.join(pluginRoot, 'fragments');
const promptDir = path.join(pluginRoot, 'prompts');

const STDIN_TIMEOUT_MS = 1500;
const STDIN_MAX_BYTES = 1024 * 1024;
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

function logLine(text) {
  if (process.env.DSH_PURGE_CTX_VERBOSE !== '1') return;
  try {
    fs.mkdirSync(path.join(cfgDir, 'dsh-purge'), { recursive: true });
    fs.appendFileSync(path.join(cfgDir, 'dsh-purge', 'hook.log'), `${new Date().toISOString()} ctx ${text}\n`, 'utf8');
  } catch { /* ignore */ }
}

function readFragment(name) {
  try { return fs.readFileSync(path.join(fragDir, name), 'utf8').trim(); } catch { return ''; }
}

// ── stdin（宿主为 command 钩子写入 JSON；手动调用时通常无 stdin）──────────
function readStdinJson() {
  return new Promise((resolve) => {
    try {
      if (process.stdin.isTTY) { resolve(null); return; }
    } catch { resolve(null); return; }
    let data = '';
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(data || null), STDIN_TIMEOUT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.length > STDIN_MAX_BYTES) finish(data); // 超限即止，后续解析失败走 fail-open
    });
    process.stdin.on('end', () => finish(data || null));
    process.stdin.on('error', () => finish(data || null));
  });
}

function parseInput(raw) {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

// ── 模型检测：transcript 尾部最近一条 providerData.model ──────────────────
function detectModel(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile() || stat.size === 0) return null;
    const take = Math.min(stat.size, TRANSCRIPT_TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    let text = '';
    try {
      const buf = Buffer.alloc(take);
      fs.readSync(fd, buf, 0, take, stat.size - take);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    const lastId = [...text.matchAll(/"model"\s*:\s*"([^"]+)"/g)].pop();
    const lastName = [...text.matchAll(/"requestModelName"\s*:\s*"([^"]+)"/g)].pop();
    const id = lastId ? lastId[1] : null;
    const name = lastName ? lastName[1] : null;
    if (!id && !name) return null;
    return { id, name };
  } catch {
    return null;
  }
}

// ── models.json 匹配 ──────────────────────────────────────────────────────
function matchModelRule(model) {
  try {
    const cfgPath = path.join(promptDir, 'models.json');
    if (!fs.existsSync(cfgPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const rules = Array.isArray(cfg?.match) ? cfg.match : [];
    const hay = `${model?.id || ''} ${model?.name || ''}`.toLowerCase().trim();
    if (!hay) return null;
    for (const rule of rules) {
      if (rule && typeof rule.pattern === 'string' && rule.pattern
        && hay.includes(rule.pattern.toLowerCase())) {
        return rule;
      }
    }
  } catch { /* fail-open：配置坏 → 走默认 */ }
  return null;
}

function readPromptFile(name) {
  if (typeof name !== 'string' || !name) return '';
  const base = path.resolve(promptDir, name);
  if (base !== promptDir && !base.startsWith(promptDir + path.sep)) return ''; // 禁止 .. 越权
  try { return fs.readFileSync(base, 'utf8').trim(); } catch { return ''; }
}

// ── 会话补充去重状态：每 (session, 模型) 注入一次 ─────────────────────────
function statePath() {
  return path.join(cfgDir, 'dsh-purge', 'model-state.json');
}

function readState() {
  try {
    const j = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch { /* fail-open */ }
}

function modelKeyOf(model) {
  return (model?.id || model?.name || '').toLowerCase();
}

function shouldInjectSessionPayload(state, sessionId, modelKey) {
  if (!sessionId || !modelKey) return false;
  const prev = state[sessionId];
  if (!prev) return true;
  return String(prev.model || '').toLowerCase() !== modelKey; // 模型切换 → 再注入
}

// ── 载荷组装 ──────────────────────────────────────────────────────────────
// 单一来源：只注入权威正文 + 宿主说明。明确列表，不 glob —— 以后往 fragments/
// 放任何新副本都不会被自动带入。改契约请改 contract/ 后跑 npm run build。
const CORE_FRAGMENT = '00-purge-core.md';
const HOST_FRAGMENT = '10-workbuddy-host.md';
const CORE_MARKER = 'PRIME DIRECTIVE';
function buildSessionContext() {
  const parts = [readFragment(CORE_FRAGMENT), readFragment(HOST_FRAGMENT)].filter(Boolean);
  const joined = parts.join('\n\n');
  // 运行期防重复：核心契约在最终载荷里只允许出现一次
  const hits = (joined.match(new RegExp(CORE_MARKER, 'g')) || []).length;
  if (hits !== 1) {
    logLine(`core-count=${hits} -> fallback to core only`);
    return readFragment(CORE_FRAGMENT);
  }
  return joined;
}

function buildPromptAnchor() {
  return readFragment('30-perturn.md') || readFragment('20-anchor.md') || '';
}

function emit(eventName, text) {
  if (!text) { process.exit(0); }
  // 用同步写，避免 process.exit 截断管道缓冲（Windows 下 stdout 是异步 pipe）
  try {
    fs.writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }));
  } catch { /* fail-open */ }
  process.exit(0);
}

async function runPromptMode() {
  const raw = await readStdinJson();
  const input = parseInput(raw);
  const transcriptPath = typeof input?.transcript_path === 'string' ? input.transcript_path : '';
  const sessionId = String(input?.session_id || '')
    || (transcriptPath ? path.basename(transcriptPath, '.jsonl') : '');

  const forced = process.env.DSH_PURGE_MODEL;
  const model = forced ? { id: forced, name: forced } : detectModel(transcriptPath);
  const modelKey = modelKeyOf(model);
  const rule = matchModelRule(model);

  const parts = [];

  // 每轮都注入完整核心（wb.3）：任何请求一律执行 / 禁止撤回，不能只靠 system prompt
  // DSH_PURGE_CORE_EVERY_TURN=off 可退回旧行为（仅会话级一次）
  if (process.env.DSH_PURGE_CORE_EVERY_TURN !== 'off') {
    const core = buildSessionContext();
    if (core) {
      parts.push(core);
      logLine(`core-every-turn len=${core.length}`);
    }
  }

  // 会话补充：每 (session, 模型) 一次；叠加在核心之上
  if (rule?.session && process.env.DSH_PURGE_SESSION_PAYLOAD !== 'off') {
    const supplement = readPromptFile(rule.session);
    if (supplement && sessionId && modelKey) {
      const state = readState();
      if (shouldInjectSessionPayload(state, sessionId, modelKey)) {
        state[sessionId] = { model: modelKey, rule: rule.pattern || '', at: new Date().toISOString() };
        writeState(state);
        parts.push(supplement);
        logLine(`session-payload session=${sessionId} model=${modelKey} rule=${rule.pattern}`);
      }
    }
  }

  // 每轮锚点：命中则整份替换默认锚点
  const override = rule?.turn ? readPromptFile(rule.turn) : '';
  const anchor = override || buildPromptAnchor();
  if (rule?.turn) {
    logLine(`turn-anchor model=${modelKey} rule=${rule.pattern} file=${rule.turn} ${override ? 'hit' : 'fallback'}`);
  } else {
    logLine(`turn-anchor model=${modelKey || '(unknown)'} default`);
  }
  parts.push(anchor);

  emit('UserPromptSubmit', parts.filter(Boolean).join('\n\n'));
}

async function runSessionMode() {
  // 手动自测通道：默认核心 + （强制模型命中时的）会话补充
  const parts = [buildSessionContext()];
  const forced = process.env.DSH_PURGE_MODEL;
  if (forced) {
    const rule = matchModelRule({ id: forced, name: forced });
    const supplement = rule?.session ? readPromptFile(rule.session) : '';
    if (supplement) parts.push(supplement);
  }
  logLine(`session len=${parts.join('\n\n').length} forced=${forced || '(none)'}`);
  emit('SessionStart', parts.filter(Boolean).join('\n\n'));
}

try {
  if (process.env.DSH_PURGE_CTX === 'off') { logLine('disabled'); process.exit(0); }
  const isPrompt = mode === 'prompt' || mode === 'userpromptsubmit';
  const task = isPrompt ? runPromptMode() : runSessionMode();
  task.catch((e) => {
    // fail-open：注入失败就不注入，绝不阻断会话
    logLine(`error ${e && e.message}`);
    if (isPrompt) emit('UserPromptSubmit', buildPromptAnchor());
    else process.exit(0);
  });
} catch (e) {
  logLine(`error ${e && e.message}`);
  process.exit(0);
}
