#!/usr/bin/env node
/**
 * dsh-purge (WorkBuddy port) — PreToolUse 自动放行钩子。
 *
 * 契约（与 WorkBuddy 内建 subscription-gate 同构）：
 *   stdin  : JSON  { tool_name, tool_input, session_id, ... }
 *   stdout : { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *               "permissionDecision": "allow", "permissionDecisionReason": "..." } }
 *   exit 0 = 放行；exit 2 = 阻断（本钩子永不 2）。
 *
 * 设计：fail-open。读不到 stdin / 解析失败 / 超时 / 未预期异常 → 仍然 allow。
 * 环境变量：
 *   DSH_PURGE_HOOK_LOG=1  把每次判定写到 dsh-purge/hook.log
 *   DSH_PURGE_HOOK_DENY=<tool 名字逗号分隔>  只对这些工具恢复默认询问（调试用）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function stateDir() {
  const base = process.env.WORKBUDDY_CONFIG_DIR || process.env.CODEBUDDY_CONFIG_DIR
    || path.join(os.homedir(), '.workbuddy');
  return path.join(base, 'dsh-purge');
}

function logLine(text) {
  if (process.env.DSH_PURGE_HOOK_LOG !== '1') return;
  try {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'hook.log'),
      `${new Date().toISOString()} ${text}\n`, 'utf8');
  } catch { /* fail-open */ }
}

function decide(input) {
  const tool = String(input?.tool_name || input?.toolName || input?.tool || 'unknown');
  const deny = (process.env.DSH_PURGE_HOOK_DENY || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (deny.includes(tool)) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask',
      permissionDecisionReason: 'dsh-purge: DSH_PURGE_HOOK_DENY match, deferring to host' } };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `dsh-purge: auto-approved ${tool}`,
    },
  };
}

function emit(obj) {
  // 同步写，避免 process.exit 截断管道缓冲（Windows 下 stdout 是异步 pipe）
  try { fs.writeSync(1, JSON.stringify(obj)); } catch { /* fail-open */ }
  process.exit(0);
}

// 兜底：任何未捕获异常都不允许变成阻断
process.on('uncaughtException', (e) => { logLine(`uncaught ${e && e.message}`); emit(decide({})); });
process.on('unhandledRejection', (e) => { logLine(`unhandled ${e && e.message}`); emit(decide({})); });
setTimeout(() => { logLine('timeout-fallback'); emit(decide({})); }, 8000).unref?.();
if (typeof setTimeout === 'function') { /* keep timer ref'd so process stays alive */ }

const chunks = [];
let size = 0;
process.stdin.on('data', (c) => {
  size += c.length;
  if (size > MAX_INPUT_BYTES) { logLine('input-too-large'); emit(decide({})); }
  chunks.push(c);
});
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  let input = {};
  if (raw) { try { input = JSON.parse(raw); } catch { input = {}; } }
  const verdict = decide(input);
  logLine(`tool=${input?.tool_name || '?'} decision=${verdict.hookSpecificOutput.permissionDecision}`);
  emit(verdict);
});
// stdin 被关闭但从未 end（宿主异常）
process.stdin.on('error', () => emit(decide({})));
