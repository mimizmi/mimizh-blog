# 笔记审查报告（Review Report）

> 审查对象：`01-Index.md` ~ `08-Comparison-with-Bevy-ECS.md`（8 篇，约 250 KB）
> 对照基准：`E:/code/_Codex/unity-project/Magic Game Harness`，`main` 分支 `1fe2010`，工作区干净
> 审查方式：逐文件通读全部产品源码（2 803 行）+ 测试源码（3 306 行）+ 15 个 `.asmdef` + `Packages/manifest.json` + `docs/superpowers/specs/2026-08-19-modular-game-harness-design.md`（1 487 行）+ VContainer 1.19.0 包内源码
> 审查日期：2026-08-21

---

## 0. 总评

先说结论，避免被下面一长串 issue 带偏印象：

**这套笔记的骨架是对的，深度也在线。** 03/04/05 三篇对 `Session` 状态机、ModApi 契约边界、架构守门测试的解读，绝大部分是**直接读源码得出的**，引用的代码片段与真实代码逐字一致，推理链条也站得住。特别是：

- 03 §4.4 对 "superseded start" 竞态的复原（`scopeFactory.Create` 之后必须 re-check `state == Starting`），与 `SessionLifecycleConcurrencyTests.Stop_requested_while_starting_reaches_one_terminal_state_without_leaking_a_scope` 的意图完全吻合；
- 04 §2 对 `ModApiShapeTests` 的引用逐字准确；
- 05 全篇对两个架构测试文件的解读几乎无误，是 8 篇里事实密度最高、错误最少的一篇。

**问题集中在三类**，且有明确的模式：

| 类别 | 表现 | 影响 |
|---|---|---|
| **A. 统计口径失真** | 文件数、行数、程序集数、测试数几乎全部对不上 | 读者会低估项目完成度（把已实现的 Diagnostics 当成"未实现"） |
| **B. 示例/测试名凭空生成** | 03 §10/§11 的 7 个测试名、`OnDispose` API、06 §1.4 的 `RegisterCapability<T>` 全部不存在 | **最严重**——这些"证据"会误导后续实现，甚至直接违反项目自己的架构测试 |
| **C. 机制解释似是而非** | 结论对但因果错（`GetHashCode` 随机化、`TaskScheduler.Default`、`RegisterEntryPointExceptionHandler` 顺序、`CancellationTokenSource.Dispose`） | 学到的是错误的心智模型，迁移到别的项目会踩坑 |

其中 **B 类必须修正**：06 §1.4 里那段 `context.RegisterCapability<IGameRules>(rules)` 示例，恰好被 `PublicApiSurfaceTests.Module_context_is_not_an_unrestricted_service_locator` 明确禁止（该测试断言 `IModuleContext` 上不得存在任何泛型方法）。如果照着笔记去实现 Context Runtime，第一件事就是把自己的架构测试搞红。

下面逐条给出证据与修正。**已在原笔记中就地修改的条目标注 ✅；仅在本报告中记录、原文保留的标注 📝。**

---

## 1. A 类：统计口径失真

### 1.1 全项目真实统计（本报告的基准数据）

15 个 `.asmdef`：`Assets/GameFramework` 下 10 个产品程序集，`Assets/Tests` 下 3 个测试程序集，`Packages/com.mimizh.game-mod-sdk` 下 2 个 SDK 程序集。

| 程序集 | .cs 文件 | 行数 | 真实状态 |
|---|---:|---:|---|
| `Game.Core.Primitives` | 5 | 974 | ✅ 完整实现 |
| `Game.ModApi` | 8 | 409 | ✅ 契约完整（11 个 spec 命名空间中 4 个有内容） |
| `Game.Core.Diagnostics` | 6 | 201 | ✅ **可用实现**（Router + Factory + 3 个 sink + 事件名表） |
| `Game.Bootstrap` | 16 | 1 183 | ✅ 完整实现 |
| `Game.Core.Context` | 1 | 6 | ❌ 空 anchor |
| `Game.Core.Rules` | 1 | 6 | ❌ 空 anchor |
| `Game.Core.Networking` | 1 | 6 | ❌ 空 anchor |
| `Game.Core.Persistence` | 1 | 6 | ❌ 空 anchor |
| `Game.Core.HotUpdate` | 1 | 6 | ❌ 空 anchor |
| `Game.Framework.Editor` | 1 | 6 | ❌ 空 anchor |
| **产品小计** | **41** | **2 803** | |
| `Game.Framework.Conformance` | 2 | 45 | ✅ `NeutralModuleFixture` |
| `Game.Framework.Tests.EditMode` | 21 | 2 820 | ✅ |
| `Game.Framework.Tests.PlayMode` | 5 | 441 | ✅ |
| `Game.ModSdk.Runtime` | 1 | 6 | ❌ 空 anchor（SDK 外壳） |
| `Game.ModSdk.Editor` | 1 | 6 | ❌ 空 anchor（SDK 外壳） |

测试规模（属性标注点，`Assets/Tests` 下 grep 精确统计）：

```
[Test]            88
[UnityTest]       10
[TestCase(...)]   47   ← 参数化，实际用例数更多
[TestCaseSource]   4
                 ---
                 149
```

> 复现命令：
> ```bash
> find Assets/GameFramework/Core/Primitives -name "*.cs" | wc -l
> find Assets/GameFramework/Core/Primitives -name "*.cs" -exec cat {} + | wc -l
> grep -rho "\[Test\]\|\[UnityTest\]\|\[TestCaseSource" --include=*.cs Assets/Tests | sort | uniq -c
> ```

### 1.2 逐条差异

| # | 位置 | 笔记原文 | 真实值 | 处置 |
|---|---|---|---|---|
| A-1 | `01-Index.md:47` | Primitives `4 文件 / ~580 行` | **5 文件 / 974 行** | ✅ |
| A-2 | `01-Index.md:48` | ModApi `8 文件 / ~290 行` | 8 文件 / **409 行** | ✅ |
| A-3 | `01-Index.md:54` | Diagnostics `⏳ 部分（DiagnosticEventFactory）` | **6 文件 / 201 行，完整可用**：`DiagnosticRouter` + `DiagnosticEventFactory` + `IDiagnosticSink` + `InMemoryDiagnosticSink` + `UnityConsoleDiagnosticSink` + `FrameworkDiagnosticEvents`（10 个事件名） | ✅ |
| A-4 | `01-Index.md:55` | Bootstrap `7 文件 / ~580 行` | **16 文件 / 1 183 行** | ✅ |
| A-5 | `01-Index.md:58-59` | EditMode 14 文件 / PlayMode 4 文件 | **21 / 5** | ✅ |
| A-6 | `01-Index.md:31` | "13 个 AOT 程序集" | spec §8.3 只定义 **10 个** AOT 程序集；13 是"`Assets` 下 asmdef 总数（含 3 个测试程序集）"；全项目 asmdef 共 **15 个**（另有 2 个在 SDK 包内） | ✅ |
| A-7 | `02:4` | "4 个文件 + 1 个诊断子目录，共 ~580 行" | 5 个 `.cs`（4 个顶层 + `Diagnostics/DiagnosticValues.cs`），**974 行** | ✅ |
| A-8 | `03:4` | "实文件 14 + 7 + 测试 13 = ~3500 行" | **只有第一个数字错**：Bootstrap 是 **16** 个 `.cs`，不是 14。第二个 "7" 说得通（`Core/Diagnostics/` 目录里 6 个 `.cs` + 1 个 README）；**"测试 13" 是对的**（`EditMode/Bootstrap/` 9 个 + `PlayMode/Bootstrap/` 4 个）；"~3500" 也是合理估计（实测 1 183 + 201 + 1 884 = **3 268**）。已改成精确数字 | ✅ |
| A-9 | `03:35` | "Bootstrap 目录 14 个文件" | **16**（下面的文件清单本身是完整且正确的 16 项，只有标题的数字错了） | ✅ |
| A-10 | `03:23` | "依赖其他 9 个 runtime 程序集" | asmdef 里是 **8 个游戏程序集 + VContainer**；说"9 条引用"可以，说"9 个 runtime 程序集"不对 | ✅ |
| A-11 | `05:28` | 标题"两个测试文件覆盖的 5 个维度"，正文列 10 个 | 标题应为 **10 个维度** | ✅ |

### 1.3 A-3 单独说明：Diagnostics 不是"部分实现"

这是影响最大的一条统计错误。`Game.Core.Diagnostics` 是**当前唯一一个已经被 Bootstrap 全链路用起来的 Core 子系统**：

```
AppLifetimeScope.Configure
  → new UnityConsoleDiagnosticSink()
  → new DiagnosticRouter(new[]{ consoleSink })
  → new DiagnosticEventFactory()
  → builder.RegisterInstance(router / eventFactory)
        ↓
  ApplicationLifecycleCoordinator.Emit / Session.Emit / EntryPointFailureReporter.Report
        ↓
  DiagnosticRouter.Emit → 每个 sink（sink 抛异常被隔离）
```

它还有一个笔记完全没提的结构性特征：**`Game.Core.Diagnostics` 只引用 `Game.Core.Primitives`，不引用 `Game.ModApi`**（`Game.Core.Diagnostics.asmdef` 的 `references` 只有一项，`AssemblyDependencyTests.cs:18` 也把这条钉死了）。

这解释了一个否则会显得多余的类型：`ModuleDiagnosticsAdapter` 为什么住在 `Game.Bootstrap` 而不是 `Game.Core.Diagnostics`？因为它要同时看见 `Game.ModApi.Diagnostics.IModuleDiagnostics`（公共契约侧）和 `Game.Core.Diagnostics.DiagnosticRouter`（私有实现侧），而**整个依赖图里只有 Bootstrap 一个程序集同时引用了这两边**。适配器只能落在组合根。这是"依赖方向决定了代码物理位置"的一个干净例子，值得写进笔记（已补入 `03` 新增的 §9.1）。

---

## 2. B 类：不存在的测试名与不可编译的示例

这一类是本次审查最需要处理的部分。

### 2.1 `03-Bootstrap-Architecture.md` §10：7 个测试名全部不存在

笔记 `03:960-986` 给出一张 `SessionStateMachineTests` 的测试表：

```
New_session_is_in_Created_state
Start_transitions_to_Running_and_registers_scope
Stop_transitions_to_Stopped_and_disposes_scope
Failed_start_emits_start_failed_event
Cancel_during_start_transitions_to_Stopped
Restart_after_stop_is_rejected
State_is_immutable_after_terminal_transition
```

**这 7 个名字在仓库里一个都不存在。** `SessionStateMachineTests.cs`（239 行）的真实内容是 7 个测试，但名字完全不同：

```csharp
Session_factory_enforces_one_active_session_and_allows_recreation_after_stop
Stop_disposes_scope_and_clears_factory_before_final_event
Canceled_startup_fails_releases_factory_and_does_not_poison_next_session
Scope_creation_failure_is_normalized_and_releases_factory
Use_after_dispose_is_explicit_and_repeated_dispose_is_safe
Application_and_bound_module_diagnostics_are_attributed
Entry_point_failure_is_routed_as_normalized_application_diagnostic
```

顺带纠正一个由假测试名推出的假结论。笔记说"**最微妙的一个**：Cancel during start → `Stopped` 不是 `Failed`"。**真实代码恰好相反**——`Session.StartAsync` 的 catch 分支无条件调用 `FailStart(exception)`，而 `FailStart` 的 `finally` 里写死 `state = SessionState.Failed`：

```csharp
// Session.cs:314-368
void FailStart(Exception primary)
{
    ...
    finally
    {
        lock (sync)
        {
            state = SessionState.Failed;   // ← 取消也走这里
            isDisposed = true;
            ...
        }
    }
}
```

真实测试名 `Canceled_startup_fails_releases_factory_and_does_not_poison_next_session` 里的 `fails` 就是这个意思。取消与失败**在 `SessionState` 上被合并成同一个终态 `Failed`**；区分只体现在**返回的 Task 上**（取消返回 `Task.FromCanceled`，其它失败返回 `Task.FromException`）：

```csharp
// Session.cs:176-185
catch (Exception exception)
{
    FailStart(exception);
    if (exception is OperationCanceledException)
    {
        var token = cancellationToken.IsCancellationRequested ? cancellationToken : new CancellationToken(true);
        return Task.FromCanceled(token);   // ← 差别只在这里
    }
    return Task.FromException(exception);
}
```

这其实比笔记编的那个说法更有意思：**状态机粒度和 Task 结果粒度是两套独立的信号**，前者只关心"这个 Session 还能不能用"，后者才承载"为什么不能用"。已重写为 `03` §10。

✅ 已整节重写。

### 2.2 `03-Bootstrap-Architecture.md` §11：测试名 + API 双重不存在

笔记 `03:1005-1008` 的示例：

```csharp
public async Task Cleanup_failure_during_normal_stop_keeps_original_completion_and_reports_failure()
{
    harness.ScopeFactory.OnDispose = _ => throw new InvalidOperationException("cleanup boom");
```

两处都是假的：

1. 测试名不存在。`SessionCleanupFailureTests.cs` 的 5 个真实测试是：
   `Scope_disposal_failure_during_normal_stop_still_releases_all_ownership`、
   `Second_session_can_be_created_after_a_cleanup_failure`、
   `Repeated_stop_and_dispose_after_a_cleanup_failure_are_deterministic`、
   `Failed_start_preserves_the_primary_failure_when_cleanup_also_throws`、
   `Failed_start_without_a_scope_still_releases_the_factory`。
2. **`RecordingScopeFactory` 没有 `OnDispose` 属性。** 真实的注入点（`SessionTestSupport.cs:16-37`）是三个：

   ```csharp
   public Exception CreateFailure { get; set; }               // 从 Create 抛（模拟 scope 建不出来）
   public Exception DisposeFailure { get; set; }              // 从 scope.Dispose 抛（模拟清理失败）
   public Action<ISessionLifetime> OnCreating { get; set; }   // Create 之前的回调（用来注入重入）
   ```

   注意 `DisposeFailure` 是**在构造 `RecordingScope` 时传进去**的（`Create` 里 `new RecordingScope(lifetime, DisposeFailure)`），所以它必须在 `CreateSession()` → `StartAsync()` 之前设置——这个时序约束，笔记里那个假 API 完全表达不出来。

✅ 已整节重写为真实 API + 真实测试名。

### 2.3 `03-Bootstrap-Architecture.md` §12.1：数量错

标题写"8 个守门测试"，`LifecycleMainThreadTests.cs` 实际有 **10 个**。表里列的 8 个名字都对，漏了：

```csharp
Many_concurrent_worker_threads_are_all_rejected_without_disturbing_the_session
Main_thread_lifecycle_succeeds_and_repeated_stop_and_dispose_stay_idempotent
```

有意思的是笔记 §12.3 其实**引用了**第一个测试的代码体，只是没意识到它就是那个漏掉的测试。✅ 已补。

### 2.4 `06-Mod-Distribution.md` §1.4：示例代码违反项目自己的架构测试

`06:155`：

```csharp
context.RegisterCapability<IGameRules>(rules);
```

`IModuleContext` 的完整定义只有两个属性，没有任何方法：

```csharp
// Assets/GameFramework/ModApi/Lifecycle/IModuleContext.cs
public interface IModuleContext
{
    ModuleId ModuleId { get; }
    IModuleDiagnostics Diagnostics { get; }
}
```

而且这个"没有泛型方法"是**被测试钉死的架构约束**，不是暂未实现：

```csharp
// PublicApiSurfaceTests.cs:62-68
[Test]
public void Module_context_is_not_an_unrestricted_service_locator()
{
    var methods = typeof(IModuleContext).GetMethods();
    Assert.That(methods.Any(m => m.Name.StartsWith("Resolve", StringComparison.Ordinal)), Is.False);
    Assert.That(methods.Any(m => m.IsGenericMethod), Is.False);   // ← 禁止一切泛型方法
}
```

`RegisterCapability<T>` 是泛型方法，加进去测试立刻红。这条约束的动机在 spec §11.3（"Public contracts shall not expose internal Unity scene objects unless represented by stable, restricted handles"）和 `IModuleContext` 自己的 doc comment 里："It exposes **no unrestricted service resolution** and becomes invalid after deactivation completes."

**未来的能力注册 API 必然长成非泛型形态**，比如：

```csharp
// 一种符合现有约束的可能形状（仍属推测，当前代码库中不存在）
IDisposable RegisterCapability(CapabilityKey key, CapabilityVersion version, object provider);
bool TryGetCapability(CapabilityKey key, CapabilityVersion minimum, out object provider);
```

类型安全靠 `CapabilityKey` + 单独打包的**契约程序集**（spec §8.5 "Contract-Only Cross-Mod Assemblies"）来承担，而不是靠 `IModuleContext` 上的泛型参数。这正是 capability 模型与 DI 容器的分野：DI 容器用 `Resolve<T>()`，`T` 就是契约；capability 模型用 `(key, version)` 二元组，契约由**独立版本化的第三方程序集**承载，于是"谁提供、谁消费、版本合不合"全都能写进 manifest 被机器检查。

同一段还有两个小错：

- `CapabilityVersion.Parse("1.x")` — **会抛 `FormatException`**。`CapabilityVersion` 包着 `SemanticVersion`，正则是 `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)...$`，三段必填。当前代码库里**根本没有版本区间（range）类型**，`CapabilityRequirement` 存的是"精确版本"（doc comment 原文：`Gets the exact capability contract version`）。`"1.x"` 这种写法要等未来引入 `VersionRange` 才成立。
- 两个 `async Task<...>` 方法体里没有 `await`，会触发 CS1998。

✅ 已重写为可编译、且不违反架构测试的示例，并把"版本区间尚不存在"标注出来。

📝 `07-Comparison-with-SMAPI.md:223` 的 manifest 推测里同样用了 `"version": "1.x"`，但那一段明确标了"已推测"，且是 JSON 而非 C#，保留原样并加了一句脚注。

### 2.5 `08-Comparison-with-Bevy-ECS.md` §2：同一个 `GetCapability<T>` 问题

`08` 的概念对照表里写 `ctx.GetCapability<T>(key)`。同上，泛型方法形态与 `Module_context_is_not_an_unrestricted_service_locator` 冲突。✅ 已改为非泛型形态并加注"推测形状"。

---

## 3. C 类：结论对但因果错

这一类不影响"这个项目做了什么"的判断，但会让读者带走错误的通用知识。逐条给出**正确的机制**。

### 3.1 `02:172` — `string.GetHashCode` 为什么不能用

笔记原文：

> ⚠️ .NET runtime 在**每个进程**里**随机化**字符串的 hash seed（从 .NET Core 2.1 起）。

两点不准：

1. **时间线不对。** 字符串哈希随机化在 .NET Framework 4.5 就以 `UseRandomizedStringHashAlgorithm` 配置项存在，.NET Core 从 1.0 起就是**默认且不可关闭**，不是 2.1 才引入。
2. **对 Unity 来说这个理由几乎不成立。** 本项目跑在 Unity 6 的 Mono / IL2CPP 上，不是 CoreCLR。Unity 的 Mono 运行时里 `string.GetHashCode()` **不做 per-process 随机化**，同一进程、同一 Unity 版本下它是确定的。

那 FNV-1a 到底买到了什么？三件更实在的事：

| 保证 | 为什么 `GetHashCode` 给不了 |
|---|---|
| **跨后端一致** | Editor 走 Mono、Player 走 IL2CPP，两者的 `string.GetHashCode` 实现不同。同一个 `ModuleId` 在 Editor 与打包后的 Player 里可能算出不同的 hash。 |
| **跨 Unity 版本一致** | BCL 的 `GetHashCode` 从来没有跨版本稳定的承诺，Unity 升级 Mono 版本就可能变。 |
| **可写进产物** | 一旦哈希值确定，它就可以出现在 lockfile、网络握手、Addressables key 里。`GetHashCode` 的契约明确说了"不要持久化"。 |

还有一个笔记完全没提、但很值得知道的实现细节：

```csharp
// NamespacedIdentifiers.cs:132-133
for (var index = 0; index < value.Length; index++)
    hash = (hash ^ value[index]) * 16777619;
```

这里迭代的是 **`char`（UTF-16 code unit）**，不是**字节**。教科书 FNV-1a 定义在字节序列上。对 `ModuleId` / `CapabilityKey` 无所谓——它们被 `NamespacedIdentifier.IsValid` 限死在 ASCII 子集（`a-z`、`0-9`、`-`、`.`），UTF-16 code unit 与 UTF-8 字节一一对应，结果与标准 FNV-1a 一致。但 `DiagnosticAttribute.GetHashCode` 也走这个函数，而 `DiagnosticAttribute.Value` **可以是任意字符串**（包括中文、emoji）。此时算出来的值仍然是**确定的**（这才是真正的需求），只是**不等于**标准 FNV-1a 对该字符串 UTF-8 编码的结果。

> 结论没变（这个实现是对的），但理由要换成"确定性"而不是"标准 FNV-1a"。如果将来要把这个哈希写进跨语言协议（比如服务端用 Go 校验），就必须补一句规格说明："哈希定义在 UTF-16 code unit 序列上"。

✅ 已重写 `02` §1.4。

### 3.2 `03:191` — `RegisterEntryPointExceptionHandler` 的顺序

笔记原文：

> **`RegisterEntryPointExceptionHandler` 必须在 `RegisterEntryPoint` 之前**——否则 entry-point 抛出的异常**不会被 reporter 捕获**。

**"不会被捕获"是错的。** 查 VContainer 1.19.0 源码：

```csharp
// EntryPointDispatcher.cs
public void Dispatch()
{
    PlayerLoopHelper.EnsureInitialized();
    var exceptionHandler = container.ResolveOrDefault<EntryPointExceptionHandler>();  // ← 容器建好之后才解析
    ...
}
```

handler 是在 **`Dispatch()` 时**从已建成的容器里解析的，跟注册先后没关系。而且 `Registry.AddToBuildBuffer` 里明写着 `// Overwritten by the later registration`——同类型多次注册，**后注册的赢**。所以就算顺序反过来，最终生效的仍然是框架自己的 `failureReporter.Report`。

**但顺序确实有影响，只是影响的是另一件事。** `RegisterEntryPoint<T>()` 内部第一步是 `EntryPointsBuilder.EnsureDispatcherRegistered(builder)`：

```csharp
// ContainerBuilderUnityExtensions.cs:13-26
public static void EnsureDispatcherRegistered(IContainerBuilder containerBuilder)
{
    if (containerBuilder.Exists(typeof(EntryPointDispatcher), false)) return;
    containerBuilder.Register<EntryPointDispatcher>(Lifetime.Scoped);

    if (!containerBuilder.Exists(typeof(EntryPointExceptionHandler)))       // ★
    {
        containerBuilder.RegisterEntryPointExceptionHandler(UnityEngine.Debug.LogException);  // ★ 默认 handler
    }
    ...
}
```

★ 处：**如果此刻还没有任何 handler，VContainer 会替你注册一个默认的 `Debug.LogException`。**

于是：

| 顺序 | 结果 |
|---|---|
| 现有代码：先 handler，后 entry point | `Exists(...)` 为 true → 不注册默认 handler → 容器里**恰好一个** handler |
| 反过来：先 entry point，后 handler | 先塞进默认 `Debug.LogException`，再塞进框架的 → **两条注册**，VContainer 为该类型建出一个 `CollectionInstanceProvider`，`ResolveOrDefault` 拿到后注册的那个（行为仍正确，但多了一条冗余注册和一次集合构造） |

**正确的说法**：这个顺序不是"能不能捕获"的问题，而是"要不要让 VContainer 塞一个你不想要的默认 handler 进来"的问题。写在前面是干净的做法，但不写在前面也不会漏掉异常。

✅ 已重写 `03` §2.3，并补了 `Dispatch()` 的时机说明（见 §7 第 7 条）。

### 3.3 `03:547` — `CancellationTokenSource` 重复 Dispose

笔记原文：

> 多次 dispose `CancellationTokenSource` 会抛 `ObjectDisposedException` 的奇怪变种——用 latch 保证 dispose 恰好一次。

**不会抛。** `CancellationTokenSource.Dispose()` 遵守 `IDisposable` 的标准契约，内部有 `_disposed` 检查，重复调用是 no-op。这是 BCL 的明文保证。

那 `DisposeCancellationOnce` 的 latch 为什么存在？看它的两个调用点就清楚了——`RunStop` 的 `finally` 和 `FailStart` 的 `finally`。latch 的价值是：

1. **表达单一所有权**：这个 `CancellationTokenSource` 只有 `Session` 一个 owner，且只被释放一次——这是设计意图的代码化，跟 `scope = null; owned?.Dispose();` 的"先清引用再释放"是同一个套路；
2. **让重复调用的开销恒定**：不进 BCL 的 dispose 路径，只做一次 `bool` 判断；
3. **为将来换成非幂等的资源留位置**：如果哪天 `lifetimeCancellation` 换成一个自定义的、Dispose 非幂等的对象，这里不用改。

真正**必须**小心的不是 `Dispose` 重入，而是另一件事，而项目已经处理了：`CancellationTokenSource` 被 Dispose 之后，**再访问它的 `.Token` 属性会抛 `ObjectDisposedException`**。所以 `SessionLifetime` 在构造时就把 token 拷了一份：

```csharp
// Session.cs:86
lifetime = new SessionLifetime(id, lifetimeCancellation.Token);   // ← 构造时抓一次
```

`CancellationToken` 是 struct，持有对内部状态的引用；source 释放后，已经拿到手的 token 依然可以安全读 `IsCancellationRequested`。`SessionLifetime` 的 doc comment 把这条写死了：

> The token is captured once at Session construction and stays stable for the whole Session lifetime, so observing it remains valid after the source has been disposed.

而这正是测试 `RecordingScope.Dispose` 里那行 `TokenCancelledAtDispose = Lifetime.Token.IsCancellationRequested` 能安全执行的原因。

✅ 已重写 `03` §4.7，把重点从"重复 Dispose 会炸"改成"Dispose 之后 `.Token` 会炸，所以必须提前捕获"。

### 3.4 `03:859` — `TaskScheduler.Default` 与 `ContinueWith`

笔记原文：

> **为什么显式 `TaskScheduler.Default`？** 默认情况下，await continuation 会在调用者的 synchronization context 上跑……

把 `await` 和 `ContinueWith` 混为一谈了。代码里是 `ContinueWith`，不是 `await`：

```csharp
// ApplicationLifecycleCoordinator.cs:208-212
stop.ContinueWith(
    completed => CompleteShutdown(completion, Failure(completed)),
    CancellationToken.None,
    TaskContinuationOptions.ExecuteSynchronously,
    TaskScheduler.Default);
```

正确的机制是 .NET 里一个非常经典的坑：

- **`await` 的续体**：捕获 `SynchronizationContext`；没有 SC 时回落到 `TaskScheduler.Current`。
- **不带 scheduler 参数的 `ContinueWith`**：**不看 `SynchronizationContext`**，直接用 `TaskScheduler.Current`。

而 `TaskScheduler.Current` 是**环境值**——它等于"当前正在执行的 Task 所属的调度器"，只有在没有 Task 上下文时才是 `Default`。这意味着如果 `ShutdownAsync` 恰好被某个跑在自定义调度器（比如 `ConcurrentExclusiveSchedulerPair`、或某些测试框架的调度器）上的 Task 调用，续体就会被排到那个调度器上——一个**取决于调用栈的、非确定的**行为。这正是"永远显式传 `TaskScheduler` 给 `ContinueWith`"这条老规矩的由来。

再看 `TaskContinuationOptions.ExecuteSynchronously`：它的意思是"尽量在**完成 antecedent 的那个线程**上就地跑续体，省掉一次调度"。所以两个参数合起来的语义是：

> 能就地跑就就地跑（省一次排队）；不能就地跑时，回落到**线程池**，而不是某个碰巧存在的环境调度器。

推论——也是代码注释真正在说的那件事——**续体可能跑在任意线程上**：

```csharp
// A future Session with genuinely asynchronous cleanup: never block the caller, and never
// resume Unity or VContainer work off the main thread. The continuation only emits
// diagnostics and releases references.
```

所以 `CompleteShutdown` 的函数体被严格限制成"只改内存状态 + 发诊断"，一行 Unity API 都不碰。**并且这反过来给诊断管线加了一条硬约束：所有 sink 必须线程安全。** 项目确实满足：`InMemoryDiagnosticSink` 用 `lock` 保护 `List`，`UnityConsoleDiagnosticSink` 只调 `Debug.Log`（Unity 少数几个可跨线程调用的 API 之一）。

✅ 已重写 `03` §8.3，并新增 §9.1 讲诊断管线的线程契约。

### 3.5 `02:582-583` — Guid 格式示例字符串是错的

```
"a1b2c3d4e5f6789012345678abcdef0"      ← 31 个字符，N format 应为 32
"a1b2c3d4-e5f6-7890-1234-5678abcdef0"  ← 末段 11 位，D format 应为 8-4-4-4-12
```

正确示例：

```
N: "a1b2c3d4e5f678901234567890abcdef"        (32 hex，无连字符)
D: "a1b2c3d4-e5f6-7890-1234-567890abcdef"    (8-4-4-4-12)
```

✅ 已修。

### 3.6 `02:640` / `02:709-717` — 两个表述问题

- `02:640` 写"**10 个字段**"，紧接着的表列了 11 行。`DiagnosticEvent` 构造函数确实是 **11 个参数**。✅ 已改。
- `02:709-717` 关于 `ToArray()` vs `ToList()` 的那段自问自答（"等等，`source.ToList()` 也拷贝了？"）逻辑绕了个圈才说清，而且落点错了——重点不是"数组 vs List"。真正的不可变性是**三层**，缺一不可：
  1. `attributes?.ToArray()` 对**任意 `IEnumerable`** 物化出一份私有拷贝——传进来的如果是 LINQ 惰性序列，这一步顺便消除了"延迟求值 + 外部改动"的风险；
  2. 私有数组字段 `readonly DiagnosticAttribute[] items` **从不外泄**；
  3. 对外只暴露 `IReadOnlyList<DiagnosticAttribute>`，且 `DiagnosticAttribute` 是 `readonly struct`，所以索引器返回的是**值拷贝**，调用方拿到手也改不了集合里的那一份。

  只做第 1 层（改用 `List<T>` 存）也能挡住"外部改 source"，但挡不住"内部把 `List` 引用漏出去"。✅ 已重写。

  📝 顺带一个笔记没提的性能观察：`GetEnumerator()` 写的是 `((IEnumerable<DiagnosticAttribute>)items).GetEnumerator()`，这会**装箱**数组的枚举器并产生堆分配。`UnityConsoleDiagnosticSink.Format` 里的 `foreach (var attribute in diagnosticEvent.Attributes)` 每发一条带属性的诊断就分配一次。对一个 Unity 框架来说这是真实的 GC 压力点，修起来也很便宜。已列入 `09` 的改进清单。

### 3.7 `02:89` — "总长 ≤ 128（隐式）"

不是隐式，是显式写在第一行的：

```csharp
// NamespacedIdentifiers.cs:87
if (string.IsNullOrEmpty(value) || value.Length > 128 || value.IndexOf('.') < 0)
    return false;
```

同一行还有另外两个被笔记表格漏掉的**前置门**：`IsNullOrEmpty` 和 `IndexOf('.') < 0`（必须含点）。这三个条件放在循环之前，是刻意的快速失败排序。✅ 已修。

---

## 4. D 类：spec 引用错位

笔记里大量使用"spec 第 X.Y 节"的引用，抽查后发现几处错位。**spec §6「Architectural Principles」是一个 13 条的扁平编号列表，没有 6.1 / 6.3 / 6.5 这样的子小节。**

| # | 位置 | 笔记写 | 应为 | 处置 |
|---|---|---|---|---|
| D-1 | `03:1209` | spec 6.3 Provider-before-consumer | spec §6 **原则 6** | ✅ |
| D-2 | `03:1210` | spec 6.5 Logical unload | spec §6 **原则 7** | ✅ |
| D-3 | `04:23` | spec 6.1 "Public contracts, replaceable implementations" | spec §6 **原则 1**，原文是 "**Stable** contracts, replaceable implementations" | ✅ |
| D-4 | `01:31` | "13 个 AOT 程序集的依赖图（spec 第 8 节）" | 依赖方向在 §8.2，程序集表在 §8.3，且只有 **10 个** | ✅ |
| D-5 | `01` §3 标题 | "关键设计原则（spec 第 6 节）"，但其下 §3.6 讲 client-host authority | §3.6 的内容出自 spec **§5.1「Confirmed Initial Model」**，不在 §6 | ✅ |

`01` §3.1–§3.5 的映射本身是对的：3.1→原则 1，3.2→原则 2，3.3→原则 3，3.4→原则 6，3.5→原则 7。

---

## 5. E 类：依赖图画错

### 5.1 `01-Index.md:31-45` 的 ASCII 图

笔记画的：

```
Game.ModApi
        ↓
   ┌────┴────┬─────────┬───────────┬────────────┐
Context    Rules    Networking  Persistence  HotUpdate       Diagnostics
```

把 `Diagnostics` 画在了 `ModApi` 下游。**`Game.Core.Diagnostics` 不引用 `Game.ModApi`**（见 §1.3）。而且 Rules / Networking / Persistence / HotUpdate 也不是 `ModApi` 的直接下游同级——它们**还依赖 `Context`**。真实的四层（逐字取自 15 个 asmdef 的 `references`）：

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
                    Game.Bootstrap
        [上面 8 个 + VContainer]   autoReferenced: false
```

✅ 已替换 `01` §2 的图。

### 5.2 `04-ModApi-Contract-Surface.md:18` 的注解方向反了

```
Game.ModApi             (公共契约 — 只依赖 Primitives)
        ↓
[Context / Rules / Networking / Persistence / HotUpdate]    (不依赖 ModApi)   ← ❌
```

箭头方向是对的，注解是反的。`Game.Core.Context.asmdef` 的 `references` 明确含 `"Game.ModApi"`；spec §8.3 的表里 Context 的 "Permitted dependencies" 也写的是 "ModApi, Primitives"。

正确表述是**单向**的那一半：**`Game.ModApi` 不依赖 `Game.Core.Context`**（这才是"公共契约不泄漏内部实现"的那条不变量）；反过来 Context 必须依赖 ModApi，否则它没法实现 `IModule` 的加载与激活。✅ 已修。

---

## 6. F 类：外部事实（SMAPI / Bevy）

这两篇是对比分析，对 harness 本身的描述没问题，但对**外部项目**的描述有若干不准。这类错误的危害在于：拿一个不存在的 SMAPI 特性去论证"我们比它强"，论证就是空的。

### 6.1 `07-Comparison-with-SMAPI.md`

| # | 笔记 | 实际 | 处置 |
|---|---|---|---|
| F-1 | "Mod 加载方式：MonoMod runtime IL patch" | SMAPI 加载 mod 的机制是 **Mono.Cecil 重写程序集 + `Assembly.Load`**。它在加载前用 Cecil 改写 IL 来抹平跨平台 / 跨游戏版本的差异（这就是 SMAPI 有名的 "rewriter"）。Harmony 的运行时 patch 是**各个 mod 自己按需用的**，不是 SMAPI 的加载机制。 | ✅ |
| F-2 | 组件表把 "MonoMod（类似 Harmony，更老）" 列为 SMAPI 核心组件 | MonoMod 不是 SMAPI 直接依赖的独立组件。Harmony 2.x 自己内部构建在 MonoMod.Core 之上，但那是 Harmony 的实现细节。SMAPI 自己的重写层用的是 Mono.Cecil。 | ✅ |
| F-3 | "Mod API 稳定性：反编译推出来的（不官方）" | 混淆了两层。SMAPI **自己的** API（`IMod` / `IModHelper` / 事件体系）是有版本、有文档、有弃用周期的正式 API。不官方的是**星露谷本体的内部实现**——那才是 mod 靠反编译摸索、靠 Harmony patch 去改的部分。 | ✅ |
| F-4 | manifest 示例里的 `"Compatibility": { "GameVersion": "1.5.4" }` | **SMAPI 的 `manifest.json` 没有这个字段。** 真实字段是 `Name` / `Author` / `Version` / `Description` / `UniqueID` / `EntryDll` / `MinimumApiVersion` / `Dependencies` / `ContentPackFor` / `UpdateKeys`。游戏版本兼容性由 SMAPI 中心化的 **mod 兼容性数据库**维护，不写在 mod 自己的 manifest 里。示例还漏了必填的 `EntryDll`。 | ✅ |
| F-5 | "Content Patcher：编辑游戏数据（XNB 文件）" | Content Patcher 是 Pathoschild 写的**第三方 mod**，不是 SMAPI 核心组件；而且它工作在 SMAPI 的 content API 之上，操作的是加载后的资产对象。"编辑 XNB" 是更早期 XNB-hack 时代的做法，正是 Content Patcher 用来取代的东西。 | ✅ |

**F-4 修正后反而强化了笔记的原论点**：SMAPI 把"游戏版本兼容性"放在**中心化数据库**里，本质上是因为它是外挂框架、没法要求 mod 作者在 manifest 里声明一个它自己都不拥有的版本轴；而 harness 因为框架就是游戏本体，可以把 `FrameworkCompatibility` 的四个维度**做成 manifest 的必填字段**。这是"第三方注入 vs 一等公民"这个根本差异的一个具体后果——比原文含糊的"SMAPI 是半自由文本"有力得多。已改写。

### 6.2 `08-Comparison-with-Bevy-ECS.md`

| # | 笔记 | 实际 | 处置 |
|---|---|---|---|
| F-6 | 头部写 "5.x 版本"，且全篇未声明代码所依据的版本 | **Bevy 不存在 5.x**——它至今仍在 **0.x** 阶段。而且 0.x 每个 minor 都可能 breaking：文中 `events.send(...)` 是 **0.15 及以前**的写法，0.16 起 `EventWriter::send` 改名为 `write`。 | ✅ 已改为"以 Bevy 0.15 为准"并给出 0.16 的改名说明 |
| F-6b | 头部 "80k+ GitHub stars" | 这个数字与 Bevy 实际的 star 量级不符，且随时间变化、无法从仓库核实。已改成不含具体数字的定性描述（"Rust 游戏开发生态里最活跃、社区规模最大的引擎"）——**对比笔记里不应该出现无法核实又不影响论点的精确数字**。 | ✅ |
| F-11 | `Plugin::build → Plugin::ready → ...` | 补全为 `build` → `ready` → `finish` → `cleanup` 四个钩子。 | ✅ |
| F-7 | 对照表 "服务定位：`Query<T>`" | `Query<T>` 是**按组件筛选实体**的接口，不是服务定位。Bevy 里对应"取一个全局服务"的是 **`Res<T>` / `ResMut<T>`**，对应"无约束地拿任何东西"的是 **`&mut World`**。 | ✅ |
| F-8 | 对照表 "多实例：多个 World ↔ 多个 Session" | Bevy 可以同时持有多个 `World`；harness 的 `SessionFactory` **强制同一时刻至多一个** active Session（`CreateSession` 里 `if (activeSession != null) throw`）。类比应写成"多个 World ↔ **顺序复用**的 Session"。 | ✅ |
| F-9 | `ctx.GetCapability<T>(key)` | 同 §2.5。 | ✅ |
| F-10 | `fn move_player(query: Query<&mut Transform, With<Player>>)` | 要写 `mut query`，否则不能可变借出。 | ✅ |

---

## 7. 笔记漏掉的关键实现思路

以下都是**读源码能读出来、但 8 篇笔记里一句没提**的设计要点。它们不是"错误"，而是"这批笔记离吃透这份代码还差的那部分"。已单独展开成 [`09-Implementation-Deep-Dives.md`](./09-Implementation-Deep-Dives.md)。

| # | 主题 | 为什么重要 |
|---|---|---|
| 1 | **`readonly bool initialized` 字段**为什么必须存在 | `SemanticVersion` 和 `ModuleOperationError` 都有这个字段。原因是 `new SemanticVersion(0,0,0)` 是**合法版本 0.0.0**，光看 `Major/Minor/Patch` 无法区分它和 `default`。`ModuleId` 那种靠 `value == null` 的做法在纯数值 struct 上不适用。 |
| 2 | **比较语义矩阵**与 `<` / `>` 的陷阱 | `SemanticVersion` 的 `<` / `>` 走 `CompareTo`（总序，build metadata 参与），不走 `ComparePrecedenceTo`。所以 `v("1.0.0+a") < v("1.0.0+b")` 返回 **true**——这不是 SemVer 语义。而且 `<=` / `>=` 根本没实现。 |
| 3 | **`ComparePrecedenceTo` 会抛异常** | 它对 invalid 值抛 `InvalidOperationException`，而 `PrecedenceComparer` 直接转调它。于是一个 `default(SemanticVersion)` 混进待排序集合 → `List.Sort` 抛 `InvalidOperationException`。 |
| 4 | **`Game.Core.Primitives` 的 `noEngineReferences: false`** | 笔记 `02` §8 说"不依赖任何 `UnityEngine.*`"——源码层面对，但 asmdef 层面**没有强制**。`using UnityEngine;` 现在能编译通过。改成 `true` 才能把这条从注释升级成编译期约束。 |
| 5 | **`autoReferenced: false`** 全线开启 | 意味着 `Assembly-CSharp`（默认脚本程序集）**看不见**任何框架程序集。任何使用方必须显式建 asmdef 并声明引用——一道结构性防线。 |
| 6 | **`AsSelf()` 为什么只出现在 `SessionFactory` 上** | `.AsSelf().As<ISessionFactory>()` 里的 `AsSelf()` 不是随手加的：`ApplicationLifecycleCoordinator` 收的是**具体类型**，因为它要调 `internal void PreventNewSessions()`——这个方法**不在** `ISessionFactory` 上。 |
| 7 | **`IStartable.Start()` 的真实执行时机** | 不在 `Configure` 里，也不在容器建成那一刻。`EntryPointDispatcher.Dispatch()` 把 startables 交给 `PlayerLoopHelper.Dispatch(PlayerLoopTiming.Startup, ...)`——跑在 **Unity PlayerLoop 的 Startup 阶段**。 |
| 8 | **三种拒绝姿势**及各自的适用面 | `ThrowIfNotMainThread`（同步抛）/ `Task.FromException`（faulted Task）/ `new ValueTask(Task.FromException(...))`。三者的分布取决于方法签名与调用方最可能的消费方式。 |
| 9 | **Primary / cleanup failure 账本模式** vs `AggregateException` | 项目选了"主异常原样传播、清理异常拼进 message"，而不是 `AggregateException`。这个取舍有明确理由，值得展开。 |
| 10 | **诊断管线的线程契约** | 见 §3.4。`CompleteShutdown` 可能在线程池上跑 → 所有 `IDiagnosticSink` 必须线程安全。这条约束目前只存在于代码注释里，**没有测试守**。 |
| 11 | **`ModuleId` / `CapabilityKey` 没有实现 `IComparable`** | 项目对"确定性"要求很高（lockfile、网络握手），但这两个核心 ID 没有全序。将来遍历注册表时若依赖 `Dictionary` 的枚举顺序，就会引入不确定性。 |
| 12 | **`NamespacedIdentifier` / `StableStringHash` 是 `internal`** | Mod 作者拿不到它们，想预校验字符串只能靠 `TryParse`——这是刻意的（校验规则的**唯一权威**留在框架里），但值得写明。 |
| 13 | **`DiagnosticEvent` 不校验时区** | 只校验 `timestamp != default`。工厂默认注入 `DateTimeOffset.UtcNow`，但构造函数允许任何 offset 传进来。 |
| 14 | **Session 子 scope 目前没有 entry point** | child builder 只注册了 `SessionId` 和 `ISessionLifetime`。一旦将来加了 `RegisterEntryPoint`，`EnsureDispatcherRegistered` 会在**子容器**里注册一个 `Lifetime.Scoped` 的 dispatcher 和它自己的默认异常 handler——需要提前知道的坑。 |

---

## 8. 修订记录

本次对原笔记做的就地修改：

| 文件 | 修改 |
|---|---|
| `01-Index.md` | 重写 §2 的统计表与依赖图（A-1~A-6、E-1）；修正 §3 的 spec 引用（D-4、D-5）；更新阅读路线图，加入 `00` 与 `09` |
| `02-Primitives-Deep-Dive.md` | 修正头部统计（A-7）；§1.2 的 128 长度限制（3.7）；重写 §1.4 的哈希论证并补 UTF-16 细节（3.1）；修正 §4.2 的 Guid 示例（3.5）；修正 §5.1 字段数（3.6）；重写 §5.2/§5.3 的不可变性论证（3.6） |
| `03-Bootstrap-Architecture.md` | 修正头部与 §1.1/§1.2 统计（A-8~A-10）；重写 §2.3（3.2）；重写 §4.7（3.3）；重写 §8.3 的 scheduler 论证（3.4）；**整节重写 §10、§11**（2.1、2.2）；补全 §12.1（2.3）；修正 §15 的 spec 引用（D-1、D-2）；新增 §9.1「诊断管线的线程契约」 |
| `04-ModApi-Contract-Surface.md` | 修正 §0 的依赖图注解（E-2）与 spec 引用（D-3） |
| `05-Architecture-Enforcement.md` | 修正 §1 标题维度数（A-11）；修正 §5 关于 HybridCLR "当前没引用" 的说法——它在 `manifest.json` 里是 git URL 依赖，只是**因为 git 依赖没有可断言的版本号**才不在版本锁测试里；同理 UniTask 也已安装，这恰恰是那些"禁止引用 UniTask"的测试有意义的前提 |
| `06-Mod-Distribution.md` | 重写 §1.4 的示例代码（2.4） |
| `07-Comparison-with-SMAPI.md` | 修正 §1.1/§1.2/§3.4 的 SMAPI 事实（F-1~F-5） |
| `08-Comparison-with-Bevy-ECS.md` | 修正版本描述（"5.x" → 0.x，标注以 0.15 为准）与 star 数；拆开 §2 对照表里被混为一谈的"服务定位"一行、修正"多实例"一行；补 §1.1 的 `mut query`、补 `Plugin` 四个钩子；新增「全篇代码约定」说明 `ctx.GetCapability<T>` 的正确非泛型形态（F-6~F-11） |
| `06-Mod-Distribution.md`（补充） | 除 §1.4 重写外，新增 §1.5「两个必须澄清的 API 误区」与篇末「本篇的定位与真实实现进度」对照表 |
| 各篇篇末 | 统一新增「附：本篇的勘误与延伸」小节，回指本报告与 `09`，使勘误可追溯 |
| **新增** `00-Review-Report.md` | 本文件 |
| **新增** `09-Implementation-Deep-Dives.md` | §7 列出的 14 个主题的展开 |

---

## 9. 给后续笔记的三条建议

1. **凡是引用测试名、API 名、字段名，先 grep 一次。** 本次 B 类错误全部集中在"我记得测试大概是这么写的"这种地方。写成 `` `Xxx_yyy_zzz`（`path/File.cs:123`）`` 这种带行号的引用，既是给读者的，也是给自己的一道校验。
2. **区分"代码写了什么" / "spec 写了什么" / "我推断的"。** `06` 做得最好（开头就声明"基于 spec 推断"），但推断段落里混进了不可编译的 C#，反而比纯散文更容易被当成事实。建议推断代码一律加 `// 推测形状，当前代码库中不存在` 的行内注释。
3. **统计数字用命令生成，不要手数。** 在笔记头部直接放上生成命令，下次更新时重跑一遍即可，也方便读者验证：
   ```bash
   find Assets/GameFramework/Bootstrap -name '*.cs' | wc -l
   find Assets/GameFramework/Bootstrap -name '*.cs' -exec cat {} + | wc -l
   ```
