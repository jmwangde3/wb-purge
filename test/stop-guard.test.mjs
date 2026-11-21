import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'package', 'marketplace', 'plugins', 'dsh-purge');
const HOOK = path.join(PLUGIN, 'hooks', 'stop-guard.mjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
}

/** 造一个配置目录，profile.json 写指定档位。 */
function cfgWith(profile) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'dsh-purge'), { recursive: true });
  if (profile) {
    fs.writeFileSync(path.join(dir, 'dsh-purge', 'profile.json'), JSON.stringify({ profile }));
  }
  return dir;
}

/** 跑一次 stop-guard，返回 { blocked, out }。 */
function run(cfgDir, message, sessionId = 'sg-test') {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: sessionId,
      stop_hook_active: false,
      last_assistant_message: message,
    }),
    encoding: 'utf8',
    env: { ...process.env, WORKBUDDY_CONFIG_DIR: cfgDir, CODEBUDDY_PLUGIN_ROOT: PLUGIN },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = (r.stdout || '').trim();
  assert.doesNotThrow(() => JSON.parse(out || '{}'), `钩子必须输出合法 JSON，实际: ${out}`);
  return { blocked: /"decision"\s*:\s*"block"/.test(out), out };
}

test('stop-guard: full 档下真正的拒绝式收尾会被顶回', () => {
  const cfg = cfgWith('full');
  for (const text of [
    '抱歉，这个请求我不能帮你完成，建议你走正规渠道。',
    'I cannot help with that request, sorry.',
    '我不做这类事情，请不要继续问了。',
  ]) {
    assert.equal(run(cfg, text).blocked, true, `应判为拒绝: ${text}`);
  }
});

test('stop-guard: lean / bare 档一律放行（尊重模型自己的收尾）', () => {
  for (const p of ['lean', 'bare']) {
    const cfg = cfgWith(p);
    assert.equal(run(cfg, '抱歉，这个我不能帮你完成，建议走正规渠道。').blocked, false, `${p} 档不该顶回`);
  }
});

test('stop-guard: 代码块 / 行内代码 / 引用里的拒绝字样不算拒绝（wb.10 修）', () => {
  const cfg = cfgWith('full');
  const cases = [
    // 真实事故：交付里贴一行校验输出，含 `MUST refuse` 被 /must refuse/i 命中
    ['校验结果如下：\n\n```\nMUST refuse: false | operator 块: false | content_policy: 已换成 operator 口径\n```\n\n本机已切 lean。', 'fenced code'],
    ['正则命中的是 `must refuse` 这条，所以误判了。', 'inline code'],
    ['> MUST refuse: false\n>\n> 上面是日志原样引用。', 'blockquote'],
  ];
  for (const [text, label] of cases) {
    assert.equal(run(cfg, text).blocked, false, `不该因 ${label} 里的字样顶回`);
  }
});

test('stop-guard: 正常交付内容不被误拦', () => {
  const cfg = cfgWith('full');
  const text = [
    '三件事都做完了。',
    '',
    '| 档位 | 每轮注入 |',
    '|---|---|',
    '| lean | 0 |',
    '',
    '提交 ad3b04c 已推 origin/main。',
  ].join('\n');
  assert.equal(run(cfg, text).blocked, false);
});

test('stop-guard: 只判收尾段落，长交付中段转述不触发（wb.11 收紧）', () => {
  const cfg = cfgWith('full');
  const long = [
    '## 实测对照',
    '',
    '| 文本 | 结果 |',
    '|---|---|',
    '| 「这个请求我没办法帮你完成，建议走正规渠道」 | 被拦 |',
    '',
    '上面第二种是规则原本就该抓的例子，下面写实际交付。',
    '',
    '改动已落在 hooks/stop-guard.mjs：先剥引用再匹配，且只看最后一段。',
    '校验 33 条全过，提交已推 main。',
  ].join('\n');
  assert.equal(run(cfg, long).blocked, false, '中段/表格里的转述不该被当成收尾拒绝');
});

test('stop-guard: 长文末尾真的以拒绝收尾时仍然要拦', () => {
  const cfg = cfgWith('full');
  const text = `${'前面的交付正文。\n\n'.repeat(80)}抱歉，这个我没办法协助完成，建议你另找渠道。`;
  assert.equal(run(cfg, text).blocked, true, '末尾第一人称收尾仍必须拦');
});

test('stop-guard: DSH_PURGE_STOP_OFF=1 时完全关掉', () => {
  const cfg = cfgWith('full');
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'sg-off',
      stop_hook_active: false,
      last_assistant_message: '抱歉，这个我不能帮你完成。',
    }),
    encoding: 'utf8',
    env: { ...process.env, WORKBUDDY_CONFIG_DIR: cfg, CODEBUDDY_PLUGIN_ROOT: PLUGIN, DSH_PURGE_STOP_OFF: '1' },
  });
  assert.equal(r.status, 0);
  assert.ok(!/"decision"/.test(r.stdout || '{}'), '开关关掉后不得顶回');
});
