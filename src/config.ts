// 共享配置 — 修改此文件来添加/编辑分类

export const NOTE_CATS: Record<string, { label: string; color: string; desc: string }> = {
  tech:  { label: '技术',   color: 'var(--tech)',    desc: '系统设计、编程语言、工程实践' },
  reading: { label: '读书', color: 'var(--reading)', desc: '阅读笔记与思考' },
  life:  { label: '生活',   color: 'var(--life)',    desc: '旅行、随笔、日常记录' },
};

export const WIKI_SECTIONS: Record<string, { label: string; color: string; desc: string }> = {
  cs:     { label: '计算机科学', color: 'var(--tech)',    desc: '数据结构、算法、分布式系统' },
  lang:   { label: '编程语言',   color: 'var(--project)', desc: '语言特性、类型系统、运行时' },
  papers: { label: '论文笔记',   color: 'var(--paper)',   desc: '经典论文精读与批注，附 PDF 原文' },
  tools:  { label: '工具与配置', color: 'var(--wiki)',    desc: '开发环境、编辑器、系统配置' },
};

export const STATUS_COLORS: Record<string, string> = {
  '维护中': 'var(--wiki)', '活跃开发': 'var(--life)', '发布': 'var(--tech)', '实验性': 'var(--tx3)',
};

// 当文件夹没有在配置中定义时，使用确定性颜色分配
const AUTO_COLORS = ['var(--tech)', 'var(--reading)', 'var(--life)', 'var(--project)', 'var(--wiki)', 'var(--paper)'];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 获取分类元数据 — 支持自动检测未配置的文件夹 */
export function getCatInfo(id: string) {
  if (NOTE_CATS[id]) return NOTE_CATS[id];
  const color = AUTO_COLORS[hashId(id) % AUTO_COLORS.length];
  return { label: id, color, desc: '' };
}

export function getWikiSection(id: string) {
  if (WIKI_SECTIONS[id]) return WIKI_SECTIONS[id];
  const color = AUTO_COLORS[hashId(id) % AUTO_COLORS.length];
  return { label: id, color, desc: '' };
}
