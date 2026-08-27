import fs from 'node:fs';
import path from 'node:path';
import { gitDateFor } from './gitdates.mjs';

export function resolveDate(entry: { collection: string; id: string; data?: { date?: string } }): string {
  const fmDate = entry.data?.date;
  if (fmDate && fmDate.trim()) return fmDate;

  // entry.id 带 .md 后缀（legacy content collections），且用正斜杠——与 git 的路径形式一致
  const repoRel = `src/content/${entry.collection}/${entry.id}`;
  const fromGit = gitDateFor(repoRel);
  if (fromGit) return fromGit;

  // 兜底：不在 git 仓库里时退回文件创建时间
  const filePath = path.join(process.cwd(), 'src', 'content', entry.collection, entry.id);
  try {
    return fs.statSync(filePath).birthtime.toISOString().split('T')[0];
  } catch {
    return '';
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
