import { getCollection, type CollectionEntry } from 'astro:content';
import { resolveDate, computeReadingTime } from './metadata';

export interface TreeNode {
  type: 'folder' | 'note';
  name: string;
  label: string;
  segments: string[];
  children?: TreeNode[];
  note?: CollectionEntry<'notes'>;
  wikiEntry?: CollectionEntry<'wiki'>;
  projectEntry?: CollectionEntry<'projects'>;
  count: number;
  depth: number;
  resolvedDate?: string;
  readingTime?: string;
  /** For wiki: PDF link */
  pdf?: string;
  /** frontmatter draft:true —— 不进 RSS / 「最近更新」，但页面仍可直接访问。
   *  注意：`_` 开头的文件被 Astro 内容集合整体忽略，根本不会走到这里。 */
  isDraft?: boolean;
  /** For projects: status, tags, icon, tagline */
  status?: string;
  tags?: string[];
  icon?: string;
  tagline?: string;
}

// ── Generic tree builder ──────────────────────────
function buildTree(
  entries: { id: string; title: string; date: string; desc: string;
    pdf?: string; status?: string; tags?: string[]; icon?: string; tagline?: string;
    _raw: any }[],
  kind: 'note' | 'wiki' | 'project'
): TreeNode[] {
  const root: Record<string, any> = {};

  for (const entry of entries) {
    const parts = entry.id.replace(/\.md$/, '').split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const isLast = i === parts.length - 1;
      if (!current[seg]) {
        current[seg] = isLast
          ? { __entry: entry, __children: {} }
          : { __entry: null, __children: {} };
      }
      if (!isLast) current = current[seg].__children;
    }
  }

  function build(nodes: Record<string, any>, segments: string[]): TreeNode[] {
    const result: TreeNode[] = [];
    for (const [name, val] of Object.entries(nodes)) {
      const childSegs = [...segments, name];
      const children = build(val.__children || {}, childSegs);
      if (val.__entry) {
        const e = val.__entry;
        const raw = e._raw as { collection: string; id: string; data?: { date?: string; draft?: boolean }; body?: string };
        const resolvedDate = resolveDate(raw);
        const readingTime = raw.body ? computeReadingTime(raw.body) : '';
        result.push({
          type: 'note',
          name,
          label: e.title || name,
          segments: childSegs,
          children: children.length ? children : undefined,
          depth: childSegs.length - 1,
          count: 1,
          resolvedDate,
          readingTime,
          isDraft: raw.data?.draft === true,
          tags: e.tags || [],
          ...(kind === 'note' ? { note: e._raw } : {}),
          ...(kind === 'wiki' ? { wikiEntry: e._raw, pdf: e.pdf } : {}),
          ...(kind === 'project' ? { projectEntry: e._raw, status: e.status, icon: e.icon, tagline: e.tagline } : {}),
        });
      } else if (children.length > 0) {
        result.push({
          type: 'folder',
          name,
          label: name,
          segments: childSegs,
          children,
          depth: childSegs.length - 1,
          count: countNodes(children),
        });
      }
    }
    // Sort: folders first, then by name for folders, by date desc for notes
    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      if (a.type === 'folder') return a.name.localeCompare(b.name);
      const aDate = a.resolvedDate || (a.note || a.wikiEntry)?.data?.date || '';
      const bDate = b.resolvedDate || (b.note || b.wikiEntry)?.data?.date || '';
      return bDate.localeCompare(aDate);
    });
    return result;
  }

  return build(root, []);
}

function countNodes(node: TreeNode | TreeNode[]): number {
  if (Array.isArray(node)) return node.reduce((sum, n) => sum + countNodes(n), 0);
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// ── Note tree ─────────────────────────────────────
export async function buildNoteTree(): Promise<TreeNode[]> {
  const notes = await getCollection('notes');
  const tree = buildTree(
    notes.map(n => ({
      id: n.id, title: n.data.title || '', date: n.data.date || '',
      desc: n.data.description || '', tags: n.data.tags || [], _raw: n,
    })),
    'note'
  );
  registerColors(tree);
  return tree;
}

// ── Wiki tree ─────────────────────────────────────
export async function buildWikiTree(): Promise<TreeNode[]> {
  const wiki = await getCollection('wiki');
  const tree = buildTree(
    wiki.map(w => ({
      id: w.id, title: w.data.title || '', date: w.data.date || '',
      desc: w.data.description || '', tags: w.data.tags || [], pdf: w.data.pdf, _raw: w,
    })),
    'wiki'
  );
  registerColors(tree);
  return tree;
}

// ── Project tree ──────────────────────────────────
export async function buildProjectTree(): Promise<TreeNode[]> {
  const projects = await getCollection('projects');
  return buildTree(
    projects.map(p => ({
      id: p.id, title: p.data.title || '', date: '',
      desc: p.data.tagline || '', status: p.data.status, tags: p.data.tags,
      icon: p.data.icon, tagline: p.data.tagline, _raw: p,
    })),
    'project'
  );
}

// ── Tree navigation helpers ───────────────────────
export function findNode(root: TreeNode[], segments: string[]): TreeNode | null {
  if (segments.length === 0) return null;
  const [first, ...rest] = segments;
  const child = root.find(n => n.name === first);
  if (!child) return null;
  if (rest.length === 0) return child;
  if (child.type === 'folder' && child.children) return findNode(child.children, rest);
  return null;
}

export function getAncestors(root: TreeNode[], segments: string[]): TreeNode[] {
  const result: TreeNode[] = [];
  let current = root;
  for (const seg of segments) {
    const node = current.find(n => n.name === seg);
    if (!node) break;
    result.push(node);
    if (node.type === 'folder' && node.children) current = node.children;
    else break;
  }
  return result;
}

export function flattenNodes(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'note') result.push(n);
    if (n.children) result.push(...flattenNodes(n.children));
  }
  return result;
}

// ── Color helpers ─────────────────────────────────
// 顶层目录 → 强调色。要求：(1) 纯函数式，同一目录在任何页面颜色一致；
// (2) 同一集合内的顶层目录尽量不撞色。
// 做法：按字母序为顶层目录分配调色板下标（树本身已排序，因此结果稳定）。
// 旧实现按"首次遇到的顺序"分配并缓存，构建顺序不同会让同一目录换色。
const CAT_COLORS = [
  'var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)',
  'var(--p5)', 'var(--p6)', 'var(--p7)', 'var(--p8)',
];

const colorRegistry: Record<string, string> = {};

/** 由各 build*Tree 在返回前调用，登记顶层目录的配色 */
function registerColors(tree: TreeNode[]) {
  [...tree].map(n => n.name).sort().forEach((name, i) => {
    if (!(name in colorRegistry)) colorRegistry[name] = CAT_COLORS[i % CAT_COLORS.length];
  });
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getFolderColor(path: string): string {
  const topLevel = path.split('/')[0] || '';
  return colorRegistry[topLevel] || CAT_COLORS[hashStr(topLevel) % CAT_COLORS.length];
}

export { STATUS_COLORS } from '../config';
