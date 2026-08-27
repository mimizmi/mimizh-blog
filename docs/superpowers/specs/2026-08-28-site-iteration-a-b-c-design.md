# 站点迭代设计：字体自托管 / 数据正确性 / 基础件 / 观赏性

- 日期：2026-08-28
- 分支：`feat/cjk-typography` 之后的新分支
- 范围代号：A（修流血）+ B（补基础件）+ C（观赏性）
- 状态：已通过设计评审，待转实现计划

## 1. 背景

站点当前已具备：Pagefind 全文搜索 + ⌘K、双向链接与反链、TOC 滚动高亮、阅读进度条、明暗主题、字号/字体/宽度设置面板、CJK 排版 remark/rehype 插件链、Expressive Code、KaTeX、RSS、sitemap。笔记图片已由 Astro 5 自动转 webp 并带 `width`/`height`/`loading=lazy`（已核实构建产物，非待办项）。

对现状做了一轮事实核查，发现三个层面的空档。以下数字均来自本仓库实测，不是估计：

| 事实 | 来源 |
|---|---|
| `<head>` 中有 2 个外域 render-blocking 请求 | `src/layouts/BaseLayout.astro:59`（Google Fonts，9 字族含 2 套 CJK）、`:60`（jsdelivr KaTeX CSS） |
| 21 篇笔记中 15 篇无 `date` frontmatter | 扫描 `src/content/notes/**/*.md` |
| 无 date 时回退到 `fs.statSync().birthtime` | `src/utils/metadata.ts:14` |
| 全站唯一 CJK 字符 1209 个（其中汉字 1195） | 扫描 `src/content` + `src/pages` + `src/components` + `src/layouts` + `src/config.ts` |
| 数学公式使用 89 处 | grep 全站 markdown 的行内与块级公式记号 |
| mermaid 代码块 0 个 | grep 全站 markdown 的 mermaid 围栏 |
| `dist/_astro` 3.6MB / 63 个 chunk | `mermaid.core` 682K、`cynefin` 688K、`cytoscape` 444K、`katex` 261K（后者为 mermaid 传递依赖） |
| `public/` 只有 `CNAME` 和 `assets/` | 无 favicon、无 robots.txt |
| `src/pages/` 无 `404.astro` | 但 `astro.config.mjs` 的 sitemap filter 已排除 `/404` |
| `og:image` 缺失，`twitter:card` 为 `summary` | `src/layouts/BaseLayout.astro` head |
| 实际使用的 font-weight：300 / 400 / 500 / 600 | `src/styles/global.css` |
| 首页仅 bio + 联系方式 | `src/pages/index.astro`（28 行） |
| tags 渲染为不可点胶囊，无聚合入口 | `src/pages/notes/[...slug].astro:146,178` |

### 三条核心问题

**P1 — 字体链路整体不可达。** 站点全部字体挂在 `fonts.googleapis.com`，KaTeX CSS 与其字体挂在 jsdelivr。这两个域名在中国大陆基本不可达。直接后果是上一个 commit（4de2380「中文排版：补 CJK 字体回退、中西文间距、标点挤压与等宽数字」）的成果在作者本人的网络环境下大概率从未生效，正文回退到系统宋体。89 处公式同理会在 KaTeX 字体未加载时错位。

**P2 — 无 date 笔记的日期是「构建那天」。** CI 中 `actions/checkout` 产生的文件其 `birthtime` 等于克隆时刻，因此 15 篇笔记线上显示同一日期，且每次 deploy 都会变化。列表排序、RSS 顺序、以及任何「最近更新」类功能全部失真。

**P3 — 3.4MB 死重。** mermaid 零使用却把整条依赖链打进产物。因为是动态 import，**用户实际不会下载**，代价只在仓库、构建时间与部署体积。优先级低于 P1/P2，但因零使用，处理成本也最低。

## 2. 范围

### 本次做

- A1 字体与 KaTeX 自托管 + CJK 子集化
- A2 日期改用 git 最后提交时间
- A3 mermaid 改为构建期预渲染
- B 补 favicon / 404 / robots.txt / webmanifest
- C1 构建期自动生成 OG 卡片图
- C2 首页从名片页改造为落地页

### 本次不做（留待下轮）

- D 类「发现与互动」：`/tags` 聚合页、局部关系图、giscus 评论、「在 GitHub 上编辑」
- E 类「工程护栏」中除本次顺带引入的构建断言之外的部分：wikilink 断链校验、Pagefind 中文分词实测、PWA 离线、RSS 全文
- 任何与上述无关的重构

## 3. 总体形状

```
构建期新增子系统          现有代码改动              新增静态资源
─────────────────       ──────────────          ────────────
字体子集流水线    ─┐     metadata.ts (日期)      public/fonts/*.woff2
mermaid 预渲染     ├──►  BaseLayout (去 CDN)     public/favicon.svg
OG 图生成      ◄──┘     index.astro (落地页)    public/robots.txt
                        astro.config.mjs         src/pages/404.astro
        ▲                                        src/pages/og/*.png
        └── 协同 1：OG 图复用子集字体渲染中文标题
        └── 协同 2：首页「最近更新」复用 git 日期
```

两处协同即两条依赖边：C1 依赖 A1 的字体产物，C2 依赖 A2 的日期。其余各项互不依赖，可独立验收、独立回滚。

## 4. A1 — 字体自托管与子集化

### 4.1 方案选择

| 方案 | 仓库成本 | 用户首屏下载 | 维护成本 | 豆腐块风险 |
|---|---|---|---|---|
| ① 精确子集，产物进 git（**采用**） | ~500KB | ~150KB | 加新汉字需重跑脚本，有 CI 护栏兜底 | 有，可封堵 |
| ② Fontsource 分片按需拷贝 | 0（npm 依赖） | ~400KB | 零 | 无 |
| ③ 自托管完整字体 | 45MB+ | 5MB+ | 零 | 无 |

③ 因首屏下载不可接受而排除。② 最省事，但用户下载约为 ① 的三倍且 dist 涨到约 30MB。采用 ①：站点内容全部在 repo 内、构建期可穷举字符集，1195 字的规模让精确子集小到可以 preload。这是静态站相对动态站的结构性优势，值得为它多写一个脚本。

### 4.2 字体范围

保留设置面板现有全部 4 套预设，共 9 个字族（评审已确认）：

```
serif : Lora + Source Serif 4 + Noto Serif SC     （默认）
sans  : DM Sans + Inter + Noto Sans SC
mono  : Space Mono + Atkinson Hyperlegible
cn    : Noto Serif SC + Noto Sans SC
共用  : JetBrains Mono
```

### 4.3 CJK 字体处理

- 源使用 Noto Serif SC / Noto Sans SC 的**可变字体** `.ttf`，各一个文件，**不进 git**（下载脚本或手动放置到未跟踪的 `fonts/source/`）。
- 用 `subset-font`（基于 harfbuzzjs，纯 JS，无 Python 依赖）按站点字符集子集化，保留 `wght` 300–700 轴，输出每字族一个可变 woff2，预计 150–250KB。
- 选可变字体而非切静态字重的理由：站点实际使用 300/400/500/600 四档，其中 600 目前未从 Google Fonts 加载，是浏览器合成的伪粗体。一个可变文件同时更小且更准。
- 产物提交进 `public/fonts/`；子集脚本保留在 repo 供内容变化时重跑。**CI 不执行子集化**，因而不需要联网拉取字体。

### 4.4 拉丁字体处理

7 个拉丁字族改用 Fontsource npm 包，由 Vite 打包并带内容 hash。latin/latin-ext subset 每字族约 20–40KB，无需额外子集化处理。

### 4.5 KaTeX 处理

改为本地 `katex/dist/katex.min.css`（`katex` 已是现有依赖），字体只拷贝 `fonts/*.woff2`，丢弃 ttf/woff 旧格式，约 150KB。

### 4.6 加载策略

- 全部 `@font-face` 使用 `font-display: swap`。
- 仅 preload 默认 serif 预设的两个首屏字体：Source Serif 4 400 与 Noto Serif SC 可变子集。
- 其余预设的字体在用户切换时才请求。
- `src/styles/fonts.css` 集中声明所有 `@font-face`，由 `global.css` 或 BaseLayout 引入。
- ⚠️ 实现注意：Fontsource 经 Vite 打包后文件名带内容 hash，静态 `<link rel="preload">` 无法写死路径。若无法在构建期取到解析后的 URL，则把**首屏那两个字体**直接放进 `public/fonts/` 走固定路径，其余字体仍由 Vite 打包。preload 的正确性优先于打包一致性。

### 4.7 豆腐块封堵

方案 ① 唯一的真实风险：用户在搜索框输入的汉字可能不在子集内，会显示为缺字方块。

封堵办法：给所有接受用户输入的元素单独指定 `font-family: system-ui`，正文与 UI 才使用子集字体。涉及 `.search-in`（BaseLayout 搜索框）与 `.tree-filter`（侧栏过滤框）。用户输入任何字符都不会出现豆腐块。

### 4.8 覆盖率护栏

`scripts/check-font-coverage.mjs`：

1. 扫描 `src/content/**/*.md` + `src/pages` + `src/components` + `src/layouts` + `src/config.ts`，抽出全部 CJK 码点。
2. 与子集脚本同时产出的覆盖表 `public/fonts/coverage.json` 比对。该文件结构：

```json
{
  "generatedAt": "2026-08-28T10:30:00.000Z",
  "sourceFonts": ["NotoSerifSC[wght].ttf", "NotoSansSC[wght].ttf"],
  "codepoints": [19968, 19969, 20026, 12290, 65292],
  "count": 1209
}
```

字段含义：`generatedAt` 为 ISO 8601 UTC 时间戳；`codepoints` 为十进制码点升序数组；`count` 为冗余校验值，应等于 `codepoints.length`。

3. 存在未覆盖字符时**退出码非零**，并在错误信息中列出缺失字符与重跑命令。

该脚本进入 `npm run verify`，由 CI 在 build 之前执行。目的是让「写了新字但忘了重跑子集」这一唯一的维护负担变成 CI 红灯，而不是线上静默豆腐。

### 4.9 验收

- `<head>` 中不再出现任何 `fonts.googleapis.com` / `fonts.gstatic.com` / `cdn.jsdelivr.net`。
- 4 套预设逐一切换，中英文均使用本地字体渲染。
- 公式页面在断开外网的情况下排版正常。

## 5. A2 — 日期改用 git 提交时间

- 新增 `src/utils/gitdates.ts`：构建期执行一次 `git log --format=%aI --name-only --no-renames`，一遍扫出「文件路径 → 最后提交时间」的 map，在模块级缓存。当前 28 个内容文件，成本可忽略。map 形态示例：

```
"src/content/notes/Database/CMU 115-445/01_Buffer Pool Manager.md" → "2026-04-24T11:02:33+08:00"
```

时间取 `%aI`（ISO 8601 带时区偏移）。消费侧截取到 `YYYY-MM-DD`，与现有 frontmatter `date` 的格式保持一致。

- `src/utils/metadata.ts` 的 `resolveDate` 优先级改为：**frontmatter `date` → git 最后提交时间 → `birthtime`（保留为兜底）**。
- **必须同时修改 CI**：`.github/workflows/deploy.yml` 的 `actions/checkout@v4` 需设 `fetch-depth: 0`。默认的浅克隆只有一个 commit，`git log` 会让所有文件拿到同一时间，等于换一种方式复现 P2。此项与代码改动是同一次改动的两半，不可分开合并。
- 同一份 map 额外导出「最后更新时间」，供 C2 的「最近更新」列表使用。

### 验收

- 15 篇无 `date` 的笔记在构建产物中显示各自的 git 提交日期，彼此不同。
- 连续两次 build，日期不发生变化。

## 6. A3 — mermaid 构建期预渲染

- 移除 `mermaid` 运行时依赖与 `BaseLayout.astro` 尾部的动态 import 段。当前 `dist/_astro` 的 3.6MB 中有 3.4MB 是 JS，其中绝大部分来自 mermaid（含 261KB 的 katex chunk，系其传递依赖）。移除后剩余 JS 仅 ClientRouter 与 Expressive Code 的复制按钮，预计降至数十 KB 量级。
- 注意 `dist/_astro` 的**总体**大小不会同步降到那个量级：A1 会把 7 个拉丁字族（约 500KB）打进同一目录。两项叠加后预计落在 700KB 上下。第 13 节按此口径记录。
- 新增 `src/plugins/mermaid-prerender.mjs` 取代现有 `remarkMermaid` 的运行时输出路径：remark 阶段遇到 mermaid 代码块时，用 headless chromium 渲染为内联 SVG 直接嵌入 HTML。
- **无 mermaid 块时不启动浏览器**。当前零使用状态下构建时间零增加。
- **双主题**：预渲染 SVG 主题固定，而站点有明暗切换。渲染 light 与 dark 两份，以 `[data-theme]` CSS 显隐。SVG 体积小，两份的代价可忽略；这比试图用 CSS 变量覆盖 mermaid 生成的 inline style 可靠得多。
- 收益：保留图表能力，运行时零 JS，无 JS 环境与打印均正常。

### 验收

- 新建一篇含 mermaid 块的临时笔记，构建产物中为内联 SVG 且不含 mermaid 运行时 JS。
- 明暗主题切换时图表配色跟随。
- 验收后删除该临时笔记。

## 7. B — 基础件

- **favicon**：`public/favicon.svg`，使用站点强调色与 `m` 字形，与 `.nav-logo` 呼应。`apple-touch-icon.png`（180×180）由该 SVG 导出，导出步骤写进子集脚本同级的 `scripts/` 下或手动生成一次后提交，不引入运行时依赖。另附 `site.webmanifest`（同时为将来的 PWA 打底）。BaseLayout 补相应 `<link>`。
- **404**：`src/pages/404.astro`，走 BaseLayout，提供搜索入口与返回首页链接。⚠️ 在 `build.format: 'directory'` 下必须**实测**产物是根部 `404.html` 而非 `404/index.html` —— GitHub Pages 只识别前者。不得依据记忆下结论；实测结果若为后者，需针对性处理。
- **robots.txt**：`public/robots.txt`，allow all，并声明指向 `https://mimizh.dpdns.org/sitemap-index.xml` 的 `Sitemap:` 行。
- 完成后 `astro.config.mjs` 中既有的 `filter: (page) => !page.includes('/404')` 才名副其实。

## 8. C1 — OG 卡片图

- `satori`（JSX → SVG）+ `@resvg/resvg-js`（SVG → PNG），全部构建期，无运行时成本。
- **字体取自 A1 的子集产物** —— satori 需要嵌入字体数据才能渲染中文标题，正好复用，这是两个新子系统的协同点。
- `src/pages/og/[...slug].png.ts` 使用 `getStaticPaths`，为每个内容页生成一张。当前 43 个页面 × 约 40KB ≈ 1.7MB。
- 视觉沿用站点语言：深色底、左侧分类色竖条、大号标题、下方分类路径与 `mimizh.dpdns.org`。分类色取自 `src/utils/tree.ts` 的 `getFolderColor`，与站内保持一致。
- BaseLayout 注入 `og:image`，并将 `twitter:card` 由 `summary` 升为 `summary_large_image`。

### 验收

- OG 图数量等于内容页数量。
- 中文标题正常渲染，无缺字。
- 长标题有截断或缩排处理，不溢出画布。

## 9. C2 — 首页落地页

`src/pages/index.astro` 由名片页扩展为落地页，保留身份感并补上入口：

1. 问候与 bio（原样保留，仍从 `src/content/home/home.md` 读取）
2. **最近更新**：跨 notes / wiki / projects 取最新 6 条，带分类色点与日期（依赖第 5 节的 git 日期，否则列表无意义）
3. **板块概览**：三个版块各自篇数与色点，可点击进入
4. 联系方式（原样保留）与 **RSS 入口** —— 当前 RSS 仅存在于 `<head>`，页面上没有任何入口

全部构建期生成，无运行时成本。草稿（`draft: true`）不进入「最近更新」，与现有 RSS 行为一致。

## 10. 实现顺序

按依赖排序，每步独立可验收、可回滚：

1. **A2 日期**（含 CI `fetch-depth: 0`）—— 最小、无依赖、立即修正数据正确性
2. **B 基础件** —— 独立、快
3. **A1 字体** —— 最大的一块，C1 依赖其产物
4. **A3 mermaid** —— 独立
5. **C1 OG 图** —— 依赖 A1
6. **C2 首页** —— 依赖 A2

## 11. 验收与护栏

静态站无测试框架，护栏做成构建期断言。

新增 `npm run verify`，包含三类检查：

1. **字体覆盖率**：内容中出现而子集未覆盖的汉字 → 失败（见 4.8）
2. **产物断言**：`404.html` 存在于 dist 根部；OG 图数量等于内容页数量；`public/fonts/` 非空
3. **外域断言**：构建产物的所有 HTML 中不含 `googleapis.com`、`gstatic.com`、`jsdelivr.net` —— 这一条把 P1 变成不可回归的问题

CI 流程调整为：`npm run check` → `npm run verify` → `npm run build`，且 checkout 步骤设 `fetch-depth: 0`。

**需要作者人工验收的一项**：在中国大陆网络环境下本地 `npm run preview`，开 DevTools Network 面板确认无任何外域字体请求，且中文正文渲染为 Noto Serif SC 而非系统宋体。此项无法由 CI 或开发者代验。

## 12. 依赖变更

新增：`subset-font`、`satori`、`@resvg/resvg-js`、`playwright`（dev）、7 个 `@fontsource/*`（Lora、Source Serif 4、DM Sans、Inter、Space Mono、Atkinson Hyperlegible、JetBrains Mono）。

移除：`mermaid`。

具体版本在实现时核实当前可用版本，本文不预设版本号。

## 13. 预期影响

| 指标 | 现在 | 之后 |
|---|---|---|
| `<head>` 外域请求 | 2 个（大陆均不可达） | 0 |
| 首屏字体下载 | 请求失败，回退系统宋体 | 约 150KB，本地 |
| `dist/_astro` 中的 JS | 3.4MB / 63 chunk | 数十 KB（仅 ClientRouter + 复制按钮） |
| `dist/_astro` 总体 | 3.6MB | 约 700KB（JS 缩水，新增拉丁字体约 500KB） |
| 无 `date` 笔记的日期 | 15 篇同为构建日，每次 deploy 变化 | 各自的 git 提交日期 |
| 分享卡片 | 纯文字 | 每页一张图 |
| 首页 | 名片 | 落地页（最近更新 + 板块 + RSS 入口） |

## 14. 风险

| 风险 | 缓解 |
|---|---|
| 新增汉字未重跑子集 → 线上豆腐块 | 4.8 的覆盖率护栏让 CI 红灯 |
| 用户搜索框输入生僻字 → 豆腐块 | 4.7 输入类元素回退 `system-ui` |
| CI 浅克隆导致 git 日期全同 | 第 5 节强制 `fetch-depth: 0`，与代码同次提交 |
| `404.html` 输出路径与 GitHub Pages 期望不符 | 第 7 节要求实测产物，不依赖记忆 |
| playwright 使 CI 变慢 | 无 mermaid 块时不启动浏览器；当前零使用即零成本 |
| OG 图中文缺字 | 字体源与正文子集同一份，字符集一致 |
