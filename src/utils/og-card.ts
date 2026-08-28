// ── OG 卡片渲染 ───────────────────────────────────────────
// 构建期跑，satori 出 SVG、resvg 转 PNG。字体用 scripts/assets/og-fonts/
// 下的静态字重子集——satori 对可变字体的字重选择不可靠，所以那里另出了
// 一份定死字重的版本（见 scripts/subset-fonts.mjs）。
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const OG_FONTS = path.join(process.cwd(), 'scripts', 'assets', 'og-fonts');
const WIDTH = 1200;
const HEIGHT = 630;

type LoadedFont = { name: string; data: Buffer; weight: 400 | 600; style: 'normal' };
let fonts: LoadedFont[] | null = null;

function loadFonts(): LoadedFont[] {
  if (fonts) return fonts;
  fonts = [
    { name: 'OG Serif', data: fs.readFileSync(path.join(OG_FONTS, 'og-serif-400.ttf')), weight: 400, style: 'normal' },
    { name: 'OG Sans', data: fs.readFileSync(path.join(OG_FONTS, 'og-sans-600.ttf')), weight: 600, style: 'normal' },
  ];
  return fonts;
}

export interface OgCardOptions {
  title: string;
  /** 面包屑式的分类路径，例如 "Computer Graphic / DirectX12" */
  category: string;
  /** 该板块的强调色，十六进制 */
  color: string;
}

export async function renderOgCard({ title, category, color }: OgCardOptions): Promise<Buffer> {
  // 长标题截断：1200px 宽、64px 字号下大约能放两行
  const shown = title.length > 52 ? title.slice(0, 51) + '…' : title;

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: WIDTH, height: HEIGHT, display: 'flex',
          backgroundColor: '#0f0e0d', fontFamily: 'OG Serif',
        },
        children: [
          { type: 'div', props: { style: { width: 16, height: HEIGHT, backgroundColor: color } } },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', flexDirection: 'column',
                justifyContent: 'space-between', padding: '72px 80px', flexGrow: 1,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 28, color, fontFamily: 'OG Sans', letterSpacing: 2 },
                    children: category || '笔记',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 64, color: '#e2ddd7', lineHeight: 1.3 },
                    children: shown,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 26, color: '#a09b94', fontFamily: 'OG Sans' },
                    children: 'mimizh.dpdns.org',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    { width: WIDTH, height: HEIGHT, fonts: loadFonts() }
  );

  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng());
}
