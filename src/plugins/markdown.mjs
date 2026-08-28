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

// ── 5. 中西文混排间隙 ─────────────────────────────────────
// 汉字与拉丁/数字相邻时插入一个空的 <span class="hws">，由 CSS 给出 1/8 em 的
// 视觉间隙。插空元素而不是真空格：复制粘贴与 Pagefind 索引都拿不到多余字符。
// CJK：汉字、假名、谚文。刻意不含 U+3000–303F 与全角形式——「。」「，」
// 本身自带右侧留白，再补间隙反而过宽。
const RE_CJK_LTN = /([⺀-⻿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯])([A-Za-z0-9À-ɏ@#$%&\[({<])/g;
const RE_LTN_CJK = /([A-Za-z0-9À-ɏ@#$%&\])}>])([⺀-⻿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯])/g;

// 这些子树里的文字不参与：代码、公式、图表源码，加间隙只会改变语义或错位。
const HWS_SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'var', 'script', 'style', 'svg', 'math', 'textarea']);
const HWS_SKIP_CLASS = (c) => c === 'no-hws' || c.startsWith('katex');

function hwsSkipped(node) {
  if (HWS_SKIP_TAGS.has(node.tagName)) return true;
  const cls = node.properties?.className;
  const list = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(/\s+/) : [];
  return list.some((c) => typeof c === 'string' && HWS_SKIP_CLASS(c));
}

/** 把一个文本节点按边界切成 [text, span, text, …]；没有边界时返回 null。 */
function hwsSplit(value) {
  const cuts = [];
  for (const re of [RE_CJK_LTN, RE_LTN_CJK]) {
    re.lastIndex = 0;
    let m;
    // 每次只前进一格而非跳过整个匹配，"中A中" 这类连续边界才不会漏掉后一个
    while ((m = re.exec(value)) !== null) {
      cuts.push(m.index + 1);
      re.lastIndex = m.index + 1;
    }
  }
  if (cuts.length === 0) return null;
  cuts.sort((a, b) => a - b);

  const out = [];
  let prev = 0;
  for (const c of cuts) {
    if (c <= prev) continue;
    out.push(txt(value.slice(prev, c)));
    out.push(el('span', { className: ['hws'] }));
    prev = c;
  }
  out.push(txt(value.slice(prev)));
  return out;
}

export function rehypeCjkSpacing() {
  return (tree) => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c.type === 'text') {
          const parts = hwsSplit(c.value);
          if (parts) {
            node.children.splice(i, 1, ...parts);
            i += parts.length - 1; // 跳过刚插入的节点，保证单趟幂等
          }
          continue;
        }
        if (c.type !== 'element' || hwsSkipped(c)) continue;
        walk(c);
      }
    };
    walk(tree);
  };
}
