// ── Task 1 回归测试：无 date frontmatter 的笔记必须拿到各自的 git 提交日期 ──
import fs from 'node:fs';
import path from 'node:path';
import { getGitDates, gitDateFor } from '../../src/utils/gitdates.mjs';

const NOTES_DIR = path.join('src', 'content', 'notes');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

/** frontmatter 里有没有 date：只看文件开头的 --- 块 */
function hasFrontmatterDate(file) {
  const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
  const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? /^date:\s*\S/m.test(m[1]) : false;
}

const failures = [];
const dateless = walk(NOTES_DIR).filter((f) => !hasFrontmatterDate(f));

if (getGitDates().size === 0) failures.push('git log 没有解析出任何文件');
if (dateless.length === 0) failures.push('没有找到无 date 的笔记，测试样本为空');

const dates = new Set();
for (const f of dateless) {
  const rel = f.split(path.sep).join('/');
  const d = gitDateFor(rel);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) failures.push(`拿不到 git 日期: ${rel} -> ${JSON.stringify(d)}`);
  else dates.add(d);
}

// 浅克隆时所有文件会共享同一个 commit 时间，这条断言就是用来抓 fetch-depth 配错的
if (dates.size < 2) failures.push(`${dateless.length} 篇无 date 笔记只有 ${dates.size} 个不同日期，疑似浅克隆`);

// git 默认开着 core.quotepath，非 ASCII 路径会被 git log 转成带引号的八进制转义形式，
// 跟 map 里期望的原始 UTF-8 路径对不上——这条断言专门盯防这类文件名（en dash U+2013）
const NON_ASCII_PATH = 'src/content/notes/Database/CMU 115-445/00_Count\u2013Min Sketch.md';
const nonAsciiDate = gitDateFor(NON_ASCII_PATH);
if (!/^\d{4}-\d{2}-\d{2}$/.test(nonAsciiDate)) {
  failures.push(`非 ASCII 路径拿不到 git 日期（疑似 core.quotepath 转义未处理）: ${NON_ASCII_PATH} -> ${JSON.stringify(nonAsciiDate)}`);
}

if (failures.length) {
  console.error('git 日期检查失败：');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`git 日期检查通过：${dateless.length} 篇无 date 笔记，${dates.size} 个不同日期`);
