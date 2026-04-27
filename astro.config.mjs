import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import astroExpressiveCode from 'astro-expressive-code';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';

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
      themes: ['github-dark'],
      plugins: [
        pluginLineNumbers({
          showLineNumbers: true,
          startLineNumber: 1,
        }),
      ],
    }),
  ],
  markdown: {
    remarkPlugins: [remarkMath, remarkAssetLinks],
    rehypePlugins: [rehypeKatex],
  },
  build: {
    format: 'directory',
  },
});