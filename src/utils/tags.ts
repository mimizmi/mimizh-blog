// ── 标签工具 ──────────────────────────────────────────────
// 标签页用它生成锚点 id，各详情页用它生成指向锚点的链接。两边必须算出同一个
// 值，所以放在这里共用一份，不要在页面里各写一遍。

/**
 * 标签 → 锚点 slug。保留字母、数字与 CJK（内容里可能出现中文标签），
 * 其余压成连字符。
 *
 * 大小写在这里被抹平，这是有意的：内容里同时存在 `Rust` 与 `cpp`、
 * `Virtual-Machine` 与 `distributed-systems` 这类不统一的写法，
 * 标签页按小写归组，锚点也必须跟着归一，否则详情页链过去会落空。
 */
export function tagSlug(tag: string): string {
  return tag.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 详情页标签芯片的目标地址 */
export function tagHref(tag: string): string {
  return `/tags/#${tagSlug(tag)}`;
}
