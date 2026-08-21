import { getCollection } from 'astro:content';
import { extractWikiLinks, resolveWikiLink } from '../plugins/wikilinks.mjs';

export interface Backlink {
  url: string;
  title: string;
}

let cache: Map<string, Backlink[]> | null = null;

/**
 * 扫描全部笔记 / Wiki 正文里的 [[...]]，构建 目标URL → 来源列表 的反向索引。
 * 构建期只算一次，之后各页面复用。
 */
export async function getBacklinkMap(): Promise<Map<string, Backlink[]>> {
  if (cache) return cache;

  const map = new Map<string, Backlink[]>();

  const scan = (
    entries: { id: string; body?: string; data: { title?: string } }[],
    base: string,
  ) => {
    for (const entry of entries) {
      const rel = entry.id.replace(/\.md$/, '');
      const from: Backlink = {
        url: `${base}${rel}/`,
        title: entry.data.title || rel.split('/').pop() || rel,
      };
      const seen = new Set<string>();
      for (const raw of extractWikiLinks(entry.body || '')) {
        const hit = resolveWikiLink(raw);
        if (!hit || hit.url === from.url || seen.has(hit.url)) continue;
        seen.add(hit.url);
        const list = map.get(hit.url) || [];
        list.push(from);
        map.set(hit.url, list);
      }
    }
  };

  const [notes, wiki] = await Promise.all([getCollection('notes'), getCollection('wiki')]);
  scan(notes as any, '/notes/');
  scan(wiki as any, '/wiki/');

  for (const list of map.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }

  cache = map;
  return map;
}

/** 取某个页面的反向链接 */
export async function getBacklinksFor(url: string): Promise<Backlink[]> {
  const map = await getBacklinkMap();
  return map.get(url) || [];
}
