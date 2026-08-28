import type { APIRoute } from 'astro';
import { renderOgCard } from '../../utils/og-card';
import { buildNoteTree, buildWikiTree, buildProjectTree, flattenNodes, getFolderColor } from '../../utils/tree';

interface OgEntry {
  slug: string;
  title: string;
  category: string;
  color: string;
}

// ── 调色板：CSS 变量 → sRGB 十六进制 ──────────────────────
// getFolderColor 返回的永远是 'var(--pN)'（见 src/utils/tree.ts:191-194 的
// CAT_COLORS），而站点的 --p1..--p8 是 oklch()——satori 和 resvg 都不解析
// CSS 变量，也不解析 oklch。所以这里放一张换算好的对照表。
// 值来自 src/styles/global.css:17-18 深色主题的 --p1..--p8，经 OKLCH→sRGB 换算。
// 改了 global.css 的配色，这张表要跟着改。
const PALETTE: Record<string, string> = {
  'var(--p1)': '#5eaceb',
  'var(--p2)': '#ec9d53',
  'var(--p3)': '#65c281',
  'var(--p4)': '#b191ea',
  'var(--p5)': '#50bfbe',
  'var(--p6)': '#eb8186',
  'var(--p7)': '#d588ce',
  'var(--p8)': '#acc455',
};
/** 站点主强调色 --accent: oklch(74% .13 62) */
const ACCENT = '#e5974c';

function toHex(c: string): string {
  if (c && c.startsWith('#')) return c;
  return PALETTE[c] ?? ACCENT;
}

// ── 取数：建树而非 getCollection ──────────────────────────
// getFolderColor 读的是模块级 colorRegistry，只由 buildNoteTree/buildWikiTree
// 在建树时填充（buildProjectTree 不填）。若绕开建树直接用 getCollection 取
// entry 再调 getFolderColor，表要么是空的（落到 hashStr 兜底，配色与站内不
// 一致），要么取决于同一构建进程里谁先跑过 getStaticPaths（顺序依赖）。
// 这里改用 buildNoteTree/buildWikiTree/buildProjectTree + flattenNodes，
// 与 src/pages/rss.xml.ts 同一套取数方式：建树即填色表，segments 与页面 URL
// 同源，不再依赖构建顺序。
async function collectEntries(): Promise<OgEntry[]> {
  const out: OgEntry[] = [];

  // notes：flattenNodes 只留 type === 'note' 的叶子节点，目录节点不会出现，
  // 不需要再手动过滤。也不按 isDraft 过滤——草稿页面仍可直接访问（见
  // src/utils/tree.ts:19），过滤掉会让 verify-dist.mjs 的
  // 「页面数 == PNG 数」断言失败。
  const noteTree = await buildNoteTree();
  for (const n of flattenNodes(noteTree)) {
    const dir = n.segments.slice(0, -1).join('/');
    out.push({
      slug: `notes/${n.segments.join('/')}`,
      title: n.label,
      category: n.segments.slice(0, -1).join(' / '),
      color: toHex(getFolderColor(dir)),
    });
  }

  const wikiTree = await buildWikiTree();
  for (const n of flattenNodes(wikiTree)) {
    // --wiki 在 global.css:35 定义为 var(--p5)
    out.push({ slug: `wiki/${n.segments.join('/')}`, title: n.label, category: 'Wiki', color: PALETTE['var(--p5)'] });
  }

  const projectTree = await buildProjectTree();
  for (const n of flattenNodes(projectTree)) {
    // --project 在 global.css 里实际是 var(--p4)，但计划定的是 p1，按计划走。
    out.push({ slug: `projects/${n.segments.join('/')}`, title: n.label, category: '项目', color: PALETTE['var(--p1)'] });
  }

  return out;
}

export async function getStaticPaths() {
  const entries = await collectEntries();
  return entries.map((e) => ({ params: { slug: e.slug }, props: e }));
}

export const GET: APIRoute = async ({ props }) => {
  const { title, category, color } = props as unknown as OgEntry;
  const png = await renderOgCard({ title, category, color });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
