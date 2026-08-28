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
