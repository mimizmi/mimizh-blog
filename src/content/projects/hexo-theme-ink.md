---
title: Hexo Theme Ink
status: 维护中
tags: [CSS, Hexo, TypeScript]
icon: ⬡
tagline: 极简主义博客主题
---

## 介绍

Ink 是一款极简主义的 Hexo 博客主题，设计以内容为中心——去掉所有装饰性元素，用字号、字重、行距和颜色建立视觉层次。

### 核心设计原则

- 内容优先，导航元素极度克制
- 中英文混排视觉统一
- 默认深色，可切换浅色
- 零 JavaScript 依赖（KaTeX 除外）

## 功能特性

- **深色 / 亮色模式** — 跟随系统设置，支持手动切换
- **KaTeX 数学渲染** — 行内公式与块级公式均支持
- **代码高亮** — 基于 Prism.js，支持 30+ 语言
- **阅读进度条** — 顶部细线，非侵入式
- **响应式设计** — 移动端阅读体验与桌面端一致

## 安装使用

```bash
cd your-hexo-blog
git clone https://github.com/mimizh/hexo-theme-ink themes/ink
```

修改 Hexo 配置文件 `_config.yml`：

```yaml
theme: ink
```

主要配置项：

```yaml
dark_mode: auto      # auto | always | never
code_highlight: true
katex: false
reading_progress: true
```

## 链接

- GitHub → mimizh/hexo-theme-ink
- 示例站点 →
