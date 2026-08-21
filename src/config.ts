// 共享配置

/** 站点级元信息，供 SEO / RSS / sitemap 使用 */
export const SITE = {
  title: 'mimizh',
  description: '个人笔记站 — 计算机图形学、数据库、分布式系统、游戏开发的学习记录。',
  author: 'mimizh',
  lang: 'zh-CN',
  /** 与 astro.config.mjs 的 site 保持一致 */
  url: 'https://mimizh.dpdns.org',
} as const;

/** 项目状态 → 颜色 */
export const STATUS_COLORS: Record<string, string> = {
  '维护中': 'var(--wiki)',
  '活跃开发': 'var(--life)',
  '发布': 'var(--tech)',
  '实验性': 'var(--tx3)',
};
