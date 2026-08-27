// ── 极小的断言收集器 ──────────────────────────────────────
// 一次跑完所有检查再统一报错，而不是第一条就退出——修的时候能一次看全。

export function createChecker() {
  const failures = [];
  const passed = [];
  return {
    check(name, fn) {
      try {
        fn();
        passed.push(name);
      } catch (e) {
        failures.push(`${name}: ${e.message}`);
      }
    },
    report() {
      for (const p of passed) console.log(`  ✓ ${p}`);
      if (failures.length) {
        console.error('\n检查失败：');
        for (const f of failures) console.error(`  ✗ ${f}`);
        process.exit(1);
      }
      console.log(`\n全部 ${passed.length} 项检查通过`);
    },
  };
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
