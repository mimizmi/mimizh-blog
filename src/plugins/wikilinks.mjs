// ── Obsidian 双向链接 [[...]] ──────────────────────────────
// 一份实现同时服务两处：
//   1. remarkWikiLinks —— 渲染期把 [[Note]] 变成站内链接
//   2. extractWikiLinks + resolveWikiLink —— 供 backlinks 计算反向链接
// 索引直接扫文件系统（而不是 astro:content），这样 remark 插件在
// Astro 内容层之外也能用。代价：dev 模式下新增笔记文件需重启 dev server。

import fs from 'node:fs';
import path from 'node:path';

const ROOTS = [
  { dir: 'src/content/notes', base: '/notes/' },
  { dir: 'src/content/wiki', base: '/wiki/' },
];

let cache = null;

function readTitle(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    if (!fm) return '';
    const t = /^title:\s*(.+)$/m.exec(fm[1]);
    if (!t) return '';
    return t[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'assets' || e.name.startsWith('.')) continue;
      walk(full, acc);
    } else if (e.name.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

/** 构建 别名 → {url,title} 索引；别名含完整相对路径、文件名、frontmatter 标题 */
export function getNoteIndex() {
  if (cache) return cache;
  const byAlias = new Map();
  const all = [];

  for (const { dir, base } of ROOTS) {
    const abs = path.resolve(process.cwd(), dir);
    for (const file of walk(abs)) {
      const rel = path.relative(abs, file).split(path.sep).join('/').replace(/\.md$/, '');
      const name = rel.split('/').pop();
      const title = readTitle(file) || name;
      const rec = { url: `${base}${rel}/`, title, rel, name };
      all.push(rec);
      // 越具体的别名越先登记，后来者不覆盖
      for (const alias of [rel, name, title]) {
        const k = String(alias).toLowerCase();
        if (k && !byAlias.has(k)) byAlias.set(k, rec);
      }
    }
  }

  cache = { byAlias, all };
  return cache;
}

/** 解析一个 [[目标]]，命中返回 {url,title}，否则 null */
export function resolveWikiLink(target) {
  const { byAlias } = getNoteIndex();
  const clean = String(target).trim().replace(/^\.?\//, '').replace(/\.md$/i, '');
  return byAlias.get(clean.toLowerCase()) || null;
}

const WIKI_SOURCE = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/.source;

/** 从 markdown 原文抽出所有 wikilink 目标（用于反向链接） */
export function extractWikiLinks(body) {
  const out = [];
  const re = new RegExp(WIKI_SOURCE, 'g');
  let m;
  while ((m = re.exec(body || '')) !== null) out.push(m[1].trim());
  return out;
}

/** 与 github-slugger 行为接近的轻量 slug，仅用于 [[note#标题]] 的锚点 */
function slugish(s) {
  return String(s).trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

/** remark 插件：把文本节点里的 [[...]] 替换成链接节点 */
export function remarkWikiLinks() {
  function split(value) {
    const re = new RegExp(WIKI_SOURCE, 'g');
    const out = [];
    let last = 0;
    let m;
    while ((m = re.exec(value)) !== null) {
      if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
      const [, target, hash, label] = m;
      const hit = resolveWikiLink(target);
      const text = (label || target).trim();
      if (hit) {
        out.push({
          type: 'link',
          url: hash ? `${hit.url}#${slugish(hash)}` : hit.url,
          data: { hProperties: { className: ['wikilink'] } },
          children: [{ type: 'text', value: label ? text : hit.title }],
        });
      } else {
        out.push({
          type: 'emphasis',
          data: {
            hName: 'span',
            hProperties: { className: ['wikilink', 'wikilink-missing'], title: `未找到：${target}` },
          },
          children: [{ type: 'text', value: text }],
        });
      }
      last = m.index + m[0].length;
    }
    if (!out.length) return null;
    if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
    return out;
  }

  function visit(node) {
    if (!node || !Array.isArray(node.children)) return;
    // 代码块 / 行内代码是 code / inlineCode 节点，不是 text，天然不会被改写
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.type === 'text' && child.value.includes('[[')) {
        const parts = split(child.value);
        if (parts) {
          node.children.splice(i, 1, ...parts);
          i += parts.length - 1;
          continue;
        }
      }
      visit(child);
    }
  }

  return (tree) => visit(tree);
}
