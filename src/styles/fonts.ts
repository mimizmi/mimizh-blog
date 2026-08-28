// ── 拉丁字体 ──────────────────────────────────────────────
// 由 Fontsource 提供，Vite 打包并带内容 hash。全部是副作用 import：
// 每个 css 文件里是该字族的 @font-face 与它自带的 unicode-range。
// 改这里之前先确认 BaseLayout 的 __mzFontPresets 用的是同一批字族名。
import '@fontsource-variable/lora';
import '@fontsource-variable/lora/wght-italic.css';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';

// ── KaTeX ─────────────────────────────────────────────────
// katex 本来就是依赖（rehype-katex 用它做构建期渲染），这里只是把它的
// 样式表从 jsdelivr 换成本地。字体文件由 Vite 从 css 里的相对路径解析。
import 'katex/dist/katex.min.css';
