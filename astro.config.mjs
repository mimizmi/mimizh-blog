import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import sitemap from '@astrojs/sitemap';
import astroExpressiveCode from 'astro-expressive-code';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';
import {
  pluginCollapsibleSections,
  pluginCollapsibleSectionsTexts,
} from '@expressive-code/plugin-collapsible-sections';

// 折叠区的 summary 文案默认是英文的 "N collapsed lines"，站内其它 UI（callout
// 标签、导航）都是中文，这里补一份 zh-CN 并把 defaultLocale 指过去。
pluginCollapsibleSectionsTexts.addLocale('zh-CN', {
  collapsedLines: '已折叠 {lineCount} 行',
});

// 注：代码框自带的 "Copy to clipboard" / "Terminal window" 没能一并汉化。
// pluginFramesTexts.addLocale() 在这里无效——Astro 用 esbuild 打包本配置文件，
// 我们 import 到的 pluginFramesTexts 与 expressive-code 内部构造 frames 插件时
// 用的不是同一个模块实例。折叠插件之所以能汉化，是因为它的实例由本文件亲手
// 构造，改的就是同一个对象。这两句英文是插件默认值，与本次改动无关。
import {
  rehypeTableWrap,
  rehypeCallouts,
  rehypeHeadingAnchors,
  rehypeExternalLinks,
  rehypeCjkSpacing,
} from './src/plugins/markdown.mjs';
import { remarkWikiLinks } from './src/plugins/wikilinks.mjs';
import { remarkMermaidPrerender, mermaidPrerenderIntegration } from './src/plugins/mermaid-prerender.mjs';

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
      defaultLocale: 'zh-CN',
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
        // 版本必须与 astro-expressive-code 对齐（都是 0.41.7）。装 ^0.44 会把
        // @expressive-code/core 的第二份副本嵌套装进来，插件就注册到了另一个
        // core 实例上——不报错，只是静默失效。
        pluginCollapsibleSections(),
      ],
    }),
    sitemap({
      filter: (page) => !page.includes('/404'),
    }),
    mermaidPrerenderIntegration(),
  ],
  markdown: {
    // remark 先跑：mermaid 要赶在 Expressive Code 之前把代码块摘出去
    remarkPlugins: [remarkMermaidPrerender, remarkMath, remarkAssetLinks, remarkWikiLinks],
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
