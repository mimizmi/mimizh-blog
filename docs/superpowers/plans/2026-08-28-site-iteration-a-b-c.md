# 站点迭代 A+B+C 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把站点的字体与 KaTeX 从大陆不可达的 CDN 迁到自托管子集，修掉无 `date` 笔记的日期回退 bug，补齐 favicon/404/robots 基础件，并加上构建期 OG 卡片图与首页落地页。

**Architecture:** 全部新增逻辑都在构建期运行，不给站点增加任何运行时 JS——这是本仓库既有插件文件顶部已经写明的原则（`src/plugins/markdown.mjs:4`）。新增三个构建期子系统：字体子集流水线（脚本手动跑、产物进 git、CI 校验覆盖率）、mermaid 预渲染（remark 阶段出内联 SVG）、OG 卡片图（satori + resvg，走 Astro endpoint）。护栏做成两个 node 脚本：构建前查字体覆盖率，构建后查产物断言。

**Tech Stack:** Astro 5（legacy content collections）、`build.format: 'directory'`、GitHub Pages、Node 20、subset-font（harfbuzzjs）、Fontsource、satori + @resvg/resvg-js、playwright（仅构建期）、Pagefind。

**Spec:** `docs/superpowers/specs/2026-08-28-site-iteration-a-b-c-design.md`

## Global Constraints

- 站点 URL 固定为 `https://mimizh.dpdns.org`，与 `astro.config.mjs` 的 `site` 和 `src/config.ts` 的 `SITE.url` 三处保持一致。
- `build.format: 'directory'`，不得修改。
- 新增构建期模块一律用纯 ESM `.mjs` + 同名 `.d.mts` 类型声明，沿用 `src/plugins/wikilinks.mjs` / `wikilinks.d.mts` 的既有约定。不引入 `unist-util-visit` 等新的 AST 工具，手写 `walk`，与 `src/plugins/markdown.mjs:7` 的 `visit` 同风格。
- 注释用中文，段落分隔用 `// ── 标题 ─────` 形式，与既有插件一致。
- 任何新代码都不得给客户端增加 JS。判据：`dist/_astro/*.js` 的总量在该任务完成后不得高于任务开始前。
- 字重覆盖范围 `300–700`（站点实际用到 300/400/500/600）。
- 外域断言的三个目标域名，逐字：`googleapis.com`、`gstatic.com`、`jsdelivr.net`。
- 开发机是 Windows（Git Bash），CI 是 `ubuntu-latest`。所有路径拼接必须走 `node:path`，写进 git/URL 的路径一律用正斜杠。
- 内容集合是 legacy API（`src/content/config.ts` 用 `defineCollection({ schema })`），因此 `entry.id` **带 `.md` 后缀**——`src/utils/metadata.ts:14` 已依赖这一点。

## 与 spec 的三处偏离

写计划时发现 spec 里三处需要修正，已在下面对应任务落实，执行者无需再决策：

1. **spec 第 11 节的命令顺序不可行。** 它写 `check → verify → build`，但 verify 里的产物断言（404.html、OG 图、外域）必须在 build 之后才有 dist 可查。改为两个命令：`npm run verify`（构建前，只查字体覆盖率）与 `npm run verify:dist`（构建后，查产物）。CI 顺序 `check → verify → build → verify:dist`。
2. **spec 第 12 节写「移除 mermaid」不准确。** 预渲染本身需要 mermaid。正确做法是把 `mermaid` 从 `dependencies` 移到 `devDependencies`：客户端不再 import 它，Vite 就不会打包，而构建期仍可用。产物瘦身效果不变。
3. **spec 第 8 节的「OG 图数量等于内容页数量」是个弱断言。** 改成更强的逐页断言：dist 中每个内容详情页都必须有 `og:image`，且它指向的 PNG 必须真实存在于 dist。这同时覆盖了数量、路径正确性和转义问题。

---

## 文件结构

**新建：**

| 路径 | 职责 |
|---|---|
| `src/utils/gitdates.mjs` | 一次 `git log` 扫出「仓库相对路径 → 最后提交日期」的 map，模块级缓存 |
| `src/utils/gitdates.d.mts` | 上者的类型声明 |
| `scripts/lib/assert.mjs` | 极小的断言收集器，供两个 verify 脚本共用 |
| `scripts/lib/charset.mjs` | 扫描仓库、抽出全部 CJK 码点。子集脚本与覆盖率检查共用同一份实现，避免两边口径漂移 |
| `scripts/subset-fonts.mjs` | 手动跑：把两个 CJK 可变字体按站点字符集子集化，写出 woff2 + `coverage.json` + OG 用静态字重 |
| `scripts/verify.mjs` | 构建**前**护栏：字体覆盖率 |
| `scripts/verify-dist.mjs` | 构建**后**护栏：404.html / robots / favicon / 外域 / OG 图 |
| `scripts/checks/git-dates.mjs` | Task 1 的回归测试 |
| `src/styles/fonts.css` | CJK `@font-face` + 输入框字体回退 |
| `src/styles/fonts.ts` | Fontsource 拉丁字体的副作用 import 集中处 |
| `src/plugins/mermaid-prerender.mjs` | remark 阶段把 mermaid 块渲染成双主题内联 SVG，并导出关闭浏览器的 Astro 集成 |
| `src/plugins/mermaid-prerender.d.mts` | 上者的类型声明 |
| `src/utils/og-card.ts` | OG 卡片的 satori 布局，与 endpoint 分离 |
| `src/pages/404.astro` | 404 页 |
| `src/pages/og/[...slug].png.ts` | OG 图 endpoint |
| `public/favicon.svg` / `apple-touch-icon.png` / `site.webmanifest` / `robots.txt` | 基础件 |
| `public/fonts/*.woff2` + `public/fonts/coverage.json` | 子集产物（进 git） |
| `scripts/assets/og-fonts/*.woff2` | OG 图专用静态字重（进 git，不对外服务） |

**修改：**

| 路径 | 改动 |
|---|---|
| `src/utils/metadata.ts:5-17` | `resolveDate` 插入 git 日期这一级回退 |
| `src/layouts/BaseLayout.astro:58-63` | 摘掉两个 CDN `<link>`，换成本地字体与 KaTeX；补 favicon/manifest/og:image |
| `src/layouts/BaseLayout.astro:455-484` | 删掉 mermaid 运行时 `<script>` |
| `src/styles/global.css:4` | 字体变量默认值加 CJK 回退 |
| `src/pages/index.astro` | 名片页 → 落地页 |
| `astro.config.mjs:12,58` | `remarkMermaid` → `remarkMermaidPrerender`，加关闭浏览器的集成 |
| `.github/workflows/deploy.yml` | `fetch-depth: 0`；加 verify 步骤 |
| `package.json` | 脚本与依赖 |
| `.gitignore` | 忽略 `fonts/source/` |

---

### Task 1: git 提交时间作为日期回退

修掉 15 篇无 `date` 笔记全部显示构建日的问题。纯数据正确性修复，无依赖，放第一个。

**Files:**
- Create: `src/utils/gitdates.mjs`
- Create: `src/utils/gitdates.d.mts`
- Create: `scripts/checks/git-dates.mjs`
- Modify: `src/utils/metadata.ts:1-17`
- Modify: `.github/workflows/deploy.yml`（checkout 步骤）
- Modify: `package.json`（scripts）

**Interfaces:**
- Consumes: 无
- Produces: `getGitDates(): Map<string, string>`（键是仓库相对 POSIX 路径，值是 ISO 8601 带时区字符串）；`gitDateFor(repoRelPath: string): string`（返回 `YYYY-MM-DD`，未跟踪时返回空串）。Task 7 的首页「最近更新」会经由 `resolveDate` 用到它。

- [ ] **Step 1: 写下会失败的检查脚本**

创建 `scripts/checks/git-dates.mjs`：

```js
// ── Task 1 回归测试：无 date frontmatter 的笔记必须拿到各自的 git 提交日期 ──
import fs from 'node:fs';
import path from 'node:path';
import { getGitDates, gitDateFor } from '../../src/utils/gitdates.mjs';

const NOTES_DIR = path.join('src', 'content', 'notes');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

/** frontmatter 里有没有 date：只看文件开头的 --- 块 */
function hasFrontmatterDate(file) {
  const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
  const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? /^date:\s*\S/m.test(m[1]) : false;
}

const failures = [];
const dateless = walk(NOTES_DIR).filter((f) => !hasFrontmatterDate(f));

if (getGitDates().size === 0) failures.push('git log 没有解析出任何文件');
if (dateless.length === 0) failures.push('没有找到无 date 的笔记，测试样本为空');

const dates = new Set();
for (const f of dateless) {
  const rel = f.split(path.sep).join('/');
  const d = gitDateFor(rel);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) failures.push(`拿不到 git 日期: ${rel} -> ${JSON.stringify(d)}`);
  else dates.add(d);
}

// 浅克隆时所有文件会共享同一个 commit 时间，这条断言就是用来抓 fetch-depth 配错的
if (dates.size < 2) failures.push(`${dateless.length} 篇无 date 笔记只有 ${dates.size} 个不同日期，疑似浅克隆`);

if (failures.length) {
  console.error('git 日期检查失败：');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`git 日期检查通过：${dateless.length} 篇无 date 笔记，${dates.size} 个不同日期`);
```

- [ ] **Step 2: 跑它，确认失败**

```bash
node scripts/checks/git-dates.mjs
```

预期：`ERR_MODULE_NOT_FOUND`，找不到 `src/utils/gitdates.mjs`。

- [ ] **Step 3: 实现 gitdates.mjs**

创建 `src/utils/gitdates.mjs`：

```js
// ── 构建期从 git 取文件最后提交时间 ────────────────────────
// 全部在构建期运行，不引入任何运行时 JS。
// 为什么不用 fs.birthtime：CI 上 checkout 出来的文件 birthtime 等于克隆时刻，
// 会让所有没写 date 的笔记显示同一个「构建那天」，且每次 deploy 都变。
import { execFileSync } from 'node:child_process';

let cache = null;

/**
 * 一次 git log 扫出「仓库相对路径 → 最后提交 ISO 时间」。
 * --name-only 让每个 commit 后跟它触及的文件；git log 从新到旧输出，
 * 所以每个文件第一次出现时就是它的最后一次提交。
 * 用 %x00 前缀把时间行和文件名行区分开——文件路径里不可能出现 NUL。
 */
export function getGitDates() {
  if (cache) return cache;
  const map = new Map();
  let out = '';
  try {
    out = execFileSync('git', ['log', '--format=%x00%aI', '--name-only', '--no-renames'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // 不在 git 仓库里（例如从 tarball 构建）时静默降级，由调用方回退到 birthtime
    cache = map;
    return map;
  }
  let current = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('\0')) {
      current = line.slice(1).trim();
      continue;
    }
    const file = line.trim();
    if (!file || !current) continue;
    if (!map.has(file)) map.set(file, current);
  }
  cache = map;
  return map;
}

/** 仓库相对 POSIX 路径 → 'YYYY-MM-DD'，未跟踪时返回空串 */
export function gitDateFor(repoRelPath) {
  const iso = getGitDates().get(repoRelPath);
  return iso ? iso.slice(0, 10) : '';
}
```

创建 `src/utils/gitdates.d.mts`：

```ts
export function getGitDates(): Map<string, string>;

export function gitDateFor(repoRelPath: string): string;
```

- [ ] **Step 4: 跑检查，确认通过**

```bash
node scripts/checks/git-dates.mjs
```

预期输出：`git 日期检查通过：15 篇无 date 笔记，3 个不同日期`

（当前仓库实测分布：2026-08-21 ×10、2026-04-27 ×4、2026-08-20 ×1。篇数或日期数与此不同不算失败，只要不同日期数 ≥2 即可。）

- [ ] **Step 5: 接进 resolveDate**

修改 `src/utils/metadata.ts`，在顶部 import 之后加：

```ts
import { gitDateFor } from './gitdates.mjs';
```

把 `resolveDate` 整个替换为：

```ts
export function resolveDate(entry: { collection: string; id: string; data?: { date?: string } }): string {
  const fmDate = entry.data?.date;
  if (fmDate && fmDate.trim()) return fmDate;

  // entry.id 带 .md 后缀（legacy content collections），且用正斜杠——与 git 的路径形式一致
  const repoRel = `src/content/${entry.collection}/${entry.id}`;
  const fromGit = gitDateFor(repoRel);
  if (fromGit) return fromGit;

  // 兜底：不在 git 仓库里时退回文件创建时间
  const filePath = path.join(process.cwd(), 'src', 'content', entry.collection, entry.id);
  try {
    return fs.statSync(filePath).birthtime.toISOString().split('T')[0];
  } catch {
    return '';
  }
}
```

原来那一层 `.mdx` 兜底可以删掉：git 查的是带后缀的原始 id，不需要猜扩展名；birthtime 分支只在非 git 环境下走到，此时 `.mdx` 也不会存在。

- [ ] **Step 6: 构建并肉眼核对日期**

```bash
npm run build
grep -o '<span>2026-[0-9-]*</span>' "dist/notes/Game Development/Unity/MagicGameHarness/01-Index/index.html" | head -1
grep -o '<span>2026-[0-9-]*</span>' "dist/notes/Computer Graphic/DirectX12/01_Vector_Algebra/index.html" | head -1
```

预期：两个日期**不相同**，且都不是今天。改动前这两处都会是构建当天。

- [ ] **Step 7: 修 CI 的浅克隆**

修改 `.github/workflows/deploy.yml`，把 `- uses: actions/checkout@v4` 替换为：

```yaml
      - uses: actions/checkout@v4
        with:
          # git log 要看到完整历史才能给每个文件算出真实的最后提交时间；
          # 默认的 fetch-depth: 1 会让所有文件共享同一个 commit 时间。
          fetch-depth: 0
```

⚠️ 这一步和 Step 5 是同一个修复的两半。只合前者不合这里，线上会以另一种方式复现原 bug。

- [ ] **Step 8: 把检查挂进 package.json**

在 `package.json` 的 `scripts` 里加一行（放在 `check` 之后）：

```json
    "check:dates": "node scripts/checks/git-dates.mjs",
```

- [ ] **Step 9: 提交**

```bash
git add src/utils/gitdates.mjs src/utils/gitdates.d.mts scripts/checks/git-dates.mjs src/utils/metadata.ts .github/workflows/deploy.yml package.json
git commit -m "fix: 日期回退改用 git 最后提交时间"
```

---

### Task 2: verify 骨架与基础件（favicon / 404 / robots / manifest）

先立起构建后护栏，再用它驱动基础件的补齐。后续每个任务都往这个脚本里加断言。

**Files:**
- Create: `scripts/lib/assert.mjs`
- Create: `scripts/verify-dist.mjs`
- Create: `src/pages/404.astro`
- Create: `public/robots.txt`
- Create: `public/favicon.svg`
- Create: `public/apple-touch-icon.png`
- Create: `public/site.webmanifest`
- Modify: `src/layouts/BaseLayout.astro`（head 补 icon 链接）
- Modify: `package.json`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: 无
- Produces: `scripts/lib/assert.mjs` 导出 `createChecker(): { check(name: string, fn: () => void): void; report(): void }` 与 `assert(cond: unknown, msg: string): void`。`check` 捕获 `fn` 抛出的错误并记账；`report()` 在有失败时打印全部失败并 `process.exit(1)`。Task 4 与 Task 6 会往 `scripts/verify-dist.mjs` 里追加 `c.check(...)` 调用。

- [ ] **Step 1: 写断言收集器**

创建 `scripts/lib/assert.mjs`：

```js
// ── 极小的断言收集器 ──────────────────────────────────────
// 一次跑完所有检查再统一报错，而不是第一条就退出——修的时候能一次看全。

export function createChecker() {
  const failures = [];
  const passed = [];
  return {
    check(name, fn) {
      try {
        fn();
        passed.push(name);
      } catch (e) {
        failures.push(`${name}: ${e.message}`);
      }
    },
    report() {
      for (const p of passed) console.log(`  ✓ ${p}`);
      if (failures.length) {
        console.error('\n检查失败：');
        for (const f of failures) console.error(`  ✗ ${f}`);
        process.exit(1);
      }
      console.log(`\n全部 ${passed.length} 项检查通过`);
    },
  };
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
```

- [ ] **Step 2: 写下会失败的产物断言**

创建 `scripts/verify-dist.mjs`：

```js
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
```

- [ ] **Step 3: 跑它，确认失败**

```bash
npm run build && node scripts/verify-dist.mjs
```

预期：四条全部 ✗，报缺少 `dist/404.html`、`dist/robots.txt`、`dist/favicon.svg` 等。

- [ ] **Step 4: 补 robots.txt**

创建 `public/robots.txt`：

```
User-agent: *
Allow: /

Sitemap: https://mimizh.dpdns.org/sitemap-index.xml
```

- [ ] **Step 5: 补 favicon 与 manifest**

创建 `public/favicon.svg`（形状呼应 `.nav-logo` 的 `mimi<span>zh</span>`。色值取自 `src/styles/global.css:14-15` 深色主题的 `--bg:#0f0e0d` 与 `--tx:#e2ddd7`，已换算好，直接用）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0f0e0d"/>
  <text x="32" y="45" font-family="Georgia, 'Times New Roman', serif" font-size="40"
        font-weight="600" fill="#e2ddd7" text-anchor="middle">m</text>
</svg>
```

创建 `public/site.webmanifest`：

```json
{
  "name": "mimizh",
  "short_name": "mimizh",
  "description": "个人笔记站 — 计算机图形学、数据库、分布式系统、游戏开发的学习记录。",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0e0d",
  "theme_color": "#0f0e0d",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" },
    { "src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" }
  ]
}
```

生成 `public/apple-touch-icon.png`（180×180，一次性产物，不进依赖）：

```bash
npx --yes sharp-cli --input public/favicon.svg --output public/apple-touch-icon.png resize 180 180
```

若 `sharp-cli` 不可用，用任意工具把 `favicon.svg` 导出成 180×180 PNG 放到该路径即可——它不参与构建。

- [ ] **Step 6: 补 404 页**

创建 `src/pages/404.astro`：

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="页面不存在" description="找不到这个页面。">
  <div class="main main-col">
    <div class="home-wrap fu">
      <h1 class="home-name">404</h1>
      <p class="home-p">这个地址下没有内容。可能是笔记改了路径，也可能是链接抄漏了一段。</p>
      <hr class="home-hr" />
      <div class="home-sec">试试</div>
      <button class="home-link" id="btn-404-search" type="button"
              style="border:none;background:none;cursor:pointer;text-align:left;width:100%">
        <span class="home-link-ic">⌕</span>搜索全站（或按 ⌘K）
      </button>
      <a href="/notes/" class="home-link"><span class="home-link-ic">→</span>浏览笔记</a>
      <a href="/" class="home-link"><span class="home-link-ic">→</span>回到首页</a>
    </div>
  </div>
</BaseLayout>

<script>
  // 复用 BaseLayout 已有的搜索浮层，不新增逻辑
  document.addEventListener('astro:page-load', () => {
    const btn = document.getElementById('btn-404-search');
    if (btn) btn.addEventListener('click', () => document.getElementById('btn-search')?.click());
  });
</script>
```

- [ ] **Step 7: head 里补 icon 链接**

修改 `src/layouts/BaseLayout.astro`，在 `<link rel="canonical" ...>` 那一行之后插入：

```astro
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#0f0e0d" />
```

- [ ] **Step 8: 构建并确认 404 的落点**

```bash
npm run build
ls -l dist/404.html || ls -l dist/404/index.html
```

预期：存在 `dist/404.html`。

⚠️ 若实际产出的是 `dist/404/index.html`，说明 `build.format: 'directory'` 对 404 也生效了。此时把 `package.json` 的 `build` 脚本改成：

```json
"build": "astro build && pagefind --site dist && node -e \"const fs=require('fs');if(!fs.existsSync('dist/404.html')&&fs.existsSync('dist/404/index.html'))fs.copyFileSync('dist/404/index.html','dist/404.html')\"",
```

不要跳过这个判断——GitHub Pages 只读根部的 `404.html`。

- [ ] **Step 9: 跑 verify-dist，确认通过**

```bash
node scripts/verify-dist.mjs
```

预期：四条全部 ✓，末行 `全部 4 项检查通过`。

- [ ] **Step 10: 挂进 package.json 与 CI**

`package.json` 的 `scripts` 加：

```json
    "verify:dist": "node scripts/verify-dist.mjs",
```

修改 `.github/workflows/deploy.yml`，在 `- run: npm run build` 之后插入：

```yaml
      - run: npm run verify:dist
```

- [ ] **Step 11: 提交**

```bash
git add scripts/lib/assert.mjs scripts/verify-dist.mjs src/pages/404.astro public/robots.txt public/favicon.svg public/apple-touch-icon.png public/site.webmanifest src/layouts/BaseLayout.astro package.json .github/workflows/deploy.yml
git commit -m "feat: 补 favicon / 404 / robots / manifest，并立起构建后护栏"
```

---

### Task 3: CJK 字体子集流水线与覆盖率护栏

A1 的第一半。产出 `public/fonts/` 里的子集 woff2 与 `coverage.json`，并把「写了新字忘了重跑」变成 CI 红灯。

**Files:**
- Create: `scripts/lib/charset.mjs`
- Create: `scripts/subset-fonts.mjs`
- Create: `scripts/verify.mjs`
- Create: `public/fonts/`（产物）
- Create: `scripts/assets/og-fonts/`（Task 6 用）
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `scripts/lib/assert.mjs` 的 `createChecker` / `assert`（Task 2 产出）
- Produces: `scripts/lib/charset.mjs` 导出 `collectCodepoints(): number[]`（升序去重的十进制码点数组，覆盖 CJK 统一表意文字、扩展 A、CJK 标点与全角形式）。`public/fonts/coverage.json` 结构见 Step 5。Task 4 会引用 `public/fonts/noto-serif-sc-subset.woff2` 与 `noto-sans-sc-subset.woff2` 这两个文件名；Task 6 会读 `scripts/assets/og-fonts/og-serif-400.woff2` 与 `og-sans-600.woff2`。

- [ ] **Step 1: 装依赖，取可变字体源**

```bash
npm i -D subset-font
mkdir -p fonts/source scripts/assets/og-fonts public/fonts
```

下载两个 CJK 可变字体到 `fonts/source/`（该目录不进 git）。首选 notofonts/noto-cjk 仓库的 Variable/OTF/Subset 目录：

```bash
curl -fL -o fonts/source/NotoSerifSC-VF.otf \
  https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/OTF/Subset/NotoSerifSC-VF.otf
curl -fL -o fonts/source/NotoSansSC-VF.otf \
  https://github.com/notofonts/noto-cjk/raw/main/Sans/Variable/OTF/Subset/NotoSansSC-VF.otf
ls -lh fonts/source/
```

预期：两个文件各 8–20MB。

⚠️ 若 404 或体积明显不对（比如几 KB 的 HTML 错误页），去 https://github.com/notofonts/noto-cjk 的 releases 里找当前的 Variable OTF 路径。**不要**用 Google Fonts 网页下载的 zip——那里面是静态字重，不带 `wght` 轴，后面保留字重轴会失败。

- [ ] **Step 2: 探针——确认拿到的确实是可变字体**

```bash
node -e "
const fs=require('fs');
for (const f of ['NotoSerifSC-VF.otf','NotoSansSC-VF.otf']) {
  const b=fs.readFileSync('fonts/source/'+f);
  console.log(f, b.length, b.includes(Buffer.from('fvar')) ? 'HAS fvar' : 'NO fvar');
}
"
```

预期：两行都是 `HAS fvar`（`fvar` 表的存在即可变字体）。若为 `NO fvar`，回到 Step 1 换源，不要继续往下走。

- [ ] **Step 3: 写字符集收集器**

创建 `scripts/lib/charset.mjs`：

```js
// ── 站点 CJK 字符集收集 ───────────────────────────────────
// 子集脚本和覆盖率检查共用这一份实现。两边各写一遍口径必然漂移，
// 结果就是「子集脚本觉得够了、检查脚本觉得不够」这类假警报。
import fs from 'node:fs';
import path from 'node:path';

/** 扫描哪些目录/文件。UI 文案在 astro/ts 里，正文在 md 里，两边都要覆盖。 */
const ROOTS = ['src/content', 'src/pages', 'src/components', 'src/layouts', 'src/config.ts'];
const EXTS = new Set(['.md', '.astro', '.ts', '.mjs']);
const SKIP_DIRS = new Set(['.obsidian', 'node_modules']);

/** 需要覆盖的区段：CJK 统一表意文字、扩展 A、CJK 标点、全角/半角形式 */
function isTarget(cp) {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
}

function walk(target, acc) {
  const st = fs.statSync(target);
  if (st.isFile()) {
    if (EXTS.has(path.extname(target))) acc.push(target);
    return;
  }
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    walk(path.join(target, e.name), acc);
  }
}

/** @returns {number[]} 升序去重的十进制码点 */
export function collectCodepoints() {
  const files = [];
  for (const r of ROOTS) if (fs.existsSync(r)) walk(r, files);
  const set = new Set();
  for (const f of files) {
    for (const ch of fs.readFileSync(f, 'utf8')) {
      const cp = ch.codePointAt(0);
      if (isTarget(cp)) set.add(cp);
    }
  }
  return [...set].sort((a, b) => a - b);
}
```

- [ ] **Step 4: 跑一遍，核对数量**

```bash
node -e "import('./scripts/lib/charset.mjs').then(m=>console.log(m.collectCodepoints().length))"
```

预期：1209 左右（当前仓库实测 1209，其中汉字 1195）。数量随内容增长而变，落在 1100–1400 区间都正常。

- [ ] **Step 5: 写子集脚本**

创建 `scripts/subset-fonts.mjs`：

```js
#!/usr/bin/env node
// ── CJK 字体子集化 ────────────────────────────────────────
// 手动跑：npm run fonts
// 产物进 git（public/fonts/），CI 不执行本脚本，因此 CI 不需要联网拉字体。
// 内容里出现新汉字时必须重跑，否则 npm run verify 会红。
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';
import { collectCodepoints } from './lib/charset.mjs';

const SRC_DIR = path.join('fonts', 'source');
const OUT_DIR = path.join('public', 'fonts');
const OG_DIR = path.join('scripts', 'assets', 'og-fonts');

const FAMILIES = [
  { src: 'NotoSerifSC-VF.otf', out: 'noto-serif-sc-subset.woff2', ogOut: 'og-serif-400.woff2', ogWeight: 400 },
  { src: 'NotoSansSC-VF.otf', out: 'noto-sans-sc-subset.woff2', ogOut: 'og-sans-600.woff2', ogWeight: 600 },
];

const cps = collectCodepoints();
const text = cps.map((cp) => String.fromCodePoint(cp)).join('');
console.log(`字符集：${cps.length} 个码点`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(OG_DIR, { recursive: true });

for (const fam of FAMILIES) {
  const srcPath = path.join(SRC_DIR, fam.src);
  if (!fs.existsSync(srcPath)) {
    console.error(`缺少源字体 ${srcPath}——见 plan Task 3 Step 1 的下载命令`);
    process.exit(1);
  }
  const buf = fs.readFileSync(srcPath);

  // 站点用：保留 wght 300–700 轴，一个文件覆盖全部字重
  const variable = await subsetFont(buf, text, {
    targetFormat: 'woff2',
    variationAxes: { wght: { min: 300, max: 700 } },
  });
  fs.writeFileSync(path.join(OUT_DIR, fam.out), variable);
  console.log(`  ${fam.out}  ${(variable.length / 1024).toFixed(0)} KB`);

  // OG 图用：satori 对可变字体的字重选择不可靠，另出一份定死字重的静态子集。
  // 不放 public/——它只在构建期被 satori 读取，不对浏览器服务。
  const stat = await subsetFont(buf, text, {
    targetFormat: 'woff2',
    variationAxes: { wght: fam.ogWeight },
  });
  fs.writeFileSync(path.join(OG_DIR, fam.ogOut), stat);
  console.log(`  ${fam.ogOut}  ${(stat.length / 1024).toFixed(0)} KB`);
}

fs.writeFileSync(
  path.join(OUT_DIR, 'coverage.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceFonts: FAMILIES.map((f) => f.src),
    codepoints: cps,
    count: cps.length,
  }) + '\n'
);
console.log(`  coverage.json  ${cps.length} 个码点`);
```

- [ ] **Step 6: 跑子集，核对体积**

`package.json` 的 `scripts` 加：

```json
    "fonts": "node scripts/subset-fonts.mjs",
```

然后：

```bash
npm run fonts
ls -lh public/fonts/ scripts/assets/og-fonts/
```

预期：四个 woff2 各 150–350KB，`coverage.json` 约 10KB。

⚠️ 若 `subset-font` 报 CFF2 相关错误，说明它这一版对 OTF/CFF2 可变字体支持不全。把 Step 1 的源换成同仓库 `Variable/TTF/` 下的 `.ttf` 版本重跑——TTF glyf 轮廓的子集路径更成熟。

- [ ] **Step 7: 写下会失败的覆盖率检查**

创建 `scripts/verify.mjs`：

```js
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
```

- [ ] **Step 8: 跑它确认通过，再人为破坏一次确认它会红**

```bash
node scripts/verify.mjs
```

预期：两条 ✓。

然后验证护栏真的有效——往任意一篇笔记末尾加一个站内没出现过的生僻字：

```bash
printf '\n龘\n' >> "src/content/notes/Database/CMU 115-445/01_Buffer Pool Manager.md"
node scripts/verify.mjs
```

预期：`✗ 字体子集覆盖了全部站内 CJK 字符: 有 1 个字符不在子集里：龘`，退出码 1。

还原：

```bash
git checkout -- "src/content/notes/Database/CMU 115-445/01_Buffer Pool Manager.md"
node scripts/verify.mjs
```

预期：恢复两条 ✓。

- [ ] **Step 9: 忽略源字体，挂进 CI**

`.gitignore` 追加：

```
# CJK 可变字体源文件，太大不进仓库；子集产物在 public/fonts/
fonts/source/
```

`package.json` 的 `scripts` 加：

```json
    "verify": "node scripts/verify.mjs",
```

`.github/workflows/deploy.yml` 里，在 `- run: npm run check` 之后插入：

```yaml
      - run: npm run verify
```

- [ ] **Step 10: 提交**

```bash
git add scripts/lib/charset.mjs scripts/subset-fonts.mjs scripts/verify.mjs public/fonts scripts/assets/og-fonts .gitignore package.json package-lock.json .github/workflows/deploy.yml
git commit -m "feat: CJK 字体子集流水线与覆盖率护栏"
```

---

### Task 4: 拉丁字体本地化、KaTeX 本地化、摘掉 CDN

A1 的第二半。这一步之后 `<head>` 里不再有任何外域请求。

**Files:**
- Create: `src/styles/fonts.css`
- Create: `src/styles/fonts.ts`
- Modify: `src/layouts/BaseLayout.astro:58-63` 与 `__mzFontPresets`
- Modify: `src/styles/global.css:4`
- Modify: `scripts/verify-dist.mjs`（追加外域断言）
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 3 产出的 `public/fonts/noto-serif-sc-subset.woff2`、`noto-sans-sc-subset.woff2`；Task 2 产出的 `createChecker` / `assert`
- Produces: CSS 字族名 `'Noto Serif SC Subset'` 与 `'Noto Sans SC Subset'`——Task 7 若要在首页显式指定 CJK 字体，用这两个名字。

- [ ] **Step 1: 写下会失败的外域断言**

修改 `scripts/verify-dist.mjs`，在 `c.report();` 之前插入：

```js
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
```

- [ ] **Step 2: 跑它，确认失败**

```bash
npm run build && node scripts/verify-dist.mjs
```

预期：`✗ 产物 HTML 不含任何外域引用: 有 N 处外域引用`（每个页面各一条 googleapis、一条 jsdelivr，N 约为页面数的两倍）。

- [ ] **Step 3: 装拉丁字体包**

优先用可变字体包（一个包覆盖整条字重轴）。先探查哪些有可变版本：

```bash
npm view @fontsource-variable/lora version
npm view @fontsource-variable/source-serif-4 version
npm view @fontsource-variable/dm-sans version
npm view @fontsource-variable/inter version
npm view @fontsource-variable/jetbrains-mono version
```

能查到版本的装可变包，查不到的改装同名静态包 `@fontsource/<name>`。Space Mono 与 Atkinson Hyperlegible 没有可变版本，一律静态：

```bash
npm i @fontsource-variable/lora @fontsource-variable/source-serif-4 \
      @fontsource-variable/dm-sans @fontsource-variable/inter \
      @fontsource-variable/jetbrains-mono \
      @fontsource/space-mono @fontsource/atkinson-hyperlegible
```

- [ ] **Step 4: 集中声明拉丁字体**

创建 `src/styles/fonts.ts`：

```ts
// ── 拉丁字体 ──────────────────────────────────────────────
// 由 Fontsource 提供，Vite 打包并带内容 hash。全部是副作用 import：
// 每个 css 文件里是该字族的 @font-face 与它自带的 unicode-range。
// 改这里之前先确认 BaseLayout 的 __mzFontPresets 用的是同一批字族名。
import '@fontsource-variable/lora';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';

// ── KaTeX ─────────────────────────────────────────────────
// katex 本来就是依赖（rehype-katex 用它做构建期渲染），这里只是把它的
// 样式表从 jsdelivr 换成本地。字体文件由 Vite 从 css 里的相对路径解析。
import 'katex/dist/katex.min.css';
```

站点正文用到斜体（`Lora` 与 `Source Serif 4` 的 ital 轴，原 Google Fonts 请求里带 `ital`）。装完后列出各包实际提供的斜体入口，按结果在上面补 import：

```bash
ls node_modules/@fontsource-variable/lora/ node_modules/@fontsource-variable/source-serif-4/ | grep -i italic
```

若某个包没有斜体文件，就不补——正文斜体会由浏览器合成，可以接受。

- [ ] **Step 5: 声明 CJK 与输入框回退**

创建 `src/styles/fonts.css`：

```css
/* ── CJK 子集字体 ─────────────────────────────────────────
   由 scripts/subset-fonts.mjs 生成，只含站内实际出现的字符。
   走 public/ 的固定路径而非 Vite 打包，是为了让 BaseLayout 里的
   preload 能写死 URL——Vite 打包后的文件名带内容 hash，写不死。 */
@font-face {
  font-family: 'Noto Serif SC Subset';
  src: url('/fonts/noto-serif-sc-subset.woff2') format('woff2-variations');
  font-weight: 300 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Noto Sans SC Subset';
  src: url('/fonts/noto-sans-sc-subset.woff2') format('woff2-variations');
  font-weight: 300 700;
  font-style: normal;
  font-display: swap;
}

/* ── 输入框回退 ───────────────────────────────────────────
   子集只覆盖站内出现过的字。用户在搜索框里敲的字未必在其中，
   用子集字体会出豆腐块，所以输入类元素一律走系统字体。 */
.search-in,
.tree-filter {
  font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
```

- [ ] **Step 6: 摘掉两个 CDN link，引入本地字体**

修改 `src/layouts/BaseLayout.astro`。删除这四行（两条 `preconnect`、Google Fonts 的 `<link href="https://fonts.googleapis.com/css2?family=...">`、jsdelivr 的 KaTeX `<link>`），把它们替换为：

```astro
  <link rel="preload" href="/fonts/noto-serif-sc-subset.woff2" as="font" type="font/woff2" crossorigin />
```

只 preload 这一个。spec 4.6 原本还想 preload Source Serif 4，但 Fontsource 经 Vite 打包后文件名带内容 hash，静态 `<link>` 写不死路径——这正是 spec 4.6 那条 ⚠️ 说的情况。CJK 子集走 `public/` 的固定路径，所以能 preload，而它恰好是首屏最大、最该抢跑的那个。拉丁字体体积小得多（20–40KB），靠 `font-display: swap` 足够。

并在 frontmatter 里 `import '../styles/global.css';` 之前加两行：

```astro
import '../styles/fonts.ts';
import '../styles/fonts.css';
```

- [ ] **Step 7: 改字体预设表**

先查出各包声明的真实字族名——可变包的名字带 ` Variable` 后缀，静态包不带，写错的表现是静默回退到 Georgia 而不报错：

```bash
grep -h "font-family:" \
  node_modules/@fontsource-variable/lora/index.css \
  node_modules/@fontsource-variable/source-serif-4/index.css \
  node_modules/@fontsource-variable/dm-sans/index.css \
  node_modules/@fontsource-variable/inter/index.css \
  node_modules/@fontsource-variable/jetbrains-mono/index.css \
  node_modules/@fontsource/space-mono/400.css \
  node_modules/@fontsource/atkinson-hyperlegible/400.css | sort -u
```

按输出订正后，修改 `src/layouts/BaseLayout.astro` 里的 `window.__mzFontPresets`，把 `'Noto Serif SC'` / `'Noto Sans SC'` 换成子集族名，拉丁族名换成上面查到的真名：

```js
    window.__mzFontPresets = {
      serif: { fh: "'Lora Variable','Noto Serif SC Subset',Georgia,serif", fb: "'Source Serif 4 Variable','Noto Serif SC Subset',Georgia,serif", fm: "'JetBrains Mono Variable','Noto Sans SC Subset',monospace" },
      sans:  { fh: "'DM Sans Variable','Noto Sans SC Subset',system-ui,sans-serif", fb: "'Inter Variable','Noto Sans SC Subset',system-ui,sans-serif", fm: "'JetBrains Mono Variable','Noto Sans SC Subset',monospace" },
      mono:  { fh: "'Space Mono','Noto Sans SC Subset',monospace", fb: "'Atkinson Hyperlegible','Noto Sans SC Subset',system-ui,sans-serif", fm: "'JetBrains Mono Variable','Noto Sans SC Subset',monospace" },
      cn:    { fh: "'Noto Serif SC Subset',Georgia,serif", fb: "'Noto Sans SC Subset',system-ui,sans-serif", fm: "'JetBrains Mono Variable','Noto Sans SC Subset',monospace" }
    };
```

- [ ] **Step 8: 同步 global.css 的默认值**

修改 `src/styles/global.css:4`，把三个字体变量的默认值改成与 serif 预设一致（首屏 JS 执行前用的就是这一份）：

```css
  --fh:'Lora Variable','Noto Serif SC Subset',Georgia,serif;--fb:'Source Serif 4 Variable','Noto Serif SC Subset',Georgia,serif;--fm:'JetBrains Mono Variable','Noto Sans SC Subset',monospace;
```

- [ ] **Step 9: 构建并验证**

```bash
npm run build && node scripts/verify-dist.mjs
ls -lh dist/fonts/
grep -c "googleapis\|jsdelivr" dist/index.html
```

预期：外域断言 ✓，全部 5 项通过；`dist/fonts/` 下有两个 woff2 与 `coverage.json`；grep 计数为 0。

- [ ] **Step 10: 人工验收（只有作者能做）**

```bash
npm run preview
```

浏览器打开 http://localhost:4321 ，开 DevTools → Network → Font：

1. 确认**没有任何**指向 `fonts.gstatic.com` 或 `cdn.jsdelivr.net` 的请求
2. 确认加载了 `/fonts/noto-serif-sc-subset.woff2`
3. 打开设置面板，四套预设逐一切换，中英文都要正常换字体
4. 打开 `/notes/Computer Graphic/DirectX12/01_Vector_Algebra/`，确认公式排版正常
5. 在搜索框里敲几个生僻字（如「龘齉」），确认显示为系统字体而非豆腐块

- [ ] **Step 11: 提交**

```bash
git add src/styles/fonts.css src/styles/fonts.ts src/layouts/BaseLayout.astro src/styles/global.css scripts/verify-dist.mjs package.json package-lock.json
git commit -m "feat: 字体与 KaTeX 全部自托管，摘掉两个外域"
```

---

### Task 5: mermaid 构建期预渲染

**Files:**
- Create: `src/plugins/mermaid-prerender.mjs`
- Create: `src/plugins/mermaid-prerender.d.mts`
- Modify: `astro.config.mjs`
- Modify: `src/plugins/markdown.mjs`（删掉 `remarkMermaid` 与 `escAttr`）
- Modify: `src/layouts/BaseLayout.astro`（删运行时 script）
- Modify: `src/styles/global.css`（双主题 SVG 显隐）
- Modify: `package.json`

**Interfaces:**
- Consumes: 无
- Produces: `remarkMermaidPrerender(): (tree) => Promise<void>`；`mermaidPrerenderIntegration(): { name: string; hooks: Record<string, () => Promise<void>> }`（负责在 `astro:build:done` 关掉浏览器）。

- [ ] **Step 1: 建一篇临时探针笔记**

⚠️ 目录名不能以 `_` 开头——Astro 内容集合会整体忽略下划线开头的文件与目录（`src/utils/tree.ts:20` 的注释里写明了这一点），探针笔记根本不会被渲染出来。

```bash
mkdir -p "src/content/notes/tmp-probe"
cat > "src/content/notes/tmp-probe/mermaid-probe.md" <<'PROBE'
---
title: Mermaid 预渲染探针
date: 2026-08-28
draft: true
---

## 图

```mermaid
graph LR
  A[Client] --> B[BufferPool]
  B --> C[Disk]
```
PROBE
```

（探针里刻意用英文标签：新增汉字会让 Task 3 的覆盖率护栏变红，与本任务无关。）

- [ ] **Step 2: 记录改动前的基线**

```bash
npm run build
du -sh dist/_astro
find dist/_astro -name "*.js" -exec du -ch {} + | tail -1
grep -c 'class="mermaid"' "dist/notes/tmp-probe/mermaid-probe/index.html"
```

预期：`_astro` 约 3.6MB（Task 4 之后会更大些）、JS 约 3.4MB、页面里有 1 个 `class="mermaid"` 的 `<pre>`。记下这三个数。

- [ ] **Step 3: 装 playwright，把 mermaid 挪到 devDependencies**

```bash
npm i -D playwright
npx playwright install chromium
```

然后手改 `package.json`：把 `"mermaid": "^11.17.0"` 那一行从 `dependencies` 剪切到 `devDependencies`，跑 `npm install` 落实。

理由：预渲染本身需要 mermaid，所以不能真删；但客户端不再 import 它，Vite 就不会打包。放 devDependencies 是让这个事实在依赖清单里也成立。

- [ ] **Step 4: 写预渲染插件**

创建 `src/plugins/mermaid-prerender.mjs`：

```js
// ── Mermaid 构建期预渲染 ──────────────────────────────────
// 全部在构建期运行，产物是内联 SVG，不引入任何运行时 JS。
// 浏览器懒启动：没有 mermaid 代码块的构建完全不碰 playwright。
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

let browserPromise = null;
const cache = new Map(); // `${theme}\0${src}` → svg

async function getPage() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      const page = await browser.newPage();
      // 把 mermaid 的 UMD 包直接注入页面，避免页面去网络上取
      await page.setContent('<!doctype html><html><body></body></html>');
      await page.addScriptTag({ path: require_.resolve('mermaid/dist/mermaid.min.js') });
      return { browser, page };
    })();
  }
  return browserPromise;
}

async function renderOne(src, theme) {
  const key = `${theme}\0${src}`;
  if (cache.has(key)) return cache.get(key);
  const { page } = await getPage();
  const svg = await page.evaluate(async ([code, th]) => {
    window.mermaid.initialize({ startOnLoad: false, theme: th, securityLevel: 'strict' });
    const out = await window.mermaid.render('m' + Math.random().toString(36).slice(2), code);
    return out.svg;
  }, [src, theme]);
  cache.set(key, svg);
  return svg;
}

/** 收集树上所有 mermaid 代码块 */
function collect(tree) {
  const found = [];
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i];
      if (c.type === 'code' && (c.lang || '').toLowerCase() === 'mermaid') {
        found.push({ parent: node, index: i, src: c.value || '' });
        continue;
      }
      walk(c);
    }
  };
  walk(tree);
  return found;
}

export function remarkMermaidPrerender() {
  return async (tree) => {
    const blocks = collect(tree);
    if (!blocks.length) return; // 没图就不启动浏览器

    for (const b of blocks) {
      const [light, dark] = await Promise.all([
        renderOne(b.src, 'neutral'),
        renderOne(b.src, 'dark'),
      ]);
      // 两份都嵌进去，由 CSS 按 data-theme 显隐——比试图用 CSS 变量
      // 覆盖 mermaid 生成的 inline style 可靠得多
      b.parent.children[b.index] = {
        type: 'html',
        value:
          '<div class="mermaid-wrap">' +
          `<div class="mermaid-svg" data-mz-theme="light">${light}</div>` +
          `<div class="mermaid-svg" data-mz-theme="dark">${dark}</div>` +
          '</div>',
      };
    }
  };
}

/** 构建结束时关掉浏览器，否则 astro build 不会退出 */
export function mermaidPrerenderIntegration() {
  return {
    name: 'mermaid-prerender',
    hooks: {
      'astro:build:done': async () => {
        if (!browserPromise) return;
        const { browser } = await browserPromise;
        await browser.close();
        browserPromise = null;
      },
    },
  };
}
```

创建 `src/plugins/mermaid-prerender.d.mts`：

```ts
export function remarkMermaidPrerender(): (tree: unknown) => Promise<void>;

export function mermaidPrerenderIntegration(): {
  name: string;
  hooks: Record<string, () => Promise<void>>;
};
```

- [ ] **Step 5: 换掉 astro.config.mjs 的接线**

修改 `astro.config.mjs`：从 `./src/plugins/markdown.mjs` 的 import 列表里删掉 `remarkMermaid`，新增一行：

```js
import { remarkMermaidPrerender, mermaidPrerenderIntegration } from './src/plugins/mermaid-prerender.mjs';
```

`integrations` 数组末尾加：

```js
    mermaidPrerenderIntegration(),
```

`remarkPlugins` 里把 `remarkMermaid` 换成 `remarkMermaidPrerender`（位置不变，仍在最前——它要赶在 Expressive Code 之前把代码块摘走）：

```js
    remarkPlugins: [remarkMermaidPrerender, remarkMath, remarkAssetLinks, remarkWikiLinks],
```

然后从 `src/plugins/markdown.mjs` 里删掉 `remarkMermaid` 函数与只被它使用的 `escAttr`——已无调用方。

- [ ] **Step 6: 删掉运行时 script**

修改 `src/layouts/BaseLayout.astro`，删除 `</body>` 之前那整段 `<script>`（从注释 `// Mermaid：仅当页面存在图表时才动态载入` 到该 `</script>` 为止），连同 `mermaidLib`、`renderMermaid` 与两个 `addEventListener`。

- [ ] **Step 7: 加双主题显隐样式**

`src/styles/global.css` 末尾追加：

```css
/* ── 预渲染的 mermaid 图：两份 SVG 按主题显隐 ── */
.mermaid-svg{display:none}
[data-theme="light"] .mermaid-svg[data-mz-theme="light"],
[data-theme="dark"] .mermaid-svg[data-mz-theme="dark"]{display:block}
.mermaid-svg svg{max-width:100%;height:auto}
```

- [ ] **Step 8: 构建并核对三个数**

```bash
npm run build
du -sh dist/_astro
find dist/_astro -name "*.js" -exec du -ch {} + | tail -1
grep -c '<svg' "dist/notes/tmp-probe/mermaid-probe/index.html"
grep -c 'class="mermaid"' "dist/notes/tmp-probe/mermaid-probe/index.html"
```

预期：JS 从约 3.4MB 降到数十 KB；页面里有 2 个 `<svg>`（light + dark）；`class="mermaid"` 计数为 0。

`_astro` 总量不会同步降到数十 KB——Task 4 往里放了约 500KB 拉丁字体，总量预计落在 700KB 上下。这是预期的。

- [ ] **Step 9: 肉眼验收双主题**

```bash
npm run preview
```

打开 http://localhost:4321/notes/tmp-probe/mermaid-probe/ ，点导航栏的 ◐ 切换明暗，确认图表配色跟着变，且切换时不闪烁、不重排。

- [ ] **Step 10: 删掉探针笔记，重新构建**

```bash
rm -rf "src/content/notes/tmp-probe"
npm run build && node scripts/verify.mjs && node scripts/verify-dist.mjs
```

预期：全部通过；构建耗时与改动前相当（没有 mermaid 块时不启动浏览器）。

- [ ] **Step 11: 提交**

```bash
git add src/plugins/mermaid-prerender.mjs src/plugins/mermaid-prerender.d.mts src/plugins/markdown.mjs astro.config.mjs src/layouts/BaseLayout.astro src/styles/global.css package.json package-lock.json
git commit -m "perf: mermaid 改为构建期预渲染，运行时零 JS"
```

---

### Task 6: OG 卡片图

**Files:**
- Create: `src/utils/og-card.ts`
- Create: `src/pages/og/[...slug].png.ts`
- Modify: `src/layouts/BaseLayout.astro`（`ogImage` prop 与 meta）
- Modify: `src/pages/notes/[...slug].astro`、`src/pages/wiki/[...slug].astro`、`src/pages/projects/[...slug].astro`
- Modify: `scripts/verify-dist.mjs`（追加 OG 断言）
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 3 产出的 `scripts/assets/og-fonts/og-serif-400.woff2`、`og-sans-600.woff2`；`src/utils/tree.ts` 的 `getFolderColor`；Task 2 的 `createChecker` / `assert`
- Produces: `renderOgCard(opts: { title: string; category: string; color: string }): Promise<Buffer>`（返回 PNG）。`BaseLayout` 新增可选 prop `ogImage?: string`（站内绝对路径，如 `/og/notes/xxx.png`）。

- [ ] **Step 1: 写下会失败的 OG 断言**

修改 `scripts/verify-dist.mjs`，在 `c.report();` 之前插入：

```js
// ── OG 图 ──
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
      if (!m) return; // 目录列表页没有 og:image，是预期的
      checked++;
      const png = path.join(DIST, decodeURIComponent(new URL(m[1]).pathname));
      if (!fs.existsSync(png)) problems.push(`${rel} 的 og:image 指向不存在的文件`);
    }
  };
  walk(DIST);
  assert(checked > 0, '一个带 og:image 的详情页都没查到，检查 ogImage prop 是否真的传下去了');
  assert(problems.length === 0, `${problems.length} 处问题：\n      ` + problems.slice(0, 5).join('\n      '));
});
```

- [ ] **Step 2: 跑它，确认失败**

```bash
npm run build && node scripts/verify-dist.mjs
```

预期：`✗ 每个内容详情页都有 og:image 且图片真实存在: 一个带 og:image 的详情页都没查到`。

- [ ] **Step 3: 装依赖**

```bash
npm i -D satori @resvg/resvg-js
```

- [ ] **Step 4: 写卡片布局**

创建 `src/utils/og-card.ts`：

```ts
// ── OG 卡片渲染 ───────────────────────────────────────────
// 构建期跑，satori 出 SVG、resvg 转 PNG。字体用 scripts/assets/og-fonts/
// 下的静态字重子集——satori 对可变字体的字重选择不可靠，所以那里另出了
// 一份定死字重的版本（见 scripts/subset-fonts.mjs）。
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const OG_FONTS = path.join(process.cwd(), 'scripts', 'assets', 'og-fonts');
const WIDTH = 1200;
const HEIGHT = 630;

type LoadedFont = { name: string; data: Buffer; weight: 400 | 600; style: 'normal' };
let fonts: LoadedFont[] | null = null;

function loadFonts(): LoadedFont[] {
  if (fonts) return fonts;
  fonts = [
    { name: 'OG Serif', data: fs.readFileSync(path.join(OG_FONTS, 'og-serif-400.woff2')), weight: 400, style: 'normal' },
    { name: 'OG Sans', data: fs.readFileSync(path.join(OG_FONTS, 'og-sans-600.woff2')), weight: 600, style: 'normal' },
  ];
  return fonts;
}

export interface OgCardOptions {
  title: string;
  /** 面包屑式的分类路径，例如 "Computer Graphic / DirectX12" */
  category: string;
  /** 该板块的强调色，十六进制 */
  color: string;
}

export async function renderOgCard({ title, category, color }: OgCardOptions): Promise<Buffer> {
  // 长标题截断：1200px 宽、64px 字号下大约能放两行
  const shown = title.length > 52 ? title.slice(0, 51) + '…' : title;

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: WIDTH, height: HEIGHT, display: 'flex',
          backgroundColor: '#0f0e0d', fontFamily: 'OG Serif',
        },
        children: [
          { type: 'div', props: { style: { width: 16, height: HEIGHT, backgroundColor: color } } },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', flexDirection: 'column',
                justifyContent: 'space-between', padding: '72px 80px', flexGrow: 1,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 28, color, fontFamily: 'OG Sans', letterSpacing: 2 },
                    children: category || '笔记',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 64, color: '#e2ddd7', lineHeight: 1.3 },
                    children: shown,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 26, color: '#a09b94', fontFamily: 'OG Sans' },
                    children: 'mimizh.dpdns.org',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    { width: WIDTH, height: HEIGHT, fonts: loadFonts() }
  );

  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng());
}
```

色值取自 `src/styles/global.css:14-15` 深色主题的 `--bg` / `--tx` / `--tx2`，已经是十六进制，直接用。

- [ ] **Step 5: 写 endpoint**

创建 `src/pages/og/[...slug].png.ts`：

```ts
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { renderOgCard } from '../../utils/og-card';
import { getFolderColor } from '../../utils/tree';

interface OgEntry {
  slug: string;
  title: string;
  category: string;
  color: string;
}

// ── 调色板：CSS 变量 → sRGB 十六进制 ──────────────────────
// getFolderColor 返回的永远是 'var(--pN)'（见 src/utils/tree.ts:191-194 的
// CAT_COLORS），而站点的 --p1..--p8 是 oklch()——satori 和 resvg 都不解析
// CSS 变量，也不解析 oklch。所以这里放一张换算好的对照表。
// 值来自 src/styles/global.css:17-18 深色主题的 --p1..--p8，经 OKLCH→sRGB 换算。
// 改了 global.css 的配色，这张表要跟着改。
const PALETTE: Record<string, string> = {
  'var(--p1)': '#5eaceb',
  'var(--p2)': '#ec9d53',
  'var(--p3)': '#65c281',
  'var(--p4)': '#b191ea',
  'var(--p5)': '#50bfbe',
  'var(--p6)': '#eb8186',
  'var(--p7)': '#d588ce',
  'var(--p8)': '#acc455',
};
/** 站点主强调色 --accent: oklch(74% .13 62) */
const ACCENT = '#e5974c';

function toHex(c: string): string {
  if (c && c.startsWith('#')) return c;
  return PALETTE[c] ?? ACCENT;
}

async function collectEntries(): Promise<OgEntry[]> {
  const out: OgEntry[] = [];

  for (const e of await getCollection('notes')) {
    // entry.id 形如 "Computer Graphic/DirectX12/01_Vector_Algebra.md"
    const segs = e.id.replace(/\.md$/, '').split('/');
    const dir = segs.slice(0, -1).join('/');
    out.push({
      slug: `notes/${segs.join('/')}`,
      title: e.data.title || segs[segs.length - 1],
      category: dir.split('/').join(' / '),
      color: toHex(getFolderColor(dir)),
    });
  }
  for (const e of await getCollection('wiki')) {
    const slug = e.id.replace(/\.md$/, '');
    // --wiki 在 global.css:35 定义为 var(--p5)
    out.push({ slug: `wiki/${slug}`, title: e.data.title, category: 'Wiki', color: PALETTE['var(--p5)'] });
  }
  for (const e of await getCollection('projects')) {
    const slug = e.id.replace(/\.md$/, '');
    // --tech 在 global.css:34 定义为 var(--p1)
    out.push({ slug: `projects/${slug}`, title: e.data.title, category: '项目', color: PALETTE['var(--p1)'] });
  }
  return out;
}

export async function getStaticPaths() {
  const entries = await collectEntries();
  return entries.map((e) => ({ params: { slug: e.slug }, props: e }));
}

export const GET: APIRoute = async ({ props }) => {
  const { title, category, color } = props as unknown as OgEntry;
  const png = await renderOgCard({ title, category, color });
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
```

⚠️ `PALETTE` 是站点配色的第二份副本，改 `global.css` 的 `--p1..--p8` 时必须同步改它。之所以接受这份重复：satori 与 resvg 都不解析 CSS 变量与 `oklch()`，构建期没有浏览器来求值。想彻底消除重复，得把色值改成 CSS 侧和 TS 侧共用的十六进制常量——那是独立的重构，不在本次范围内。

- [ ] **Step 6: 注入 og:image**

修改 `src/layouts/BaseLayout.astro`。在 `Props` 接口里加：

```ts
  /** OG 卡片图的站内绝对路径，例如 /og/notes/xxx.png */
  ogImage?: string;
```

在 props 解构里加 `ogImage,`。把原有的 `<meta name="twitter:card" content="summary" />` 那一行替换为：

```astro
  {ogImage && <meta property="og:image" content={new URL(ogImage, Astro.site ?? SITE.url).href} />}
  {ogImage && <meta property="og:image:width" content="1200" />}
  {ogImage && <meta property="og:image:height" content="630" />}
  <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
  {ogImage && <meta name="twitter:image" content={new URL(ogImage, Astro.site ?? SITE.url).href} />}
```

在 `src/pages/notes/[...slug].astro` 的 `<BaseLayout>` 上加一个 prop：

```astro
  ogImage={isNote ? `/og/notes/${node.segments.join('/')}.png` : undefined}
```

`src/pages/wiki/[...slug].astro` 里同样有 `node` 与 `isNote` 两个变量（该文件第 23–31 行建立），写法完全一致：

```astro
  ogImage={isNote ? `/og/wiki/${node.segments.join('/')}.png` : undefined}
```

`src/pages/projects/[...slug].astro` 的第 27 行有 `if (!node || node.type !== 'note' || !node.projectEntry) return Astro.redirect('/projects/');`——能走到模板的一定是详情页，所以不需要三元判断：

```astro
  ogImage={`/og/projects/${node.segments.join('/')}.png`}
```

三个板块的目录列表页与 `/notes/`、`/wiki/`、`/projects/` 索引页都不传 `ogImage`，保持无 og:image，Step 1 的断言已经把它们排除在外。

- [ ] **Step 7: 构建并验证**

```bash
npm run build && node scripts/verify-dist.mjs
ls dist/og/notes/ | head -5
du -sh dist/og
```

预期：OG 断言 ✓；`dist/og/` 下有 PNG；总量 1–3MB。

- [ ] **Step 8: 肉眼看一张**

```bash
npm run preview
```

浏览器打开 `http://localhost:4321/og/notes/Computer%20Graphic/DirectX12/01_Vector_Algebra.png`，确认：中文标题正常显示无缺字、左侧色条可见、长标题不溢出画布。

- [ ] **Step 9: 提交**

```bash
git add src/utils/og-card.ts "src/pages/og/[...slug].png.ts" src/layouts/BaseLayout.astro "src/pages/notes/[...slug].astro" "src/pages/wiki/[...slug].astro" "src/pages/projects/[...slug].astro" scripts/verify-dist.mjs package.json package-lock.json
git commit -m "feat: 构建期生成 OG 卡片图"
```

---

### Task 7: 首页落地页

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/styles/global.css`（新区块样式）

**Interfaces:**
- Consumes: `src/utils/tree.ts` 的 `buildNoteTree` / `buildWikiTree` / `buildProjectTree` / `flattenNodes` / `getFolderColor` 与 `TreeNode` 类型。Task 1 的修复经由 `TreeNode.resolvedDate` 间接生效，本任务不直接调 `resolveDate`。
- Produces: 无（终点任务）

- [ ] **Step 1: 确认数据入口（已查明，无需再摸索）**

不要用 `getCollection` + `data.draft`——那和 RSS 不是同一套口径，「最近更新」会和订阅源对不上。`src/pages/rss.xml.ts:35-36` 用的是：

```ts
flattenNodes(nodes).filter(n => !n.isDraft)
```

相关事实，都已核对：

- `src/utils/tree.ts:113,127,141` 导出 `buildNoteTree()` / `buildWikiTree()` / `buildProjectTree()`，都返回 `Promise<TreeNode[]>`
- `src/utils/tree.ts:177` 的 `flattenNodes()` **只返回 `type === 'note'` 的叶子**，目录节点不会混进来
- `TreeNode` 上已有 `segments: string[]`、`resolvedDate?: string`、`isDraft?: boolean`、`note?` / `wikiEntry?` / `projectEntry?`（`src/utils/tree.ts:4-22`）
- `resolvedDate` 是树在构建时调用 `resolveDate` 算好的，因此 Task 1 的修复会自动流到首页，不需要在这里再调一次
- 下划线开头的文件被 Astro 内容集合整体忽略，不会出现在树里，无需额外过滤

跑一遍确认树的形状符合预期：

```bash
grep -n "flattenNodes\|isDraft\|resolvedDate" src/utils/tree.ts | head
```

- [ ] **Step 2: 改写首页 frontmatter**

修改 `src/pages/index.astro`，把 frontmatter 替换为：

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';
import { buildNoteTree, buildWikiTree, buildProjectTree, flattenNodes, getFolderColor } from '../utils/tree';
import type { TreeNode } from '../utils/tree';

const homeEntries = await getCollection('home');
const h = homeEntries[0]?.data || {};
const bio = (h.bio as string || '').trim().split('\n').filter((p: string) => p.trim());

const [noteTree, wikiTree, projectTree] = await Promise.all([
  buildNoteTree(), buildWikiTree(), buildProjectTree(),
]);

// ── 最近更新：跨三个板块，按日期倒序取 6 条 ──
// draft 口径与 rss.xml.ts 完全一致：flattenNodes 取叶子，再滤掉 isDraft。
// 日期直接用树上的 resolvedDate（内部已调 Task 1 的 resolveDate）。
interface Recent { title: string; href: string; date: string; label: string; color: string }

const collect = (
  nodes: TreeNode[],
  base: string,
  title: (n: TreeNode) => string,
  meta: (n: TreeNode) => { label: string; color: string },
): Recent[] =>
  flattenNodes(nodes)
    .filter((n) => !n.isDraft)
    .map((n) => ({
      title: title(n),
      href: `${base}${n.segments.join('/')}/`,
      date: n.resolvedDate || '',
      ...meta(n),
    }));

const recent: Recent[] = [
  ...collect(noteTree, '/notes/',
    (n) => n.note?.data.title || n.name,
    (n) => ({ label: n.segments[0] || '笔记', color: getFolderColor(n.segments.slice(0, -1).join('/')) })),
  ...collect(wikiTree, '/wiki/',
    (n) => n.wikiEntry?.data.title || n.name,
    () => ({ label: 'Wiki', color: 'var(--wiki)' })),
  ...collect(projectTree, '/projects/',
    (n) => n.projectEntry?.data.title || n.name,
    () => ({ label: '项目', color: 'var(--tech)' })),
];

recent.sort((a, b) => b.date.localeCompare(a.date));
const latest = recent.slice(0, 6);

// ── 板块概览 ──
const countOf = (nodes: TreeNode[]) => flattenNodes(nodes).filter((n) => !n.isDraft).length;
const sections = [
  { label: '笔记', href: '/notes/', count: countOf(noteTree), color: 'var(--sec)' },
  { label: '项目', href: '/projects/', count: countOf(projectTree), color: 'var(--tech)' },
  { label: 'Wiki', href: '/wiki/', count: countOf(wikiTree), color: 'var(--wiki)' },
];
---
```

`getFolderColor` 在这里返回 `var(--pN)`，直接进 `style` 属性由浏览器求值——和站内其它页面同一套机制，不需要 Task 6 那张十六进制对照表（那张表只是因为 satori 没有浏览器可用）。

- [ ] **Step 3: 加两个新区块与 RSS 入口**

在模板里，把第一条 `<hr class="home-hr" />` 与「工作」区块之间插入：

```astro
      <div class="home-sec">最近更新</div>
      <div class="home-recent">
        {latest.map(r => (
          <a class="home-recent-row" href={r.href}>
            <span class="home-recent-dot" style={`background:${r.color}`}></span>
            <span class="home-recent-title">{r.title}</span>
            <span class="home-recent-meta">{r.label}</span>
            <span class="home-recent-date">{r.date}</span>
          </a>
        ))}
      </div>

      <div class="home-sec">板块</div>
      <div class="home-sections">
        {sections.map(s => (
          <a class="home-section-card" href={s.href} style={`--cc:${s.color}`}>
            <span class="home-section-dot" style={`background:${s.color}`}></span>
            <span class="home-section-label">{s.label}</span>
            <span class="home-section-count">{s.count}</span>
          </a>
        ))}
      </div>
```

在「联系」区块的最后一个链接之后补 RSS 入口：

```astro
      <a href="/rss.xml" class="home-link"><span class="home-link-ic">◈</span>RSS 订阅</a>
```

- [ ] **Step 4: 加样式**

`src/styles/global.css` 末尾追加：

```css
/* ── 首页：最近更新与板块 ── */
.home-recent{display:flex;flex-direction:column;gap:.1rem;margin:.3rem 0 1.1rem}
.home-recent-row{display:grid;grid-template-columns:8px 1fr auto auto;align-items:center;gap:.6rem;padding:.42rem .5rem;border-radius:5px;text-decoration:none;color:inherit;transition:background .18s}
.home-recent-row:hover{background:var(--sf)}
.home-recent-dot{width:6px;height:6px;border-radius:50%}
.home-recent-title{font-size:calc(.87rem * var(--fs-body));color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-recent-meta{font-size:calc(.66rem * var(--fs-ui));color:var(--tx3);font-family:var(--fm)}
.home-recent-date{font-size:calc(.66rem * var(--fs-ui));color:var(--tx3);font-family:var(--fm);font-variant-numeric:tabular-nums}
.home-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem;margin:.3rem 0 1.1rem}
.home-section-card{display:flex;align-items:center;gap:.45rem;padding:.6rem .7rem;border:1px solid var(--bd);border-radius:6px;text-decoration:none;color:inherit;transition:border-color .18s,background .18s}
.home-section-card:hover{border-color:var(--cc);background:var(--sf)}
.home-section-dot{width:7px;height:7px;border-radius:50%}
.home-section-label{font-size:calc(.82rem * var(--fs-ui));color:var(--tx)}
.home-section-count{margin-left:auto;font-size:calc(.7rem * var(--fs-ui));color:var(--tx3);font-family:var(--fm);font-variant-numeric:tabular-nums}
@media(max-width:640px){.home-recent-row{grid-template-columns:8px 1fr auto}.home-recent-meta{display:none}}
```

- [ ] **Step 5: 构建并核对**

```bash
npm run build && node scripts/verify.mjs && node scripts/verify-dist.mjs
grep -o 'home-recent-date">[^<]*' dist/index.html
```

预期：所有检查通过；输出 6 个日期，且**不全相同**（若全相同说明 Task 1 没生效）。

- [ ] **Step 6: 肉眼验收**

```bash
npm run preview
```

打开首页确认：最近更新 6 条链接可点且落对页面；板块卡片计数与实际篇数一致；RSS 入口可点；深浅两个主题下都正常；DevTools 手机模式下不横向溢出。

- [ ] **Step 7: 提交**

```bash
git add src/pages/index.astro src/styles/global.css
git commit -m "feat: 首页从名片页改造为落地页"
```

---

## 收尾

七个任务完成后跑一次完整流程，确认 CI 会跑的东西在本地也是绿的：

```bash
npm run check && npm run check:dates && npm run verify && npm run build && npm run verify:dist
```

然后按 `superpowers:finishing-a-development-branch` 决定如何并入 main。
