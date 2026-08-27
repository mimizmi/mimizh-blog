#!/usr/bin/env node
// ── 构建后护栏 ────────────────────────────────────────────
// 跑在 astro build 之后，检查 dist/ 的产物。
// 后续任务会往这里追加断言，不要把这个文件拆散。
import fs from 'node:fs';
import path from 'node:path';
import { createChecker, assert } from './lib/assert.mjs';

const DIST = 'dist';
const c = createChecker();

if (!fs.existsSync(DIST)) {
  console.error(`找不到 ${DIST}/，先跑 npm run build`);
  process.exit(1);
}

// ── 基础件 ──
c.check('404.html 在 dist 根部', () => {
  // GitHub Pages 只认根部的 404.html，不认 404/index.html
  assert(fs.existsSync(path.join(DIST, '404.html')), '缺少 dist/404.html');
});

c.check('robots.txt 存在且声明了 sitemap', () => {
  const p = path.join(DIST, 'robots.txt');
  assert(fs.existsSync(p), '缺少 dist/robots.txt');
  const txt = fs.readFileSync(p, 'utf8');
  assert(
    /^Sitemap:\s*https:\/\/mimizh\.dpdns\.org\/sitemap-index\.xml\s*$/m.test(txt),
    'robots.txt 里没有正确的 Sitemap 行'
  );
});

c.check('favicon 与 manifest 存在', () => {
  for (const f of ['favicon.svg', 'apple-touch-icon.png', 'site.webmanifest']) {
    assert(fs.existsSync(path.join(DIST, f)), `缺少 dist/${f}`);
  }
});

c.check('首页 head 引用了 favicon 与 manifest', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert(html.includes('/favicon.svg'), '首页没有引用 /favicon.svg');
  assert(html.includes('/site.webmanifest'), '首页没有引用 /site.webmanifest');
});

c.report();
