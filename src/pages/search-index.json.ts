import { buildNoteTree, buildWikiTree, buildProjectTree, flattenNodes } from '../utils/tree';

export async function GET() {
  const noteTree = await buildNoteTree();
  const wikiTree = await buildWikiTree();
  const projTree = await buildProjectTree();

  const items: { title: string; path: string; excerpt: string; type: string }[] = [];

  for (const n of flattenNodes(noteTree)) {
    items.push({
      type: 'note',
      title: n.note?.data.title || n.name,
      path: `/notes/${n.segments.join('/')}/`,
      excerpt: n.note?.data.description || '',
    });
  }

  for (const w of flattenNodes(wikiTree)) {
    items.push({
      type: 'wiki',
      title: w.wikiEntry?.data.title || w.name,
      path: `/wiki/${w.segments.join('/')}/`,
      excerpt: w.wikiEntry?.data.description || '',
    });
  }

  for (const p of flattenNodes(projTree)) {
    items.push({
      type: 'project',
      title: p.projectEntry?.data.title || p.name,
      path: `/projects/${p.segments.join('/')}/`,
      excerpt: p.tagline || '',
    });
  }

  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
}
