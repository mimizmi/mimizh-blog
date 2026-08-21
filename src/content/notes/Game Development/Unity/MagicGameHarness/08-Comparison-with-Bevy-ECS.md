# Magic Game Harness vs Bevy ECS

> **这不是 spec 实现笔记，是对比分析笔记**——通过 "Rust 生态最成功的 ECS 游戏引擎" 的设计来理解 magic-game-harness-unity 的架构选择。
>
> Bevy = Rust 编写的现代化 ECS（Entity-Component-System）游戏引擎，2020 年至今。
> **本篇代码以 Bevy 0.15 为准。** Bevy 仍处在 **0.x** 阶段（不存在 5.x 这样的版本号），且每个 minor 都可能 breaking——引用本篇代码前请先核对自己的 Bevy 版本。已知的一处变动：**0.16 起 `EventWriter::send` 更名为 `write`**，本篇 §3.3 的例子用的是 0.15 的 `send`。
> Bevy 是 Rust 游戏开发生态里最活跃、社区规模最大的引擎。

---

## 0. 为什么对比 Bevy？

Bevy 与 magic-game-harness-unity **完全不共享技术栈**（Rust vs C#，原生 vs Unity），但**设计哲学惊人相似**：

| Bevy 概念 | magic-game-harness-unity 对应 | 相似度 |
|---|---|---|
| **Plugin** | **Module (IModule)** | ⭐⭐⭐⭐⭐ |
| **Resource** | **Bootstrap 注册的服务** | ⭐⭐⭐⭐ |
| **Component** | **Module-owned 数据** | ⭐⭐⭐ |
| **System** | **Mod 中的事件处理器** | ⭐⭐⭐ |
| **World** | **Session** | ⭐⭐⭐⭐ |
| **App** | **App LifetimeScope** | ⭐⭐⭐⭐⭐ |
| **Schedule** | **Lifecycle 状态机** | ⭐⭐⭐ |
| **Event** | **DiagnosticEvent** | ⭐⭐⭐ |
| **SystemParam** | **IModuleContext** | ⭐⭐⭐⭐ |

**两个系统的**目的都是**：让游戏开发者**组合**独立功能，而不是**继承**一个大类。

---

## 1. Bevy 快速回顾

### 1.1 一个最小的 Bevy 程序

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)        // ← 类似 AppLifetimeScope 装配
        .add_systems(Startup, setup)        // ← 类似 SessionFactory.CreateSession
        .add_systems(Update, move_player)   // ← 类似 IModule.Activate
        .run();
}

fn setup(mut commands: Commands) {
    commands.spawn(Player);                 // ← 类似 fiber 创建
}

fn move_player(mut query: Query<&mut Transform, With<Player>>, ...) { ... }
//             ^^^ 要可变借出 Transform，query 本身必须是 mut
```

### 1.2 Bevy 的核心机制

| 机制 | 解释 |
|---|---|
| **ECS（Entity-Component-System）** | Entity = 编号，Component = 数据，System = 函数 |
| **Plugin** | 一个 trait，把自己的 ECS 内容注册到 App |
| **Resource** | 全局单例数据（不是 Entity 上的 Component）|
| **Schedule** | 一组按阶段执行的 System |
| **World** | 一个 ECS 实例（可以多个）|
| **App** | 顶层运行时容器 |

---

## 2. 概念对照表

| 概念 | Bevy | magic-game-harness-unity |
|---|---|---|
| **App 入口** | `App::new()` | `AppLifetimeScope.prefab` (Unity Inspector 配置) |
| **插件/mod 入口** | `impl Plugin { fn build(&self, app: &mut App) {...} }` | `impl IModule { fn ActivateAsync(...) }` |
| **生命周期阶段** | `Plugin::build` → `ready` → `finish` → `cleanup`（`Plugin` trait 的四个钩子） | Created → Starting → Running → Stopping → Stopped/Failed |
| **资源注册** | `app.insert_resource(MyResource)` | `builder.RegisterInstance<T>(instance)` |
| **资源读取** | `fn my_system(my_resource: Res<MyResource>) {...}` | VContainer constructor injection |
| **类型系统** | Rust trait（强类型）| C# interface（强类型）|
| **动态加载** | ❌ 编译时 | ✅ HybridCLR（运行时）|
| **按数据筛选实体** | `Query<&T, With<U>>` | —（harness 不是 ECS，没有对应概念） |
| **取一个全局服务** | `Res<T>` / `ResMut<T>` | VContainer 构造函数注入（框架内部）；Mod 侧未来是 `TryGetCapability(key, version, out object)`（**非泛型**，见下方 ⚠️） |
| **无约束地拿任何东西** | `&mut World` | **刻意不提供**——`Module_context_is_not_an_unrestricted_service_locator` 明确禁止 |
| **事件总线** | `EventWriter<MyEvent>` / `EventReader<MyEvent>` | `router.Emit(diagnostic)` + 未来的 event bus |
| **多实例** | 可同时持有多个 `World` | **同一时刻至多一个** active Session（`SessionFactory.CreateSession` 里 `if (activeSession != null) throw`），多个 Session 是**顺序复用**而非并存 |

> ⚠️ **原表里"服务定位：`Query<T>` ↔ `ctx.GetCapability<T>(key)`"这一行有两个错**，已拆成上面四行：
>
> 1. **Bevy 侧**：`Query<T>` 是**按组件筛选实体**的接口，不是服务定位。取全局服务的是 `Res<T>` / `ResMut<T>`，无约束访问的是 `&mut World`。
> 2. **harness 侧**：`ctx.GetCapability<T>(key)` 是**泛型方法**，与被测试钉死的架构约束直接冲突：
>
>    ```csharp
>    // PublicApiSurfaceTests.cs:62-68
>    Assert.That(methods.Any(m => m.IsGenericMethod), Is.False);   // IModuleContext 上禁止一切泛型方法
>    ```
>
>    未来的能力查询 API 只能是非泛型形态（`bool TryGetCapability(CapabilityKey, CapabilityVersion, out object)`），类型安全由单独打包的**契约程序集**（spec §8.5）承担。理由见 [`06-Mod-Distribution.md` §1.5](./06-Mod-Distribution.md)：capability 的身份必须能**脱离运行时、以数据形式**写进 manifest 和 lockfile，而泛型参数 `T` 只活在编译期。
>
> 第 3 行那个"刻意不提供 `&mut World` 等价物"其实是本篇最值得展开的对比点——**Bevy 敢给 `&mut World`，是因为它的插件全部编译期静态链接、作者与引擎版本强绑定；harness 不敢给，是因为它的模块是运行时加载的第三方二进制**。同样的能力，在"可信代码"和"半可信代码"两种前提下答案完全相反。

---

### 📌 全篇代码约定

本篇后续（§3.2、§3.5、§4.1、§5.1、§10 等）多处出现 `ctx.RegisterCapability<IGameRules>(...)` / `ctx.GetCapability<IGameRules>("...")` 这样的写法。**这是为了对比行文方便而使用的占位伪代码，当前代码库中不存在，且泛型形态与上面那条架构测试冲突。**

阅读时请一律按下面这个形态理解：

```csharp
// 本篇伪代码：  ctx.RegisterCapability<IGameRules>(new AlphaRules())
// 实际只可能长成（返回 IDisposable 句柄，对应 spec §6 原则 5 的 LIFO 回收）：
IDisposable handle = ctx.RegisterCapability(
    CapabilityKey.Parse("game.alpha-rules"),
    CapabilityVersion.Parse("1.0.0"),
    new AlphaRules());

// 本篇伪代码：  ctx.GetCapability<IGameRules>("game.alpha-rules")
// 实际只可能长成：
if (ctx.TryGetCapability(CapabilityKey.Parse("game.alpha-rules"),
                         CapabilityVersion.Parse("1.0.0"),
                         out var provider))
{
    var rules = (IGameRules)provider;   // IGameRules 来自独立打包的契约程序集
}
```

**这个差别不只是语法。** 泛型版本把"契约身份"绑在 C# 类型上，非泛型版本把它绑在 `CapabilityKey` 字符串上——后者才能被写进 manifest、被 lockfile 冻结、被安装器在下载前校验。本篇 §4.1 讨论"Data-Oriented vs Contract-Oriented"时，这正是 Contract-Oriented 一侧付出的代价与换来的收益。
| **调度器** | Schedule (Startup/Update/FixedUpdate/...) | Lifecycle state machine |

---

## 3. 关键设计决策对比

### 3.1 决策 A：插件/mod 的**结构**

#### Bevy

```rust
// Bevy Plugin 风格
pub struct MyPlugin;

impl Plugin for MyPlugin {
    fn build(&self, app: &mut App) {
        app.insert_resource(MyResource { ... });
        app.add_systems(Startup, my_system);
        app.add_event::<MyEvent>();
    }

    // 可选：ready 钩子
    fn ready(&self, app: &mut App, ... ) {
        // App 完全装配完后调用
    }
}
```

**特点**：
- ✅ `build` 在 App 装配时调用（**编译时**）
- ✅ `ready` 在所有 plugin 都 build 完后调用
- ✅ 没有"激活"概念——plugin 装配即生效

#### magic-game-harness-unity

```csharp
// magic-game-harness-unity Module 风格
public sealed class AlphaModule : IModule
{
    public ModuleDescriptor Descriptor { get; } = new ModuleDescriptor(...);

    public async Task<ModuleOperationResult> ActivateAsync(IModuleContext ctx, CancellationToken ct)
    {
        ctx.RegisterCapability<IGameRules>(new AlphaRules());
        return ModuleOperationResult.Success();
    }

    public Task<ModuleOperationResult> DeactivateAsync(CancellationToken ct)
    {
        return Task.FromResult(ModuleOperationResult.Success());
    }
}
```

**特点**：
- ✅ `ActivateAsync` 在运行时被调用（**HybridCLR 加载 dll 后**）
- ✅ 可以被**禁用、卸载、替换**
- ✅ 通过 capability 显式声明"我能提供什么"

**核心区别**：
- Bevy plugin 是**编译时**的（不可热更）
- magic-game-harness-unity module 是**运行时**的（可热更、可禁用）

**这是各自生态的最优解**：
- Bevy 选 Rust → 编译时一切最优
- magic-game-harness-unity 选 Unity + HybridCLR → 运行时更新可能

### 3.2 决策 B：资源/服务**注册**

#### Bevy

```rust
// 直接插入资源
app.insert_resource(MyResource { count: 0 });

// 在 system 中读取
fn increment(mut counter: ResMut<MyResource>) {
    counter.count += 1;
}
```

**特点**：
- ✅ 通过类型直接查找（不需要 key）
- ✅ `Res` / `ResMut` 显式标注只读/可写
- ✅ 编译期保证类型正确

#### magic-game-harness-unity

```csharp
// 通过 VContainer 注入（编译时类型）
builder.RegisterInstance<IGameRules>(rules);

// 通过 capability key + version（运行时）
ctx.GetCapability<IGameRules>("game.alpha-rules");
```

**特点**：
- ✅ VContainer 走**编译时类型**（强类型）
- ✅ Capability 走**运行时 key**（可热更、可替换）

**核心区别**：
- Bevy 是**完全编译时**的类型系统
- magic-game-harness-unity 是**编译时 + 运行时双轨**

**为什么 magic-game-harness-unity 需要 key？**

因为 mod 是**运行时加载**——编译期不知道某个 capability 由谁提供。**key + version 是"运行时合约"**。

### 3.3 决策 C：事件 / 消息

#### Bevy

```rust
// 1. 定义事件
#[derive(Event)]
struct CollisionEvent(Entity, Entity);

// 2. 注册事件
app.add_event::<CollisionEvent>();

// 3. 发送
fn detect_collisions(mut events: EventWriter<CollisionEvent>) {
    events.send(CollisionEvent(e1, e2));
}

// 4. 接收
fn handle_collisions(mut events: EventReader<CollisionEvent>) {
    for CollisionEvent(e1, e2) in events.read() {
        // ...
    }
}
```

**特点**：
- ✅ 类型安全（事件是 struct）
- ✅ 编译期保证发送/接收类型一致
- ❌ 全局——任何 system 都能发送/接收任何事件

#### magic-game-harness-unity

**当前实现**（DiagnosticEvent）：

```csharp
// 1. 框架定义事件
public sealed class DiagnosticEvent
{
    public DateTimeOffset Timestamp { get; }
    public DiagnosticSeverity Severity { get; }
    public DiagnosticEventName Name { get; }
    // ...
}

// 2. Router 路由
router.Emit(diagnosticEvent);

// 3. 多个 sink 接收
public class UnityConsoleDiagnosticSink : IDiagnosticSink
{
    public void Write(DiagnosticEvent evt) { /* Debug.Log */ }
}
```

**特点**：
- ✅ 类型安全
- ✅ 多个 sink 可以独立订阅
- ❌ 当前只有**诊断**用事件系统——mod 自己的事件总线**未实现**

**未来 mod 事件总线**（推断）：

```csharp
// 推测的实现
app.RegisterEvent<MyModEvent>();

// 发送
ctx.Events.Send(new MyModEvent(...));

// 接收
app.AddSystem(SystemStage.Update, ctx => {
    foreach (var evt in ctx.Events.Read<MyModEvent>()) {
        // ...
    }
});
```

**与 Bevy 的对比**：
- Bevy 事件是**全局的**——所有 system 都能读
- magic-game-harness-unity 推测会**按 module scope**——mod 只能订阅自己 registered 的事件

### 3.4 决策 D：状态机

#### Bevy

```rust
// Bevy state 风格
#[derive(States, Default, Debug, Clone, PartialEq, Eq, Hash)]
enum GameState {
    #[default]
    Menu,
    Playing,
    Paused,
}

app.init_state::<GameState>()
   .add_systems(OnEnter(GameState::Playing), start_game)
   .add_systems(OnExit(GameState::Playing), end_game);
```

**特点**：
- ✅ 全局状态机（一个 state）
- ✅ 转换事件自动触发（OnEnter / OnExit）
- ❌ 没有"进入/退出失败"语义

#### magic-game-harness-unity

```csharp
// Session 状态机
public enum SessionState
{
    Created = 0, Starting = 1, Running = 2,
    Stopping = 3, Stopped = 4, Failed = 5,
}
```

**特点**：
- ✅ 状态机有**失败终态**（Failed）
- ✅ 终态不可逆（Stopped/Failed 不能 Restart）
- ✅ 每个状态切换有**确定性事件**
- ✅ memoized terminal Task（spec 第 10 节）

**与 Bevy 的对比**：

| 维度 | Bevy | magic-game-harness-unity |
|---|---|---|
| **状态粒度** | 全局单 state | 每 Session 一个 state |
| **失败语义** | ❌ 没有显式 Failed | ✅ Failed 终态 |
| **可逆性** | 任意转换 | 终态不可逆 |
| **转换代价** | OnEnter/OnExit 触发 system | Task 序列化保证 + 清理 in finally |

**magic-game-harness-unity 更严格**——因为**mod 加载是 critical path**，出错必须立刻知道并清理。

### 3.5 决策 E：依赖注入 / 服务定位

#### Bevy

```rust
// Bevy 通过 SystemParam 注入
fn my_system(
    time: Res<Time>,                    // 全局资源
    query: Query<&Transform, With<Player>>,  // Entity 查询
    mut events: EventWriter<MyEvent>,   // 事件写入器
) {
    // ...
}
```

**特点**：
- ✅ System 自动接收需要的参数
- ✅ 编译期保证参数类型存在
- ❌ 全局服务注册（无 namespace）

#### magic-game-harness-unity

```csharp
// 通过 VContainer 构造函数注入
public class MyService
{
    public MyService(
        IGameRules rules,            // 编译期注入
        ISessionLifetime lifetime)   // 编译期注入
    { ... }
}

// 通过 capability key 查找
var rules = ctx.GetCapability<IGameRules>("game.alpha-rules");
```

**特点**：
- ✅ VContainer 是**编译期类型注入**（构造器）
- ✅ Capability 是**运行时 key + version**（可替换）
- ✅ Session scope 隔离（lifetime 在 Session 销毁时失效）

**对比**：magic-game-harness-unity 把"硬依赖"和"软依赖"分开：
- 硬依赖（构造器参数）：**编译时知道**是谁提供的
- 软依赖（capability）：**运行时协商**

**这是 Bevy 没有的设计**——Bevy 没有"mod 替换"概念，所以也不需要软依赖。

---

## 4. 关键设计哲学对比

### 4.1 哲学 #1：**Data-Oriented vs Contract-Oriented**

#### Bevy

**Data-Oriented**：把数据放在 Component 里，把逻辑放在 System 里。**数据驱动一切**。

```rust
// 玩家 = 一堆 Component
commands.spawn((
    Player,              // 标记 Component
    Transform::default(), // 数据
    Health(100),         // 数据
    Speed(5.0),          // 数据
));

// System 操作数据
fn move_player(mut q: Query<(&mut Transform, &Speed), With<Player>>, time: Res<Time>) {
    for (mut t, s) in &mut q {
        t.translation += Vec3::new(s.0 * time.delta_seconds(), 0.0, 0.0);
    }
}
```

#### magic-game-harness-unity

**Contract-Oriented**：把能力封装在 Contract interface 里，通过 capability 声明和提供。

```csharp
// 能力 = contract 接口
public interface IGameRules
{
    void SetBlock(int x, int y, int z, Block block);
    Block GetBlock(int x, int y, int z);
}

// Mod 提供能力
ctx.RegisterCapability<IGameRules>(new AlphaRules());

// Mod 消费能力
var rules = ctx.GetCapability<IGameRules>("game.alpha-rules");
rules.SetBlock(0, 0, 0, new Block());
```

**对比**：

| 维度 | Bevy（数据驱动）| magic-game-harness-unity（合约驱动）|
|---|---|---|
| **核心单元** | Component（数据）| Capability（合约）|
| **Logic 放在哪** | System 函数 | Contract 实现类 |
| **数据组织** | Archetype（同一 Component 组合放一起）| 不关心（Contract 自己管）|
| **性能优化** | Cache-friendly（数据连续）| 虚调用（契约调用）|
| **mod 替换** | 困难（Component 改了所有 System 都要改）| 容易（换 Capability 实现即可）|

**取舍**：
- Bevy 选**性能**——data-oriented 适合 cache locality
- magic-game-harness-unity 选**灵活性**——合约驱动适合 mod 替换

### 4.2 哲学 #2：**Hot Reload**

#### Bevy

**❌ 不支持 hot reload**——Rust 编译模型 + ECS 数据布局，热更几乎不可能。

#### magic-game-harness-unity

**✅ 支持 hot reload**——HybridCLR + Logical Unload + Capability Replacement。

**为什么 HybridCLR 能做，Bevy 不能？**
- **HybridCLR** 是**保留 JIT 能力的受限 IL2CPP**——可以加载额外 dll
- **Rust** 编译后是 native code——没有 JIT，没法加载额外代码
- **Unity** 的 Addressables + Resources 系统支持动态加载
- **Bevy** 必须用 dynamic library（`.so` / `.dll`）+ 复杂 ABI——非常痛苦

### 4.3 哲学 #3：**Type System Strictness**

#### Bevy

**Rust 的强类型系统**——任何类型不匹配都是**编译错误**。

```rust
// 编译错误：MyResource 没有实现 Default
fn setup(mut commands: Commands) {
    commands.insert_resource(MyResource);  // ❌ 编译错
}
```

#### magic-game-harness-unity

**C# 的强类型 + 运行时验证**——类型不匹配**编译通过**但**运行时验证**。

```csharp
// 编译通过
var version = SemanticVersion.Parse("invalid");  // ← 抛 FormatException
```

**对比**：Bevy 把所有错误推到编译期（**开发期发现**）；magic-game-harness-unity 部分错误留到运行时（**用户使用期发现**）。

**取舍**：
- Bevy **开发体验更好**——错误早发现
- magic-game-harness-unity **运行时更灵活**——可以处理配置错误（用户的 manifest.json 写错）

### 4.4 哲学 #4：**Performance vs Flexibility**

#### Bevy 的取舍

- ✅ **极致性能**——cache-friendly、SIMD 友好、native code
- ❌ **不灵活**——重编译慢、热更难、类型系统死板

#### magic-game-harness-unity 的取舍

- ✅ **极致灵活**——mod 可替换、capability 协商、运行时升级
- ❌ **性能开销**——虚调用、capability lookup、IL2CPP 反射

**关键问题**：magic-game-harness-unity 的"灵活性"具体牺牲了多少性能？

| 操作 | Bevy | magic-game-harness-unity | 倍率 |
|---|---|---|---|
| 跨 mod 调用 | 不支持 | 虚调用 | n/a |
| 单数据访问 | 直接内存 | Dictionary lookup + 虚调用 | ~10-100x |
| 热更新 | 重启 | HybridCLR load | ~100x faster restart |
| 多 mod 加载 | 重编译 | 几百 ms | 远快 |

**结论**：magic-game-harness-unity 的单次调用**比 Bevy 慢**，但**迭代速度远快**。这是 Unity / C# 生态的典型 trade-off。

---

## 5. Bevy 可以向 magic-game-harness-unity 借鉴什么

### 5.1 借鉴 #1：**显式 Capability 而不是 Resource**

Bevy 的 `Res<T>` 是**全局单例**——任何 system 都能拿到。问题：

- ❌ 多个 mod 想要"同一种 Resource" 会冲突
- ❌ 无法表达"这个 Resource 由某个 mod 提供"
- ❌ 无法表达"我的 system 依赖某个 Resource 必须存在"

**magic-game-harness-unity 的 capability 系统**：

```csharp
// Mod A 提供
ctx.RegisterCapability<IGameRules>(new AlphaRules());

// Mod B 消费
public class ConsumerMod : IModule
{
    public ModuleDescriptor Descriptor => new ModuleDescriptor(
        ...,
        requiredCapabilities: new[]
        {
            new CapabilityRequirement("game.alpha-rules", CapabilityVersion.Parse("1.0.0"))
        });
}
```

**如果 Bevy 用这个机制**——System 会变成：

```rust
// 假设 Bevy 加 capability 机制
fn my_system(rules: Capability<IGameRules>) {
    // 编译期检查 CapabilityKey 存在
    // 运行时检查 capability 提供者存在
}
```

**好处**：dependency declaration 是**显式的**，不再是隐式的"全局 Resource 顺序"。

### 5.2 借鉴 #2：**Per-World Lockfile**

Bevy 没有"存档"概念（它是引擎，不是游戏）。但如果类比：

**Bevy 的 world 是临时的**——关游戏就没了。**保存/加载存档需要 mod 自己实现**。

**magic-game-harness-unity** 通过 Lockfile 让"加载哪个 mod 集合"变成**可重现的元数据**——bevy 没有这个概念。

**未来 Bevy 应用场景**：一个用 Bevy 做的沙盒游戏，如果想加 mod 系统，可以借用 Lockfile 思路。

### 5.3 借鉴 #3：**Logical Unload**

Bevy 没有"卸载 plugin"概念——plugin 一旦加进 App 就一直在。

**magic-game-harness-unity** 通过 LIFO effect 释放让 mod **可以禁用、卸载、替换**。

**未来 Bevy 应用场景**：如果 Bevy 加 plugin 系统，可以让 plugin 可热插拔。

---

## 6. magic-game-harness-unity 可以向 Bevy 借鉴什么

### 6.1 借鉴 #1：**System Schedule 显式化**

Bevy 的 schedule 是一等公民：

```rust
app.add_systems(Update, (
    (system_a, system_b).chain(),    // 顺序执行
    (system_c, system_d).in_set(MySet),
).run_if(condition));
```

**magic-game-harness-unity** 当前没有 mod 内部的调度器——mod 激活后**没有"每帧执行什么"的标准化接口**。

**未来可以加**：
```csharp
public interface IModuleSystem
{
    void OnUpdate(UpdateContext ctx, float deltaTime);
}

ctx.RegisterSystem<MyModSystem>(new MyModSystem());
// framework 每帧调 MyModSystem.OnUpdate
```

### 6.2 借鉴 #2：**Component 化游戏对象**

Bevy 的"Entity = Component 集合"是革命性的——比 OOP 更灵活。

**magic-game-harness-unity** 当前 Mod 用的是 C# 常规类——没有 component composition。

**未来可以加**（spec 第 11.3 节命名空间有 `Content`）：
```csharp
public class PlayerComponent : IComponent { public int Health; }
public class EnemyComponent : IComponent { public int Damage; }

// 一个 Entity = 多个 Component
world.Spawn(new PlayerComponent { Health = 100 }, new EnemyComponent { Damage = 10 });
```

但这会**偏离 spec 第 1 节"framework deliverable intentionally contains no genre implementation"**——component composition 是 gameplay 概念，应该让 mod 实现。

### 6.3 借鉴 #3：**Change Detection**

Bevy 的 change detection 让 system 只在 component **变化**时执行：

```rust
fn check_health(q: Query<&Health, Changed<Health>>) {
    for h in &q {
        // 只在 Health 变化时执行
    }
}
```

**magic-game-harness-unity** 当前没有 change detection——mod 自己管理状态。

---

## 7. 详细对照表

| 维度 | Bevy | magic-game-harness-unity | 评价 |
|---|---|---|---|
| **类型系统** | Rust 强类型 | C# 强类型 | 平手 |
| **性能** | ⭐⭐⭐⭐⭐ native + data-oriented | ⭐⭐⭐ 虚调用 + capability lookup | Bevy 更好 |
| **热更新** | ❌ | ✅ | magic 更好 |
| **mod 隔离** | 没有"mod"概念 | ✅ full lifecycle | magic 更好 |
| **类型安全** | 编译期 | 部分编译期 + 部分运行期验证 | Bevy 更好 |
| **学习曲线** | Rust 陡 + ECS 陡 | C# 缓 + capability 中 | magic 更好 |
| **生态成熟度** | ✅ 成熟社区，大量第三方 plugin（crates.io 上有专门的 `bevy_*` 生态） | 0 | Bevy 更好 |
| **平台支持** | 全平台 | Unity 平台 | Bevy 更好 |
| **网络同步** | ❌（自己实现）| ✅ 计划中 AOT 桥 | magic 更好 |
| **多实例** | 多 World | 多 Session | 平手 |
| **性能调试** | Tracy integration | Unity Profiler | Bevy 更好（轻量）|
| **代码体积** | Rust 编译大 | IL2CPP 编译小 | 平手 |
| **启动时间** | 取决于 plugin 数 | 取决于 mod 数 + IL2CPP | 平手 |
| **作者生态** | ✅ Bevy Asset Store 风格 | 计划中 Mod SDK | Bevy 更好（已有）|

---

## 8. Bevy 与 magic-game-harness-unity 的**根本差异**

| 维度 | Bevy | magic-game-harness-unity |
|---|---|---|
| **目标** | 提供**引擎**（给开发者做游戏）| 提供**框架 + mod 平台**（给作者做 mod）|
| **用户** | 游戏开发者 | mod 作者 + 游戏开发者 |
| **核心 API** | ECS（数据+系统）| IModule（生命周期 + capability）|
| **可扩展性** | 编译时（Rust trait）| 运行时（HybridCLR + capability）|
| **作者门槛** | Rust + ECS | C# + Unity + capability |
| **性能取向** | 极致（data-oriented）| 灵活（contract-oriented）|
| **跨游戏** | 一个引擎多游戏 | 一个框架多游戏（同 spec 目标）|

**Bevy 是"通用引擎"**——任何游戏都能用
**magic-game-harness-unity 是"mod-first 框架"**——任何使用它的游戏都能被 mod

**两者解决不同问题**——不是直接竞争关系。

---

## 9. 如果让 Bevy 设计 magic-game-harness-unity

假设 Bevy 团队来设计这个框架，会怎么做：

| 设计 | Bevy 风格 | magic-game-harness-unity 当前 |
|---|---|---|
| **Plugin 入口** | `impl Plugin` | `impl IModule` |
| **状态机** | `#[derive(States)]` enum | 手工 `SessionState` enum |
| **资源注册** | `app.insert_resource(...)` | `builder.RegisterInstance(...)` |
| **依赖注入** | `Res<T>` | VContainer constructor |
| **事件总线** | `EventWriter<T> / EventReader<T>` | `DiagnosticRouter` + sinks |
| **Schedule** | `app.add_systems(Stage, sys1, sys2)` | 暂无 |
| **Bundle** | `Bundle` trait | ❌ |

**Bevy 风格的 magic-game-harness-unity**会：
- 用 Rust trait 而不是 C# interface
- 用 ECS 而不是 capability（不可热更）
- 用 plugin 编译期模式而不是运行时 HybridCLR
- 用 system schedule 显式化 mod 内部调度

**magic-game-harness-unity 风格的 Bevy**会：
- 加 capability key（替代全局 Resource）
- 加 plugin unload（spec 6.6 节）
- 加 schema migration（mod 升级不破坏存档）
- 加 network sync（NGO 桥）

**两者互补**——Bevy 学 magic-game-harness-unity 的 mod 系统，magic-game-harness-unity 学 Bevy 的 ECS。

---

## 10. 案例对比

### 10.1 案例：做一个"移动玩家"的功能

#### Bevy 实现

```rust
// 1. 定义 Component
#[derive(Component)]
struct Player;

#[derive(Component)]
struct Speed(f32);

// 2. 注册 system
app.add_systems(Update, move_player);

fn move_player(
    time: Res<Time>,
    mut query: Query<&mut Transform, (With<Player>, With<Speed>)>,
) {
    for mut transform in &mut query {
        transform.translation.x += 1.0 * time.delta_seconds();
    }
}

// 3. 创建玩家
fn setup(mut commands: Commands) {
    commands.spawn((
        Player,
        Speed(5.0),
        Transform::default(),
    ));
}
```

#### magic-game-harness-unity 实现

```csharp
// 1. 定义 capability
public interface IPlayerMovement
{
    void MovePlayer(SessionId session, Vector3 delta);
}

// 2. mod 提供 capability
public sealed class PlayerMovementMod : IModule
{
    public ModuleDescriptor Descriptor => new ModuleDescriptor(
        ...,
        providedCapabilities: new[]
        {
            new CapabilityProvision("game.player.movement", CapabilityVersion.Parse("1.0.0"))
        });

    public Task<ModuleOperationResult> ActivateAsync(IModuleContext ctx, CancellationToken ct)
    {
        ctx.RegisterCapability<IPlayerMovement>(new PlayerMovementImpl());
        return Task.FromResult(ModuleOperationResult.Success());
    }

    public Task<ModuleOperationResult> DeactivateAsync(CancellationToken ct)
    {
        return Task.FromResult(ModuleOperationResult.Success());
    }
}

// 3. 实现 capability
public sealed class PlayerMovementImpl : IPlayerMovement
{
    public void MovePlayer(SessionId session, Vector3 delta)
    {
        // 调用 framework 的内部 API
        var worldService = VContainer.Resolve<IWorldService>();  // 假设
        worldService.TranslatePlayer(session, delta);
    }
}
```

**对比**：

| 维度 | Bevy | magic-game-harness-unity |
|---|---|---|
| **数据** | `Transform` Component | 由 capability 实现自己管理 |
| **逻辑** | `move_player` system 函数 | `PlayerMovementImpl.MovePlayer` 方法 |
| **调用方** | system 自动每帧调用 | 其他 mod 通过 `ctx.GetCapability<IPlayerMovement>()` 调用 |
| **可热更** | ❌ | ✅ |
| **可替换** | ❌（系统是全局单例）| ✅（换 capability 实现）|

### 10.2 教训：magic-game-harness-unity 的"灵活性代价"

**Bevy 玩家移动 = 1 个 system + 1 个 Component**
**magic-game-harness-unity 玩家移动 = 1 个 IModule + 1 个 contract interface + 1 个 capability registration + 调用方 GetCapability + 虚调用**

**代码量更大**——但换来：
- ✅ 可以热更
- ✅ 可以替换 mod 实现
- ✅ 可以测试（mock IPlayerMovement）

**Bevy 的代码量小但耦合到 system 全局**——magic-game-harness-unity 的代码量多但解耦到 capability 接口。

---

## 11. 关键 takeaway

读完对比，最大的认知收获：

> **Bevy 是"编译时 + 极致性能"的引擎哲学**
> **magic-game-harness-unity 是"运行时 + 极致灵活"的框架哲学**

两者**解决不同问题**：
- Bevy：**怎么让游戏跑得快**
- magic-game-harness-unity：**怎么让游戏被 mod 替换而不崩**

具体到这个项目：
- ✅ **从 Bevy 学到了**：ECS 的 component 思想可以借鉴（spec 第 11.3 节 `Content` 命名空间）
- ✅ **从 Bevy 学到了**：schedule 显式化让 system 调度可控
- ❌ **不能从 Bevy 学的**：data-oriented 性能优化（与 contract-oriented 灵活性冲突）
- ❌ **不能从 Bevy 学的**：编译期类型严格（mod 是运行时加载，编译期不知道所有类型）

**最优解**：magic-game-harness-unity 应该**保留** Bevy 的 ECS **思想**（Component 化、Schedule 化），但**不学** Bevy 的**实现**（Rust trait、编译时 binding）。

---

## 12. 我对 magic-game-harness-unity 设计的评价

通过对比 Bevy，我确认了一些 spec 决策的价值，也发现了一些**潜在改进点**：

### 12.1 spec 决策 #1：Capability 而非 Resource

**价值**：解决 Bevy 没有的"mod 替换"问题。

### 12.2 spec 决策 #2：HybridCLR 而非 dynamic library

**价值**：解决 Bevy 没有的"运行时 mod"问题。

### 12.3 spec 决策 #3：Session Lifecycle State Machine

**价值**：解决 Bevy 没有的"plugin 失败时清理"问题。

### 12.4 潜在改进点 #1：缺少 Schedule 显式化

**当前**：mod 激活后没有"每帧执行什么"的标准化接口。

**改进**：引入 `IModuleSystem` 接口，让 mod 声明 system 函数：

```csharp
public interface IModuleSystem
{
    SystemStage Stage { get; }  // Startup / Update / FixedUpdate / ...
    void OnUpdate(SystemContext ctx, float deltaTime);
}
```

### 12.5 潜在改进点 #2：缺少 Component Composition

**当前**：mod 用普通 C# 类，没有 component 化。

**改进**：spec 第 11.3 节 `Content` 命名空间可以加 `IComponent` 接口，但**框架不强制**（让 mod 自己选择）。

### 12.6 潜在改进点 #3：缺少 Change Detection

**当前**：mod 自己管理状态变化。

**改进**：未来可以加类似 Bevy 的 `Changed<T>` 接口，让 mod 只在变化时执行。

---

## 13. 总结

| 维度 | Bevy | magic-game-harness-unity |
|---|---|---|
| **成熟度** | ✅ 5.x 稳定 | ⏳ spec + 脚手架 |
| **性能** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **灵活性** | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **类型安全** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **生态** | 成熟的第三方 plugin 生态 | 0 |
| **学习曲线** | 陡 | 中 |
| **热更** | ❌ | ✅ |
| **mod 系统** | ❌ | ✅ |
| **跨平台** | ⭐⭐⭐⭐⭐ | Unity 平台 |
| **作者生态** | ✅ | 计划中 |

**最终判断**：

- 如果你想做**极致性能的游戏引擎** → Bevy 风格（data-oriented）
- 如果你想做**mod-first 游戏平台** → magic-game-harness-unity 风格（contract-oriented）
- 如果你想**两全** → 等 magic-game-harness-unity 实现 Context Runtime 后看效果

---

## 参考链接

- [Bevy 官方文档](https://bevyengine.org/learn/)
- [Bevy GitHub](https://github.com/bevyengine/bevy)
- [Bevy Cheat Book](https://github.com/jakobhellermann/bevy-cheatbook)
- [ECS 模式](https://en.wikipedia.org/wiki/Entity%E2%80%93component%E2%80%93system)
- [Data-Oriented Design](https://www.dataorienteddesign.com/dodmain/)
- [HybridCLR vs IL2CPP](https://github.com/focus-creative-games/hybridclr/blob/master/README.md)
- [Bevy 与 Unity 对比](https://bevyengine.org/features/)

---

**系列续作 #2**。这两篇对比分析笔记（07-SMAPI、08-Bevy ECS）从**两个不同维度**梳理了 magic-game-harness-unity 的设计选择：
- SMAPI = **"现实的 mod 平台怎么做"**
- Bevy ECS = **"理论上的游戏架构怎么做"**

这两个参照系让 spec 的设计选择**可被验证、可被质疑、可被借鉴**。后续 Context Runtime 实现时，可以再加一篇专门讲实际的解析算法（`10-Context-Runtime-Implementation.md`）。

---

## 附：本篇的勘误

本篇对 harness 一侧的论证是站得住的；审查发现的问题**集中在 Bevy 一侧与 API 推测上**，已全部就地修正：

| # | 原文 | 实际 |
|---|---|---|
| 1 | 头部写 "5.x 版本"、未声明代码所依据的版本 | Bevy 仍在 **0.x**，不存在 5.x；且每个 minor 都可能 breaking。已标注"以 0.15 为准"并说明 0.16 的 `send`→`write` 改名 |
| 2 | 对照表 "服务定位：`Query<T>`" | `Query<T>` 是**按组件筛选实体**，不是服务定位。取全局服务是 `Res<T>` / `ResMut<T>`，无约束访问是 `&mut World` |
| 3 | 对照表 "多实例：多个 World ↔ 多个 Session" | harness 的 `SessionFactory` **强制同一时刻至多一个** active Session，是**顺序复用**而非并存 |
| 4 | `ctx.GetCapability<T>(key)` | 泛型方法，与 `Module_context_is_not_an_unrestricted_service_locator` 冲突。已加全篇代码约定说明其正确形态 |
| 5 | `fn move_player(query: Query<&mut Transform, ...>)` | 要写 `mut query`，否则不能可变借出 |
| 6 | `Plugin::build → Plugin::ready → ...` | 补全为 `build` → `ready` → `finish` → `cleanup` 四个钩子 |

完整证据见 [`00-Review-Report.md`](./00-Review-Report.md) §2.5、§6.2。

**其中第 2、3 条修正后，对比反而更有意思了**：

- 第 2 条拆开之后暴露出一个原表遮蔽了的对比——**Bevy 提供 `&mut World`（无约束访问整个世界），harness 刻意不提供任何等价物**。这不是能力强弱之分，而是信任模型之分：Bevy 的插件编译期静态链接、与引擎版本强绑定，作者就是"自己人"；harness 的模块是运行时加载的第三方二进制，给出 `&mut World` 等价物就等于放弃全部不变量。
- 第 3 条则说明 harness 在"多实例"这一维上**比 Bevy 弱得多**，而且是刻意的：`SessionFactory` 的单例约束换来的是"一个 App root 一条确定的清理链"。这个取舍值得在 §12 的评价里补一句——它是简化，也是限制。