# Magic Game Harness — Bootstrap 架构解读

> 源码位置：`Assets/GameFramework/Bootstrap/` + `Assets/GameFramework/Core/Diagnostics/`
> `Bootstrap/` **16 个 `.cs` / 1 183 行** ＋ `Core/Diagnostics/` **6 个 `.cs` / 201 行**（目录里还有 1 个 README）
> 相关测试 **13 个 `.cs` / 1 884 行**：`EditMode/Bootstrap/` 9 个（8 个 fixture + 共享夹具 `SessionTestSupport.cs`）、`PlayMode/Bootstrap/` 4 个
> 合计 **3 268 行**
> **这是当前框架里**已经完整实现**的部分**——可以看到 spec 第 9 节"Runtime Scopes and VContainer"是怎么落地的。

---

## 0. Bootstrap 在整个框架里的位置

按 spec 第 8.3 节的依赖图：

```
Game.Core.Primitives        ← 原子层
        ↓
Game.ModApi                 ← 公共契约
        ↓
Game.Core.Context/Rules/Networking/Persistence/HotUpdate/Diagnostics
        ↓
Game.Bootstrap              ← 组合根（这一篇）
```

**Bootstrap 是所有具体实现的"汇合点"**——它的 asmdef 里有 **9 条引用：8 个框架程序集 + VContainer**（spec 表 8.3 对它的 "Permitted dependencies" 写的是 "All required core assemblies"），反过来其它程序集**不**依赖它。`AssemblyDependencyTests.cs:37-38` 额外断言了这个反向约束：任何 `Game.Core.*` 都不得引用 `Game.Bootstrap`。

> ⚠️ 上面这张图沿用了 spec §8.2 的简化画法，它把 Diagnostics 和 Context 画在了同一层。**真实的 asmdef 依赖是四层**，而且 `Game.Core.Diagnostics` **不引用 `Game.ModApi`**——完整的图见 [`01-Index.md` §2](./01-Index.md)。这个差异不是细节：它决定了 `ModuleDiagnosticsAdapter` 只能住在 Bootstrap（见本篇 §9.1）。

**责任**：
1. **VContainer 装配**——把 Primitives/ModApi/Diagnostics 等等注册成可注入服务
2. **主线程守门**——任何触碰 Unity 对象的生命周期操作必须 Unity 主线程
3. **应用 + Session 双层生命周期**——一个 App 进程可运行多个 Session（虽然 spec 允许"一个 active session"）
4. **诊断路由**——把诊断事件分发给 sinks，且生命周期锁**永远不在** sink 回调里持有

---

## 1. 文件全景与依赖图

### 1.1 Bootstrap 目录 16 个 `.cs` 文件

```
Bootstrap/
├── ApplicationLifecycleCoordinator.cs   (247 行) ← App 级生命周期
├── AppLifetimeScope.cs                  (63 行)  ← VContainer 配置入口
├── AppLifetimeScope.prefab              (1 个 MonoBehaviour 挂载点)
├── AssemblyInfo.cs                      (4 行)  ← InternalsVisibleTo 测试程序集
├── EntryPointFailureReporter.cs         (31 行) ← VContainer entry-point 异常 → 诊断
├── FrameworkCompatibilityConfiguration.cs (19 行) ← ScriptableObject → FrameworkCompatibility
├── FrameworkIdentityProvider.cs         (10 行) ← 暴露兼容性信息
├── IFrameworkIdentityProvider.cs        (9 行)
├── ModuleDiagnosticsAdapter.cs          (59 行) ← IModuleDiagnostics 适配器
│
├── Session/
│   ├── ISession.cs                      (15 行) ← IAsyncDisposable + Start/Stop
│   ├── ISessionFactory.cs               (9 行)
│   ├── Session.cs                       (420 行) ← Session 实现（核心）
│   ├── SessionFactory.cs                (89 行) ← Session 工厂 + latch
│   ├── SessionLifetime.cs               (46 行) ← 不可变 Session 视图
│   ├── SessionState.cs                  (12 行) ← 状态枚举
│   └── VContainerSessionScopeFactory.cs (73 行) ← 实际 VContainer 集成
│
└── Threading/
    └── UnityMainThreadGuard.cs          (77 行) ← 主线程守门（核心）
```

### 1.2 相关依赖：Core/Diagnostics 6 个 `.cs`（201 行，完整可用）

```
Core/Diagnostics/
├── DiagnosticRouter.cs             ← 路由到多个 sink，捕获 sink 异常
├── DiagnosticEventFactory.cs       ← 把 10 个字段打包成 DiagnosticEvent
├── FrameworkDiagnosticEvents.cs    ← 10 个标准事件名常量
├── IDiagnosticSink.cs              ← sink 接口
├── InMemoryDiagnosticSink.cs       ← 测试用 sink
├── UnityConsoleDiagnosticSink.cs   ← 把事件写到 Unity 控制台
└── (1 个 README)
```

### 1.3 关键类型关系

```
AppLifetimeScope (Unity MonoBehaviour)
    │ VContainer Configure
    ↓
registers: IUnityMainThreadGuard, SessionFactory, DiagnosticRouter, ...
    │
    ↓
ApplicationLifecycleCoordinator (VContainer EntryPoint)
    │ owns
    ↓
SessionFactory
    │ creates
    ↓
Session
    │ owns
    ↓
VContainerSessionScope (child VContainer scope)
    │
    ↓
SessionLifetime (immutable view, exposed to services)
```

**3 个生命周期所有者**：`ApplicationLifecycleCoordinator` → `SessionFactory` → `Session`。**每一层都校验主线程、状态机、清理顺序**。

---

## 2. AppLifetimeScope — 装配入口

**文件**：`AppLifetimeScope.cs`（63 行）

### 2.1 配置时机

```csharp
public sealed class AppLifetimeScope : LifetimeScope
{
    [SerializeField] FrameworkCompatibilityConfiguration compatibilityConfiguration;

    protected override void Configure(IContainerBuilder builder)
    {
        var mainThreadGuard = UnityMainThreadGuard.CaptureCurrentThread();
        // ... 验证 compatibility、注册服务
    }
}
```

**`AppLifetimeScope` 是 `VContainer.Unity.LifetimeScope` 子类**——通过 Unity 的 prefab 机制（`AppLifetimeScope.prefab`）挂在 SampleScene 上。VContainer 触发 `Configure` 方法时**就在 Unity 主线程**——这正是为什么 **mainThreadGuard 的捕获点选在这里**：

```csharp
// 来自 UnityMainThreadGuard 的注释：
// "its identity is captured inside AppLifetimeScope.Configure,
//  which VContainer runs during composition on the Unity main thread;
//  it is never guessed from a static initializer, which would latch
//  whichever thread first touched the type"
```

**为什么不用静态初始化？**

```csharp
// ❌ 错误做法：static init 捕获
public static readonly UnityMainThreadGuard Instance =
    new UnityMainThreadGuard(Thread.CurrentThread.ManagedThreadId);
//    ↑ 第一次访问这个类型的线程就是"主线程"——但这是错的
//       如果 test runner 的某个 background task 先 touch，guard 就废了
```

**✅ 正确做法**：在已知的主线程（VContainer.Configure / Unity 主循环）显式 `CaptureCurrentThread()`，且**每个 App root 都拿到一个新实例**（避免 Domain Reload 禁用时的脏状态）。

### 2.2 注册的服务

```csharp
var consoleSink = new UnityConsoleDiagnosticSink();
var router = new DiagnosticRouter(new[] { consoleSink });
var eventFactory = new DiagnosticEventFactory();
compatibility = compatibilityConfiguration.ToRuntime();

var identity = new FrameworkIdentityProvider(compatibility);
var failureReporter = new EntryPointFailureReporter(router, eventFactory);

builder.RegisterInstance<IUnityMainThreadGuard>(mainThreadGuard);
builder.RegisterInstance(compatibility);
builder.RegisterInstance(router);
builder.RegisterInstance(eventFactory);
builder.RegisterInstance<IFrameworkIdentityProvider>(identity);
builder.Register<ModuleDiagnosticsAdapterFactory>(Lifetime.Singleton);
builder.Register<VContainerSessionScopeFactory>(Lifetime.Singleton).As<ISessionScopeFactory>();
builder.Register<SessionFactory>(Lifetime.Singleton).AsSelf().As<ISessionFactory>();
builder.RegisterInstance(failureReporter);
builder.RegisterEntryPointExceptionHandler(failureReporter.Report);
builder.RegisterEntryPoint<ApplicationLifecycleCoordinator>();
```

**9 个注册**，全部用 `Singleton` 生命周期：

| 注册 | 类型 | 用途 |
|---|---|---|
| `IUnityMainThreadGuard` | 单例 | 主线程守门 |
| `FrameworkCompatibility` | 实例 | 当前 build 兼容性元数据 |
| `DiagnosticRouter` | 实例 | 路由诊断事件 |
| `DiagnosticEventFactory` | 实例 | 构造诊断事件 |
| `IFrameworkIdentityProvider` | 单例 | 暴露兼容性 |
| `ModuleDiagnosticsAdapterFactory` | 单例 | Mod 诊断适配器工厂 |
| `ISessionScopeFactory` | 单例 | VContainer 子 scope 创建 |
| `SessionFactory` | 单例 | Session 工厂 |
| `EntryPointFailureReporter` | 实例 | VContainer entry-point 异常捕获 |

**关键设计**：所有服务都是 `Singleton`——App 进程范围内只有一个，**通过 child scope 隔离 Session 状态**。

### 2.3 注册顺序的隐性约束

```csharp
builder.RegisterEntryPointExceptionHandler(failureReporter.Report);
builder.RegisterEntryPoint<ApplicationLifecycleCoordinator>();
```

这两行的顺序**确实有意义**，但不是"不这么写就捕获不到异常"。查 VContainer 1.19.0 源码可知：

```csharp
// VContainer/Runtime/Unity/EntryPointDispatcher.cs
public void Dispatch()
{
    PlayerLoopHelper.EnsureInitialized();
    var exceptionHandler = container.ResolveOrDefault<EntryPointExceptionHandler>();  // ← 容器建好之后才解析
    ...
}
```

handler 是在 `Dispatch()` 时从**已建成的容器**里解析的，跟注册先后无关。而且 `Registry.AddToBuildBuffer` 里明写着 `// Overwritten by the later registration`——同类型多次注册，**后注册的赢**。所以就算顺序反过来，最终生效的仍然是框架自己的 `failureReporter.Report`。

**顺序真正影响的是另一件事**。`RegisterEntryPoint<T>()` 内部第一步是 `EntryPointsBuilder.EnsureDispatcherRegistered(builder)`：

```csharp
// VContainer/Runtime/Unity/ContainerBuilderUnityExtensions.cs:13-26
public static void EnsureDispatcherRegistered(IContainerBuilder containerBuilder)
{
    if (containerBuilder.Exists(typeof(EntryPointDispatcher), false)) return;
    containerBuilder.Register<EntryPointDispatcher>(Lifetime.Scoped);

    if (!containerBuilder.Exists(typeof(EntryPointExceptionHandler)))                          // ★
        containerBuilder.RegisterEntryPointExceptionHandler(UnityEngine.Debug.LogException);   // ★ 默认 handler

    containerBuilder.RegisterBuildCallback(container =>
        container.Resolve<EntryPointDispatcher>().Dispatch());
}
```

★ 处：**如果此刻还没有任何 handler，VContainer 会替你注册一个默认的 `Debug.LogException`。**

| 顺序 | 结果 |
|---|---|
| **现有代码**：先 handler，后 entry point | `Exists(...)` 为 true → 不注册默认 handler → 容器里**恰好一个** handler |
| 反过来：先 entry point，后 handler | 先塞进默认 `Debug.LogException`，再塞进框架的 → **两条注册**，VContainer 为该类型建出一个 `CollectionInstanceProvider`，`ResolveOrDefault` 拿到后注册的那个。行为仍正确，但多了一条冗余注册和一次集合构造 |

所以正确的说法是：**这个顺序不是"能不能捕获"的问题，而是"要不要让 VContainer 塞一个你不想要的默认 handler 进来"的问题。**

`AppLifetimeScope.Configure` 依然是一个顺序敏感的方法，但敏感点在别处——见下面 §2.4 和 §2.5。

### 2.4 兼容性验证

```csharp
FrameworkCompatibility compatibility;
try
{
    if (compatibilityConfiguration == null)
        throw new System.InvalidOperationException("AppLifetimeScope requires a compatibility configuration asset.");
    compatibility = compatibilityConfiguration.ToRuntime();
}
catch (System.Exception exception)
{
    router.Emit(eventFactory.Create(
        DiagnosticSeverity.Critical,
        FrameworkDiagnosticEvents.ApplicationStartFailed,
        CorrelationId.New(),
        lifecycleEpisodeId: LifecycleEpisodeId.New(),
        error: new DiagnosticError(
            "framework.configuration-invalid",
            ...)));
    throw;  // ← 关键：抛回去，让 VContainer 也报告失败
}
```

**两层失败处理**：
1. 自己的诊断（`Critical` + `ApplicationStartFailed`）
2. 重新抛出（让 VContainer 把整个装配标记为失败 → 启动 Unity 错误面板）

**`throw` 而非 swallow**：spec 第 1 节说 "build a stable, versioned platform"——配置错误必须让开发者**当时**看到，而不是 silent fallback 到"默认版本"。

### 2.5 `AsSelf()` 为什么只出现在 `SessionFactory` 上

对比这两行：

```csharp
builder.Register<VContainerSessionScopeFactory>(Lifetime.Singleton).As<ISessionScopeFactory>();   // 没有 AsSelf
builder.Register<SessionFactory>(Lifetime.Singleton).AsSelf().As<ISessionFactory>();              // 有 AsSelf
```

根源在 `ApplicationLifecycleCoordinator` 的构造函数签名：

```csharp
// ApplicationLifecycleCoordinator.cs:51-55
internal ApplicationLifecycleCoordinator(
    DiagnosticRouter router,
    DiagnosticEventFactory eventFactory,
    SessionFactory sessionFactory,          // ← 具体类型，不是 ISessionFactory
    IUnityMainThreadGuard mainThread)
```

**为什么必须是具体类型？** 因为 shutdown 序列要调 `factory.PreventNewSessions()`（`:172`），而这个方法是 `internal`，**不在 `ISessionFactory` 上**：

```csharp
public interface ISessionFactory
{
    bool HasActiveSession { get; }
    ISession ActiveSession { get; }
    ISession CreateSession();
    // 没有 PreventNewSessions
}
```

这是一次刻意的**能力分割**：

- `ISessionFactory`（public 接口）= 谁都能用的能力：查询、创建
- `SessionFactory.PreventNewSessions()`（internal 方法）= 只有组合根能用的能力：**永久关闭创建通道**

把"关闭工厂"这种不可逆、只应发生一次的操作放在 internal 具体类型上，等于**用可见性表达权限**。`AsSelf()` 就是为了让 DI 能把具体类型注进去。`PublicApiSurfaceTests.cs:247-250` 甚至把这条钉死了。

反过来，`VContainerSessionScopeFactory` 没有任何 internal 能力需要暴露，所以**不加 `AsSelf()`**——只暴露接口，实现类型对容器其余部分不可见。最小暴露原则在 DI 注册上的体现。

> 更完整的装配逐行解剖（含 `RegisterInstance` vs `Register(Singleton)` 的真实差别、struct 装箱、以及为什么 `router`/`eventFactory` 必须手动 `new`），见 [`09-Implementation-Deep-Dives.md` §4](./09-Implementation-Deep-Dives.md)。

### 2.6 `ApplicationLifecycleCoordinator.Start()` 到底什么时候跑

不是在 `Configure` 里，也不是容器建成的那一刻。精确链路：

```
LifetimeScope.Awake / Build
  → ContainerBuilder.Build()
      → RegisterBuildCallback 里的 container.Resolve<EntryPointDispatcher>().Dispatch()
          → PlayerLoopHelper.EnsureInitialized()
          → container.ResolveOrDefault<EntryPointExceptionHandler>()      ← handler 在这里才解析
          → PlayerLoopHelper.Dispatch(PlayerLoopTiming.Startup, startableLoopItem)
                    ↓
              【下一次 Unity PlayerLoop 的 Startup 阶段】
                    ↓
              ApplicationLifecycleCoordinator.Start()
```

三个推论：

1. **`Start()` 不在 `Configure()` 的调用栈里。** 所以 `Configure` 抛异常和 `Start` 抛异常走的是**完全不同的两条路**：前者直接冒泡到 Unity，后者被 `EntryPointExceptionHandler` 接住。这正好解释了 §2.4 里那段 catch 为什么要**手动**发一次诊断再 `throw`——那时候 `EntryPointFailureReporter` 还没被容器接线上，不手动发就什么日志都没有。同一个失败（配置无效）在两个阶段有两套报告路径，是有意为之。
2. **`Start()` 一定在 Unity 主线程**（PlayerLoop 就在主线程）。所以 `:90` 的 `mainThread.ThrowIfNotMainThread(...)` 在正常路径下**永远不会触发**——它守的是"被别人手动调用"的情形（测试，或未来某段持有 coordinator 引用的代码）。这是一个"防未来的自己"的检查。
3. `EntryPointDispatcher` 是 `Lifetime.Scoped`，即**每个 scope 一个**。当前 Session 子 scope 没注册任何 entry point，所以不会触发 `EnsureDispatcherRegistered`。一旦将来加了，子容器会拿到自己的 dispatcher **和自己的默认异常 handler**，绕过框架的诊断管线——这是个需要提前知道的坑。

---

## 3. UnityMainThreadGuard — 守门核心

**文件**：`UnityMainThreadGuard.cs`（77 行）

### 3.1 接口设计

```csharp
internal interface IUnityMainThreadGuard
{
    bool IsMainThread { get; }
    void ThrowIfNotMainThread(string operation);
    InvalidOperationException CreateViolation(string operation);  // 不抛，只构造
}
```

**两个不同的拒绝方式**：

| 方法 | 何时用 |
|---|---|
| `ThrowIfNotMainThread` | 同步方法（如 `SessionFactory.CreateSession`） |
| `CreateViolation` | `Task`-返回方法——构造异常返回 faulted Task，**而不是抛出同步异常** |

**为什么 `Task`-返回方法不直接抛？** 因为调用者往往 `await`，sync throw 在 `Task.FromException` 之前的栈上会让 awaiter 看到 **异常路径与 lifecycle 失败路径不同**。统一为 faulted Task 让 rejection 与 lifecycle 失败**走同一条诊断渠道**——"caller that only awaits" 也不会错过。

### 3.2 三个关键注释

```csharp
/// Internal to Game.Bootstrap. It is never exposed through Game.ModApi or the
/// distributed Mod SDK, and it deliberately does not live in Game.Core.Primitives:
/// it exists only because this assembly creates and disposes Unity and VContainer objects.
```

**为什么不在 Primitives 里？** 因为 Primitives 是**纯 C#**（不依赖 Unity）——Unity 线程模型是 Unity-specific 的。把它放进 Primitives 会让契约污染。

```csharp
/// The main thread identity is captured during App composition — AppLifetimeScope runs
/// Configure on the Unity main thread — and never guessed from a static initializer,
/// which could latch whichever thread happened to touch the type first.
```

**避免静态初始化"第一个 touch 决定"**——Unity test runner 可能让 background thread 先 touch type。

```csharp
/// Each App root receives a fresh instance, so the policy stays correct when Domain Reload
/// is disabled.
```

**Domain Reload 关闭时**——static 字段会跨测试/会话保持。**每次都 new 一个 guard** 强制重置。

### 3.3 拒绝消息的内容

```csharp
return new InvalidOperationException(
    $"{operation} must be initiated on the Unity main thread. Application and Session " +
    "lifecycle mutation creates and disposes Unity and VContainer objects, so it is " +
    "main-thread-only and is never dispatched through Task.Run or a thread-pool continuation.");
```

**消息含 3 部分**：
1. **哪个操作被拒绝**（如 `SessionFactory.CreateSession`）—— 让调用者知道"我做了哪个调用错了"
2. **为什么**（`creates and disposes Unity and VContainer objects`）
3. **不能用什么绕过**（`Task.Run or thread-pool continuation`）

这是教科书级别的错误消息——**包含 self-explaining context**，让你 grep 一行就找到规则来源。

---

## 4. Session — 状态机 + 锁 + 副作用归属

**文件**：`Session.cs`（420 行，最复杂的文件）

### 4.1 状态机

```csharp
public enum SessionState
{
    Created = 0,
    Starting = 1,
    Running = 2,
    Stopping = 3,
    Stopped = 4,
    Failed = 5,
}
```

```
                  StartAsync
        Created ──────────────→ Starting ────────→ Running
            │                   (建立 scope)        │
            │ StopAsync        │                  StopAsync
            ├─────────────────→ ┤ Stopping ←────── ┤
            │                  ↓                   │
            │                 [清理]               │
            ↓                  ↓                   ↓
          Failed (各种失败路径)               Stopped
```

**关键约束**：
- `Starting → Running` 之前必须建立 scope
- `Stopping` 之后 `state == Starting` 再次判定为 false（`adopted = state == SessionState.Starting`）
- `Stopped` / `Failed` 是终态，不可重启

### 4.2 锁持有时间

```csharp
public Task StopAsync(CancellationToken cancellationToken)
{
    if (!mainThread.IsMainThread)                              // ← 不在锁里
        return Task.FromException(...);

    TaskCompletionSource<bool> completion;
    lock (sync)                                                // ← 锁内只做状态变更 + memoization
    {
        if (stopTask != null) return stopTask;
        if (state == SessionState.Failed || state == SessionState.Stopped)
        {
            isDisposed = true;
            return stopTask = Task.CompletedTask;
        }
        state = SessionState.Stopping;
        completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        stopTask = completion.Task;
    }

    RunStop(completion);                                       // ← 锁外做 cancel + dispose + release
    return stopTask;
}
```

**锁内**做 3 件事：
1. 判 idempotency（返回 memoized stopTask）
2. 检查终态
3. 设置 Stopping + memoize TaskCompletionSource

**锁外**做 4 件事（`RunStop`）：
1. `lifetimeCancellation.Cancel()` — 通知 owned work
2. `scope.Dispose()` — 销毁 VContainer child scope
3. `release(this)` — SessionFactory 释放引用
4. 发诊断

**为什么这样分？** 因为 `scope.Dispose()` 会销毁 Unity 对象，**可能执行 Unity 回调**，如果回调 reentrant 调用 Session API，**不能**死锁。

### 4.3 重复 stop 的幂等性

```csharp
const int callers = 16;
var results = new Task[callers];
for (var index = 0; index < callers; index++)
    results[index] = session.StopAsync(CancellationToken.None);
await Task.WhenAll(results);

Assert.That(results.Distinct().Count(), Is.EqualTo(1), "Every caller must observe the same operation.");
```

**16 个 StopAsync 调用共享同一个 Task 对象**。这是经典的 **memoization 模式**：

```csharp
lock (sync)
{
    if (stopTask != null) return stopTask;  // ← 第二个 caller 拿到第一个的 Task
    // ...
    stopTask = completion.Task;             // ← 第一个 caller memoize
}
```

**为什么这样？** 16 个 caller 等同一个 Task，**scope 只 dispose 一次**（测试断言 `DisposeCount == 1`），**诊断事件只发一次**。

### 4.4 StartAsync 的 "superseded start" 处理

```csharp
public Task StartAsync(CancellationToken cancellationToken)
{
    // ...
    lock (sync)
    {
        if (isDisposed) return Task.FromException(new ObjectDisposedException(nameof(Session)));
        if (state != SessionState.Created)
            return Task.FromException(new InvalidOperationException(...));
        state = SessionState.Starting;
    }

    Emit(SessionStarting);
    try
    {
        cancellationToken.ThrowIfCancellationRequested();
        var created = scopeFactory.Create(lifetime);

        // ★ 关键：scope 已建好，但还需要 re-check state
        bool adopted;
        lock (sync)
        {
            adopted = state == SessionState.Starting;
            if (adopted) scope = created;
        }

        if (!adopted)
        {
            DisposeSupersededScope(created);        // ← 有人在我们建 scope 时 stop 了
            return Task.FromCanceled(new CancellationToken(true));
        }
        // ...
    }
}
```

**为什么要在 `scopeFactory.Create` 之后再 re-check state？**

考虑竞态：
1. 主线程 A 调用 `StartAsync()` → 进入 `state = Starting`
2. scopeFactory.OnCreating 回调里（A 线程内 reentrant）调用 `StopAsync()` → `state = Stopping`，memoize stopTask
3. A 继续：scopeFactory.Create 返回了 scope
4. **如果直接 `scope = created`**，会持有 scope 不放；但 `Stopping` 已经发生 → 资源泄漏
5. **re-check `state == Starting`**，发现已经是 Stopping → dispose 这个 orphan scope

**测试 `Stop_requested_while_starting_reaches_one_terminal_state_without_leaking_a_scope`** 断言了这一点。

### 4.5 FailStart — "原失败 + 清理失败" 双错误模型

```csharp
void FailStart(Exception primary)
{
    Exception cleanupFailure = null;
    try
    {
        try { lifetimeCancellation.Cancel(); }
        catch (Exception exception) { cleanupFailure = exception; }

        ISessionScope ownedScope;
        lock (sync)
        {
            ownedScope = scope;
            scope = null;
        }

        try { ownedScope?.Dispose(); }
        catch (Exception exception) { cleanupFailure = cleanupFailure ?? exception; }

        try { release(this); }
        catch (Exception exception) { cleanupFailure = cleanupFailure ?? exception; }
    }
    finally
    {
        lock (sync)
        {
            state = SessionState.Failed;
            isDisposed = true;
            if (stopTask == null) stopTask = Task.CompletedTask;
        }
        DisposeCancellationOnce();
    }

    Emit(Severity.Error, SessionFailed, BuildError("framework.session-start-failed", primary, cleanupFailure));
}
```

**两个原则**：

#### (a) cleanup 失败**永远不能替换原失败**

```csharp
catch (Exception exception)
{
    cleanupFailure = cleanupFailure ?? exception;  // ← 用 ?? 而不是 =
}
```

如果 `lifetimeCancellation.Cancel()` 已经失败了（`cleanupFailure != null`），后续的 cleanup exception **不覆盖**——只追加。

#### (b) finally 保证状态变更

```csharp
finally
{
    lock (sync)
    {
        state = SessionState.Failed;        // ← 无论 throw 没 throw 都跑
        isDisposed = true;
        if (stopTask == null) stopTask = Task.CompletedTask;
    }
    DisposeCancellationOnce();
}
```

**即使 cleanup 全炸了**，Session 状态仍然 `Failed`，`stopTask` 仍然 memoized——调用者 `await session.StartAsync(...)` 不会卡住。

### 4.6 BuildError 的智能消息

```csharp
static DiagnosticError BuildError(string code, Exception primary, Exception cleanupFailure)
{
    var message = Describe(primary);
    if (cleanupFailure != null)
        message = $"{message} (cleanup also failed: {cleanupFailure.GetType().FullName}: {Describe(cleanupFailure)})";
    return new DiagnosticError(code, message, primary.GetType().FullName);
}

static string Describe(Exception exception) =>
    string.IsNullOrWhiteSpace(exception.Message) ? exception.GetType().Name : exception.Message;
```

**消息示例**：
- 单失败：`"Module 'auth.mod-x' failed to load: file not found"`
- 双失败：`"Module 'auth.mod-x' failed to load: file not found (cleanup also failed: System.ObjectDisposedException: Cannot access a disposed object. Object name: 'XContainer'.")`

**为什么 `Describe` 用 fallback？** 因为有些异常（如某些 NRE）的 `Message` 是空串，直接打印会显示"原始类型名 + 冒号 + 空串"很难看。

### 4.7 DisposeCancellationOnce

```csharp
void DisposeCancellationOnce()
{
    lock (sync)
    {
        if (cancellationDisposed) return;
        cancellationDisposed = true;
    }
    lifetimeCancellation.Dispose();
}
```

**为什么"once"？** 先排除一个常见的误解：**重复 `Dispose()` 一个 `CancellationTokenSource` 不会抛异常。** 它遵守 `IDisposable` 的标准契约，内部有 `_disposed` 检查，第二次调用是 no-op。

latch 的真实价值是三条：

1. **表达单一所有权**——这个 CTS 只有 `Session` 一个 owner，且只被释放一次。这跟 `scope = null; owned?.Dispose();` 的"先清引用再释放"是同一个套路：把设计意图写成代码，而不是写成注释。
2. **让重复调用的开销恒定**——不进 BCL 的 dispose 路径，只做一次 `bool` 判断。`FailStart` 和 `RunStop` 的 `finally` 都会调它。
3. **为将来换成非幂等的资源留位置**——如果哪天 `lifetimeCancellation` 换成一个自定义的、Dispose 非幂等的对象，这里不用改。

**真正必须小心的是另一件事**，而项目已经处理了：`CancellationTokenSource` 被 Dispose 之后，**再访问它的 `.Token` 属性会抛 `ObjectDisposedException`**。所以 `SessionLifetime` 在构造时就把 token 拷了一份：

```csharp
// Session.cs:86
lifetime = new SessionLifetime(id, lifetimeCancellation.Token);   // ← 构造时抓一次，之后再不碰 source
```

`CancellationToken` 是 struct，持有对内部状态的引用；source 释放后，**已经拿到手的 token 依然可以安全读 `IsCancellationRequested`**。`SessionLifetime` 的 doc comment 把这条写死了：

> The token is captured once at Session construction and stays stable for the whole Session lifetime, so observing it remains valid after the source has been disposed.

这也正是测试夹具 `RecordingScope.Dispose` 里那行能安全执行的原因：

```csharp
// SessionTestSupport.cs:67
TokenCancelledAtDispose = Lifetime != null && Lifetime.Token.IsCancellationRequested;
```

它在 scope 被销毁时读 token——而此时 `RunStop` 的 `finally` 可能已经把 source dispose 掉了。如果 `SessionLifetime` 存的是 source 而不是 token，这个断言会变成一个随机崩溃的测试。

---

## 5. SessionFactory — 单 Session + 主线程守门

**文件**：`SessionFactory.cs`（89 行）

### 5.1 "exactly one active session" 模型

```csharp
public ISession CreateSession()
{
    mainThread.ThrowIfNotMainThread(...);
    lock (sync)
    {
        if (creationPrevented)
            throw new InvalidOperationException("The application is shutting down; no new Session may be created.");
        if (activeSession != null)
            throw new InvalidOperationException("Only one Session may be active at a time.");
        activeSession = new Session(...);
        return activeSession;
    }
}
```

**两个 latch**：
1. `creationPrevented` — App 关闭后不能再 create
2. `activeSession != null` — 一次只有一个 active

**为什么不允许多个并发 Session？** spec 没明确禁止，但 Bootstrap README 写的是 "permits one active Session"——简化清理语义：**一个 App root 一条清理链**。

### 5.2 Latch 的不可逆

```csharp
internal void PreventNewSessions()
{
    mainThread.ThrowIfNotMainThread(...);
    lock (sync) creationPrevented = true;
}
```

**没有 un-latch**——`creationPrevented` 一旦置 true 就永远是 true。这是**单稳态触发器**模式：永远向前。

**为什么这样设计？** App 关闭时调用 `PreventNewSessions()` → 等现有 Session 清理完 → 进程退出。**绝不会"再打开 create 通道"**——避免 race。

### 5.3 Release 回调

```csharp
public ISession CreateSession()
{
    // ...
    activeSession = new Session(..., Release);
    // ...
}

void Release(Session session)
{
    lock (sync)
    {
        if (ReferenceEquals(activeSession, session)) activeSession = null;
    }
}
```

**Release 是 Session.Stop 时调用的回调**——让 factory 清空引用。

**`ReferenceEquals(activeSession, session)`** 而不是 `==`——避免 `==` 操作符被重载带来的奇怪行为（struct/class 区分），且**确保是同一个引用**而不是重载的相等。

---

## 6. SessionLifetime — 不可变视图

**文件**：`SessionLifetime.cs`（46 行）

### 6.1 "不是 service locator"

```csharp
internal interface ISessionLifetime
{
    SessionId SessionId { get; }
    CancellationToken Token { get; }
}

sealed class SessionLifetime : ISessionLifetime
{
    internal SessionLifetime(SessionId sessionId, CancellationToken token)
    {
        if (!sessionId.IsValid) throw new ArgumentException(...);
        SessionId = sessionId;
        Token = token;
    }

    public SessionId SessionId { get; }
    public CancellationToken Token { get; }
}
```

**只有 2 个属性**——`SessionId` 和 `Token`。

**故意没暴露**：
- ❌ Session 实例本身（会导致循环引用 + service locator 反模式）
- ❌ DiagnosticRouter（跨层耦合）
- ❌ SessionFactory（不安全）

### 6.2 Token 是一次性 snapshot

```csharp
internal SessionLifetime(SessionId sessionId, CancellationToken token)
{
    // ...
    Token = token;
}
```

**`CancellationToken` 是 struct，capture by value**——`Token` 持有的是 source 的引用。`source.Cancel()` 之后，`Token.IsCancellationRequested` 立即返回 true（即使 source 已被 dispose）。

**为什么 capture 一次？** 因为 source 会被 dispose（`DisposeCancellationOnce`），但 token 仍要可观察——所以"在 source 还活着时"capture token，之后即使 source dispose，token 仍可读。

### 6.3 注册到 child scope

```csharp
public ISessionScope Create(ISessionLifetime lifetime)
{
    // ...
    var child = appScope.CreateChild(
        builder =>
        {
            builder.RegisterInstance(sessionId);
            builder.RegisterInstance<ISessionLifetime>(lifetime);
        },
        $"Session {sessionId}");
    return new VContainerSessionScope(child, mainThread);
}
```

**`sessionId` 和 `lifetime` 都注册到 child scope**——所以 Session-owned services 可以：
```csharp
public class MyService
{
    public MyService(SessionId sessionId, ISessionLifetime lifetime)
    {
        _sessionId = sessionId;
        _token = lifetime.Token;  // 用来观察 Session 是否要停了
    }
}
```

---

## 7. VContainerSessionScopeFactory — 真正建 scope

**文件**：`VContainerSessionScopeFactory.cs`（73 行）

### 7.1 三层守门

```csharp
public ISessionScope Create(ISessionLifetime lifetime)
{
    mainThread.ThrowIfNotMainThread(nameof(VContainerSessionScopeFactory) + "." + nameof(Create));
    // ...
    var child = appScope.CreateChild(...);
    return new VContainerSessionScope(child, mainThread);
}

sealed class VContainerSessionScope : ISessionScope
{
    public void Dispose()
    {
        mainThread.ThrowIfNotMainThread("Session child scope disposal");
        // ...
    }
}
```

**为什么 factory 里也守门？** README 解释：

> Defense in depth: the Session already rejects off-main lifecycle calls, but this is the
> last point before real Unity and VContainer objects are touched, so it re-checks.

**纵深防御**——即使有人绕过 `Session` 直接调 `ISessionScopeFactory.Create`（不应该发生），仍然会被 guard 拒掉。

### 7.2 Scope 包装的额外价值

```csharp
sealed class VContainerSessionScope : ISessionScope
{
    public bool IsDisposed => scope == null;

    public void Dispose()
    {
        mainThread.ThrowIfNotMainThread("Session child scope disposal");
        var owned = scope;
        scope = null;
        owned?.Dispose();
    }
}
```

**额外提供的**：
- `IsDisposed` 属性（VContainer `LifetimeScope` 没有原生暴露）
- **idempotent dispose**（scope = null 之后再调 Dispose 是 no-op）
- **clear reference before disposing**——避免 disposed scope 的引用泄漏

**最后一点关键**：`scope = null; owned?.Dispose();` 是**两步走**——先把字段清掉，再 dispose owned 引用。这样如果 dispose 抛了异常重入 scope，**看到的是 null 而不是 disposed 对象**。

---

## 8. ApplicationLifecycleCoordinator — 应用级

**文件**：`ApplicationLifecycleCoordinator.cs`（247 行）

### 8.1 双重身份

```csharp
public sealed class ApplicationLifecycleCoordinator : IStartable, IDisposable
```

- `IStartable`（VContainer 接口）— VContainer 启动时调 `Start()`
- `IDisposable` — VContainer 关闭时调 `Dispose()`（如果 root 没显式 shutdown）

**注意**：`IStartable.Start()` 是同步方法——VContainer 期望它**立即完成**。所以 `ApplicationLifecycleCoordinator.Start()` 本身**不**做重活，只是发两个诊断事件 + 设 `started = true`。

### 8.2 ShutdownAsync 的"原子"行为

```csharp
public Task ShutdownAsync(CancellationToken cancellationToken)
{
    if (!mainThread.IsMainThread)
        return Task.FromException(...);

    TaskCompletionSource<bool> completion;
    lock (sync)
    {
        if (shutdownTask != null) return shutdownTask;        // ← 幂等
        completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        shutdownTask = completion.Task;
    }

    RunShutdown(completion);
    return shutdownTask;
}
```

**同 Session.StopAsync 一致的模式**：
- **idempotent**（多次调用返回同一个 Task）
- **`TaskCreationOptions.RunContinuationsAsynchronously`**——continuation 不会 inline 在 completion thread，避免 stack dive

### 8.3 Shutdown 序列

```csharp
void RunShutdown(TaskCompletionSource<bool> completion)
{
    Emit(ApplicationStopping);

    SessionFactory factory;
    lock (sync) factory = sessionFactory;       // ← 锁外 snapshot 引用

    ISession active = null;
    try
    {
        if (factory != null)
        {
            factory.PreventNewSessions();        // ① 锁新 Session
            active = factory.ActiveSession;      // ② 取现有 Session
        }
    }
    catch (Exception exception)
    {
        CompleteShutdown(completion, exception);
        return;
    }

    if (active == null)
    {
        CompleteShutdown(completion, null);
        return;
    }

    Task stop;
    try
    {
        stop = active.StopAsync(CancellationToken.None);   // ③ 停止 Session
    }
    catch (Exception exception)
    {
        CompleteShutdown(completion, exception);
        return;
    }

    if (stop.IsCompleted)                                       // ④ sync 完成
    {
        CompleteShutdown(completion, Failure(stop));
        return;
    }

    stop.ContinueWith(                                          // ⑤ async 完成
        completed => CompleteShutdown(completion, Failure(completed)),
        CancellationToken.None,
        TaskContinuationOptions.ExecuteSynchronously,
        TaskScheduler.Default);                                 // ← 显式线程池！
}
```

**5 个步骤 + 4 个错误路径**，每一步都有 try/catch + CompleteShutdown 兜底。

**最后的 `TaskScheduler.Default`** 是关键：

> A future Session with genuinely asynchronous cleanup: never block the caller, and never
> resume Unity or VContainer work off the main thread. The continuation only emits
> diagnostics and releases references.

**为什么显式 `TaskScheduler.Default`？** 这里有个非常经典、非常容易混淆的 .NET 机制差异——注意代码用的是 `ContinueWith`，**不是 `await`**：

| | 续体调度到哪 |
|---|---|
| **`await` 的续体** | 捕获 `SynchronizationContext`；没有 SC 时回落到 `TaskScheduler.Current` |
| **不带 scheduler 参数的 `ContinueWith`** | **完全不看 `SynchronizationContext`**，直接用 `TaskScheduler.Current` |

而 `TaskScheduler.Current` 是一个**环境值**——它等于"当前正在执行的 Task 所属的调度器"，只有在没有 Task 上下文时才是 `Default`。这意味着：如果 `ShutdownAsync` 恰好被某个跑在自定义调度器（`ConcurrentExclusiveSchedulerPair`、某些测试框架的调度器……）上的 Task 调用，续体就会被排到**那个**调度器上——一个**取决于调用栈的、非确定的**行为。这就是"永远显式传 `TaskScheduler` 给 `ContinueWith`"这条老规矩的由来。

再看 `TaskContinuationOptions.ExecuteSynchronously`：它的意思是"尽量在**完成 antecedent 的那个线程**上就地跑续体，省掉一次调度"。

两个参数合起来的语义是：

> **能就地跑就就地跑（省一次排队）；不能就地跑时，回落到线程池，而不是某个碰巧存在的环境调度器。**

**关键推论**（也正是代码注释在说的那件事）：**续体可能跑在任意线程上**。所以 `CompleteShutdown` 的函数体被严格限制成"只改内存状态 + 发诊断"，一行 Unity API 都不碰。

而这反过来给整条诊断管线加了一条硬约束——**所有 `IDiagnosticSink` 必须线程安全**。详见下面 §9.1。

### 8.4 Dispose() 的"不全阻塞"原则

```csharp
public void Dispose()
{
    mainThread.ThrowIfNotMainThread(...);

    Task pending;
    lock (sync) pending = shutdownTask;
    pending = pending ?? ShutdownAsync(CancellationToken.None);    // ← 触发 shutdown 如果还没

    if (pending.IsCompleted)
    {
        if (pending.IsFaulted) _ = pending.Exception;             // ← observe 故障
        return;
    }

    Emit(Warning, ApplicationStopped,
        new DiagnosticError("framework.application-shutdown-incomplete",
            "The application root was disposed before asynchronous Session shutdown completed; call ShutdownAsync and await it before disposing the root."));
}
```

**关键**：**绝不 `.Wait()` 或 `.Result`**！理由：

> VContainer disposal is synchronous and does not await arbitrary IAsyncDisposable, so this
> method never blocks on a task whose continuation would need the Unity PlayerLoop: it starts
> shutdown if it has not run, and if the operation has not already completed it records that
> fact as a Warning diagnostic and returns.

**为什么？** 因为：

1. VContainer `Dispose()` 是同步的——它要立刻清理容器
2. 但如果 Session 清理是 async 的（要等某个 await），等就意味着**阻塞主线程**
3. 阻塞主线程 = PlayerLoop 卡住 = 渲染/输入/物理全部冻结

**正确的失败模式**是发 Warning，**让开发者从日志发现问题**——而不是让程序"看起来工作"实际挂了。

### 8.5 Observe Fault 的细节

```csharp
if (pending.IsFaulted) _ = pending.Exception;
```

`_ = pending.Exception` —— **读取 Exception 属性会"observe"异常**，防止其变成"unobserved task exception"飘到进程层（Unity 会 LogError 污染日志，但更重要的是 TaskScheduler 可能 unobserved exception 触发 `TaskScheduler.UnobservedTaskException`）。

**这是 .NET Task 的一个隐藏陷阱**——faulted Task 不读取 `.Exception`，CLR 会在 finalize 时尝试触发 unobserved exception event。

---

## 9. 诊断路由 — sink 异常隔离

**文件**：`DiagnosticRouter.cs`（45 行）

```csharp
public void Emit(DiagnosticEvent diagnosticEvent)
{
    foreach (var sink in sinks)
    {
        try
        {
            sink.Write(diagnosticEvent);
        }
        catch (Exception exception)
        {
            try
            {
                sinkFailureHandler(exception);
            }
            catch (Exception handlerException)
            {
                UnityEngine.Debug.LogException(handlerException);
            }
        }
    }
}
```

**3 层 try/catch**：

1. **sink 抛异常** → 调 `sinkFailureHandler`（默认 `Debug.LogException`）
2. **handler 自己抛异常** → `Debug.LogException`（最坏兜底）
3. **永远不会让一个坏 sink 把整个 Emit 弄崩**

**为什么？** 诊断是"侧通道"——**绝不能因为 sink 坏了让应用代码走不下去**。

**`sinkFailureHandler` 默认值**：

```csharp
this.sinkFailureHandler = sinkFailureHandler ?? UnityEngine.Debug.LogException;
```

默认就是 Unity 的 LogException——简单但足够。

### 9.1 诊断管线的线程契约与所有权

由 §8.3 推出的那条约束值得单列，因为它是整个 Bootstrap 里**唯一一条没有被测试守住**的重要不变量。

#### 契约

> **`IDiagnosticSink.Write` 可能被任意线程调用。所有 sink 实现必须线程安全。**

当前三个 sink 的合规情况：

| Sink | 线程安全？ | 依据 |
|---|---|---|
| `InMemoryDiagnosticSink` | ✅ | `lock (sync)` 保护 `List.Add`，`Snapshot` 也在锁内 `ToArray()` |
| `UnityConsoleDiagnosticSink` | ✅ | 只调 `Debug.Log` / `LogWarning` / `LogError`——Unity 明确允许跨线程调用的少数 API 之一；`Format` 是静态纯函数，只用局部 `StringBuilder` |
| `DelegateDiagnosticSink`（测试用） | ⚠️ | 取决于每个测试传进去的委托 |

`InMemoryDiagnosticSink.Snapshot` 的写法值得看一眼：

```csharp
// Core/Diagnostics/InMemoryDiagnosticSink.cs:12-21
public IReadOnlyList<DiagnosticEvent> Snapshot
{
    get { lock (sync) { return events.ToArray(); } }
}
```

每次读都在锁内拷一份。这既挡住了"读的时候撞上并发 `Add`"（`List<T>` 扩容期间读会读到脏状态），也保证返回的快照**不随后续写入变化**——测试 `In_memory_sink_returns_stable_snapshots` 断言的正是后半条。

#### `DiagnosticRouter` 的两个无锁设计

**(a) `sinks` 在构造函数里 `ToArray()` 定型。**

```csharp
// DiagnosticRouter.cs:16-18
this.sinks = sinks.ToArray();
if (this.sinks.Any(sink => sink == null))
    throw new ArgumentException("Diagnostic sink collection cannot contain null entries.", nameof(sinks));
```

所以 `Emit` 的 `foreach` 不需要加锁——数组构造后不可变，多线程并发 `Emit` 各自遍历同一个不可变数组是安全的。**这是无锁并发读的标准做法：把可变性挪到构造期。**

注意 `ToArray()` 在 null 检查**之前**。顺序很重要：如果先对传进来的 `IEnumerable` 做检查再 `ToArray()`，一个惰性序列会被枚举两次，且第二次可能产出不同内容（TOCTOU）。

**(b) `Emit` 自己没有锁，这是刻意的。** 如果 `Emit` 加锁，那么 §4.2"锁持有时间最小化"就白做了——`Session` 费劲地在锁外调 `Emit`，结果 `Emit` 内部又串行化，一个重入的 sink 照样死锁。

#### 为什么 `ModuleDiagnosticsAdapter` 必须住在 Bootstrap

一个乍看多余、其实由依赖图强制的位置选择。看它的 `using`：

```csharp
// Bootstrap/ModuleDiagnosticsAdapter.cs:1-3
using Game.Core.Diagnostics;      // DiagnosticRouter、DiagnosticEventFactory（私有实现侧）
using Game.Core.Primitives;
using Game.ModApi.Diagnostics;    // IModuleDiagnostics、ModuleDiagnostic（公共契约侧）
```

它要同时看见两侧。而 **`Game.Core.Diagnostics` 的 asmdef 只引用 `Game.Core.Primitives`，不引用 `Game.ModApi`**——所以适配器放不进 `Game.Core.Diagnostics`；`Game.ModApi` 更不可能引用私有实现。整个依赖图里**只有 `Game.Bootstrap` 一个程序集同时引用了这两边**，适配器只能落在组合根。

这是"依赖方向决定了代码的物理位置"的一个干净例子：不是作者选了这里，是依赖图**只剩这一个合法位置**。

#### 缺口

这条"sink 必须线程安全"的约束目前**只存在于代码注释里**。想补测试也补不了：`SessionFactory` 只造真的 `Session`，而真 `Session.StopAsync` 总是同步完成（清理全是同步的），`stop.IsCompleted` 恒为 true，§8.3 里那条 `ContinueWith` 分支永远走不到。

等未来有了真正异步的 Session 清理（等 Addressables 释放句柄、等网络优雅断开），这个测试就必须补上——否则很容易有人往 sink 里塞一个非线程安全的实现（比如一个直接写 `List` 的文件缓冲 sink），而且**在同步清理的世界里它一直是对的**，直到某天清理变异步了才炸。

> 这类"约束现在恰好不会被违反，但没有任何东西守着"的地方，是技术债里最阴险的一种。参见 [`09-Implementation-Deep-Dives.md` §7.5](./09-Implementation-Deep-Dives.md)。

---

## 10. SessionStateMachineTests — 状态机约束

**文件**：`SessionStateMachineTests.cs`（239 行）

这个 fixture 有 **7 个测试**。注意它**没有**用 `SessionTestSupport.cs` 里的共享夹具，而是在文件末尾自带一套更轻的私有 `Harness` / `FakeScopeFactory` / `FakeScope` / `DelegateSink`（`:194-237`）——因为它只需要"能不能建出 scope"这一个注入点（`FakeScopeFactory.Failure`），不需要 `DisposeFailure` / `OnCreating` / `DisposeCount` 那些。同一个命名空间里并存两套夹具，是按"最小够用"切分的。

| 测试 | 覆盖的不变量 |
|---|---|
| `Session_factory_enforces_one_active_session_and_allows_recreation_after_stop` | 工厂单例约束 + 完整生命周期 + stop 幂等 + 停止后可重建 |
| `Stop_disposes_scope_and_clears_factory_before_final_event` | **清理顺序**：`SessionStopped` 事件发出时，factory 引用**已经**清空 |
| `Canceled_startup_fails_releases_factory_and_does_not_poison_next_session` | 取消 → `Failed` + 释放工厂 + 不污染下一个 Session |
| `Scope_creation_failure_is_normalized_and_releases_factory` | scope 建不出来 → `framework.session-start-failed` + 释放工厂 |
| `Use_after_dispose_is_explicit_and_repeated_dispose_is_safe` | 重复 `DisposeAsync` 安全；终态后 `StartAsync` → `ObjectDisposedException` |
| `Application_and_bound_module_diagnostics_are_attributed` | 注入时钟 + `ModuleDiagnosticsAdapter` 的 module/session 归属 |
| `Entry_point_failure_is_routed_as_normalized_application_diagnostic` | VContainer entry-point 异常 → `framework.entry-point-failed` |

### 10.1 最值得看的一个：事件顺序即所有权顺序

```csharp
// SessionStateMachineTests.cs:53-74
var activeAtStoppedEvent = true;
SessionFactory factory = null;
var observer = new DelegateSink(value =>
{
    if (value.Name == FrameworkDiagnosticEvents.SessionStopped)
        activeAtStoppedEvent = factory.HasActiveSession;      // ← 在事件回调里回头看工厂
});
...
await session.StopAsync(CancellationToken.None);

Assert.That(scopeFactory.Created.Single().IsDisposed, Is.True);
Assert.That(activeAtStoppedEvent, Is.False);                  // ★ 关键断言
Assert.That(memory.Snapshot.Select(value => value.Name), Is.EqualTo(new[]
{
    FrameworkDiagnosticEvents.SessionStarting,
    FrameworkDiagnosticEvents.SessionStarted,
    FrameworkDiagnosticEvents.SessionStopping,
    FrameworkDiagnosticEvents.SessionStopped,
}));
```

★ 处断言的是：**`SessionStopped` 这条"我停好了"的事件被发出去时，所有权释放必须已经全部完成。**

这不是形式主义。设想一个监听 `SessionStopped` 的组件想立刻开一个新 Session：

```csharp
sink.On(SessionStopped, () => factory.CreateSession());   // 合法吗？
```

只有当 `release(this)` 已经跑完、`activeSession` 已经置 null 时，这才不会撞上 `"Only one Session may be active at a time."`。这条测试把"事件是终态的公告，不是终态的一部分"钉死了——回看 §4.2 `RunStop` 的实现顺序（cancel → dispose scope → release factory → **最后**才 `Emit`），正是为了满足它。

> **推广**：任何"完成事件"的语义都应该是这样。发 `OrderCompleted` 之前库存必须已扣、发 `ConnectionClosed` 之前 socket 必须已释放。否则监听方就得写防御性重试。

### 10.2 一个必须纠正的误解：取消**也是** `Failed`

一种直觉的想法是"取消是用户的正常操作，应该有独立的终态"。**这份代码不是这么做的。** 看 `FailStart` 的 `finally`：

```csharp
// Session.cs:353-362
finally
{
    lock (sync)
    {
        state = SessionState.Failed;   // ← 取消也走这里，没有分支
        isDisposed = true;
        if (stopTask == null) stopTask = Task.CompletedTask;
    }
    DisposeCancellationOnce();
}
```

而 `StartAsync` 的 catch 无条件先调 `FailStart(exception)`。测试名 `Canceled_startup_**fails**_releases_factory_...` 里的 `fails` 就是这个意思，断言也很直白：

```csharp
// SessionStateMachineTests.cs:92-95
Assert.That(async () => await session.StartAsync(cancellation.Token),
    Throws.InstanceOf<OperationCanceledException>());
Assert.That(session.State, Is.EqualTo(SessionState.Failed));   // ← 不是 Stopped
```

**那"取消"和"出错"的区别体现在哪？体现在返回的 Task 上**：

```csharp
// Session.cs:176-185
catch (Exception exception)
{
    FailStart(exception);                                    // 状态：一律 Failed
    if (exception is OperationCanceledException)
    {
        var token = cancellationToken.IsCancellationRequested ? cancellationToken : new CancellationToken(true);
        return Task.FromCanceled(token);                     // ← 结果：Canceled
    }
    return Task.FromException(exception);                    // ← 结果：Faulted
}
```

这是一个**很值得学的分层**：

| 信号 | 粒度 | 回答的问题 |
|---|---|---|
| `SessionState` | 粗（6 个值，其中 2 个终态） | **这个 Session 还能不能用？** |
| `Task` 的完成方式 | 细（Canceled / Faulted / 异常类型 / 消息） | **为什么不能用？** |

状态机只需要粗粒度，因为它的消费者是"要不要清理 / 能不能重启"这类判断——对它们来说"取消"和"出错"的处置完全一样（都得清理、都不能重启）。把取消单独做成一个终态，只会让每个 `switch (state)` 多一个分支，却不带来任何新的决策。

细粒度信息放在 Task 上，由**真正关心原因的调用方**去解包（`try/catch (OperationCanceledException)`），同时结构化诊断（`framework.session-start-failed` + `ExceptionType`）负责给运维看。**没有信息丢失，只是放对了地方。**

---

## 11. SessionCleanupFailureTests — 清理失败的语义

**文件**：`SessionCleanupFailureTests.cs`（145 行）

这个 fixture 有 **5 个测试**，全部用 `SessionTestSupport.cs` 里的共享夹具 `SessionTestHarness`。

### 11.1 三个故障注入点

`RecordingScopeFactory`（`SessionTestSupport.cs:16-37`）提供三个注入点，理解它们的**生效时机**比记住名字更重要：

```csharp
public Exception CreateFailure { get; set; }               // 从 Create() 抛 → 连 scope 都建不出来
public Exception DisposeFailure { get; set; }              // 传给 RecordingScope，从它的 Dispose() 抛
public Action<ISessionLifetime> OnCreating { get; set; }   // Create() 最开始的回调 → 注入重入/取消

public ISessionScope Create(ISessionLifetime lifetime)
{
    OnCreating?.Invoke(lifetime);                          // ① 先回调
    if (CreateFailure != null) throw CreateFailure;        // ② 再决定要不要炸
    var scope = new RecordingScope(lifetime, DisposeFailure);   // ③ DisposeFailure 在这里被"冻结"进 scope
    Created.Add(scope);
    return scope;
}
```

③ 这行有个容易踩的时序约束：**`DisposeFailure` 必须在 `StartAsync()` 之前设好**，因为它是在 `Create()` 里传进 `RecordingScope` 构造函数的。`StartAsync` 之后再改 `harness.ScopeFactory.DisposeFailure` 不会影响已经建出来的那个 scope——`Second_session_can_be_created_after_a_cleanup_failure` 正是利用这一点，在第一个 Session 失败后把它置回 `null`，让第二个 Session 拿到一个不会炸的 scope。

`RecordingScope` 记的三样东西也各有用处：

```csharp
public int DisposeCount { get; private set; }              // 证明"恰好释放一次"
public bool TokenCancelledAtDispose { get; private set; }  // 证明"cancel 早于 dispose"
public bool IsDisposed { get; private set; }
```

### 11.2 五个测试各守什么

| 测试 | 注入 | 守住的不变量 |
|---|---|---|
| `Scope_disposal_failure_during_normal_stop_still_releases_all_ownership` | `DisposeFailure` | scope dispose 炸了，**工厂照样被释放**、状态照样进 `Failed`、`DisposeCount == 1`、诊断 code 为 `framework.session-cleanup-failed` |
| `Second_session_can_be_created_after_a_cleanup_failure` | `DisposeFailure` 后清空 | 一次清理失败**不会毒化工厂**，下一个 Session 能正常跑完 |
| `Repeated_stop_and_dispose_after_a_cleanup_failure_are_deterministic` | `DisposeFailure` | 重复 stop 返回**同一个** Task（`Is.SameAs`）；`DisposeCount` 仍是 1；`session-cleanup-failed` 事件**只发一次** |
| `Failed_start_preserves_the_primary_failure_when_cleanup_also_throws` | `OnCreating` 触发取消 + `DisposeFailure` | **双失败模型**的核心断言，见下 |
| `Failed_start_without_a_scope_still_releases_the_factory` | `CreateFailure` | scope 根本没建出来时，`FailStart` 里的 `ownedScope?.Dispose()` 走 null 分支，工厂仍被释放 |

### 11.3 双失败模型的核心断言

```csharp
// SessionCleanupFailureTests.cs:93-125
[Test]
public void Failed_start_preserves_the_primary_failure_when_cleanup_also_throws()
{
    var harness = new SessionTestHarness();
    harness.ScopeFactory.DisposeFailure = new InvalidOperationException("scope dispose failed");
    var session = harness.Factory.CreateSession();
    using var cancellation = new CancellationTokenSource();

    // 在 scope 建出来之后才取消，这样失败清理路径上"有东西可 dispose"
    harness.ScopeFactory.OnCreating = _ => cancellation.Cancel();

    Assert.That(
        async () => await session.StartAsync(cancellation.Token),
        Throws.InstanceOf<OperationCanceledException>(),          // ★ 主失败原样传播
        "The primary start failure must not be replaced by the cleanup failure.");

    var failure = harness.Memory.Snapshot.Last();
    Assert.That(failure.Error.Value.Code, Is.EqualTo("framework.session-start-failed"));
    Assert.That(failure.Error.Value.ExceptionType,
        Does.Contain("OperationCanceledException"));               // ★ 主失败类型进 ExceptionType
    Assert.That(failure.Error.Value.Message,
        Does.Contain("scope dispose failed"));                     // ★ 清理失败拼进 Message
}
```

那行注释（"Cancel after the scope exists so failed-start cleanup has something to dispose"）值得单独品：测试作者**刻意**用 `OnCreating` 把取消时机放在 scope 创建的那一刻，就是为了同时踩中"主失败"和"清理失败"两条路径。少了这个技巧，`DisposeFailure` 根本不会被触发（因为没有 scope 可 dispose）——那就退化成 `Failed_start_without_a_scope_still_releases_the_factory` 那个场景了。

**三个 `★` 合起来说明了双失败模型的落点**：

| 信息 | 去了哪 | 谁消费 |
|---|---|---|
| 主失败的**异常对象**（含栈） | `Task` 的 faulted/canceled 结果 | 调用方的 `try/catch` |
| 主失败的**类型名** | `DiagnosticError.ExceptionType` | 日志聚合、按类型统计 |
| 清理失败 | 拼进 `DiagnosticError.Message` | 人读 |
| 失败**类别** | `DiagnosticError.Code`（`session-start-failed` vs `session-cleanup-failed`） | 告警规则 |

注意 `Code` 的区分：**在失败的 start 里，即使清理也炸了，code 仍然是 `framework.session-start-failed`**（不是 cleanup-failed）——因为对运维来说"这次启动失败了"才是要告警的事，清理炸了是附带信息。而在正常 stop 里清理炸了，code 才是 `framework.session-cleanup-failed`。这个区分很细但很对。

> 关于为什么不用 `AggregateException` 承载这两个异常（答案跟 spec §11.3 的"跨模块边界的异常必须规格化"直接相关），见 [`09-Implementation-Deep-Dives.md` §6](./09-Implementation-Deep-Dives.md)。

---

## 12. LifecycleMainThreadTests — 守门测试

**文件**：`LifecycleMainThreadTests.cs`（301 行）

**测试模式**：

```csharp
static T OnWorkerThread<T>(Func<T> function)
{
    var result = default(T);
    var failure = OnWorkerThread(() => { result = function(); });
    Assert.That(failure, Is.Null, "This lifecycle method must fault its operation rather than throw synchronously.");
    return result;
}
```

**关键**：Task-returning 方法**应该 fault 而不是 throw**——所以 worker 线程上调用时，`OnWorkerThread` 期望 `failure == null`（worker 自己没抛），然后 `result` 是 faulted Task。

### 12.1 10 个守门测试覆盖

前 8 个是"拒绝"用例（下表），另外 2 个是配套的对照用例：

- `Many_concurrent_worker_threads_are_all_rejected_without_disturbing_the_session` —— 见下面 §12.3，16 个 worker 同时被拒且不死锁；
- `Main_thread_lifecycle_succeeds_and_repeated_stop_and_dispose_stay_idempotent` —— **阳性对照**：证明主线程上一切正常。没有这条，前 9 条测试可以被一个"永远拒绝所有调用"的假实现全部骗过。

| 测试 | 验证 |
|---|---|
| `Guard_recognizes_only_the_thread_it_captured` | guard 只认识 capture 时的线程 |
| `Off_main_CreateSession_is_rejected_and_creates_no_session_or_id` | 拒绝 → 无 Session、无 ID、factory 不 latch、diagnostic 不发 |
| `Off_main_StartAsync_is_rejected_without_creating_a_scope_or_mutating_state` | 拒绝 → state 不变、scope 不建、token 不 cancel、factory 不释放 |
| `Off_main_StopAsync_is_rejected_and_leaves_the_running_session_intact` | 拒绝 → Running session 完好、token 不 cancel、scope 不 dispose |
| `Off_main_DisposeAsync_is_rejected_and_memoizes_no_terminal_operation` | 拒绝 → memoize 不发生、IsDisposed 不变 |
| `Off_main_application_Start_is_rejected_before_any_state_or_diagnostic_change` | 拒绝 → IsStarted 不变 |
| `Off_main_ShutdownAsync_is_rejected_before_latching_the_factory_or_stopping_the_session` | 拒绝 → factory 不 latch、session 不 stop |
| `Off_main_application_Dispose_is_rejected_and_starts_no_shutdown` | 拒绝 → shutdown 不开始 |

**每个测试都断言了"拒绝的副作用是 0"** —— 不是"部分应用"。

### 12.2 "拒绝后可重试"

```csharp
// The factory is neither poisoned nor latched: the main thread still works.
Assert.That(() => harness.Factory.CreateSession(), Throws.Nothing);
```

**这是关键不变量**：off-main 拒绝**不能破坏 main-thread 路径**。

### 12.3 并发 worker 拒绝

```csharp
const int callers = 16;
var ready = new ManualResetEventSlim(false);
var rejected = new Task[callers];
var threads = new Thread[callers];
for (var index = 0; index < callers; index++)
{
    var slot = index;
    threads[slot] = new Thread(() =>
    {
        ready.Wait();
        rejected[slot] = session.StopAsync(CancellationToken.None);
    }) { IsBackground = true };
    threads[slot].Start();
}
ready.Set();
foreach (var thread in threads)
    Assert.That(thread.Join(TimeSpan.FromSeconds(10)), Is.True, "Rejection must not deadlock.");
```

**16 个 worker 线程同时调 StopAsync**——全部被拒绝，**没有死锁**，session 完好无损。然后主线程的合法 stop 正常工作。

---

## 13. SessionLifecycleConcurrencyTests — 锁不泄漏

**文件**：`SessionLifecycleConcurrencyTests.cs`（207 行）

### 13.1 Reentrant diagnostics 不死锁

```csharp
var reentrantSink = new DelegateDiagnosticSink(recorded =>
{
    if (session == null) return;
    observed.Add(session.State);                // ← 从 sink 里读 Session
    observedIds.Add(session.Id);

    var probe = new Thread(() =>                // ← 跨线程读
    {
        var _ = session.State;
        var __ = session.Id;
    }) { IsBackground = true, Name = "diagnostic-lock-probe" };
    probe.Start();
    if (probe.Join(TimeSpan.FromSeconds(5))) crossThreadReads++;
    else crossThreadTimeouts++;
});

var harness = new SessionTestHarness(reentrantSink);
session = harness.Factory.CreateSession();

await session.StartAsync(CancellationToken.None);
await session.StopAsync(CancellationToken.None);

Assert.That(crossThreadTimeouts, Is.Zero, "No lifecycle lock may be held while a diagnostic sink runs.");
```

**测试设计**：
- `reentrantSink` 在被调时**启动一个跨线程 reader**
- 如果 lifecycle 锁在 sink 运行时被持有，reader 进不去 → timeout
- **断言 `crossThreadTimeouts == 0`** 即"锁从未跨 sink 持有"

### 13.2 20 轮循环不泄漏

```csharp
for (var index = 0; index < 20; index++)
{
    var session = harness.Factory.CreateSession();
    await session.StartAsync(CancellationToken.None);
    await session.StopAsync(CancellationToken.None);
    // ...
}

Assert.That(harness.ScopeFactory.Created, Has.Count.EqualTo(20));
Assert.That(harness.ScopeFactory.Created.All(scope => scope.IsDisposed), Is.True);
Assert.That(harness.ScopeFactory.Created.All(scope => scope.DisposeCount == 1), Is.True);
```

**20 个 session × 1 个 scope = 20 个 scope 全部 dispose 恰好 1 次**——**没有泄漏，没有重复清理**。

---

## 14. 关键设计模式总结

读完整个 Bootstrap 我提炼出 **7 个核心模式**：

### 模式 1：状态机 + Memoization

`SessionState` 枚举 + 锁内 memoize stopTask。

```csharp
lock (sync)
{
    if (stopTask != null) return stopTask;   // ← 第二个 caller 拿第一个的 Task
    // ...
}
```

### 模式 2：锁持有时间最小化

锁内只做状态变更；sink、cancel、dispose 全部锁外。

### 模式 3：双层失败模型

```csharp
catch (Exception exception)
{
    cleanupFailure = cleanupFailure ?? exception;  // ← 不覆盖
}
```

主失败传播，cleanup 失败追加（不替换）。

### 模式 4：状态终态不可逆

`state` 进入 `Stopped` / `Failed` 后**不再变化**——`Start` 在终态下被拒（`ObjectDisposedException`）。

### 模式 5：纵深防御（Defense in Depth）

三层主线程守门：`SessionFactory` → `Session` → `VContainerSessionScopeFactory`。

### 模式 6：Cleanup in `finally`

```csharp
try { /* cleanup */ }
finally { state = ...; isDisposed = true; }
```

无论 cleanup 怎么炸，状态机终态都能进入。

### 模式 7：单一所有权的显式化

`CancellationTokenSource` 用 `cancellationDisposed` latch 表达"只有一个 owner、只释放一次"；`VContainerSessionScope.Dispose` 用 `scope = null; owned?.Dispose();` 表达"先交出所有权再释放"。两者都不是为了防异常（`CancellationTokenSource.Dispose` 本来就幂等，见 §4.7），而是**把所有权语义写成代码**。

---

## 15. 与 spec 对照

| spec 章节 | Bootstrap 实现 |
|---|---|
| 9.1 Runtime Scopes（App/Session/Module 三层） | `AppLifetimeScope` + `VContainerSessionScope` |
| 10.3 Lifecycle States（Inactive → Loading → Active → Unloading） | `SessionState.Created → Starting → Running → Stopping → Stopped/Failed` |
| 10.4 Effect Ownership | `lifetimeCancellation` + `scope` + `release` 三个 owned 引用 |
| §6 **原则 6** Provider-before-consumer | `PreventNewSessions()` 先于 `active.StopAsync` |
| §6 **原则 7** Logical unload 强制 | `RunStop` 完整序列：cancel → dispose → release → emit |

> ⚠️ spec 第 6 节「Architectural Principles」是一个 **13 条的扁平编号列表**，没有 6.1 / 6.3 / 6.5 这样的子小节。上表最后两行标的是列表序号。

**当前实现对应 Phase 1**——AOT kernel 启动 + 单 Session 生命周期。**Module fiber**（spec 10.2）的实现还在后续 plan 中。

---

## 16. 我对 Bootstrap 实现的整体评价

### 优点

1. **教科书级别的状态机实现**——memoization + 终态不可逆 + cleanup 在 finally
2. **主线程守门是真"守"，不是"建议"**——纵深防御 + 拒绝在 mutation 前
3. **双层失败模型**——`primary vs cleanupFailure` 的设计很成熟
4. **TaskCompletionSource + RunContinuationsAsynchronously**——避免 continuation stack dive
5. **测试密度高**——8 个守门 + 8 个状态机 + 7 个 concurrency + 5 个 cleanup = ~30 个测试覆盖一个 ~700 行的核心
6. **诊断信号清晰**——start-failed vs stop-failed vs cleanup-failed vs application-shutdown-incomplete 都有独立 code
7. **公开 API 受控**——`IUnityMainThreadGuard` / `SessionLifetime` 都是 `internal`，不暴露到 Mod SDK

### 可借鉴的设计模式

| 模式 | 适用 | 学习难度 |
|---|---|---|
| 状态机 + memoized terminal Task | 长生命周期对象的优雅 stop | 🟡 中等 |
| 锁持有时间最小化（state vs effect split） | 任何需要 reentrant 的锁 | 🟡 中等 |
| 纵深防御（多层 guard） | 涉及线程安全的代码 | 🟢 简单 |
| 主失败 + cleanup 失败双错误 | 资源清理代码 | 🟢 简单 |
| `TaskCreationOptions.RunContinuationsAsynchronously` | 防止 stack dive | 🟢 简单 |
| `ObjectDisposedException` 而不是自定义异常 | 实现 IDisposable 的标准实践 | 🟢 简单 |

### 局限与可改进点

1. **每个 Session 单独的 factory 引用**——`SessionFactory.Release` 内部已经检查 `ReferenceEquals`，但**没有引用计数**。如果未来允许多 Session，需要改成 list + 引用计数。
2. **`TaskCreationOptions.RunContinuationsAsynchronously` 仅在 continuation path 用**——`FailStart` 的某些路径可能 inline await。需要测试覆盖。
3. **`preventNewSessions` 没有 backoff**——频繁错误的代码（比如搞坏 Unity 句柄）会持续抛异常。可以加 limiter。
4. **诊断没有 buffer**——如果 sink 慢，主线程会被 `Emit` 阻塞。可考虑 async emit queue。

---

## 17. 与 Unity 生态的整合点

虽然 Bootstrap 大量使用 Unity API（`MonoBehaviour`、`ScriptableObject`、`[SerializeField]`），但**主线程守门让 Unity API 调用安全**：

- `Debug.Log/LogWarning/LogError` 必须在主线程——守门保证
- VContainer `LifetimeScope.CreateChild` 必须在主线程——守门保证
- `LifetimeScope.Dispose` 销毁 Unity 对象——守门保证

**Bootstrap 是 Unity 集成与 .NET 并发模型的"翻译层"**——把 Unity 的"主线程文化"翻译成 .NET 的"线程安全语言"。

---

## 18. 关键 takeaway

读完整个 Bootstrap，最大的认知收获：

> **长生命周期对象的状态管理 = 状态机 + 锁持有时间最小化 + memoization + 双层失败处理**

具体到这个项目：
- **ApplicationLifecycleCoordinator** = 应用级状态机（Started → ShutdownRequested）
- **Session** = 会话级状态机（Created → Starting → Running → Stopping → Stopped/Failed）
- **memoization** 让 stop/dispose 幂等，让多 caller 等同一个 Task
- **锁持有时间最小化** 让 reentrant 不死锁（test 显式验证）
- **双层失败** 让原异常永远不被清理异常吞掉

这套模式可以应用到：
- **数据库 connection pool**（连接 = Session）
- **WebSocket 会话**（连接 = Session）
- **分布式任务调度**（任务 = Session）
- **任何 IDisposable 长生命周期对象**

---

## 参考链接

- [VContainer 文档](https://vcontainer.hadotakanobu.com/)
- [.NET TaskCreationOptions.RunContinuationsAsynchronously](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcreationoptions)
- [TaskScheduler.Default](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskscheduler.default)
- [Unity Domain Reload](https://docs.unity3d.com/Manual/ConfigurableEnterPlayMode.html)
- [CancellationToken 生命周期](https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads)

---

**下一步**：读 [ModApi 契约笔记](./04-ModApi-Contract-Surface.md)，看 Mod 作者能接触到的接口——`IModule`、`IModuleContext`、`CapabilityContracts` 是怎么设计的。

---

## 附：本篇的勘误与延伸

本篇经过一次源码对照审查。**§10 和 §11 曾整节引用了 7 个并不存在的测试名和一个不存在的 `OnDispose` API**，已按真实的 `SessionStateMachineTests.cs` / `SessionCleanupFailureTests.cs` 重写；由假测试名推出的"取消 → `Stopped` 不是 `Failed`"这个结论也已纠正（真实代码里取消**也是** `Failed`，区别在返回的 Task 上）。另有 §2.3、§4.7、§8.3 三处机制解释被重写。完整证据见 [`00-Review-Report.md`](./00-Review-Report.md) §2、§3.2–§3.4。

Bootstrap 还有几个本篇未展开的实现要点，见 [`09-Implementation-Deep-Dives.md`](./09-Implementation-Deep-Dives.md)：

- **§4** VContainer 装配逐行解剖：`RegisterInstance` vs `Register(Singleton)` 的真实差别、`FrameworkCompatibility` 作为 struct 被装箱、为什么 `router`/`eventFactory` 必须手动 `new`、以及 MS DI 里等价写法的一个常见 bug
- **§5** 拒绝协议的完整清单：10 个受守护入口点各自选了"同步抛"还是"faulted Task"，以及这条规则背后的三个理由（批量场景、观察时机、与业务失败语义对齐）
- **§6** 失败账本模式 vs `AggregateException` / `ExceptionDispatchInfo` 的取舍，以及 `??` 而不是 `=` 的深层理由（清理是有序的，第一个失败往往是根因）
- **§7** 诊断管线线程契约的完整论证与那个"跨线程 probe"测试技巧的原理（`Monitor` 可重入，所以同线程读证明不了锁是空闲的）
- **§8** asmdef 作为架构工具：`autoReferenced: false` 这道零维护的编译期防线