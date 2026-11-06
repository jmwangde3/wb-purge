#!/usr/bin/env node
/**
 * 一次性恢复工具：把两份 product.json 的 cli-agent-prompt.template 恢复为安装前原件。
 *
 * 背景：安装时 patchOneProductConfig 只改 cli-agent-prompt.template 一个字段，
 * 但补丁跑过两代载荷（payload 文件 00:38 改版），导致「原模板+新载荷」重放
 * （24767 字符）≠ 现状（24623 字符）—— 重放校验会失败。因此本工具不再重放，
 * 直接使用安装前的逐字节备份：
 *
 *   - cli/product.json：备份 <configDir>/dsh-purge/backup/2026-11-01T16-20-25-403Z/product.json
 *     （首补丁前抓取，大小与 app.asar 头记录的 pristine 尺寸 387311 逐字节吻合）。
 *     写回 = 整文件复制（恢复原始字节含原格式）。
 *   - @genie/.../cli/product.json（127 prompts）：当时因同名 basename 未被单独备份，
 *     但其当前模板与 cli 当前模板逐字节相同（两份配置走完全相同的补丁链），
 *     故取备份里的 pristine 模板换掉模板字段，其余字段一律不动
 *     （该文件只被 patchOneProductConfig 改过 template，其余内容即原样）。
 *
 * 断言不通过一律拒绝写入（fail-closed）。
 *
 * 用法：node restore-product-original.mjs [--config-dir DIR] [--app-dir DIR] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
function flag(name, def) { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; }
const dryRun = argv.includes('--dry-run');

const cfgDir = flag('config-dir', process.env.WORKBUDDY_CONFIG_DIR || process.env.CODEBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy'));
const appDir = flag('app-dir', (() => {
  for (const g of ['D:\\001installation_package\\WorkBuddy', 'D:\\app\\WorkBuddy']) if (fs.existsSync(path.join(g, 'WorkBuddy.exe'))) return g;
  return null;
})());
if (!appDir) { console.error('[abort] 未定位 WorkBuddy 安装目录'); process.exit(2); }

const CLI_TARGET = path.join(appDir, 'resources', 'app.asar.unpacked', 'cli', 'product.json');
const GENIE_TARGET = path.join(appDir, 'resources', 'app.asar.unpacked', 'node_modules', '@genie', 'agent-harness', 'cli', 'product.json');
const BACKUP = path.join(cfgDir, 'dsh-purge', 'backup', '2026-11-01T16-20-25-403Z', 'product.json');
const SPILL_DIR = path.join(cfgDir, 'cache');
const PRISTINE_TEMPLATE_LEN = 19831;
const CLI_PRISTINE_FILE_LEN = 387311; // app.asar 头记录的安装时尺寸

function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function getTemplate(j) {
  const prompts = Array.isArray(j?.prompts) ? j.prompts : [];
  const tpl = prompts.find((p) => p && p.name === 'cli-agent-prompt');
  return tpl && typeof tpl.template === 'string' ? tpl.template : null;
}
function normalizedWithoutTemplate(j) {
  const clone = JSON.parse(JSON.stringify(j));
  const tpl = clone.prompts?.find((p) => p && p.name === 'cli-agent-prompt');
  if (tpl) tpl.template = '@@TEMPLATE@@';
  return JSON.stringify(clone);
}
function assert(cond, msg) { if (!cond) { console.error(`[abort] 断言失败: ${msg}`); process.exit(1); } }

// ── 读取三份文件 ──────────────────────────────────────────────────────────
assert(fs.existsSync(BACKUP), `备份不存在: ${BACKUP}`);
assert(fs.existsSync(CLI_TARGET), `cli 目标不存在: ${CLI_TARGET}`);
assert(fs.existsSync(GENIE_TARGET), `genie 目标不存在: ${GENIE_TARGET}`);

const backupRaw = fs.readFileSync(BACKUP);
const backup = readJson(BACKUP);
const cliCur = readJson(CLI_TARGET);
const genieCur = readJson(GENIE_TARGET);

const tplBackup = getTemplate(backup);
const tplCliCur = getTemplate(cliCur);
const tplGenieCur = getTemplate(genieCur);

// ── 断言 1：备份确实是 pristine（含 MUST-refuse 原文、无补丁标记、长度吻合）──
assert(backupRaw.length === CLI_PRISTINE_FILE_LEN, `备份大小 ${backupRaw.length} ≠ pristine ${CLI_PRISTINE_FILE_LEN}`);
assert(tplBackup.length === PRISTINE_TEMPLATE_LEN, `备份模板长度 ${tplBackup.length} ≠ ${PRISTINE_TEMPLATE_LEN}`);
assert(tplBackup.includes('You MUST refuse'), '备份模板缺 MUST-refuse 原文');
assert(!tplBackup.includes('dsh-purge-operator-block'), '备份模板竟然含补丁标记');

// ── 断言 2：安装前溢出副本交叉校验（取最新的未打补丁副本）────────────────────
let spillChecked = false;
try {
  const spills = fs.readdirSync(SPILL_DIR)
    .filter((f) => f.startsWith('acc-product-config-v3-') && f.endsWith('.json'))
    .map((f) => path.join(SPILL_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const s of spills) {
    let j; try { j = readJson(s); } catch { continue; }
    if (j?.prompts?.length !== backup.prompts.length) continue;
    const t = getTemplate(j);
    if (!t) continue;
    if (t.includes('dsh-purge-operator-block')) continue; // 已打补丁的副本跳过，继续往前找未打补丁的
    assert(t === tplBackup, `溢出副本模板与备份不一致: ${path.basename(s)}`);
    console.log(`[ok] 溢出副本交叉校验通过: ${path.basename(s)}`);
    spillChecked = true;
    break;
  }
} catch { /* 副本目录不存在则跳过，断言1已足够 */ }
if (!spillChecked) console.log('[skip] 未找到可用溢出副本（断言1已独立成立）');

// ── 断言 3：cli 当前文件除 template 外与备份内容一致（证明只被改过模板）─────
assert(normalizedWithoutTemplate(cliCur) === normalizedWithoutTemplate(backup),
  'cli 当前文件除 template 外还有其他字段差异，拒绝整文件覆盖');

// ── 断言 4：genie 当前模板与 cli 当前模板逐字节相同（补丁链相同的证据）────────
assert(tplGenieCur === tplCliCur, 'genie/cli 当前模板不一致，拒绝用备份模板替换 genie');

// ── 断言 5：genie 结构完整 ───────────────────────────────────────────────
assert(Array.isArray(genieCur.prompts) && genieCur.prompts.length === 127, `genie prompts 数异常: ${genieCur?.prompts?.length}`);

console.log(`[plan] cli   ← 整文件复制备份（${backupRaw.length} 字节，字节级复原）`);
console.log(`[plan] genie ← 仅替换模板字段 ${tplBackup.length} 字符（prompts=127 与其余字段不动）`);
if (dryRun) { console.log('[dry-run] 未写入'); process.exit(0); }

// ── 写入 ─────────────────────────────────────────────────────────────────
fs.copyFileSync(BACKUP, CLI_TARGET);
console.log(`[restored] ${CLI_TARGET}`);

const gTpl = genieCur.prompts.find((p) => p && p.name === 'cli-agent-prompt');
gTpl.template = tplBackup;
fs.writeFileSync(GENIE_TARGET, `${JSON.stringify(genieCur, null, 2)}\n`, 'utf8');
console.log(`[restored] ${GENIE_TARGET}`);

// ── 回读验证 ─────────────────────────────────────────────────────────────
const v1 = fs.readFileSync(CLI_TARGET);
const v1t = getTemplate(readJson(CLI_TARGET));
const v2 = readJson(GENIE_TARGET);
const v2t = getTemplate(v2);
assert(v1.length === CLI_PRISTINE_FILE_LEN, `cli 回读大小 ${v1.length} ≠ ${CLI_PRISTINE_FILE_LEN}`);
assert(v1t === tplBackup, 'cli 回读模板不等于备份模板');
assert(v2t === tplBackup, 'genie 回读模板不等于备份模板');
assert(v2.prompts.length === 127, 'genie 回读 prompts 数变化');
assert(!v1t.includes('dsh-purge-operator-block') && !v2t.includes('dsh-purge-operator-block'), '回读仍含补丁标记');
console.log('[verify] 两份文件恢复后校验全部通过：模板 = pristine，无补丁标记');
process.exit(0);
