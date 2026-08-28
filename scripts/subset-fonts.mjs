#!/usr/bin/env node
// ── CJK 字体子集化 ────────────────────────────────────────
// 手动跑：npm run fonts
// 产物进 git（public/fonts/），CI 不执行本脚本，因此 CI 不需要联网拉字体。
// 内容里出现新汉字时必须重跑，否则 npm run verify 会红。
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';
import { collectCodepoints } from './lib/charset.mjs';

const SRC_DIR = path.join('fonts', 'source');
const OUT_DIR = path.join('public', 'fonts');
const OG_DIR = path.join('scripts', 'assets', 'og-fonts');

const FAMILIES = [
  { src: 'NotoSerifSC-VF.otf', out: 'noto-serif-sc-subset.woff2', ogOut: 'og-serif-400.woff2', ogWeight: 400 },
  { src: 'NotoSansSC-VF.otf', out: 'noto-sans-sc-subset.woff2', ogOut: 'og-sans-600.woff2', ogWeight: 600 },
];

const cps = collectCodepoints();
const text = cps.map((cp) => String.fromCodePoint(cp)).join('');
console.log(`字符集：${cps.length} 个码点`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(OG_DIR, { recursive: true });

for (const fam of FAMILIES) {
  const srcPath = path.join(SRC_DIR, fam.src);
  if (!fs.existsSync(srcPath)) {
    console.error(`缺少源字体 ${srcPath}——见 plan Task 3 Step 1 的下载命令`);
    process.exit(1);
  }
  const buf = fs.readFileSync(srcPath);

  // 站点用：保留 wght 300–700 轴，一个文件覆盖全部字重
  const variable = await subsetFont(buf, text, {
    targetFormat: 'woff2',
    variationAxes: { wght: { min: 300, max: 700 } },
  });
  fs.writeFileSync(path.join(OUT_DIR, fam.out), variable);
  console.log(`  ${fam.out}  ${(variable.length / 1024).toFixed(0)} KB`);

  // OG 图用：satori 对可变字体的字重选择不可靠，另出一份定死字重的静态子集。
  // 不放 public/——它只在构建期被 satori 读取，不对浏览器服务。
  const stat = await subsetFont(buf, text, {
    targetFormat: 'woff2',
    variationAxes: { wght: fam.ogWeight },
  });
  fs.writeFileSync(path.join(OG_DIR, fam.ogOut), stat);
  console.log(`  ${fam.ogOut}  ${(stat.length / 1024).toFixed(0)} KB`);
}

fs.writeFileSync(
  path.join(OUT_DIR, 'coverage.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceFonts: FAMILIES.map((f) => f.src),
    codepoints: cps,
    count: cps.length,
  }) + '\n'
);
console.log(`  coverage.json  ${cps.length} 个码点`);
