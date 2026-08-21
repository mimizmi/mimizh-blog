# Magic Game Harness Unity — 项目总览与阅读路线图

> 源码：[github.com/mimizmi/magic-game-harness-unity](https://github.com/mimizmi/magic-game-harness-unity)
> 状态：脚手架 + 部分实现（截至 `1fe2010` commit, 2026-08-21）
> **这是 mimizmi 自己的项目**——一个 Unity 6 模块化游戏框架，目标类似"Bevy + mod-first"的 Unity 等价物。

---

## 1. 项目要解决什么问题

设想你要做这样的平台：

1. **核心团队**开发"框架"——AOT 内核、生命周期、网络桥、存档、Hot Reload
2. **职业 Mod 创作者**写 DLL 形式的玩法模块、UI、规则，**不需要拿到游戏源码**
3. **普通玩家**一键安装/卸载/组合 Mod，世界存档不会因为某个 Mod 升级而损坏

**核心矛盾**：Mod 要够"自由"（能注册能力、能订阅事件、能修改规则），但又**不能**绕过框架的 AOT 校验机制（否则一个 Bug Mod 就能毁掉整个世界）。

Magic Game Harness 的答案是：

| 层 | 谁能改 | 责任 |
|---|---|---|
| **AOT Kernel** | 框架开发者 | 不变量、生命周期、版本兼容性、依赖解析 |
| **ModApi（公共契约）** | 框架开发者 | Mod 能调用的接口，stable across versions |
| **HybridCLR 热更层** | Mod 作者 | 玩法逻辑、AI 技能、内容定义 |

**关键设计**：Mod **不能**直接引用 Context Runtime、Networking、Persistence 等内部实现，只能引用 Primitives + ModApi 这两个**对外公开**的程序集。

---

## 2. 程序集依赖图与实现进度

> spec 第 8.2 节定义依赖方向，第 8.3 节列出 **10 个** AOT 程序集。
> 全项目共 **15 个 asmdef**：`Assets/GameFramework` 下 10 个产品程序集，`Assets/Tests` 下 3 个测试程序集，`Packages/com.mimizh.game-mod-sdk` 下 2 个 SDK 外壳程序集。

下图逐字取自 15 个 asmdef 的 `references` 字段（方括号内是真实引用集）：

```
                    Game.Core.Primitives          references: []
                    ╱                    ╲
       Game.ModApi                        Game.Core.Diagnostics
      [Primitives]                        [Primitives]
            │                                      │
     Game.Core.Context                             │
   [Primitives, ModApi]                            │
            │                                      │
   ┌────────┼────────┬──────────────┐              │
 Rules  Networking  Persistence  HotUpdate         │
        [Primitives, ModApi, Context]              │
            └──────────────┬───────────────────────┘
                           │
                    Game.Bootstrap           ← 组合根（VContainer 装配）
        [上面 8 个 + VContainer]   autoReferenced: false
```

**两个容易画错的地方**：

1. **`Game.Core.Diagnostics` 不引用 `Game.ModApi`**——它只依赖 Primitives，是与 ModApi 平行的另一条分支。这解释了为什么 `ModuleDiagnosticsAdapter`（把 `IModuleDiagnostics` 桥到 `DiagnosticRouter`）必须住在 `Game.Bootstrap`：整个依赖图里只有 Bootstrap 同时看得见这两边。
2. **Rules / Networking / Persistence / HotUpdate 不是 ModApi 的直接下游同级**——它们还依赖 `Context`，处在第三层。

| 程序集 | 责任 | .cs | 行数 | 状态 |
|---|---|---:|---:|---|
| `Game.Core.Primitives` | 命名空间 ID、SemVer、兼容性四轴、诊断原语 | 5 | 974 | ✅ 完整实现 |
| `Game.ModApi` | 公共契约（spec 列 11 个子命名空间，4 个有内容） | 8 | 409 | ✅ 契约完整 |
| `Game.Core.Diagnostics` | Router + Factory + 3 个 sink + 10 个事件名 | 6 | 201 | ✅ **可用实现** |
| `Game.Bootstrap` | VContainer scope + App/Session 生命周期 + 主线程守门 | 16 | 1 183 | ✅ 完整实现 |
| `Game.Core.Context` | Fiber registry、依赖解析、effect ownership | 1 | 6 | ❌ 空 anchor |
| `Game.Core.Rules` | 权威规则提供者 | 1 | 6 | ❌ 空 anchor |
| `Game.Core.Networking` | NGO 自定义消息桥 | 1 | 6 | ❌ 空 anchor |
| `Game.Core.Persistence` | Snapshot / journal / schema / lockfile | 1 | 6 | ❌ 空 anchor |
| `Game.Core.HotUpdate` | HybridCLR bootstrap | 1 | 6 | ❌ 空 anchor |
| `Game.Framework.Editor` | 框架开发工具（Editor only） | 1 | 6 | ❌ 空 anchor |
| **产品小计** | | **41** | **2 803** | |
| `Game.Framework.Conformance` | 中性 Mod 夹具（只引用 Primitives + ModApi） | 2 | 45 | ✅ |
| `Game.Framework.Tests.EditMode` | EditMode 测试 | 21 | 2 820 | ✅ |
| `Game.Framework.Tests.PlayMode` | PlayMode 测试 | 5 | 441 | ✅ |
| `Game.ModSdk.Runtime` / `.Editor` | Mod SDK 外壳（`Packages/` 下，无行为） | 2 | 12 | ❌ 空 anchor |

测试规模（`Assets/Tests` 下属性标注点）：`[Test]` 88 + `[UnityTest]` 10 + `[TestCase(...)]` 47 + `[TestCaseSource]` 4 = **149**。

> 数字生成方式（下次更新重跑即可，不要手数）：
> ```bash
> find Assets/GameFramework/Bootstrap -name '*.cs' | wc -l
> find Assets/GameFramework/Bootstrap -name '*.cs' -exec cat {} + | wc -l
> grep -rho "\[Test\]\|\[UnityTest\]\|\[TestCaseSource" --include=*.cs Assets/Tests | sort | uniq -c
> ```

**当前状态**：Primitives + ModApi 契约 + Diagnostics + Bootstrap 四块已完整实现并被大量测试覆盖；Context / Rules / Networking / Persistence / HotUpdate 仍是空 anchor。下一步要实现的是 **Context Runtime**（spec 第 10 节，框架的灵魂）。

---

## 3. 关键设计原则

> §3.1–§3.5 出自 spec **第 6 节「Architectural Principles」**——注意那是一个 **13 条的扁平编号列表**，没有 6.1 / 6.3 这样的子小节，下面标注的"原则 N"就是列表序号。
> §3.6 不属于第 6 节，它出自 spec **第 5.1 节「Confirmed Initial Model」**。

### 3.1 Stable contracts, replaceable implementations（原则 1）

> 公共 API 只暴露接口 + DTO，不暴露内部 Context Runtime。

`Game.ModApi` 是 Mod 唯一能引用的程序集；它不依赖 `Game.Core.Context`（依赖图是单向的）。

### 3.2 AOT for invariants, hot for variability（原则 2）

- 性能/完整性关键的基础设施（版本校验、依赖解析、生命周期）→ AOT
- 频繁变化的玩法/内容 → HybridCLR 热更

### 3.3 Explicit ownership — 副作用归属（原则 3）

每个注册/订阅/任务都归属一个 **module fiber**（生命周期纤维）：
- 注册 → 拿一个 `IDisposable` handle
- 卸载 fiber → **LIFO 逆序**释放所有 handle

### 3.4 Provider-before-consumer 启停顺序（原则 6）

```
启动：provider 先激活 → consumer 再激活（能找到能力）
卸载：consumer 先卸载 → provider 再卸载（不会还有人在用）
```

### 3.5 Logical ≠ Physical unload（原则 7）

- **Logical unload**（必做）：停止行为、取消任务、释放 Addressables 句柄、销毁 Unity 对象、清理静态注册表
- **Physical unload**（可选）：HybridCLR 卸载 DLL，依赖 Edition 版本

**物理卸载失败不能复活逻辑已禁用的行为。**

### 3.6 Trusted cooperative client-host authority（spec 第 5.1 节，不属于第 6 节）

- 一个玩家被选为 host，**host 执行权威仿真**
- 其他客户端提交操作提案
- relay 服务只搬运字节，**不验证游戏语义**
- 云存档做异步审计，**不是反作弊机制**

> 推论：这套架构**不**支持竞技排名 / 服务器经济 / 有价值交易。

---

## 4. 阅读路线图

| 顺序 | 主题 | 笔记 | 状态 |
|---|---|---|---|
| 0️⃣ | **审查报告** — 本系列笔记的勘误、证据与修订记录（**建议先扫一遍**） | [00-Review-Report.md](./00-Review-Report.md) | ✅ 已写 |
| 1️⃣ | **Primitives** — 命名空间 ID、版本、诊断原语 | [02-Primitives-Deep-Dive.md](./02-Primitives-Deep-Dive.md) | ✅ 已写 |
| 2️⃣ | **Bootstrap** — VContainer scope + App/Session 生命周期 | [03-Bootstrap-Architecture.md](./03-Bootstrap-Architecture.md) | ✅ 已写 |
| 3️⃣ | **ModApi** — Mod 作者视角的契约 | [04-ModApi-Contract-Surface.md](./04-ModApi-Contract-Surface.md) | ✅ 已写 |
| 4️⃣ | **Architecture Tests** — 依赖规则如何被测试守住 | [05-Architecture-Enforcement.md](./05-Architecture-Enforcement.md) | ✅ 已写 |
| 5️⃣ | **Mod 分发流程** — 作者→构建→玩家→激活的完整链路 | [06-Mod-Distribution.md](./06-Mod-Distribution.md) | ✅ 已写 |
| 6️⃣ | **vs SMAPI** — Stardew Valley mod 平台对比 | [07-Comparison-with-SMAPI.md](./07-Comparison-with-SMAPI.md) | ✅ 已写 |
| 7️⃣ | **vs Bevy ECS** — Rust ECS 引擎对比 | [08-Comparison-with-Bevy-ECS.md](./08-Comparison-with-Bevy-ECS.md) | ✅ 已写 |
| 8️⃣ | **实现思路深挖** — 值类型哨兵、比较语义矩阵、VContainer 装配、拒绝协议、失败账本、asmdef 强制 | [09-Implementation-Deep-Dives.md](./09-Implementation-Deep-Dives.md) | ✅ 已写 |
| 9️⃣ | **Context Runtime** — Fiber + 依赖解析（计划中的下一个实现） | — | 🔜 未实现 |

---

## 5. 推荐阅读顺序（先做什么后做什么）

| 阶段 | 目标 | 时间投入 |
|---|---|---|
| **第 1 阶段：基础类型** | 把 Primitives 全部读完并理解 FNV-1a、SemVer 优先级、Guid N format 这些"小但关键"的设计 | 1-2 小时 |
| **第 2 阶段：组合根** | 读 Bootstrap，看 VContainer scope 怎么分层、生命周期状态机怎么写 | 2-3 小时 |
| **第 3 阶段：公共契约** | 读 ModApi，理解 Mod 作者会接触到的接口（这部分完整但还没接入 Context） | 2-3 小时 |
| **第 4 阶段：架构守门** | 读 Architecture 测试，理解依赖规则怎么用代码强制（防止后续实现违反 spec） | 1 小时 |

---

## 6. 参考资料

- 完整 spec：`docs/superpowers/specs/2026-08-19-modular-game-harness-design.md`（1487 行）
- 实现计划：
  - `docs/superpowers/plans/2026-08-19-game-framework-scaffold.md` — 脚手架任务
  - `docs/superpowers/plans/2026-08-20-kernel-composition-roots.md` — Bootstrap
  - `docs/superpowers/plans/2026-08-20-kernel-composition-roots-corrections.md` — Bootstrap 修正
- 核心概念参考：
  - **FNV-1a hash** — 跨进程稳定的字符串哈希
  - **SemVer 2.0.0** spec 第 11 节 — precedence 比较规则
  - **VContainer** — Unity 的 DI 容器
  - **HybridCLR** — Unity 的 C# 热更新方案（运行时加载 DLL）
  - **Netcode for GameObjects (NGO)** — Unity 官方网络栈
  - **Addressables** — Unity 的资源异步加载系统

---

## 7. 我对项目的整体观感

1. **规范先行**——1487 行的 spec + 多份 plan 文档先行落地，代码按 spec 实现。这是非常成熟的工程做法（对比很多"边写边想"的项目）。
2. **测试驱动**——架构测试（强制依赖图）+ 行为测试（每个值对象都有 5-10 个边界 case），先于实现写好。
3. **Primitives 扎实**——这部分实现质量很高，FNV-1a、SemVer 优先级、Guid N format 都是教科书级别。
4. **设计留白合理**——Context/Networking/Persistence 等还是 anchor，等下一个 plan 落地后填充，避免"凭空虚构"。
5. **"能强制的就不写文档"**——依赖方向靠 asmdef + 测试、公共 API 靠反射白名单、隐式可达性靠 `autoReferenced: false`、"公共契约够不够用"靠 `NeutralModuleFixture` 这个只引用 Primitives + ModApi 的可执行证明。详见 [09 §8](./09-Implementation-Deep-Dives.md) 与 [09 §10](./09-Implementation-Deep-Dives.md)。

**类比**：
- Primitives 像 `std::chrono` + `semver` C++ 库
- ModApi 像 Vulkan 的公共头文件（稳定、不依赖私有类型）
- Bootstrap 像 tokio runtime 的 builder