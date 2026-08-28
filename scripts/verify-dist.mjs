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

// ── 外域 ──
c.check('产物 HTML 不含任何外域引用', () => {
  const BANNED = ['googleapis.com', 'gstatic.com', 'jsdelivr.net'];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      const html = fs.readFileSync(p, 'utf8');
      for (const b of BANNED) if (html.includes(b)) hits.push(`${p} → ${b}`);
    }
  };
  walk(DIST);
  assert(hits.length === 0, `有 ${hits.length} 处外域引用：\n      ` + hits.slice(0, 5).join('\n      '));
});

// ── OG 图 ──
// 带 og:image 的详情页数量，供下面第二条断言复用
let ogImagePageCount = 0;

c.check('每个内容详情页都有 og:image 且图片真实存在', () => {
  const problems = [];
  let checked = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== 'index.html') continue;
      const rel = path.relative(DIST, p).split(path.sep).join('/');
      // 只查内容详情页：notes/wiki/projects 下的页面，排除三个板块各自的列表页
      if (!/^(notes|wiki|projects)\/.+\/index\.html$/.test(rel)) continue;
      const html = fs.readFileSync(p, 'utf8');
      const m = html.match(/<meta property="og:image" content="([^"]+)"/);
      // 用 continue 而不是 return——这里是在遍历某一层目录的 for 循环里，
      // return 会连同该目录下尚未看过的兄弟条目、以及递归进它们子目录的
      // 机会一起跳过，导致覆盖率静默坍塌却不报错
      if (!m) continue; // 目录列表页没有 og:image，是预期的
      checked++;
      const png = path.join(DIST, decodeURIComponent(new URL(m[1]).pathname));
      if (!fs.existsSync(png)) problems.push(`${rel} 的 og:image 指向不存在的文件`);
    }
  };
  walk(DIST);
  ogImagePageCount = checked;
  assert(checked > 0, '一个带 og:image 的详情页都没查到，检查 ogImage prop 是否真的传下去了');
  assert(problems.length === 0, `${problems.length} 处问题：\n      ` + problems.slice(0, 5).join('\n      '));
});

c.check('带 og:image 的页面数与 dist/og/ 下的 PNG 数一致', () => {
  // 上一条检查用 continue 跳过没有 og:image 的页面，就无法再区分「目录列表页
  // 本来就没有 og:image」和「详情页丢了 og:image」。getStaticPaths 保证每个
  // 内容 entry 恰好生成一张图，两个计数相等等价于「每个详情页都拿到了图，
  // 且没有孤儿图片」。
  const ogDir = path.join(DIST, 'og');
  let pngCount = 0;
  if (fs.existsSync(ogDir)) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (e.name.endsWith('.png')) pngCount++;
      }
    };
    walk(ogDir);
  }
  assert(
    pngCount === ogImagePageCount,
    `带 og:image 的页面有 ${ogImagePageCount} 个，但 dist/og/ 下有 ${pngCount} 张 PNG——数量对不上`
  );
});

c.report();
