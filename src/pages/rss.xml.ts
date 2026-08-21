import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../config';
import { buildNoteTree, buildWikiTree, flattenNodes } from '../utils/tree';
import type { TreeNode } from '../utils/tree';

/** 取一段纯文本摘要：剥掉 frontmatter 之后的 markdown 记号 */
function excerpt(body: string, max = 200): string {
  const text = body
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export async function GET(context: APIContext) {
  const [noteTree, wikiTree] = await Promise.all([buildNoteTree(), buildWikiTree()]);

  type Item = {
    title: string; link: string; pubDate: Date;
    description: string; categories: string[];
  };

  const collect = (nodes: TreeNode[], base: string, pick: (n: TreeNode) => any): Item[] =>
    flattenNodes(nodes)
      .filter(n => !n.isDraft)
      .map(n => {
        const entry = pick(n);
        const data = entry?.data || {};
        const date = n.resolvedDate || data.date || '';
        return {
          title: data.title || n.name,
          link: `${base}${n.segments.join('/')}/`,
          pubDate: date ? new Date(date) : new Date(0),
          description: data.description || excerpt(entry?.body || ''),
          categories: [n.segments[0], ...(data.tags || [])].filter(Boolean),
        };
      });

  const items = [
    ...collect(noteTree, '/notes/', n => n.note),
    ...collect(wikiTree, '/wiki/', n => n.wikiEntry),
  ]
    .filter(i => !Number.isNaN(i.pubDate.getTime()))
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, 50);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items,
    customData: `<language>${SITE.lang}</language>`,
  });
}
