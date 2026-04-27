---
title: Neovim 配置思路
date: "2025-12"
description: 以 lazy.nvim 为基础的模块化配置结构
---

## 目录结构

`lua/config/` 放核心设置（选项、快捷键）；`lua/plugins/` 每个文件对应一个功能领域。lazy.nvim 会自动加载这些文件。

## 关键插件

- nvim-lspconfig + mason.nvim（LSP）
- nvim-cmp（补全）
- telescope.nvim（模糊搜索）
- oil.nvim（文件管理）

## 性能建议

- 使用 `event` 或 `keys` 延迟加载
- 避免过多 UI 插件
- 定期清理不用的插件

```lua
-- lazy.nvim 配置示例
{
  'nvim-telescope/telescope.nvim',
  cmd = 'Telescope',
  keys = { '<leader>f', '<leader>F' },
}
```
