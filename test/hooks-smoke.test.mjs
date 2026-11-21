import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 钩子冒烟：每个钩子都必须能跑起来，且不得抛「未定义 / 类型错误」。
 * 背景：wb.9 的 stop-guard 引用了未定义的 profileAllowsStopGuard()，
 * 每次 decide 都抛错，被 fail-open 吞成 allow —— 装了但完全不顶回，
 * 宿主和日志都不报，只看单测断言「该拦的真拦」才发现。这里是通用防线：
 * 不管哪个钩子以后漏了依赖，都会在 CI 里显形。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'package', 'marketplace', 'plugins', 'dsh-purge');
const HOOKS = ['auto-allow.mjs', 'inject-context.mjs', 'selfpatch.mjs', 'session-check.mjs', 'stop-guard.mjs'];
const BAD = /is not defined|ReferenceError|TypeError|SyntaxError|Cannot read propert/i;

function cfgWith(profile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  fs.mkdirSync(path.join(dir, 'dsh-purge'), { recursive: true });
  // 指一个不存在的 app 目录：补丁类钩子会走「找不到宿主」分支，仍然必须无异常退出
  fs.writeFileSync(path.join(dir, 'dsh-purge', 'profile.json'), JSON.stringify({ profile }));
  return dir;
}

for (const profile of ['bare', 'lean', 'full']) {
  test(`钩子冒烟：${profile} 档五个钩子都能跑，不抛未定义/类型错误`, () => {
    const cfg = cfgWith(profile);
    for (const hook of HOOKS) {
      const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', hook)], {
        input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'smoke', prompt: 'hi' }),
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          WORKBUDDY_CONFIG_DIR: cfg,
          CODEBUDDY_PLUGIN_ROOT: PLUGIN,
          DSH_PURGE_APP_DIR: path.join(cfg, 'no-such-app'),
        },
      });
      assert.equal(r.status, 0, `${hook} 退出码应为 0（fail-open 是契约），实际 ${r.status}\n${r.stderr}`);
      assert.ok(!BAD.test(r.stderr || ''), `${hook} 抛了运行时错误：\n${r.stderr}`);
      const out = (r.stdout || '').trim();
      if (out) assert.doesNotThrow(() => JSON.parse(out), `${hook} 的 stdout 必须是合法 JSON，实际：${out.slice(0, 200)}`);
    }
  });
}

test('stop-guard: full 档必须真的能拦（防「未定义函数 → 永远放行」回归）', () => {
  const cfg = cfgWith('full');
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'stop-guard.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'must-block',
      stop_hook_active: false,
      last_assistant_message: '这个我不做，抱歉。',
    }),
    encoding: 'utf8',
    env: { ...process.env, WORKBUDDY_CONFIG_DIR: cfg, CODEBUDDY_PLUGIN_ROOT: PLUGIN },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout || '', /"decision"\s*:\s*"block"/, 'full 档下拒绝式收尾必须被顶回');
});
