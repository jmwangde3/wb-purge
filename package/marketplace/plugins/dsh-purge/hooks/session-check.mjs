#!/usr/bin/env node
/**
 * dsh-purge (WorkBuddy port) — SessionStart 自检钩子。
 *
 * 只做检查与记录，不改用户文件：
 *   1) settings.json 的 sandbox 规则是否还是全放行（被应用更新覆盖时写漂移报告）
 *   2) 插件自身 fragments / hooks 是否在位
 *   3) 当前 CLI 版本、桌面版本
 * 报告写到 <configDir>/dsh-purge/session-check.json，并 stderr 打一行摘要。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const cfgDir = process.env.WORKBUDDY_CONFIG_DIR || process.env.CODEBUDDY_CONFIG_DIR
  || path.join(os.homedir(), '.workbuddy');
const stateDir = path.join(cfgDir, 'dsh-purge');
const settingsPath = path.join(cfgDir, 'settings.json');
const pluginRoot = process.env.CODEBUDDY_PLUGIN_ROOT || process.env.WORKBUDDY_PLUGIN_ROOT
  || path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function isDenyAllAllowed(rule) {
  return rule === 'allow';
}

function checkSandbox() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const rules = s?.sandbox?.orderedRules || {};
    const kinds = ['file', 'command', 'network'];
    const out = {};
    for (const k of kinds) {
      const list = Array.isArray(rules?.[k]?.rules) ? rules[k].rules : [];
      out[k] = {
        rules: list.length,
        anyAsk: list.filter((r) => Object.entries(r).some(([f, v]) =>
          !['id', 'source', 'path', 'isDirectory', 'description'].includes(f) && isDenyAllAllowed(v) === false && v !== 'allow')).length,
      };
    }
    return { ok: true, sandbox: out, assistedApproval: s?.securityReview?.assistedApproval ?? null };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function checkFiles() {
  const fragDir = path.join(pluginRoot, 'fragments');
  let fragments = [];
  try { fragments = fs.readdirSync(fragDir).filter((f) => f.endsWith('.md')); } catch { /* ignore */ }
  const hooksFile = path.join(pluginRoot, 'hooks', 'hooks.json');
  const promptDir = path.join(pluginRoot, 'prompts');
  let prompts = [];
  let modelRules = 0;
  let stopHook = false;
  try { prompts = fs.readdirSync(promptDir).filter((f) => f.endsWith('.md')); } catch { /* ignore */ }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(promptDir, 'models.json'), 'utf8'));
    modelRules = Array.isArray(cfg?.match) ? cfg.match.length : 0;
  } catch { modelRules = -1; } // -1 = models.json 缺失或解析失败
  try {
    const hj = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    stopHook = Array.isArray(hj?.hooks?.Stop) && hj.hooks.Stop.length > 0;
  } catch { stopHook = false; }
  return { pluginRoot, fragments, hooksPresent: fs.existsSync(hooksFile), stopHook, prompts, modelRules };
}

function checkHostPrompt() {
  // system prompt 补丁落在 <app>/resources/app.asar.unpacked/cli/product.json
  const candidates = [
    path.resolve(pluginRoot, '..', '..', '..', '..', '..', '..', 'cli', 'product.json'),
    'D:\\001installation_package\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\product.json',
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const tpl = (j.prompts || []).find((x) => x && x.name === 'cli-agent-prompt');
      const t = tpl && typeof tpl.template === 'string' ? tpl.template : '';
      return { path: p, patched: t.includes('dsh-purge-operator-block: begin'), length: t.length };
    } catch { /* next */ }
  }
  return { path: null, patched: false, length: 0 };
}

function readVersion(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

const report = {
  at: new Date().toISOString(),
  event: process.env.DSH_PURGE_EVENT || 'SessionStart',
  files: checkFiles(),
  settings: checkSandbox(),
  hostPrompt: checkHostPrompt(),
  cliVersion: readVersion(path.join(pluginRoot, '..', '..', '..', 'cli', 'package.json')),
};

try {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'session-check.json'), JSON.stringify(report, null, 2));
} catch { /* fail-open */ }

process.stderr.write(`[dsh-purge] session-check ok=${report.settings.ok} hostPrompt=${report.hostPrompt.patched} fragments=${report.files.fragments.length} prompts=${report.files.prompts.length} modelRules=${report.files.modelRules} stopHook=${report.files.stopHook}\n`);
process.exit(0);
