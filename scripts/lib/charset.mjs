// ── 站点 CJK 字符集收集 ───────────────────────────────────
// 子集脚本和覆盖率检查共用这一份实现。两边各写一遍口径必然漂移，
// 结果就是「子集脚本觉得够了、检查脚本觉得不够」这类假警报。
import fs from 'node:fs';
import path from 'node:path';

/** 扫描哪些目录/文件。整个 src/ 一把扫——显式目录清单曾经漏掉 src/plugins/，
 * 让插件里硬编码的中文标签（callout 类型名、表格 aria-label）逃过覆盖率检查。 */
const ROOTS = ['src'];
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

/** 站点 woff2 子集只收 CJK：它在字体栈里是"CJK 兜底"角色，拉丁字符本来就该走
 * 栈里前面那款拉丁字体，浏览器按字形自动切换。但 OG 卡片图不一样——satori
 * 没有浏览器那套按字形回退机制，一张卡片只装两款字体（OG Serif / OG Sans），
 * 标题、分类、页脚里任何一个非 CJK 字符（英文字母、数字、下划线、空格、
 * 省略号……）只要不在子集里，画出来就是空 path，卡片上这一整块文字直接消失。
 * 所以 OG 分支要收"全部可打印字符"，不能只收 CJK。 */
function isPrintable(cp) {
  if (cp < 0x20) return false; // 控制字符（含换行、制表符）
  if (cp >= 0x7f && cp <= 0x9f) return false; // DEL + C1 控制字符
  return true;
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

function collect(predicate) {
  const files = [];
  for (const r of ROOTS) if (fs.existsSync(r)) walk(r, files);
  const set = new Set();
  for (const f of files) {
    for (const ch of fs.readFileSync(f, 'utf8')) {
      const cp = ch.codePointAt(0);
      if (predicate(cp)) set.add(cp);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** 站点 woff2 子集用：仅 CJK 区段。@returns {number[]} 升序去重的十进制码点 */
export function collectCodepoints() {
  return collect(isTarget);
}

/** OG 卡片字体用：CJK + 全部可打印字符（同一批源文件里出现的拉丁字母、
 * 数字、标点等），因为 og-card.ts 的标题/分类/页脚文案和 [...slug].png.ts
 * 里 'Wiki'、'项目' 这类硬编码字符串都在 src/ 范围内，与这里扫描的文件集合
 * 天然重合。@returns {number[]} 升序去重的十进制码点 */
export function collectOgCodepoints() {
  return collect(isPrintable);
}
