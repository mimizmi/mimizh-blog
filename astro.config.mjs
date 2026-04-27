import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import astroExpressiveCode from 'astro-expressive-code';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';  // 新增这行

export default defineConfig({
  site: 'https://mimizh.dpdns.org',
  integrations: [
    astroExpressiveCode({
      themes: ['github-dark'],
      plugins: [
        pluginLineNumbers({
          // 可选：默认显示行号（不写这个配置的话，默认就是 true）
          showLineNumbers: true,
          // 可选：起始行号
          startLineNumber: 1,
        }),
      ],
    }),
  ],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
  build: {
    format: 'directory',
  },
});