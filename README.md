# mimizh-blog

个人博客/笔记站点，基于 Astro 构建。创建 Markdown 文件，一键生成静态 HTML，部署到 GitHub Pages / Vercel。

## 快速开始

```bash
npm install
npm run dev          # 开发预览 → http://localhost:4321
npm run build        # 构建 → dist/
```

## 内容结构

```
src/content/
├── home/
│   └── home.md          # 首页/关于页面
├── notes/               # 笔记（技术/读书/生活…）
│   ├── tech/            #  ← 文件夹 = 分类
│   │   └── my-post.md
│   ├── reading/
│   └── life/
├── projects/            # 项目展示
│   └── my-project.md
└── wiki/                # 知识库/Wiki
    ├── cs/              #  ← 文件夹 = 分区
    ├── papers/          #     论文笔记含PDF阅读器
    └── tools/
```

## 如何写笔记

在 `src/content/notes/分类名/` 下创建 `.md` 文件：

```markdown
---
title: 文章标题
date: "2025-04-24"
description: 简短描述（可选）
tags: [rust, systems]
reading_time: 12 min
---

正文内容，支持 **Markdown** 语法。

## 二级标题

- 列表项
- 另一项

代码块自动高亮（Shiki）：

\`\`\`rust
fn main() {
    println!("Hello");
}
\`\`\`

内联代码 `let x = 1` 和数学公式：

行内公式 $E = mc^2$

块级公式 $$\\int_0^\\infty e^{-x^2} dx$$

> 引用块
</katex>
```

## 如何添加新分类

### 笔记新分类

**方式一：直接创建文件夹**（推荐）

直接创建 `src/content/notes/摄影/` 文件夹并放入 `.md` 文件，构建后自动出现在侧栏。显示名为文件夹名，颜色自动轮换。

**方式二：配置显示信息**

编辑 `src/config.ts`，添加分类定义：

```typescript
export const NOTE_CATS = {
  tech:    { label: '技术', color: 'var(--tech)', desc: '...' },
  reading: { label: '读书', color: 'var(--reading)', desc: '...' },
  photo:   { label: '摄影', color: 'var(--life)', desc: '照片与游记' },  // ← 新增
};
```

可选颜色：`var(--tech)` / `var(--reading)` / `var(--life)` / `var(--project)` / `var(--wiki)` / `var(--paper)`

### Wiki 新分区

同样，直接创建文件夹（如 `src/content/wiki/设计/`）即可自动识别，或编辑 `src/config.ts` 中的 `WIKI_SECTIONS`。

### 项目

在 `src/content/projects/` 下创建 `.md` 文件：

```markdown
---
title: 项目名称
status: 维护中
tags: [TypeScript, React]
icon: ⬡
tagline: 一句话简介
---

## 介绍

项目详情…
```

status 可选：`维护中` / `活跃开发` / `发布` / `实验性`

## 首页/关于

编辑 `src/content/home/home.md`：

```yaml
---
name: 你的名字
greeting: 你好，我是 xxx
bio: |
  个人介绍，支持多行。
  这是第二段。
work: 你的工作（可选）
email: you@example.com
github: yourname
twitter: yourname
footer: 页脚文字
---
```

## 部署

### GitHub Pages

```bash
# 构建
npm run build

# 将 dist/ 推送到 gh-pages 分支
# 或设置 GitHub Actions 自动部署
```

### Vercel

直接导入项目，Build Command: `npm run build`，Output Directory: `dist`

### Cloudflare Pages

同上，框架预设选 Astro。

## 功能

- **Shiki 代码高亮** — 构建时渲染，主题 github-dark
- **KaTeX 数学公式** — `$...$` 行内 + `$$...$$` 块级
- **文件树侧栏** — 笔记/Wiki 左侧分类导航
- **面包屑导航** — 顶部 `~/ 笔记 / 技术 / 文章名`
- **暗/亮主题** — localStorage 持久化，点击 ◐ 切换
- **全局搜索** — `⌘K` 打开，跨笔记/项目/Wiki 检索
- **阅读进度条** — 文章页顶部细线
- **TOC 目录** — 文章右侧浮动目录
- **PDF 阅读器** — Wiki 论文笔记可内嵌 PDF
- **项目筛选** — 按名称/标签搜索，按状态过滤
- **响应式** — 移动端适配

## 技术栈

| 项目 | 方案 |
|------|------|
| 框架 | Astro v5 |
| Markdown | Content Collections + Zod |
| 代码高亮 | Shiki (构建时) |
| 数学公式 | KaTeX (remark-math + rehype-katex) |
| 搜索 | 构建时 JSON 索引 |
| 部署 | 纯静态 HTML |
