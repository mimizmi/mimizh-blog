# Magic Game Harness — ModApi 契约面解读

> 源码位置：`Assets/GameFramework/ModApi/`
> 8 个文件 / ~410 行（spec 列了 11 个子命名空间，但只 4 个有内容，其余先建空目录等后续 plan 填充）
> **这是 Mod 作者唯一能引用的程序集**——spec 第 8.2 节明文规定 `Game.ModApi` 不依赖 `Game.Core.Context`。

---

## 0. ModApi 在整个框架里的位置

按 spec 第 8.2 节的依赖方向：

```
Game.Core.Primitives    references: []
        ↓
Game.ModApi             [Primitives]   ← 公共契约，只依赖 Primitives
        ↓
Game.Core.Context       [Primitives, ModApi]
        ↓
Rules / Networking / Persistence / HotUpdate   [Primitives, ModApi, Context]
        ↓
Game.Bootstrap          [上面全部 + VContainer]   ← 组合根
```

**箭头方向是"被依赖 → 依赖"**。所以 `Game.Core.Context` **是**依赖 `Game.ModApi` 的——它必须依赖，否则没法实现 `IModule` 的加载与激活。spec §8.3 里 Context 的 "Permitted dependencies" 写的就是 "ModApi, Primitives"。

**真正的不变量是单向的那一半**：

> **`Game.ModApi` 不依赖 `Game.Core.Context`。**

因为 Mod 作者**不应该**看到 Context Runtime 的具体类型——spec 第 6 节**原则 1**："Stable contracts, replaceable implementations"。（注意 spec §6 是一个 13 条的扁平编号列表，没有 6.1 这样的子小节。）

这条方向由 `AssemblyDependencyTests.cs:16-19` 的白名单钉死：

```csharp
["Game.Core.Primitives"]  = Array.Empty<string>(),
["Game.ModApi"]           = new[] { "Game.Core.Primitives" },              // ← 只有这一项
["Game.Core.Diagnostics"] = new[] { "Game.Core.Primitives" },
["Game.Core.Context"]     = new[] { "Game.Core.Primitives", "Game.ModApi" },
```

断言用的是 `Is.EqualTo`（严格数组相等，不是 `Contains`），所以给 `Game.ModApi` 加**任何**一条引用都会让这个测试红。

**Mod 作者的视角**：

```
Mod 程序集 (作者写的 DLL)
    │
    │ 引用
    ↓
Game.ModApi.dll       ← 唯一依赖
Game.Core.Primitives.dll   ← 唯一依赖

（编译时用 SDK 里的这两个 DLL，运行时由 HybridCLR 加载）
```

**Mod 作者拿不到**：
- ❌ `Game.Core.Context.*`（fiber registry、依赖解析）
- ❌ `Game.Core.Networking.*`（NGO 桥）
- ❌ `Game.Core.Persistence.*`（存档）
- ❌ `Game.Core.HotUpdate.*`（HybridCLR 加载）
- ❌ `Game.Bootstrap.*`（VContainer scope）
- ❌ `Game.Framework.Editor`（框架开发工具）
- ❌ `Game.Framework.Conformance`（测试夹具）

---

## 1. 11 个 spec 子命名空间 vs 4 个已实现

spec 第 11.1 节的命名空间策略：

```text
Game.ModApi
  Lifecycle         ← ✅ 已实现
  Capabilities      ← ✅ 已实现
  Content         ← ⏳ 空目录
  UI             ← ⏳ 空目录
  Input          ← ⏳ 空目录
  Storage        ← ⏳ 空目录
  Networking     ← ⏳ 空目录
  Diagnostics      ← ✅ 已实现（2 文件）
  AI             ← ⏳ 空目录
  Packaging      ← ⏳ 空目录
  Versioning        ← ✅ 已实现（1 文件）
```

**为什么先实现 4 个**——它们是 **Module 加载生命周期 + 能力声明 + 版本**这条最小链路上必需的：

| 子命名空间 | 用途 | 没有它会怎样 |
|---|---|---|
| Lifecycle | `IModule.ActivateAsync/DeactivateAsync` | Mod 根本无法被加载 |
| Capabilities | `CapabilityRequirement/Provision` | 依赖解析无法工作 |
| Versioning | `ModuleVersion` | 无法判断 Mod 升级是否兼容 |
| Diagnostics | `IModuleDiagnostics` | Mod 出错时无法报告 |

**Content / UI / Input / Storage / Networking / AI / Packaging** 都是**领域相关**的接口——spec 说 "genre-neutral contracts"，等具体产品类型确定后再设计（避免预先承诺超出当前需要的 API surface）。

---

## 2. 公共类型清单（spec 硬约束）

**测试 `ModApiShapeTests.cs` 锁定了 11 个 required public types**：

```csharp
static readonly string[] RequiredPublicTypes =
{
    "Game.ModApi.Versioning.ModuleVersion",
    "Game.ModApi.Capabilities.CapabilityVersion",
    "Game.ModApi.Capabilities.CapabilityRequirement",
    "Game.ModApi.Capabilities.CapabilityProvision",
    "Game.ModApi.Lifecycle.ModuleDescriptor",
    "Game.ModApi.Lifecycle.ModuleOperationError",
    "Game.ModApi.Lifecycle.ModuleOperationResult",
    "Game.ModApi.Lifecycle.IModule",
    "Game.ModApi.Lifecycle.IModuleContext",
    "Game.ModApi.Diagnostics.ModuleDiagnostic",
    "Game.ModApi.Diagnostics.IModuleDiagnostics",
};

[TestCaseSource(nameof(RequiredPublicTypes))]
public void Required_public_contract_type_exists(string fullName)
{
    var assembly = AppDomain.CurrentDomain
        .GetAssemblies()
        .Single(candidate => candidate.GetName().Name == "Game.ModApi");

    var type = assembly.GetType(fullName, throwOnError: false);
    Assert.That(type, Is.Not.Null, $"Required Phase 1 Mod API type is missing: {fullName}");
    Assert.That(type.IsPublic || type.IsNestedPublic, Is.True, $"Required Mod API type is not public: {fullName}");
}
```

**测试用反射 + `Single` 锁定**——如果将来有人误改 public → internal，这 11 个测试立刻全红。

**这是非常强的契约保护**——任何一个改名/改可见性的 PR 都会被 CI 拦截。

---

## 3. Lifecycle 命名空间 — Mod 的入口

**文件**：`Lifecycle/IModule.cs` (26 行)

### 3.1 IModule 接口

```csharp
/// <summary>
/// Public module lifecycle contract. A future Context Runtime owns calls, ordering, cancellation, and context lifetime.
/// Implementations run on the Unity main thread unless a future contract explicitly states otherwise.
/// </summary>
public interface IModule
{
    ModuleDescriptor Descriptor { get; }
    Task<ModuleOperationResult> ActivateAsync(IModuleContext context, CancellationToken cancellationToken);
    Task<ModuleOperationResult> DeactivateAsync(CancellationToken cancellationToken);
}
```

**3 个关键设计点**：

#### (a) "A future Context Runtime owns..."

**当前 Context Runtime 还没实现**——IModule 接口只定义了"Mod 怎么被调用"，**没定义**"被谁调用、按什么顺序、被谁取消"。这就是 spec 第 10.4 节 Context Runtime 要做的事。

**接口仍然先定**——这样 Context Runtime 实现时，**接口是稳定的契约**。

#### (b) "Implementations run on the Unity main thread"

**Mod 作者被告知**——他们的 `ActivateAsync` 主体必须在 Unity 主线程跑。这与 Bootstrap 里 `ApplicationLifecycleCoordinator` / `Session` 的主线程守门**对偶**——两边都强制 main-thread-only。

#### (c) 两个方法的"不对称"

```csharp
Task<ModuleOperationResult> ActivateAsync(IModuleContext context, CancellationToken cancellationToken);
Task<ModuleOperationResult> DeactivateAsync(CancellationToken cancellationToken);
```

**`ActivateAsync` 收 `IModuleContext`**——因为激活时需要"我能注册能力、订阅事件、发诊断"的能力。
**`DeactivateAsync` 不收**——因为上下文在 deactivation 时已经 invalidate 了（spec 第 10.6 节："Logical unload"）：

> /// Implementations must not retain the context after deactivation.

**如果 Mod 想要 deactivate 之后还能报告诊断**——必须用 Mod 自己保存的 reference，**不能再用 context.Diagnostics**。

### 3.2 IModuleContext 接口

```csharp
public interface IModuleContext
{
    ModuleId ModuleId { get; }
    IModuleDiagnostics Diagnostics { get; }
}
```

**只有 2 个属性**——**没有 service locator、没有 capability 注册、没有事件总线**。

**这是故意的**——spec 第 6 节："Context-mediated effects return inverses or disposable handles"。

**如果 Mod 想注册能力**——它应该通过 Context Runtime 提供的注册方法，而**不是**通过 `IModuleContext` 拿一个万能解析器。**当前接口没有暴露任何注册方法**，因为 Context Runtime 还没实现。

⚠️ **但未来加的那个方法不可能是泛型的。** 见本篇 §7 引用的那条测试：

```csharp
// PublicApiSurfaceTests.cs:67
Assert.That(methods.Any(m => m.IsGenericMethod), Is.False);   // 禁止一切泛型方法
```

所以形态只能是：

```csharp
// 推测形状，当前代码库中不存在
IDisposable RegisterCapability(CapabilityKey key, CapabilityVersion version, object provider);
```

返回 `IDisposable` 对应 spec 第 6 节原则 5："Context-mediated effects return inverses or disposable handles and are recovered in LIFO order."——注册拿到句柄，卸载 fiber 时逆序释放。类型安全由单独打包的**契约程序集**（spec §8.5）承担，不由泛型参数承担。

**`Diagnostics` 字段让 Mod 发诊断**——但具体怎么路由到 `DiagnosticRouter`，由 Context Runtime 决定（通过 `Bootstrap/ModuleDiagnosticsAdapter.cs` 里的实现）。

### 3.3 IModuleContext 的生命周期

```csharp
/// <summary>
/// Activation-scoped public context. The future Context Runtime owns its lifetime and calls it on the Unity main thread.
/// It exposes no unrestricted service resolution and becomes invalid after deactivation completes.
/// </summary>
```

**3 个生命周期约束**：
1. **作用域**：仅在 activation 期间有效
2. **线程**：只能在主线程上用
3. **失效**：deactivation 后失效（虽然 C# 不能强制）

**"becomes invalid"**——C# 没有"接口生命周期"概念。spec 的保证是**契约式**的（"Mod 作者承诺不这么用"），不是技术上的（运行时检查）。

**未来可能的 enforcement**：Context Runtime 可以在 `ActivateAsync` 调用前构造新 context、`DeactivateAsync` 调用后 dispose context——但**Mod 仍可能持有引用**。所以**文档约束**+**测试断言**（不在 ModApi shape test 里，因为接口行为）就够了。

---

## 4. ModuleDescriptor — 不可变 + 防御性 ToArray

**文件**：`Lifecycle/ModuleDescriptor.cs` (47 行)

### 4.1 完整代码

```csharp
public sealed class ModuleDescriptor
{
    public ModuleDescriptor(
        ModuleId id,
        ModuleVersion version,
        IEnumerable<CapabilityRequirement> requiredCapabilities = null,
        IEnumerable<CapabilityRequirement> optionalCapabilities = null,
        IEnumerable<CapabilityProvision> providedCapabilities = null)
    {
        if (!id.IsValid) throw new ArgumentException("Module descriptor ID must be valid.", nameof(id));
        if (!version.IsValid) throw new ArgumentException("Module descriptor version must be valid.", nameof(version));
        Id = id;
        Version = version;
        var required = requiredCapabilities?.ToArray() ?? Array.Empty<CapabilityRequirement>();
        var optional = optionalCapabilities?.ToArray() ?? Array.Empty<CapabilityRequirement>();
        var provided = providedCapabilities?.ToArray() ?? Array.Empty<CapabilityProvision>();
        if (required.Any(value => !value.IsValid)) throw new ArgumentException("Required capability declarations must be valid.", nameof(requiredCapabilities));
        if (optional.Any(value => !value.IsValid)) throw new ArgumentException("Optional capability declarations must be valid.", nameof(optionalCapabilities));
        if (provided.Any(value => !value.IsValid)) throw new ArgumentException("Provided capability declarations must be valid.", nameof(providedCapabilities));
        RequiredCapabilities = Array.AsReadOnly(required);
        OptionalCapabilities = Array.AsReadOnly(optional);
        ProvidedCapabilities = Array.AsReadOnly(provided);
    }

    public ModuleId Id { get; }
    public ModuleVersion Version { get; }
    public IReadOnlyList<CapabilityRequirement> RequiredCapabilities { get; }
    public IReadOnlyList<CapabilityRequirement> OptionalCapabilities { get; }
    public IReadOnlyList<CapabilityProvision> ProvidedCapabilities { get; }
}
```

### 4.2 5 个不变量

1. **`id.IsValid` + `version.IsValid`** —— 构造时强制验证
2. **3 个能力集合都 `ToArray` 拷贝** —— 防止外部修改
3. **`Any(value => !value.IsValid)` 验证** —— 不放过单个无效元素
4. **`Array.AsReadOnly(...)`** —— 暴露 `IReadOnlyList<T>` 但**底层是数组**（避免装箱）
5. **`null` → `Array.Empty<T>()`** —— 调用者不需要 null check

### 4.3 `IReadOnlyList<T>` vs `IReadOnlyCollection<T>`

```csharp
public IReadOnlyList<CapabilityRequirement> RequiredCapabilities { get; }  // ← 用 IList，不是 ICollection
```

**为什么是 `IReadOnlyList` 而不是 `IReadOnlyCollection`？** 因为后者只允许 `Count` 和 `foreach`，前者还允许 `this[int index]`。**Mod 可能要按 index 访问能力声明**（比如"我要第 3 个 required capability"），所以 `IReadOnlyList` 更友好。

### 4.4 防御性拷贝的测试

```csharp
var required = new[] { new CapabilityRequirement(CapabilityKey.Parse("test.required"), CapabilityVersion.Parse("1.0.0")) };
// ...
var descriptor = new ModuleDescriptor(..., required, optional, provided);

required[0] = new CapabilityRequirement(CapabilityKey.Parse("test.changed"), CapabilityVersion.Parse("2.0.0"));  // ← 改外部数组！

Assert.That(descriptor.RequiredCapabilities[0].Key.ToString(), Is.EqualTo("test.required"));  // ← 不受影响
```

**`ToArray()` 的双重作用**：
1. 拷贝数组 → 防止外部修改
2. 拷贝元素 → 但因为 `CapabilityRequirement` 是 readonly struct，**元素本身不可变**——所以元素拷贝其实只是数组层面的保护

### 4.5 三种能力的语义

| 字段 | 用途 | spec 章节 |
|---|---|---|
| `RequiredCapabilities` | "必须 resolve 才能激活" | 10.5 "Dependency Reactivity" |
| `OptionalCapabilities` | "如果没 resolve 也能激活" | — |
| `ProvidedCapabilities` | "我激活后会提供这些能力" | 10.5 |

**为什么区分 Required 和 Optional？**

```csharp
// 示例：一个游戏内 Mod
public ModuleDescriptor Descriptor => new ModuleDescriptor(
    "auth.discord-login",                                  // id
    ModuleVersion.Parse("1.0.0"),
    requiredCapabilities: new[] {                          // ← 必须有 Discord API
        new CapabilityRequirement("platform.oauth", CapabilityVersion.Parse("1.x"))
    },
    optionalCapabilities: new[] {                         // ← 有就用，没有也行
        new CapabilityRequirement("ui.notification", CapabilityVersion.Parse("1.x"))
    },
    providedCapabilities: new[] {                          // ← 我提供 OAuth UI
        new CapabilityProvision("ui.oauth-discord", CapabilityVersion.Parse("1.0.0"))
    }
);
```

**Activation gate**（spec 10.5）：
1. 解析所有 `RequiredCapabilities` → **都成功**才允许激活
2. 解析 `OptionalCapabilities` → **成功或不存在**都行
3. 解析完后才能看到 `ProvidedCapabilities` 中的 capability keys 在 registry 里出现

---

## 5. Capability 命名空间 — 依赖声明

**文件**：`Capabilities/CapabilityContracts.cs` (118 行)

### 5.1 三个类型

```csharp
public readonly struct CapabilityVersion : IEquatable<CapabilityVersion>, IComparable<CapabilityVersion>
{
    public CapabilityVersion(SemanticVersion value) { ... }
    // ... Parse/TryParse/ComparePrecedenceTo/CompareTo/Equals/GetHashCode
}

public readonly struct CapabilityRequirement : IEquatable<CapabilityRequirement>
{
    public CapabilityRequirement(CapabilityKey key, CapabilityVersion version) { ... }
    public CapabilityKey Key { get; }
    public CapabilityVersion Version { get; }
}

public readonly struct CapabilityProvision : IEquatable<CapabilityProvision>
{
    public CapabilityProvision(CapabilityKey key, CapabilityVersion version) { ... }
    public CapabilityKey Key { get; }
    public CapabilityVersion Version { get; }
}
```

**3 个 readonly struct**，实现完全一样的模式（验证 + IEquatable + GetHashCode）。

### 5.2 为什么有 `CapabilityVersion` 而不只是用 `SemanticVersion`？

**类型安全 + 意图明确**：

```csharp
// ❌ 没有专门类型
void RegisterCapability(SemanticVersion version)  // 不清楚这个 SemVer 表示什么

// ✅ 有专门类型
void RegisterCapability(CapabilityVersion version)  // 一眼看出是"能力版本"
```

**更精细的好处**：未来 `CapabilityVersion` 可以加额外验证（比如"必须是 X.Y.0 形式"或"必须 ≥ 1.0.0"），而不污染 `SemanticVersion`。

### 5.3 为什么 Requirement 和 Provision 分开两个类型？

**理论上它们的形状完全一样**——`(CapabilityKey, CapabilityVersion)` 对。为什么要分？

```csharp
public readonly struct CapabilityRequirement { ... }
public readonly struct CapabilityProvision { ... }
```

**3 个好处**：

#### (a) 意图清晰

```csharp
descriptor.RequiredCapabilities.Add(new CapabilityRequirement(...));  // ← 一眼看出是"声明需求"
descriptor.ProvidedCapabilities.Add(new CapabilityProvision(...));    // ← 一眼看出是"声明提供"
```

#### (b) 防止混用

```csharp
// 类型系统阻止这种错误：
descriptor.RequiredCapabilities.Add(new CapabilityProvision(...));  // ← 编译错误
```

#### (c) 未来可扩展

```csharp
// 未来 Requirement 可以加额外字段
public readonly struct CapabilityRequirement
{
    public CapabilityKey Key { get; }
    public CapabilityVersion Version { get; }
    public bool IsOptional { get; }   // ← 新字段
    public string ReasonIfMissing { get; }  // ← 错误信息
}
```

**而 Provision 可以保持不变**——扩展不会波及其他类型。

### 5.4 Requirement / Provision 是 readonly struct 而不是 class

**两个好处**：
1. **零分配**——AOT 友好，IL2CPP 友好
2. **隐式不可变**——编译器层面保证 `Key`/`Version` 不能改

**Hash code 计算**：

```csharp
public override int GetHashCode() => unchecked((Key.GetHashCode() * 397) ^ Version.GetHashCode());
```

**397 是 ReSharper 推荐的"hash combine"质数**（`<= 65536`），`^` 是 XOR——**简单、稳定、跨进程一致**（与 `StableStringHash.Combine` 同源）。

---

## 6. Versioning 命名空间 — Module 版本

**文件**：`Versioning/ModuleVersion.cs` (70 行)

### 6.1 与 Primitives 的 SemanticVersion / ModApiVersion 对比

```csharp
// Primitives/SemanticVersion.cs（已经讲过）
public readonly struct SemanticVersion : IEquatable<SemanticVersion>, IComparable<SemanticVersion>
public readonly struct ModApiVersion : ...  // 包 SemanticVersion
public readonly struct NetworkProtocolVersion : ...  // 正整数
public readonly struct ContentCompatibilityVersion : ...  // 正整数

// ModApi/Versioning/ModuleVersion.cs
public readonly struct ModuleVersion : IEquatable<ModuleVersion>, IComparable<ModuleVersion>
```

**4 个版本类型**：
| 类型 | 用途 | 验证规则 |
|---|---|---|
| `SemanticVersion` | 通用 SemVer | 完整 SemVer 2.0.0 |
| `ModApiVersion` | 框架的 Mod API 版本 | 包 SemVer |
| `NetworkProtocolVersion` | 网络协议版本 | 正整数 |
| `ContentCompatibilityVersion` | 内容兼容性版本 | 正整数 |
| `ModuleVersion` | 单个 Mod 的发布版本 | 包 SemVer |

**为什么需要这么多类型**？——**类型系统是 spec 的执行者**：

```csharp
// 编译错误：ModVersion 不能传给 NetworkProtocolVersion
void ConfigureModule(ModuleVersion modVersion, NetworkProtocolVersion netVersion);

// 编译错误：ModApiVersion 和 ModuleVersion 不能混
bool IsCompatible(ModApiVersion framework, ModuleVersion module);  // ← 强制传对类型
```

### 6.2 ModuleVersion 是 wrapper

```csharp
public ModuleVersion(SemanticVersion value)
{
    if (!value.IsValid) throw new ArgumentException("ModuleVersion requires a valid SemanticVersion.", nameof(value));
    Value = value;
}
public SemanticVersion Value { get; }
```

**整个类型就是 `SemanticVersion` 的强类型包装**——这是 [Primitive Obsession](https://blog.ploeh.dk/2011/04/26/PrimitiveObsession/) 反模式的解药。

---

## 7. ModuleOperationResult — 不抛异常，规范化失败

**文件**：`Lifecycle/ModuleOperationResult.cs` (65 行)

### 7.1 设计动机

```csharp
/// <summary>
/// Represents a completed public module lifecycle operation without leaking private exceptions.
/// </summary>
public readonly struct ModuleOperationResult
```

**关键短语**："without leaking private exceptions"——**Mod 抛 `InvalidCastException` 不能跨边界漏出来**。

### 7.2 `Success()` vs `Failure(error)`

```csharp
public static ModuleOperationResult Success() => new ModuleOperationResult(true, null);
public static ModuleOperationResult Failure(ModuleOperationError error)
{
    if (!error.IsValid) throw new ArgumentException("Module operation failure requires a valid normalized error.", nameof(error));
    return new ModuleOperationResult(false, error);
}
```

**3 条不变量**：
1. **`Success` 必须 `Error == null`**（由 `IsValid` 强制）
2. **`Failure` 必须 `Error.IsValid == true`**（由 `IsValid` 强制）
3. **`default(ModuleOperationResult).IsValid == false`**（无默认成功）

```csharp
public bool IsValid => initialized && (Succeeded ? !Error.HasValue : Error.HasValue && Error.Value.IsValid);
```

**这是"完备性"验证**——`Succeeded == true` 时 `Error` 必须 null；`Succeeded == false` 时 `Error` 必须 valid。

### 7.3 `ModuleOperationError` — "safe caller-facing"

```csharp
public ModuleOperationError(string code, string message)
{
    if (!DiagnosticEventName.TryParse(code, out _))
        throw new ArgumentException("Module operation error code must be a canonical lowercase dot-separated identifier.", nameof(code));
    if (string.IsNullOrWhiteSpace(message))
        throw new ArgumentException("Module operation error message must be non-empty.", nameof(message));
    Code = code;
    Message = message;
    initialized = true;
}
```

**故意不带 `Exception` 字段**——这是"跨边界 safe message"设计：

```csharp
// Mod 内部抛：
throw new FileNotFoundException("C:/Users/Admin/AppData/Local/.../auth.dll");

// 跨边界给 framework 应该是：
new ModuleOperationError(
    "module.activation-failed",
    "Failed to load required assembly");  // ← 不要泄露路径！
```

**测试断言**：

```csharp
Assert.That(() => new ModuleOperationError("invalid", "message"), Throws.ArgumentException);
Assert.That(() => new ModuleOperationError("module.error", ""), Throws.ArgumentException);
```

**`"invalid"` 不是 namespaced identifier** → reject。**`""` 空消息** → reject。

### 7.4 为什么 code 是 `string` 而不是 `DiagnosticEventName`？

```csharp
public string Code { get; }   // ← string，不是 DiagnosticEventName
```

**两个原因**：
1. **`string` 在 ModApi 里没暴露 `DiagnosticEventName` 类型**——避免循环引用
2. **运行时验证**：构造时 `DiagnosticEventName.TryParse(code, out _)` 确保格式正确，但**只存 string**——Mod 作者不需要 import DiagnosticEventName

**测试**：

```csharp
Assert.That(() => new ModuleOperationError("module.error", ""), Throws.ArgumentException);
// ↑ "module.error" 是合法 namespaced identifier，但 message 空 → 拒绝
```

### 7.5 `ModuleOperationResult` 不是 `Result<T>`

**spec 6.4 节"Recoverable composition"提到用 `IDisposable` 句柄**——但 ModApi 没有暴露 `Result<T>`（带成功值的 Result）：

```csharp
// 假设的失败：
// new ModuleOperationResult.Success<int>(returnValue);  ← 没这个 API
```

**为什么？** 因为 `ActivateAsync` 的"成功"没有值——激活要么成功要么失败。**返回 `ModuleOperationResult` 本身**就够了。

**未来 `GetCapability<T>(key)` 这种"读"操作**——可能用 `Result<T>`。但现在 spec 没要求。

---

## 8. Diagnostics — Mod 报告错误的渠道

**文件**：`Diagnostics/IModuleDiagnostics.cs` (11 行) + `Diagnostics/ModuleDiagnostic.cs` (54 行)

### 8.1 接口

```csharp
public interface IModuleDiagnostics
{
    /// <summary>Reports one immutable diagnostic value; invalid values throw before private routing occurs.</summary>
    void Report(ModuleDiagnostic diagnostic);
}
```

**故意只有一个方法**——`Report`。

**故意是同步方法**——`void Report(...)` 而不是 `Task ReportAsync(...)`。

**为什么同步？** 因为诊断是"控制面"事件——本质上是 fire-and-forget。如果做成 async，要么诊断 send 会被 IO 阻塞（违背 main-thread 守门），要么要做 queue（增加复杂度）。

### 8.2 ModuleDiagnostic 构造

```csharp
public ModuleDiagnostic(
    DiagnosticSeverity severity,
    DiagnosticEventName name,
    CorrelationId correlationId,
    FiberId? fiberId = null,
    LifecycleEpisodeId? lifecycleEpisodeId = null,
    CapabilityKey? capabilityKey = null,
    DiagnosticAttributeSet attributes = null,
    DiagnosticError? error = null)
```

**对比 `Game.Core.Primitives.DiagnosticEvent`**：

| 字段 | `DiagnosticEvent` (Primitives) | `ModuleDiagnostic` (ModApi) |
|---|---|---|
| `timestamp` | ✅ 调用方填 | ❌ 由 adapter 填（用 `DiagnosticEventFactory`） |
| `severity` | ✅ | ✅ |
| `name` | ✅ | ✅ |
| `correlationId` | ✅ | ✅ |
| `sessionId` | ✅ 可选 | ❌ **由 adapter 自动注入** |
| `moduleId` | ✅ 可选 | ❌ **由 adapter 自动注入** |
| `fiberId` | ✅ 可选 | ✅ 可选（Mod 知道的） |
| `lifecycleEpisodeId` | ✅ 可选 | ✅ 可选 |
| `capabilityKey` | ✅ 可选 | ✅ 可选 |
| `attributes` | ✅ | ✅ |
| `error` | ✅ | ✅ |

**关键设计**：`sessionId` 和 `moduleId` **故意从 Mod 作者手里拿掉**。

### 8.3 为什么 ModuleDiagnostic 没有 sessionId/moduleId？

**故意防"假冒"**——看测试：

```csharp
[Test]
public void Module_diagnostic_validates_public_values_without_module_or_session_spoofing()
{
    // ...
    Assert.That(() => new ModuleDiagnostic(DiagnosticSeverity.Information, default, CorrelationId.New()), Throws.ArgumentException);
    Assert.That(() => new ModuleDiagnostic(DiagnosticSeverity.Information, DiagnosticEventName.Parse("module.event"), default), Throws.ArgumentException);
}
```

**测试名直接说**：`without_module_or_session_spoofing`——**Mod 不能给自己打别人的 SessionId**。

**注入点在 `Bootstrap/ModuleDiagnosticsAdapter.cs`**：

```csharp
public void Report(ModuleDiagnostic diagnostic)
{
    if (diagnostic == null) throw new System.ArgumentNullException(nameof(diagnostic));
    router.Emit(eventFactory.Create(
        diagnostic.Severity,
        diagnostic.Name,
        diagnostic.CorrelationId,
        sessionId,                       // ← 由 factory 注入
        moduleId,                        // ← 由 factory 注入
        diagnostic.FiberId,
        diagnostic.LifecycleEpisodeId,
        diagnostic.CapabilityKey,
        diagnostic.Attributes,
        diagnostic.Error));
}
```

**`sessionId` 和 `moduleId` 是闭包变量**——`ModuleDiagnosticsAdapterFactory.Create(moduleId, sessionId)` 时捕获，**Mod 拿不到这两个参数**。

### 8.4 Activation-scoped 语义

```csharp
/// <summary>
/// Activation-scoped diagnostic facade owned by the future Context Runtime.
/// Calls are synchronous and may occur only while its module context is valid.
/// </summary>
```

**"may occur only while its module context is valid"** — Mod 在 deactivate 之后**不应该**再调用 `Diagnostics.Report`。但这是**契约式**约束，不是技术性约束。

**测试**：

```csharp
Assert.That(() => new ModuleDiagnostic(DiagnosticSeverity.Information, default, CorrelationId.New()), Throws.ArgumentException);
```

**`default(DiagnosticEventName)` 不可用**——所以 `Report` 永远不会被错误数据成功发出。

---

## 9. Conformance — 中性 Mod 夹具

**文件**：`Conformance/NeutralModuleFixture.cs` (39 行)

```csharp
public sealed class NeutralModuleFixture : IModule
{
    public NeutralModuleFixture()
    {
        Descriptor = new ModuleDescriptor(
            ModuleId.Parse("test.module"),
            ModuleVersion.Parse("0.1.0"),
            new[] { new CapabilityRequirement(CapabilityKey.Parse("test.required"), CapabilityVersion.Parse("1.0.0")) },
            new[] { new CapabilityRequirement(CapabilityKey.Parse("test.optional"), CapabilityVersion.Parse("1.0.0")) },
            new[] { new CapabilityProvision(CapabilityKey.Parse("test.provided"), CapabilityVersion.Parse("1.0.0")) });
    }

    public ModuleDescriptor Descriptor { get; }
    public IModuleContext LastContext { get; private set; }

    public Task<ModuleOperationResult> ActivateAsync(IModuleContext context, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        LastContext = context;
        return Task.FromResult(ModuleOperationResult.Success());
    }

    public Task<ModuleOperationResult> DeactivateAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ModuleOperationResult.Success());
    }
}
```

**这是一个**故意合成的中性 Mod**——spec 第 1 节：

> The framework deliverable intentionally contains no genre implementation, gameplay skeleton, official gameplay mod, or community mod. Its behavior is validated by internal synthetic conformance fixtures that exercise lifecycle, dependency, networking, persistence, package, and hot-loading contracts without representing a game genre or shipping as player content.

**`NeutralModuleFixture` 不代表任何游戏类型**——它只是**证明合约的形状是对的**。

**为什么需要这个？** 因为 `Game.ModApi` **不依赖** Context Runtime，所以测试**不能**走完整的"加载 Mod → 激活 → 看效果"流程。**只能**断言：
- 编译能过（11 个 public 类型存在）
- 构造不抛（验证字段 OK）
- `IModule` 能被实例化、能被 activate/deactivate

**测试**：

```csharp
[Test]
public async Task Neutral_fixture_expresses_lifecycle_capabilities_context_and_cancellation()
{
    var fixture = new NeutralModuleFixture();
    var diagnostics = new RecordingModuleDiagnostics();
    var context = new TestModuleContext(fixture.Descriptor.Id, diagnostics);

    var activation = await fixture.ActivateAsync(context, CancellationToken.None);
    var deactivation = await fixture.DeactivateAsync(CancellationToken.None);

    Assert.That(activation.Succeeded, Is.True);
    Assert.That(deactivation.Succeeded, Is.True);
    Assert.That(fixture.LastContext, Is.SameAs(context));
    // ...
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();
    Assert.That(
        async () => await fixture.ActivateAsync(context, cancellation.Token),
        Throws.InstanceOf<OperationCanceledException>());
}
```

**`ActivateAsync` 应该 propagate `OperationCanceledException`**——而不是吞掉 cancel 转成 failure。这与 spec 10.5 节一致："Cyclic required dependencies remain inactive and produce a diagnosable dependency-cycle error"——**cancel 是用户主动操作，不是 failure**。

---

## 10. 测试密度

| 测试 | 数量 | 覆盖 |
|---|---|---|
| `ModApiShapeTests` | 11 | 反射验证 11 个 public 类型存在 |
| `ModApiContractTests` | 5 | 验证不变量、neutral fixture |
| `CompatibilityTests`（Primitives）| 多 | 已覆盖 ModuleVersion 的 SemVer 行为 |

**11 + 5 = 16 个 ModApi 测试**——**400 行实现 vs 200 行测试**（比例 2:1）。密度合理。

---

## 11. 与 spec 的对照

| spec 章节 | ModApi 实现 |
|---|---|
| 10.1 Module Specification（id/version/required/optional/provided/permissions）| `ModuleDescriptor` 部分实现（**权限还没加**） |
| 10.2 Fiber State | **未实现**（Context Runtime 未实现） |
| 10.3 Lifecycle States | `IModule.ActivateAsync/DeactivateAsync`（**底层状态机未实现**） |
| 10.5 Dependency Reactivity | `CapabilityRequirement/Provision` 字段已就位，**resolution 算法未实现** |
| 11.2 Stable Contracts | **11 个公共类型**全部 `public`，无 internal 泄漏 |
| 11.5 Activation Contracts | `ModuleOperationResult` + `ModuleOperationError` 已就位 |
| 11.6 Capability Contracts | `CapabilityVersion/Requirement/Provision` 已就位 |
| 11.11 Lifecycle Contracts | `IModule` 接口已就位 |
| 11.12 Diagnostic Contracts | `IModuleDiagnostics` + `ModuleDiagnostic` 已就位 |

**ModApi 是 Phase 1 的"契约面"**——数据结构 100% 就位，**算法（依赖解析、状态机、lifecycle 调度）都在 Context Runtime 的 plan 里**。

---

## 12. 我对 ModApi 的整体评价

### 优点

1. **极简的公共 surface**——11 个类型，没有过度设计
2. **类型系统执行 spec**——`CapabilityRequirement` ≠ `CapabilityProvision`、`ModuleVersion` ≠ `ModApiVersion`
3. **防御性拷贝**——`ModuleDescriptor` 不暴露内部数组
4. **构造时验证**——所有 readonly struct 都有 `IsValid` 检查
5. **"safe caller-facing"错误模型**——`ModuleOperationError` 不暴露内部异常
6. **反"假冒"设计**——ModDiagnostic 没有 sessionId/moduleId
7. **测试守门**——`ModApiShapeTests` 用反射 + Single 锁定 11 个 public 类型

### 局限与可改进点

1. **`ModuleDescriptor` 没有 `permissions` 字段**——spec 第 10.1 节列了，但当前未实现。后续 Context Runtime 实现时再加。
2. **`CapabilityRequirement` 没有"可选"标记**——当前通过 `RequiredCapabilities` vs `OptionalCapabilities` 区分，没有 `CapabilityRequirement.IsOptional`。当前够用，但如果有"required-or-optional-with-reason"语义时需要扩展。
3. **`IModuleContext` 接口故意薄**——未来加注册方法时**接口会变**，是 breaking change。spec 第 11.4 节的兼容性策略（同一 major 内只能加不能改）会要求这类扩展落在新的 major，或通过新增接口而非修改现有接口来做。
4. **没有能力查询方法**——Context Runtime 实现时必然要加，但签名受两条硬约束夹逼：**(a)** 不能是泛型方法（`Module_context_is_not_an_unrestricted_service_locator`）；**(b)** 不能返回私有实现类型（`Public_mod_api_signatures_use_only_BCL_and_public_contract_types` 的白名单）。剩下的自由度只有"同步还是异步"、"`bool TryGet(..., out object)` 还是 `ModuleOperationResult`"。**约束越紧，设计空间越小，这反而是好事**——它意味着这个 API 的形状基本已经被前面的决策锁定了，不会在实现时被随意发挥。
5. **`ModuleOperationResult` 没有 `T value`**——读操作（"读 capability 值"）需要 `Result<T>`。当前没必要，先放着。

### 可借鉴的设计模式

| 模式 | 适用 | 学习难度 |
|---|---|---|
| 类型化语义包装（`ModuleVersion`、`CapabilityVersion`）| 任何有"多种同形类型"的场景 | 🟢 简单 |
| `Result<T>` + 安全错误模型 | 跨信任边界（Mod ↔ Kernel） | 🟡 中等 |
| readonly struct + 不可变集合 | 高频创建、低频修改的数据 | 🟢 简单 |
| 反射 + `[TestCaseSource]` 锁定 API surface | 任何"必须保留的公共类型" | 🟢 简单 |
| "无 X 字段"防止假冒 | 跨信任边界的诊断/审计 | 🟡 中等 |

---

## 13. 关键 takeaway

读完 ModApi，最大的认知收获：

> **"Stable contracts, replaceable implementations" 的"稳定"是字面意思**——这 11 个 public 类型一旦发布就是契约。

具体到这个项目：
- **Phase 1 完成度**：100% 数据结构 + 0% 算法（Context Runtime 是算法层）
- **类型系统是 spec 的执行者**——编译期就拦住"用错版本"或"用错 capability 类型"
- **跨信任边界要"safe message"**——`ModuleOperationError` 不带 Exception，避免泄露内部状态

这套模式可以应用到：
- **插件系统**（VSCode extensions、Sublime packages）
- **微服务 SDK**（client 调用 server，要 safe error）
- **第三方集成**（OAuth 提供商、支付网关）

---

## 14. 与 Bootstrap 的连接点

**ModApi 与 Bootstrap 通过 `ModuleDiagnosticsAdapter` 连接**：

```
Mod (user code)
    ↓ IModuleDiagnostics.Report(diagnostic)
ModuleDiagnosticsAdapter (private, in Bootstrap)
    ↓ DiagnosticRouter.Emit(event)
UnityConsoleDiagnosticSink → Debug.Log(...)
```

**Mod 写诊断 → adapter 注入 moduleId/sessionId → 路由到 sink**

**当前实现**：adapter 已经在 `Bootstrap/ModuleDiagnosticsAdapter.cs`（59 行），但 **Context Runtime 未实现**，所以 **adapter factory**（`ModuleDiagnosticsAdapterFactory`）被注册但**没人调用**。

等 Context Runtime 实现时：
1. 每个激活的 Mod 会拿到一个绑定的 `IModuleDiagnostics`（实际是 `ModuleDiagnosticsAdapter`）
2. Mod 调 `Report(diagnostic)` → adapter 注入 moduleId + sessionId → 路由

---

## 参考链接

- [Primitive Obsession 反模式](https://blog.ploeh.dk/2011/04/26/PrimitiveObsession/)
- [Result 类型（C# 讨论）](https://github.com/microsoft/vs-threading/blob/master/doc/issuepatterns.md)
- Spec 第 6 节原则 1 "Stable contracts, replaceable implementations" —— 见 `docs/superpowers/specs/2026-08-19-modular-game-harness-design.md`；概念背景参考 [Design by contract](https://en.wikipedia.org/wiki/Design_by_contract)
- [.NET `IReadOnlyList<T>` vs `IReadOnlyCollection<T>`](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.ireadonlylist-1)
- [Reflection in .NET test fixtures](https://learn.microsoft.com/en-us/dotnet/api/system.reflection)

---

**下一步**：读 [架构守门笔记](./05-Architecture-Enforcement.md)，看依赖规则怎么用**代码**强制（Architecture Tests + PublicApiSurface Tests）。

---

## 附：本篇的勘误与延伸

本篇是 8 篇里事实密度最高、错误最少的之一；审查只发现两处，均在 §0：依赖图的注解方向写反了（写成 "Context 不依赖 ModApi"，实际相反），以及 spec 小节号错位（第 6 节是扁平列表，无 6.1）。均已就地修正。证据见 [`00-Review-Report.md`](./00-Review-Report.md) §5.2、§4（D-3）。

**一个需要注意的连带影响**：`06-Mod-Distribution.md` §1.4 和 `08-Comparison-with-Bevy-ECS.md` §2 里曾出现 `context.RegisterCapability<IGameRules>(...)` / `ctx.GetCapability<T>(key)` 这类**泛型方法**形态的 API 推测。它们与本篇 §7 讲的那条约束直接冲突：

```csharp
// PublicApiSurfaceTests.cs:62-68
Assert.That(methods.Any(m => m.IsGenericMethod), Is.False);   // IModuleContext 上禁止一切泛型方法
```

未来的能力注册 API 只能是**非泛型**形态（`(CapabilityKey, CapabilityVersion, object)`），类型安全由单独打包的**契约程序集**（spec §8.5）承担，而不是由 `IModuleContext` 的泛型参数承担。这正是 capability 模型与 DI 容器的分野：DI 用 `Resolve<T>()`，`T` 就是契约；capability 用 `(key, version)` 二元组，契约由独立版本化的第三方程序集承载，于是"谁提供、谁消费、版本合不合"全都能写进 manifest 被机器检查。两篇的示例均已按此修正。

ModApi 层还有几个本篇未展开的实现要点，见 [`09-Implementation-Deep-Dives.md`](./09-Implementation-Deep-Dives.md)：

- **§1** `ModuleOperationError` / `ModuleOperationResult` 里那个 `readonly bool initialized` 哨兵为什么不可省——`default(ModuleOperationResult)` 的语义是"失败了但没说为什么"，必须被判定为无效
- **§2.4** `ModuleOperationResult` **完全没有实现相等性**，落到 `ValueType.Equals` 的反射路径（同文件里的 `ModuleOperationError` 却实现了，是全代码库唯一的例外）
- **§3.1** `ModuleOperationError.GetHashCode` 用的是 `StringComparer.Ordinal.GetHashCode` 而非 Primitives 的 FNV-1a——因为 `StableStringHash` 是 `internal`，ModApi 看不见它。这是"稳定哈希"承诺在程序集边界上唯一的断点
- **§6** `ModuleOperationResult` 这套"规格化错误契约"为什么优于直接抛 `AggregateException`