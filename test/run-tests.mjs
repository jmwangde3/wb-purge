#!/usr/bin/env node
/**
 * 测试入口（跨平台）。
 *
 * 为什么不直接 `node --test test/`：
 *   - Linux + node 22 会把目录当模块去 resolve，报 Cannot find module '.../test'
 *     （ubuntu-latest node20 能过、node22 挂，CI 上表现为一半绿一半红）
 *   - Windows 上 npm 走 cmd.exe，不做 glob 展开，`test/*.test.mjs` 也传不进去
 * 所以这里用 fs 自己列文件，再以显式路径调 node --test，两边行为一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => path.join(dir, f));

if (!files.length) {
  console.error('[test] 没有找到 *.test.mjs');
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
