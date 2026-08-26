import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import sitemap from '@astrojs/sitemap';
import astroExpressiveCode from 'astro-expressive-code';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';
import {
  rehypeTableWrap,
  rehypeCallouts,
  rehypeHeadingAnchors,
  rehypeExternalLinks,
  remarkMermaid,
  rehypeCjkSpacing,
} from './src/plugins/markdown.mjs';
import { remarkWikiLinks } from './src/plugins/wikilinks.mjs';

// Remark plugin: rewrite relative asset links (./assets/...) to absolute (/assets/...)
// so they work both in Obsidian (relative) and on the deployed site (absolute).
function remarkAssetLinks() {
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'link' || node.type === 'image') {
      if (node.url && /^\.?\.?\/assets\//.test(node.url)) {
        node.url = '/' + node.url.replace(/^\.?\.?\//, '');
      }
    }
    if (node.children) walk(node.children);
  }
  return (tree) => walk(tree);
}

export default defineConfig({
  site: 'https://mimizh.dpdns.org',
  integrations: [
    astroExpressiveCode({
      // 双主题：跟随站点 data-theme 切换，浅色模式下不再出现深色代码块
      themes: ['github-light', 'github-dark'],
      themeCssSelector: (theme) => `[data-theme="${theme.type}"]`,
      useDarkModeMediaQuery: false,
      styleOverrides: {
        borderRadius: '6px',
        borderColor: 'var(--bd)',
        codeFontFamily: 'var(--fm)',
        codeFontSize: 'calc(.79rem * var(--fs-body))',
        codeLineHeight: '1.7',
        uiFontFamily: 'var(--fm)',
        uiFontSize: 'calc(.7rem * var(--fs-ui))',
        frames: {
          shadowColor: 'transparent',
          editorTabBarBorderBottomColor: 'var(--bd)',
        },
      },
      plugins: [
        pluginLineNumbers({
          showLineNumbers: true,
          startLineNumber: 1,
        }),
      ],
    }),
    sitemap({
      filter: (page) => !page.includes('/404'),
    }),
  ],
  markdown: {
    // remark 先跑：mermaid 要赶在 Expressive Code 之前把代码块摘出去
    remarkPlugins: [remarkMermaid, remarkMath, remarkAssetLinks, remarkWikiLinks],
    rehypePlugins: [
      rehypeKatex,
      rehypeCallouts,
      rehypeTableWrap,
      rehypeHeadingAnchors,
      rehypeExternalLinks,
      // 放最后：等结构类插件都改完 AST，再切文本节点插间隙
      rehypeCjkSpacing,
    ],
  },
  build: {
    format: 'directory',
  },
});
