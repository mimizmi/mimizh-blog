#!/usr/bin/env node
// ── 构建前护栏 ────────────────────────────────────────────
// 跑在 astro build 之前，检查源码层面的前置条件。
import fs from 'node:fs';
import path from 'node:path';
import { createChecker, assert } from './lib/assert.mjs';
import { collectCodepoints } from './lib/charset.mjs';

const c = createChecker();

c.check('字体子集覆盖了全部站内 CJK 字符', () => {
  const covPath = path.join('public', 'fonts', 'coverage.json');
  assert(fs.existsSync(covPath), '缺少 public/fonts/coverage.json，先跑 npm run fonts');
  const cov = JSON.parse(fs.readFileSync(covPath, 'utf8'));
  assert(cov.count === cov.codepoints.length, 'coverage.json 的 count 与 codepoints 长度不一致，文件已损坏');

  const covered = new Set(cov.codepoints);
  const missing = collectCodepoints().filter((cp) => !covered.has(cp));
  assert(
    missing.length === 0,
    `有 ${missing.length} 个字符不在子集里：` +
      missing.slice(0, 30).map((cp) => String.fromCodePoint(cp)).join('') +
      (missing.length > 30 ? '…' : '') +
      '\n      跑 npm run fonts 重新生成子集，并把 public/fonts/ 一起提交'
  );
});

c.check('子集字体文件存在且体积合理', () => {
  for (const f of ['noto-serif-sc-subset.woff2', 'noto-sans-sc-subset.woff2']) {
    const p = path.join('public', 'fonts', f);
    assert(fs.existsSync(p), `缺少 public/fonts/${f}`);
    const size = fs.statSync(p).size;
    assert(size > 50 * 1024, `public/fonts/${f} 只有 ${size} 字节，疑似生成失败`);
  }
});

c.report();
