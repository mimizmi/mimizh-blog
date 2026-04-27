---
title: logseq-export
status: 活跃开发
tags: [Rust, CLI, Logseq]
icon: ◈
tagline: Logseq 图谱转静态站点
---

## 背景

Logseq 是一款优秀的双向链接笔记工具，但官方的发布功能需要订阅，且样式固定无法自定义。`logseq-export` 让你完全掌控自己的笔记站点。

## 工作原理

工具解析 Logseq 的 EDN 数据格式，将页面关系构建为有向图，然后生成带有双链的静态 HTML。整个过程完全离线，无需任何网络请求。

## 核心功能

- **双向链接** — `[[页面名]]` 自动转换为可跳转的超链接
- **标签页面** — 每个 `#标签` 自动生成聚合页面
- **块嵌入** — `((block-id))` 语法支持跨页面内容引用
- **全文索引** — 生成 JSON 索引，支持客户端全文搜索
- **增量构建** — 只重新生成变更的页面

## 安装使用

```bash
cargo install logseq-export

# 导出整个图谱
logseq-export --graph ~/logseq/my-graph --out ./site

# 只导出公开页面
logseq-export --graph ~/logseq/my-graph --out ./site --public-only

# 启动预览服务器
logseq-export serve ./site
```

## 链接

- GitHub → mimizh/logseq-export
- 使用文档 →
