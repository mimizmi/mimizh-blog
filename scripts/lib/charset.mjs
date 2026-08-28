// ── 站点 CJK 字符集收集 ───────────────────────────────────
// 子集脚本和覆盖率检查共用这一份实现。两边各写一遍口径必然漂移，
// 结果就是「子集脚本觉得够了、检查脚本觉得不够」这类假警报。
import fs from 'node:fs';
import path from 'node:path';

/** 扫描哪些目录/文件。UI 文案在 astro/ts 里，正文在 md 里，两边都要覆盖。 */
const ROOTS = ['src/content', 'src/pages', 'src/components', 'src/layouts', 'src/config.ts'];
const EXTS = new Set(['.md', '.astro', '.ts', '.mjs']);
const SKIP_DIRS = new Set(['.obsidian', 'node_modules']);

/** 需要覆盖的区段：CJK 统一表意文字、扩展 A、CJK 标点、全角/半角形式 */
function isTarget(cp) {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
}

function walk(target, acc) {
  const st = fs.statSync(target);
  if (st.isFile()) {
    if (EXTS.has(path.extname(target))) acc.push(target);
    return;
  }
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    walk(path.join(target, e.name), acc);
  }
}

/** @returns {number[]} 升序去重的十进制码点 */
export function collectCodepoints() {
  const files = [];
  for (const r of ROOTS) if (fs.existsSync(r)) walk(r, files);
  const set = new Set();
  for (const f of files) {
    for (const ch of fs.readFileSync(f, 'utf8')) {
      const cp = ch.codePointAt(0);
      if (isTarget(cp)) set.add(cp);
    }
  }
  return [...set].sort((a, b) => a - b);
}
