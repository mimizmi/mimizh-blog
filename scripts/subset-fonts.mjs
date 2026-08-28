#!/usr/bin/env node
// ── CJK 字体子集化 ────────────────────────────────────────
// 手动跑：npm run fonts
// 产物进 git（public/fonts/），CI 不执行本脚本，因此 CI 不需要联网拉字体。
// 内容里出现新汉字时必须重跑，否则 npm run verify 会红。
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';
import { collectCodepoints, collectOgCodepoints } from './lib/charset.mjs';

const SRC_DIR = path.join('fonts', 'source');
const OUT_DIR = path.join('public', 'fonts');
const OG_DIR = path.join('scripts', 'assets', 'og-fonts');

// 两套源：站点分支（src）用 OTF/CFF2 可变字体——浏览器吃 CFF2 woff2 没问题，
// 且 CFF 对 CJK 更紧凑；OG 分支（ogSrc）必须用 TTF/glyf 轮廓的可变字体，见下方
// "OG 图用" 注释的原因。缺哪个下载哪个：
//   https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/OTF/Subset/NotoSerifSC-VF.otf
//   https://github.com/notofonts/noto-cjk/raw/main/Sans/Variable/OTF/Subset/NotoSansSC-VF.otf
//   https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/TTF/Subset/NotoSerifSC-VF.ttf
//   https://github.com/notofonts/noto-cjk/raw/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf
// 这条链路约 70KB/s，25MB 的 Serif 单次 curl 容易超时（exit 28）。下载时带 -C -
// （断点续传）与足够长的 --max-time，例如：
//   curl -L -C - --max-time 1800 -o fonts/source/NotoSerifSC-VF.ttf <url>
const FAMILIES = [
  { src: 'NotoSerifSC-VF.otf', ogSrc: 'NotoSerifSC-VF.ttf', out: 'noto-serif-sc-subset.woff2', ogOut: 'og-serif-400.ttf', ogWeight: 400 },
  { src: 'NotoSansSC-VF.otf', ogSrc: 'NotoSansSC-VF.ttf', out: 'noto-sans-sc-subset.woff2', ogOut: 'og-sans-600.ttf', ogWeight: 600 },
];

const cps = collectCodepoints();
const text = cps.map((cp) => String.fromCodePoint(cp)).join('');
console.log(`字符集：${cps.length} 个码点`);

// OG 分支单独收字符集：站点 woff2 只需 CJK（拉丁字符走字体栈里前面那款拉丁
// 字体），但 OG 卡片图里 satori 只装了 OG Serif / OG Sans 这两款字体，没有
// 浏览器那套按字形自动回退——标题、分类、页脚里任何一个非 CJK 字符（英文
// 字母、数字、下划线、空格、省略号……）不在子集里，画出来就是空 path，
// 详见 scripts/lib/charset.mjs 里 collectOgCodepoints 的注释。
const ogCps = collectOgCodepoints();
const ogText = ogCps.map((cp) => String.fromCodePoint(cp)).join('');
console.log(`OG 字符集：${ogCps.length} 个码点`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(OG_DIR, { recursive: true });

for (const fam of FAMILIES) {
  const srcPath = path.join(SRC_DIR, fam.src);
  const ogSrcPath = path.join(SRC_DIR, fam.ogSrc);
  const missing = [];
  if (!fs.existsSync(srcPath)) missing.push(srcPath);
  if (!fs.existsSync(ogSrcPath)) missing.push(ogSrcPath);
  if (missing.length) {
    console.error(`缺少源字体：\n  ${missing.join('\n  ')}\n下载命令见本文件头部 FAMILIES 上方的注释`);
    process.exit(1);
  }
  const buf = fs.readFileSync(srcPath);
  const ogBuf = fs.readFileSync(ogSrcPath);

  // 站点用：保留 wght 300–700 轴，一个文件覆盖全部字重
  const variable = await subsetFont(buf, text, {
    targetFormat: 'woff2',
    variationAxes: { wght: { min: 300, max: 700 } },
  });
  fs.writeFileSync(path.join(OUT_DIR, fam.out), variable);
  console.log(`  ${fam.out}  ${(variable.length / 1024).toFixed(0)} KB`);

  // OG 图用：satori 对可变字体的字重选择不可靠，另出一份定死字重的静态子集。
  // 不放 public/——它只在构建期被 satori 读取，不对浏览器服务。
  // 源换成 ogSrc（TTF/glyf）而不是复用上面的 buf（OTF/CFF2），原因有两层：
  //   1) targetFormat 用 truetype 而非 woff2：satori 内部用 opentype.js 解析
  //      字体，不支持 woff2 的 brotli 压缩（实测抛 "Unsupported OpenType
  //      signature wOF2"）。
  //   2) 光换容器（truetype）不够——CFF2 可变字体经 harfbuzz 按 wght 实例化后，
  //      表目录里只剥掉 fvar，轮廓仍是 CFF2，而 satori 的 @shuding/opentype.js
  //      只认 glyf 或经典 CFF（非 CFF2）轮廓，会抛 "Font doesn't contain
  //      TrueType or CFF outlines"。必须从 glyf 轮廓的 TTF 源出发，实例化后
  //      才会落回 glyf。两层原因都成立时才通：容器要是 truetype，源要含 glyf。
  const stat = await subsetFont(ogBuf, ogText, {
    targetFormat: 'truetype',
    variationAxes: { wght: fam.ogWeight },
  });
  fs.writeFileSync(path.join(OG_DIR, fam.ogOut), stat);
  console.log(`  ${fam.ogOut}  ${(stat.length / 1024).toFixed(0)} KB`);
}

fs.writeFileSync(
  path.join(OUT_DIR, 'coverage.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceFonts: FAMILIES.flatMap((f) => [f.src, f.ogSrc]),
    codepoints: cps,
    count: cps.length,
  }) + '\n'
);
console.log(`  coverage.json  ${cps.length} 个码点`);
