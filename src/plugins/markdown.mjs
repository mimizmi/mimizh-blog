// ── 自定义 rehype 插件集合 ────────────────────────────────
import GithubSlugger from 'github-slugger';

// 全部在构建期运行，产物是纯静态 HTML，不引入任何运行时 JS。

/** 通用遍历：回调可返回替换节点数组 */
function visit(node, fn) {
  if (!node || typeof node !== 'object') return;
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const replacement = fn(child, node, i);
    if (Array.isArray(replacement)) {
      children.splice(i, 1, ...replacement);
      // 递归进入替换产物（各插件自带幂等守卫，不会无限展开）
      for (const r of replacement) visit(r, fn);
      i += replacement.length - 1;
      continue;
    }
    visit(child, fn);
  }
}

const el = (tagName, properties, children = []) => ({
  type: 'element', tagName, properties, children,
});
const txt = (value) => ({ type: 'text', value });

// ── 1. 表格包裹 ───────────────────────────────────────────
// <table> → <div class="table-wrap" tabindex="0"><table>…</table></div>
// 目的：宽表格在窄栏内横向滚动，而不是撑破排版或被压扁。
export function rehypeTableWrap() {
  return (tree) => {
    visit(tree, (node, parent) => {
      if (node.type !== 'element' || node.tagName !== 'table') return;
      if (parent?.properties?.className?.includes?.('table-wrap')) return;

      // 统计列数，供 CSS 决定最小宽度策略
      const head = node.children.find(c => c.tagName === 'thead');
      const firstRow = head?.children?.find(c => c.tagName === 'tr')
        || node.children.find(c => c.tagName === 'tbody')?.children?.find(c => c.tagName === 'tr');
      const cols = firstRow?.children?.filter(c => c.tagName === 'th' || c.tagName === 'td').length || 0;

      return [el('div', {
        className: ['table-wrap'],
        tabindex: '0',
        role: 'region',
        'aria-label': '表格（可横向滚动）',
        'data-cols': String(cols),
      }, [node])];
    });
  };
}

// ── 2. Obsidian 风格 Callout ──────────────────────────────
// > [!warning] 标题
// > 正文…
const CALLOUT_TYPES = {
  note:      { icon: '✎', label: '笔记' },
  info:      { icon: 'ⓘ', label: '信息' },
  tip:       { icon: '✦', label: '提示' },
  hint:      { icon: '✦', label: '提示' },
  important: { icon: '❯', label: '要点' },
  success:   { icon: '✓', label: '成功' },
  check:     { icon: '✓', label: '成功' },
  done:      { icon: '✓', label: '完成' },
  question:  { icon: '?', label: '问题' },
  faq:       { icon: '?', label: '问题' },
  warning:   { icon: '△', label: '注意' },
  caution:   { icon: '△', label: '注意' },
  danger:    { icon: '✕', label: '危险' },
  error:     { icon: '✕', label: '错误' },
  bug:       { icon: '✕', label: 'Bug' },
  example:   { icon: '❏', label: '示例' },
  quote:     { icon: '❝', label: '引用' },
  cite:      { icon: '❝', label: '引用' },
  abstract:  { icon: '≡', label: '摘要' },
  summary:   { icon: '≡', label: '摘要' },
  tldr:      { icon: '≡', label: 'TL;DR' },
  todo:      { icon: '☐', label: '待办' },
};

export function rehypeCallouts() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'blockquote') return;

      const firstP = node.children.find(c => c.type === 'element' && c.tagName === 'p');
      const firstText = firstP?.children?.[0];
      if (!firstText || firstText.type !== 'text') return;

      const m = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/.exec(firstText.value.split('\n')[0]);
      if (!m) return;

      const kind = m[1].toLowerCase();
      const meta = CALLOUT_TYPES[kind];
      if (!meta) return;

      const fold = m[2];           // '' 不可折叠 / '+' 默认展开 / '-' 默认折叠
      const title = m[3].trim() || meta.label;

      // 去掉首行标记，其余内容保留
      const rest = firstText.value.slice(firstText.value.indexOf('\n') + 1);
      if (firstText.value.includes('\n') && rest.trim()) {
        firstText.value = rest;
      } else {
        firstP.children.shift();
        if (firstP.children.length === 0 || firstP.children.every(c => c.type === 'text' && !c.value.trim())) {
          node.children = node.children.filter(c => c !== firstP);
        } else {
          // 去掉紧跟标记的换行
          const head = firstP.children[0];
          if (head?.type === 'text') head.value = head.value.replace(/^\n/, '');
        }
      }

      const body = el('div', { className: ['callout-body'] }, node.children);
      const iconNode = el('span', { className: ['callout-ic'], 'aria-hidden': 'true' }, [txt(meta.icon)]);

      if (fold) {
        return [el('details', {
          className: ['callout', 'callout-fold'], 'data-callout': kind, open: fold === '+',
        }, [
          el('summary', { className: ['callout-title'] }, [iconNode, el('span', {}, [txt(title)])]),
          body,
        ])];
      }

      return [el('div', { className: ['callout'], 'data-callout': kind }, [
        el('div', { className: ['callout-title'] }, [iconNode, el('span', {}, [txt(title)])]),
        body,
      ])];
    });
  };
}

// ── 3. 标题锚点 ───────────────────────────────────────────
// 自行生成 id（与 Astro 内置 rehype-slug 同款 github-slugger，
// 内置插件遇到已有 id 会跳过），然后追加一个可点击的 # 锚点。
function nodeText(node) {
  if (node.type === 'text') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(nodeText).join('');
}

export function rehypeHeadingAnchors() {
  const HEADINGS = new Set(['h2', 'h3', 'h4']);
  return (tree) => {
    const slugger = new GithubSlugger();
    visit(tree, (node) => {
      if (node.type !== 'element' || !HEADINGS.has(node.tagName)) return;
      node.properties = node.properties || {};
      if (node.children.some(c => c.properties?.className?.includes?.('hanchor'))) return;
      if (!node.properties.id) node.properties.id = slugger.slug(nodeText(node));
      const id = node.properties.id;
      node.properties.className = [...(node.properties.className || []), 'h-anchored'];
      node.children.push(
        el('a', { className: ['hanchor'], href: `#${id}`, 'aria-hidden': 'true', tabindex: '-1' }, [txt('#')])
      );
    });
  };
}

// ── 4. 外链标记 ───────────────────────────────────────────
export function rehypeExternalLinks() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
      node.properties.target = '_blank';
      node.properties.rel = 'noopener noreferrer';
      node.properties.className = [...(node.properties.className || []), 'ext-link'];
    });
  };
}

// ── 5. Mermaid 代码块 ─────────────────────────────────────
// 在 remark 阶段就把 ```mermaid 换成 <pre class="mermaid">，
// 这样 Expressive Code（rehype 阶段）不会把它当普通代码块高亮。
// 原始图表源码另存到 data-src，便于切换主题后重新渲染。
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function remarkMermaid() {
  return (tree) => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c.type === 'code' && (c.lang || '').toLowerCase() === 'mermaid') {
          const src = escAttr(c.value || '');
          node.children[i] = {
            type: 'html',
            value: `<div class="mermaid-wrap"><pre class="mermaid" data-src="${src}">${src}</pre></div>`,
          };
          continue;
        }
        walk(c);
      }
    };
    walk(tree);
  };
}
