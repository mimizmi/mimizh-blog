import fs from 'node:fs';
import path from 'node:path';

export function resolveDate(entry: { collection: string; id: string; data?: { date?: string } }): string {
  const fmDate = entry.data?.date;
  if (fmDate && fmDate.trim()) return fmDate;

  const filePath = path.join(
    process.cwd(), 'src', 'content', entry.collection,
    entry.id
  );
  try { return fs.statSync(filePath).birthtime.toISOString().split('T')[0]; } catch {
    try {
      return fs.statSync(filePath.replace(/\.md$/, '.mdx')).birthtime.toISOString().split('T')[0];
    } catch { return ''; }
  }
}

export function computeReadingTime(body: string): string {
  if (!body) return '';
  const cleaned = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  let wordCount = 0;
  const cjkRe = /[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯]/g;
  const cjk = cleaned.match(cjkRe);
  wordCount += cjk ? cjk.length : 0;
  const nonCjk = cleaned.replace(cjkRe, ' ');
  const latinWords = nonCjk.trim().split(/\s+/).filter(w => w.length > 0);
  wordCount += latinWords.length;
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return `${minutes} min`;
}
