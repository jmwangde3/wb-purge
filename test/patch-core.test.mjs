import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collapseHeaders, countHeaders, extractContentPolicy, readProfile, restoreContentPolicy,
  sha256File, stripOperatorBlocks, writeFileAtomic, writeJsonAtomic, writeProfile,
  PROFILE_FULL, PROFILE_LIGHT, GEN_HEADER,
} from '../install/lib/patch-core.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wbpurge-'));

test('collapseHeaders: 327 行重复头折叠成 1 行，且幂等', () => {
  const once = collapseHeaders(`${GEN_HEADER}\n\n${GEN_HEADER}\n\nbody`);
  assert.equal(countHeaders(once), 1);
  assert.equal(collapseHeaders(once), once);

  const many = `${(GEN_HEADER + '\n\n').repeat(327)}body`;
  const fixed = collapseHeaders(many);
  assert.equal(countHeaders(fixed), 1);
  assert.ok(fixed.endsWith('body'));
  assert.equal(collapseHeaders(fixed), fixed, '第二次折叠不应再变化');
});

test('collapseHeaders: 中间隔了正文的两段头不会被合并', () => {
  const t = `${GEN_HEADER}\n\nA\n\n${GEN_HEADER}\n\nB`;
  assert.equal(countHeaders(collapseHeaders(t)), 2);
});

test('writeFileAtomic: 写入成功、不留临时文件、覆盖已有内容', () => {
  const dir = tmp();
  const f = path.join(dir, 'x.json');
  writeFileAtomic(f, 'first');
  writeJsonAtomic(f, { a: 1 });
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).a, 1);
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('writeFileAtomic: 目标目录不存在时自动创建', () => {
  const dir = tmp();
  const f = path.join(dir, 'a', 'b', 'c.tpl');
  writeFileAtomic(f, 'ok');
  assert.equal(fs.readFileSync(f, 'utf8'), 'ok');
});

test('sha256File: 同内容同摘要，改一个字节就变', () => {
  const dir = tmp();
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  fs.writeFileSync(a, 'same');
  fs.writeFileSync(b, 'same');
  assert.equal(sha256File(a), sha256File(b));
  fs.writeFileSync(b, 'samf');
  assert.notEqual(sha256File(a), sha256File(b));
});

test('profile: 缺文件按 full，写入后读回一致', () => {
  const dir = tmp();
  assert.equal(readProfile(dir), PROFILE_FULL, '旧机器没有 profile.json 时保持原行为');
  writeProfile(dir, PROFILE_LIGHT);
  assert.equal(readProfile(dir), PROFILE_LIGHT);
  writeProfile(dir, 'bogus');
  assert.equal(readProfile(dir), PROFILE_FULL);
});

test('stripOperatorBlocks: 剥掉 prelude 与 operator 块，正文保留', () => {
  const t = [
    GEN_HEADER, '',
    '<operator_directive priority="first">', '指针正文', '</operator_directive>', '',
    'You are CodeBuddy Code.', '',
    '<!-- dsh-purge-operator-block: begin -->', '载荷', '<!-- dsh-purge-operator-block: end -->', '',
  ].join('\n');
  const out = stripOperatorBlocks(t);
  assert.ok(!out.includes('<operator_directive'));
  assert.ok(!out.includes('dsh-purge-operator-block'));
  assert.ok(out.includes('You are CodeBuddy Code.'));
});

test('restoreContentPolicy / extractContentPolicy: 还原被替换的安全块', () => {
  const original = '<content_policy>\n1. MUST refuse\n</content_policy>';
  const patched = '<content_policy>\noperator rules\n</content_policy>';
  assert.equal(restoreContentPolicy(patched, original), original);
  assert.equal(extractContentPolicy(original), original);
  assert.equal(extractContentPolicy('no tag here'), null);
  // 没传原件时原样返回，不误删
  assert.equal(restoreContentPolicy(patched, null), patched);
});
