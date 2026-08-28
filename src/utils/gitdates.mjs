// ── 构建期从 git 取文件最后提交时间 ────────────────────────
// 全部在构建期运行，不引入任何运行时 JS。
// 为什么不用 fs.birthtime：CI 上 checkout 出来的文件 birthtime 等于克隆时刻，
// 会让所有没写 date 的笔记显示同一个「构建那天」，且每次 deploy 都变。
import { execFileSync } from 'node:child_process';

let cache = null;

/**
 * 一次 git log 扫出「仓库相对路径 → 最后提交 ISO 时间」。
 * --name-only 让每个 commit 后跟它触及的文件；git log 从新到旧输出，
 * 所以每个文件第一次出现时就是它的最后一次提交。
 * 用 %x00 前缀把时间行和文件名行区分开——文件路径里不可能出现 NUL。
 * -c core.quotepath=false：默认 git 会把非 ASCII 路径转成带引号的八进制转义
 * （如中文文件名），关掉之后 --name-only 才会原样吐出 UTF-8 路径，跟仓库相对
 * POSIX 路径对得上。
 */
export function getGitDates() {
  if (cache) return cache;
  const map = new Map();
  let out = '';
  try {
    out = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--format=%x00%aI', '--name-only', '--no-renames'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // 不在 git 仓库里（例如从 tarball 构建）时静默降级，由调用方回退到 birthtime
    cache = map;
    return map;
  }
  let current = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('\0')) {
      current = line.slice(1).trim();
      continue;
    }
    const file = line.trim();
    if (!file || !current) continue;
    if (!map.has(file)) map.set(file, current);
  }
  cache = map;
  return map;
}

/** 仓库相对 POSIX 路径 → 'YYYY-MM-DD'，未跟踪时返回空串 */
export function gitDateFor(repoRelPath) {
  const iso = getGitDates().get(repoRelPath);
  return iso ? iso.slice(0, 10) : '';
}
