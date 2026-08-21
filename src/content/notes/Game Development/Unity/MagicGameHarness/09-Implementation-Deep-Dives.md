# Magic Game Harness — 实现思路深挖（补充篇）

> 本篇是 [`00-Review-Report.md`](./00-Review-Report.md) §7 列出的 14 个"漏掉的关键实现思路"的展开。
> 基准：`main` 分支 `1fe2010`。所有代码引用都带 `文件:行号`，可以直接跳过去核对。
> 定位：`02`~`05` 讲"这些代码做了什么"，本篇讲"**为什么必须这么写、不这么写会怎样、这个手法还能用在哪**"。

---

## 目录

1. [默认值即无效：三种实现手法及其边界](#1-默认值即无效三种实现手法及其边界)
2. [比较语义的完整矩阵——以及 `<` 的陷阱](#2-比较语义的完整矩阵以及--的陷阱)
3. [哈希的三层稳定性，以及它在程序集边界上断掉的地方](#3-哈希的三层稳定性以及它在程序集边界上断掉的地方)
4. [VContainer 装配逐行解剖](#4-vcontainer-装配逐行解剖)
5. [拒绝协议：三种姿势，一条规则](#5-拒绝协议三种姿势一条规则)
6. [失败账本模式：为什么不用 `AggregateException`](#6-失败账本模式为什么不用-aggregateexception)
7. [诊断管线的线程契约与所有权](#7-诊断管线的线程契约与所有权)
8. [asmdef 作为架构工具（而不只是编译单元）](#8-asmdef-作为架构工具而不只是编译单元)
9. [可执行的改进清单](#9-可执行的改进清单)

---

## 1. 默认值即无效：三种实现手法及其边界

`02` 把"`default(X).IsValid == false`"总结成了统一模式。但真正值得学的是：**这个模式在 C# 里有三种实现，各有各的适用边界**，而这份代码三种都用到了，且用得很准。

C# 的根本约束是：**你无法阻止别人写 `default(T)` 或 `new T[10]`**。struct 的私有构造函数只挡住 `new T(...)`，挡不住零值。所以"默认值必须无效"只能靠**让零值天然落在无效区**。

### 手法 A：靠引用类型字段的 `null`

```csharp
// Core/Primitives/NamespacedIdentifiers.cs:7-11
readonly string value;
ModuleId(string value) => this.value = value;
public bool IsValid => !string.IsNullOrEmpty(value);
```

`default(ModuleId)` → `value == null` → 无效。**零成本**，不占额外空间。

**适用**：内部状态是引用类型，且 `null` 不是合法值。`ModuleId`、`CapabilityKey`、`DiagnosticEventName`、`GameBuildId` 都走这条。

### 手法 B：靠值域天然排除零

```csharp
// Core/Primitives/RuntimeIdentifiers.cs:11
public bool IsValid => value != Guid.Empty;

// Core/Primitives/CompatibilityIdentifiers.cs:93
public bool IsValid => Value > 0;
```

`Guid.Empty` 全零、`0` 不是正整数——零值恰好落在无效区。也是零成本。

**注意 `RuntimeIdentifier.TryParse` 里那一行额外检查**：

```csharp
// Core/Primitives/RuntimeIdentifiers.cs:173
if (Guid.TryParseExact(text, "N", out value) && value != Guid.Empty)
```

`Guid.TryParseExact("00000000000000000000000000000000", "N", out g)` **会返回 `true`**，且 `g == Guid.Empty`。少了后半个条件，就能从字符串里解析出一个"解析成功但语义无效"的 `SessionId`——这是个真实的、很容易漏的坑。测试 `Runtime_identifier_parsers_reject_empty_and_non_guid_values` 守着它。

**适用**：数值/句柄类型，且业务上零值本来就非法。

### 手法 C：显式的 `readonly bool initialized` 哨兵

```csharp
// Core/Primitives/SemanticVersion.cs:23
readonly bool initialized;
```

**这是三种里唯一"要花成本"的**（多占 1 字节 + 对齐 padding），但对 `SemanticVersion` 它是**唯一可行的**：

```csharp
new SemanticVersion(0, 0, 0)   // 完全合法的版本 0.0.0
default(SemanticVersion)       // 必须是无效的
```

两者的 `Major/Minor/Patch` 全是 `0`。差别只在 `PreRelease`/`BuildMetadata`——一个是 `""`（构造函数里 `?? string.Empty`，`:35-36`），一个是 `null`。理论上可以靠"`PreRelease == null` 就是 default"来判，但那是**隐式**的、脆弱的：任何人给 `PreRelease` 加一个 `= string.Empty` 的属性默认值就崩了。显式哨兵把这条不变量写死，并且让它出现在 `Equals` 里（`:118`）——`default` 与 `0.0.0` 永远不相等。

`ModuleOperationError`（`ModApi/Lifecycle/ModuleOperationResult.cs:9`）和 `ModuleOperationResult`（同文件 `:42`）同理。后者尤其明显：

```csharp
// ModApi/Lifecycle/ModuleOperationResult.cs:55
public bool IsValid => initialized && (Succeeded ? !Error.HasValue : Error.HasValue && Error.Value.IsValid);
```

`default(ModuleOperationResult)` 的 `Succeeded` 是 `false`、`Error` 是 `null`——这在语义上是"失败了但没说为什么"。**必须**被判定为无效，否则一个忘了赋值的字段会被当成"模块激活失败"。没有 `initialized` 这一位，"忘了赋值"和"合法构造出来的坏结果"就分不开了。

### 三者的选择规则

| 内部状态 | 用哪个 | 成本 |
|---|---|---|
| 引用类型，`null` 非法 | A（`null` 检查） | 0 |
| 值类型，零值本就非法 | B（值域） | 0 |
| 值类型，**零值合法** | C（`initialized` 哨兵） | +1 字节 |

> **拓展：这个模式在别处**
>
> 做金额类型 `Money`，`0 元` 是合法金额 → 必须用手法 C。做 `Percentage`，`0%` 合法 → 手法 C。做 `EntityId`（自增主键从 1 开始）→ 手法 B。做 `Email` → 手法 A。
>
> **C# 11 的 `required` 关键字解决不了这个问题**——`required` 只约束对象初始化器语法，`default(T)`、数组元素、未赋值的 struct 字段照样绕过。Rust 里这个问题不存在，因为 Rust 没有"零值默认构造"这回事（缺失必须用 `Option<T>` 显式表达）。这是 C# struct 设计的一道已知裂缝，`initialized` 哨兵是标准补丁。

---

## 2. 比较语义的完整矩阵——以及 `<` 的陷阱

`02` §2.1 引用了 `SemanticVersion` 的三分离设计（identity / precedence / total order），说得对。但它**没有把这套语义在所有值类型上的落地情况列全**，而这恰恰是最容易出事的地方。

### 2.1 全量矩阵

| 类型 | `Equals` | `GetHashCode` | `IComparable<T>` | `ComparePrecedenceTo` | `==` `!=` | `<` `>` | `<=` `>=` |
|---|---|---|---|---|---|---|---|
| `SemanticVersion` | 含 build metadata | FNV | ✅ 总序 | ✅ | ✅ | ✅ **走 `CompareTo`** | ❌ |
| `ModApiVersion` | 转调 | FNV | ✅ 总序 | ✅ | ✅ | ❌ | ❌ |
| `ModuleVersion` | 转调 | FNV | ✅ 总序 | ✅ | ✅ | ❌ | ❌ |
| `CapabilityVersion` | 转调 | FNV | ✅ 总序 | ✅ | ✅ | ❌ | ❌ |
| `NetworkProtocolVersion` | int | int | ✅ | — | ✅ | ❌ | ❌ |
| `ContentCompatibilityVersion` | int | int | ✅ | — | ✅ | ❌ | ❌ |
| `ModuleId` | Ordinal | FNV | ❌ | — | ✅ | ❌ | ❌ |
| `CapabilityKey` | Ordinal | FNV | ❌ | — | ✅ | ❌ | ❌ |
| `DiagnosticEventName` | Ordinal | FNV | ❌ | — | ✅ | ❌ | ❌ |
| `GameBuildId` | Ordinal | FNV | ❌ | — | ✅ | ❌ | ❌ |
| `SessionId` / `FiberId` / `CorrelationId` / `LifecycleEpisodeId` | Guid | Guid | ❌ | — | ✅ | ❌ | ❌ |
| `FrameworkCompatibility` | 四轴全等 | 组合 FNV | ❌ | — | ✅ | ❌ | ❌ |
| `CapabilityRequirement` / `CapabilityProvision` | Key+Version | 组合 FNV | ❌ | — | ✅ | ❌ | ❌ |
| `DiagnosticAttribute` | Ordinal×2 | 组合 FNV | ❌ | — | **❌** | ❌ | ❌ |
| `DiagnosticError` | Ordinal×3 | 组合 FNV | ❌ | — | **❌** | ❌ | ❌ |
| `ModuleOperationError` | Ordinal×2 + init | **`StringComparer.Ordinal`** | ❌ | — | **❌** | ❌ | ❌ |
| `ModuleOperationResult` | **未实现** | **未实现** | ❌ | — | ❌ | ❌ | ❌ |

粗体是值得注意的地方，逐个说。

### 2.2 陷阱一：`SemanticVersion` 的 `<` 不是 SemVer 语义

```csharp
// Core/Primitives/SemanticVersion.cs:144-146
public static bool operator <(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) < 0;
public static bool operator >(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) > 0;
```

`CompareTo` 是**总序**——precedence 相同时拿 build metadata 做最后的 ordinal tie-breaker（`:112`）。于是：

```csharp
SemanticVersion.Parse("1.0.0+one") < SemanticVersion.Parse("1.0.0+two")   // → true
```

按 SemVer 2.0.0 §10，build metadata **必须**在判定优先级时被忽略，这两个版本的 precedence 完全相同，"小于"不成立。

**这不是 bug**——类型的 doc comment（`:8-16`）把这个取舍写得很清楚，测试 `Build_metadata_is_ignored_by_precedence_but_preserved_by_exact_identity` 也断言了 `one.ComparePrecedenceTo(two) == 0` 而 `one.CompareTo(two) != 0`（`CompatibilityTests.cs:62-65`）。总序的存在理由很硬：**`SortedSet<SemanticVersion>` 用默认比较器时，绝不能把两个不相等的值坍缩成一个**。测试 `:77` 用 `SortedSet` 直接演示了这个对比。

**但它是个陷阱**，因为 `<` 长得就像"版本比较"。安全的用法是：

```csharp
// ❌ 依赖解析里千万别这么写
if (installed < required) { /* 需要升级 */ }

// ✅ 显式走 precedence
if (installed.ComparePrecedenceTo(required) < 0) { /* 需要升级 */ }

// ✅ 或者用 comparer
if (SemanticVersion.PrecedenceComparer.Compare(installed, required) < 0) { ... }
```

doc comment 最后一句就是这个意思："**Dependency and package resolution must use `PrecedenceComparer`**"。

> **一个很细的分寸**：`ModApiVersion` / `ModuleVersion` / `CapabilityVersion` 这三个包装类型**故意没有定义 `<` / `>`**，只留 `CompareTo`。这大概率是有意的——把最容易被误用的运算符，从"直接面向依赖解析"的那几个类型上拿掉了。`SemanticVersion` 保留 `<` / `>` 是为了让通用比较代码好写。
>
> **可以改进的地方**：`<=` / `>=` 在所有类型上都没实现。C# 不会自动从 `<` 推导 `<=`，所以 `a <= b` 直接编译不过。这会逼使用方写 `a < b || a == b`（两次比较，且在 build metadata 场景下语义更微妙）或 `a.CompareTo(b) <= 0`。

### 2.3 陷阱二：`ComparePrecedenceTo` 会抛异常

```csharp
// Core/Primitives/SemanticVersion.cs:88-91
public int ComparePrecedenceTo(SemanticVersion other)
{
    if (!IsValid || !other.IsValid)
        throw new InvalidOperationException("Cannot compare an invalid default SemanticVersion.");
    ...
```

而 `PrecedenceComparer` 只是它的一层薄包装（`:226-229`）。推论：

```csharp
var versions = new List<SemanticVersion> { v1, v2, default };   // ← 混进一个 default
versions.Sort(SemanticVersion.PrecedenceComparer);
// → 抛异常。而且 List.Sort 会把它再包一层 InvalidOperationException
//   （"IComparer.Compare() 方法返回不一致的结果"或"比较器抛出异常"），
//   真正的原因躲在 InnerException 里。
```

`CompareTo` 转调 `ComparePrecedenceTo`，所以**同样会抛**——`versions.Sort()`（不传 comparer）一样炸。而 `Equals` / `GetHashCode` 不会，它们把 `initialized` 当普通字段比。

这个设计是 **fail-fast 优于 fail-silent**：如果 `default` 被静默排到最前面，一个忘了初始化的版本号就会伪装成"最老的版本"，依赖解析会给出一个**看起来合理的错误答案**——这是最难查的一类 bug。抛异常至少能定位。

**代价**：任何接受外部数据（反序列化 manifest、读 lockfile）的排序路径，都必须先过一遍 `IsValid` 过滤，或用 `TryParse` 保证不会有 `default` 混进来。这条约束**目前没有写在任何文档里**（见 §9 改进项 4）。

### 2.4 陷阱三：`ModuleOperationResult` 没有相等性

```csharp
// ModApi/Lifecycle/ModuleOperationResult.cs:40
public readonly struct ModuleOperationResult
```

没有 `IEquatable<T>`，没有 `Equals` 重写，没有 `GetHashCode` 重写，没有运算符。后果：

- `result1.Equals(result2)` 落到 `ValueType.Equals`。因为这个 struct 含引用类型字段（`ModuleOperationError?` 里的两个 `string`），运行时**无法**走快速的按位比较，只能走**反射逐字段比较**——慢，且会装箱。
- `result.GetHashCode()` 落到 `ValueType.GetHashCode`，其行为在 Mono / CoreCLR 上都未文档化（常见实现只取第一个字段）。
- 放进 `HashSet<ModuleOperationResult>` 或当 `Dictionary` key 会很糟。

同一个文件里 `ModuleOperationError` **实现了** `IEquatable<T>` 和 `GetHashCode`（`:29-36`），所以这不是"作者不知道要写"，更像是"`Result` 本来就不打算被比较"。合理——但在一个把 `Equals`/`GetHashCode` 贯彻到每一个值类型的代码库里，这是唯一的例外，值得要么补上、要么在 doc comment 里写明"此类型不支持相等性比较"。

### 2.5 陷阱四：`==` 的覆盖不完整

`DiagnosticAttribute`、`DiagnosticError`、`ModuleOperationError` 都实现了 `IEquatable<T>` 和 `GetHashCode`，但**没有定义 `==` / `!=`**。所以：

```csharp
if (attributeA == attributeB)          // ❌ 编译错误 CS0019
if (attributeA.Equals(attributeB))     // ✅
```

这不会导致运行时错误（编译器拦住了），但和同一层里其它十几个类型的写法不一致，使用者会被绊一下。

---

## 3. 哈希的三层稳定性，以及它在程序集边界上断掉的地方

[`00` §3.1](./00-Review-Report.md) 已经纠正了"为什么不用 `string.GetHashCode`"的理由。这里补一个**更有意思的发现**：这套"稳定哈希"的承诺，**在 `Game.ModApi` 程序集边界上断掉了**。

### 3.1 断点在哪

`StableStringHash` 的可见性：

```csharp
// Core/Primitives/NamespacedIdentifiers.cs:123
static class StableStringHash    // ← 没有访问修饰符 = internal
```

`internal` 意味着**只有 `Game.Core.Primitives` 自己能用**。`Game.ModApi` 看不见它。于是当 `ModuleOperationError` 需要一个哈希时：

```csharp
// ModApi/Lifecycle/ModuleOperationResult.cs:36
public override int GetHashCode() => unchecked(
    ((Code    == null ? 0 : StringComparer.Ordinal.GetHashCode(Code))    * 397) ^
     (Message == null ? 0 : StringComparer.Ordinal.GetHashCode(Message)));
```

它只能退回 **`StringComparer.Ordinal.GetHashCode`**——也就是运行时自己的字符串哈希，正是 `StableStringHash` 存在的理由所要规避的那个东西。

对比同在 `Game.ModApi` 的 `CapabilityRequirement`：

```csharp
// ModApi/Capabilities/CapabilityContracts.cs:83
public override int GetHashCode() => unchecked((Key.GetHashCode() * 397) ^ Version.GetHashCode());
```

这个**是稳定的**——因为它没有直接哈希字符串，而是转调 `CapabilityKey.GetHashCode()` 和 `CapabilityVersion.GetHashCode()`，那两个在 Primitives 内部走的是 FNV-1a。

**区别就在于：能不能把哈希委托给一个 Primitives 里的值类型。** `ModuleOperationError` 的两个字段是裸 `string`（`Code` 甚至没有做成 `DiagnosticEventName` 类型，只是用 `DiagnosticEventName.TryParse` 校验了格式，`:14`），所以它无处可委托。

### 3.2 这算问题吗

**取决于这个哈希会不会被持久化或跨进程传输。**

- `ModuleOperationError` 是"模块激活失败了，原因是什么"的一次性载体，它的哈希几乎肯定只用于本地 `Dictionary`/`HashSet` 去重 → **不构成 bug**。
- 但它破坏了一个本来很干净、可以写进规格的性质："`Game.Core.Primitives` 与 `Game.ModApi` 中所有值类型的 `GetHashCode` 都是跨进程稳定的"。现在这句话有一个例外，而例外没有被记录。

**顺带一提**：如果把 `ModuleOperationError.Code` 从 `string` 改成 `DiagnosticEventName`，这个问题会自动消失（哈希委托出去了），而且还省掉了 `IsValid` 里每次都重新 `TryParse` 一遍的开销：

```csharp
// ModApi/Lifecycle/ModuleOperationResult.cs:27
public bool IsValid => initialized && DiagnosticEventName.TryParse(Code, out _) && !string.IsNullOrWhiteSpace(Message);
//                                    ↑ 每次读 IsValid 都跑一遍正则/字符扫描
```

不改的理由大概是：`Code` 作为 `string` 暴露给 Mod 作者更直白（`error.Code == "framework.xxx"` 直接可比）。这是个真实的取舍，不是疏漏。

### 3.3 三层稳定性的完整清单

把散落各处的机制归拢一下，"稳定"其实是三件不同的事：

| 层 | 机制 | 保证 | 反例（如果不做） |
|---|---|---|---|
| **字符串比较稳定** | `StringComparison.Ordinal` 贯穿所有 `Equals` | 不受 `CultureInfo` 影响 | 土耳其语 locale 下 `"I".ToLower() != "i"`，`Author.Id` 与 `author.id` 的相等性随机器变（经典的 "Turkish I problem"） |
| **哈希稳定** | FNV-1a，`StableStringHash.Compute` | 跨 Mono/IL2CPP、跨 Unity 版本一致 | Editor 里算的 key 和打包后 Player 里算的不一样 |
| **文本表示稳定** | `Guid.ToString("N")`、`int.ToString(CultureInfo.InvariantCulture)` | 不受 locale 数字格式影响 | 某些 locale 下千分位/小数点符号不同，`1000.ToString()` 变成 `"1 000"` |

第三层特别容易被忽略。注意 `NetworkProtocolVersion.ToString()`（`CompatibilityIdentifiers.cs:111`）显式传了 `CultureInfo.InvariantCulture`，`SemanticVersion.ToString()`（`:135`）三个数字段也全都显式传了。这不是过度设计——**这些字符串会进 manifest、进网络握手包**。

> **拓展：FNV-1a 的选型对不对**
>
> FNV-1a 的雪崩性质不好（相似输入倾向于产生相似哈希），对 `Dictionary` 的桶分布不如 xxHash / SipHash。但这里的取舍是对的：
>
> - **需要的是确定性，不是抗碰撞**。这些哈希不用于安全场景（没有 HashDoS 面），也不用于 GB 级数据分桶。
> - **实现必须极简**，因为它要跨语言复刻（未来服务端要能算出同样的值）。FNV-1a 是 5 行代码，xxHash 是几百行。
> - **key 空间很小**：模块数、能力数都在几十到几千量级，FNV-1a 的分布完全够用。
>
> 唯一要补的是规格说明：**"哈希定义在 UTF-16 code unit 序列上，不是 UTF-8 字节序列上"**（见 [`00` §3.1](./00-Review-Report.md)）。对被限死在 ASCII 的 `ModuleId` 无所谓，但对 `DiagnosticAttribute.Value`（可以是任意字符串）就有差别。

---

## 4. VContainer 装配逐行解剖

`03` §2.2 列了 `AppLifetimeScope.Configure` 的注册清单，但没解释**为什么每一条要写成那个特定形状**。这一节把它拆开。

```csharp
// Bootstrap/AppLifetimeScope.cs:50-60
builder.RegisterInstance<IUnityMainThreadGuard>(mainThreadGuard);        // ①
builder.RegisterInstance(compatibility);                                 // ②
builder.RegisterInstance(router);                                        // ②
builder.RegisterInstance(eventFactory);                                  // ②
builder.RegisterInstance<IFrameworkIdentityProvider>(identity);          // ③
builder.Register<ModuleDiagnosticsAdapterFactory>(Lifetime.Singleton);   // ④
builder.Register<VContainerSessionScopeFactory>(Lifetime.Singleton)
       .As<ISessionScopeFactory>();                                      // ⑤
builder.Register<SessionFactory>(Lifetime.Singleton)
       .AsSelf().As<ISessionFactory>();                                  // ⑥ ★
builder.RegisterInstance(failureReporter);                               // ②
builder.RegisterEntryPointExceptionHandler(failureReporter.Report);      // ⑦
builder.RegisterEntryPoint<ApplicationLifecycleCoordinator>();           // ⑧
```

### ① 显式接口类型参数

不写 `<IUnityMainThreadGuard>` 的话，VContainer 会按**具体类型** `UnityMainThreadGuard` 注册，而所有消费方（`SessionFactory`、`Session`、`VContainerSessionScopeFactory`）的构造函数收的都是接口，解析会失败。

注意 `mainThreadGuard` 是在 `Configure` 的**第一行**捕获的（`:22`）：

```csharp
var mainThreadGuard = UnityMainThreadGuard.CaptureCurrentThread();
```

放在第一行不是巧合——它必须早于任何可能失败的操作（比如 `:32` 的 `compatibilityConfiguration.ToRuntime()`）。如果配置校验失败要走 `catch` 分支发诊断，那条路径也在主线程上，而错误处理路径不应该因为"还没捕获主线程身份"而复杂化。

### ② `RegisterInstance(x)` — 让 VContainer 推断类型

`compatibility`（`FrameworkCompatibility` struct）、`router`、`eventFactory`、`failureReporter` 都按**具体类型**注册，因为消费方要的就是具体类型（这几个都没有接口，`DiagnosticRouter` 是 `sealed class`）。

⚠️ 一个容易踩的点：`FrameworkCompatibility` 是 **struct**。`RegisterInstance` 一个 struct 会把它装箱存进容器，每次 `Resolve` 拆箱出一份拷贝。因为它是 `readonly struct` 且从不变更，语义上没问题；但如果它很大且被高频注入，会成为分配热点。当前只有 `FrameworkIdentityProvider` 一个消费方，而且是构造时注入一次，没影响。

### ③ vs ④ — `RegisterInstance` 和 `Register(Singleton)` 的真实差别

两者最终都是"容器里只有一个实例"，差别在**谁负责创建**和**何时创建**：

| | 创建者 | 时机 | 依赖注入 | 容器 Dispose 时 |
|---|---|---|---|---|
| `RegisterInstance(x)` | **你**，在 `Configure` 里 | 立刻 | 无（你自己 `new`） | **不会**被 VContainer Dispose |
| `Register<T>(Lifetime.Singleton)` | **容器** | 第一次 Resolve 时（懒） | 构造函数注入 | 若实现 `IDisposable` 会被 Dispose |

`ModuleDiagnosticsAdapterFactory` 用 ④，因为它需要注入 `DiagnosticRouter` + `DiagnosticEventFactory`（`ModuleDiagnosticsAdapter.cs:50`），交给容器接线更省事。

`router` / `eventFactory` 用 ②，理由非常具体：**它们在 `Configure` 里就要被用到**——`:36` 的失败路径要立刻 `router.Emit(...)`，而那时容器还没建成，没法 Resolve。这是"为什么必须手动 `new`"的一个硬理由，不是风格偏好。

### ⑤ vs ⑥ — `AsSelf()` 的必要性（本节重点）

```csharp
builder.Register<VContainerSessionScopeFactory>(Lifetime.Singleton).As<ISessionScopeFactory>();   // 没有 AsSelf
builder.Register<SessionFactory>(Lifetime.Singleton).AsSelf().As<ISessionFactory>();              // 有 AsSelf
```

差别的根源在 `ApplicationLifecycleCoordinator` 的构造函数签名：

```csharp
// Bootstrap/ApplicationLifecycleCoordinator.cs:51-55
internal ApplicationLifecycleCoordinator(
    DiagnosticRouter router,
    DiagnosticEventFactory eventFactory,
    SessionFactory sessionFactory,          // ← 具体类型，不是 ISessionFactory
    IUnityMainThreadGuard mainThread)
```

**为什么必须是具体类型？** 因为 shutdown 序列要调这个：

```csharp
// ApplicationLifecycleCoordinator.cs:172
factory.PreventNewSessions();
```

而 `PreventNewSessions` 是 `internal`（`SessionFactory.cs:51`），**不在 `ISessionFactory` 上**：

```csharp
// Bootstrap/Session/ISessionFactory.cs
public interface ISessionFactory
{
    bool HasActiveSession { get; }
    ISession ActiveSession { get; }
    ISession CreateSession();
    // 没有 PreventNewSessions
}
```

这是一个**刻意的能力分割**：

- `ISessionFactory`（public 接口）= 谁都能用的能力：查询、创建
- `SessionFactory.PreventNewSessions()`（internal 方法）= 只有组合根能用的能力：**永久关闭创建通道**

把"关闭工厂"这种不可逆、只应发生一次的操作放在 internal 具体类型上，等于**用可见性表达权限**。而 `AsSelf()` 就是为了让 DI 能把具体类型注进去。

`PublicApiSurfaceTests` 甚至把这条钉死了：

```csharp
// PublicApiSurfaceTests.cs:247-250
Assert.That(
    constructor.GetParameters().Any(p => p.ParameterType == typeof(Game.Bootstrap.Session.SessionFactory)),
    Is.True,
    "The App root must depend on the Session factory so it can stop the active Session.");
```

反过来，`VContainerSessionScopeFactory` 没有任何 internal 能力需要暴露给别人，所以**不加 `AsSelf()`**——只暴露接口，实现类型对容器的其余部分不可见。最小暴露原则在 DI 注册上的体现。

> **拓展**：这个手法（public 接口给通用能力，internal 具体类型给特权能力，DI 里 `AsSelf()` + `As<T>()` 同时注册）在任何 DI 框架里都能用。Microsoft.Extensions.DependencyInjection 的等价写法是：
>
> ```csharp
> services.AddSingleton<SessionFactory>();
> services.AddSingleton<ISessionFactory>(sp => sp.GetRequiredService<SessionFactory>());
> ```
>
> 第二行**必须**用工厂委托转发，否则会创建**两个**实例——这是 MS DI 里非常常见的一个 bug。VContainer 的 `.AsSelf().As<T>()` 链式写法从 API 层面就避免了它。

### ⑦ ⑧ — 顺序的真实影响

见 [`00-Review-Report.md` §3.2](./00-Review-Report.md)。一句话：不是"能不能捕获异常"，是"要不要让 VContainer 多塞一个默认的 `Debug.LogException` handler 进来"。

### 4.1 `ApplicationLifecycleCoordinator.Start()` 到底什么时候跑

`03` 说 "VContainer 启动时调 `Start()`"——对，但太模糊。精确链路（读 VContainer 1.19.0 源码得出）：

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

三个关键推论：

1. **`Start()` 不在 `Configure()` 的调用栈里**，它被推迟到 PlayerLoop。所以 `Configure` 抛异常和 `Start` 抛异常走的是完全不同的两条路：前者直接冒泡到 Unity（`LifetimeScope.Awake` 报错），后者被 `EntryPointExceptionHandler` 接住。

   这正好解释了 `AppLifetimeScope.Configure` 的 catch 分支为什么要**手动**发一次诊断再 `throw`（`:36-45`）——那时候 `EntryPointFailureReporter` 还没被容器接线上，不手动发就什么日志都没有。同一个失败（配置无效）在两个阶段有两套报告路径，是有意为之。

2. **`Start()` 一定在 Unity 主线程**，因为 PlayerLoop 就在主线程。所以 `mainThread.ThrowIfNotMainThread(...)`（`:90`）在正常路径下**永远不会触发**——它守的是**被别人手动调用**的情形（测试，或者未来某段代码持有 coordinator 引用）。这是一个"防的是未来的自己"的检查。

3. `EntryPointDispatcher` 注册为 `Lifetime.Scoped`，意味着**每个 scope 一个 dispatcher**。当前 Session 子 scope 只注册了 `SessionId` 和 `ISessionLifetime`（`VContainerSessionScopeFactory.cs:36-40`），没有任何 entry point，所以 `EnsureDispatcherRegistered` 不会在子容器里被触发。一旦将来加了，子容器会拿到自己的 dispatcher **和自己的默认异常 handler**——那时必须显式给子 scope 也注册框架的 handler（见 §9 改进项 12）。

---

## 5. 拒绝协议：三种姿势，一条规则

`03` §3.1 提到了 `ThrowIfNotMainThread` 和 `CreateViolation` 两个方法，但没有把**十个受守护的入口点各自选了哪种**列出来。列出来之后，规则一目了然。

| 入口 | 返回类型 | 拒绝方式 | 位置 |
|---|---|---|---|
| `SessionFactory.CreateSession` | `ISession` | 同步 `throw` | `SessionFactory.cs:69` |
| `SessionFactory.PreventNewSessions` | `void` | 同步 `throw` | `SessionFactory.cs:55` |
| `Session.StartAsync` | `Task` | `Task.FromException(...)` | `Session.cs:129-130` |
| `Session.StopAsync` | `Task` | `Task.FromException(...)` | `Session.cs:205-206` |
| `Session.DisposeAsync` | `ValueTask` | `new ValueTask(Task.FromException(...))` | `Session.cs:232-234` |
| `ApplicationLifecycleCoordinator.Start` | `void` | 同步 `throw` | `:90` |
| `ApplicationLifecycleCoordinator.ShutdownAsync` | `Task` | `Task.FromException(...)` | `:117-119` |
| `ApplicationLifecycleCoordinator.Dispose` | `void` | 同步 `throw` | `:135` |
| `VContainerSessionScopeFactory.Create` | `ISessionScope` | 同步 `throw` | `:31` |
| `VContainerSessionScope.Dispose` | `void` | 同步 `throw` | `:66` |

**规则**：返回 `Task` / `ValueTask` 的一律 faulted；其余一律同步抛。零例外。

### 5.1 为什么 Task-返回的方法不能同步抛

考虑：

```csharp
await using var session = factory.CreateSession();
await session.StartAsync(token);
```

如果 `StartAsync` 同步抛，异常在 `StartAsync(...)` 这一步就飞出去了，**在 `await` 之前**。对单个 `await` 表达式而言，两者最终都是抛出同一个异常，看起来一样。但有三处实质差别：

**(a) 批量场景**

```csharp
var tasks = sessions.Select(s => s.StopAsync(ct)).ToArray();   // ← 同步抛会在这里炸掉整个 Select
await Task.WhenAll(tasks);
```

同步抛会让**第一个**失败的调用炸掉整个集合构建，后面的 session 根本没被调用到，于是它们既没停也没报错。faulted Task 则让每个调用都返回一个结果，`WhenAll` 能一次性报告全部失败。

**(b) 异常的观察时机**

同步抛的异常必须**立刻**被 try/catch 接住；faulted Task 的异常在 `await` 或读 `.Exception` 时才浮现。对一个"先发起全部、后统一收集"的关停流程，后者才是对的形状。

**(c) 与业务失败语义对齐**

`Session.StartAsync` 在**正常路径**上的所有失败都是 faulted / canceled Task（`:179-184`）。把线程违规也做成 faulted Task，意味着调用方**只需要一套错误处理**。如果线程违规同步抛而业务失败走 Task，调用方就得写两层：

```csharp
// ❌ 如果协议不统一，调用方被迫这么写
try
{
    await session.StartAsync(ct);   // 可能同步抛，也可能 faulted
}
catch (InvalidOperationException) { /* 是线程违规还是状态非法？分不清 */ }
```

这一点 `LifecycleMainThreadTests` 的辅助函数直接断言了：

```csharp
// LifecycleMainThreadTests.cs
static T OnWorkerThread<T>(Func<T> function)
{
    var result = default(T);
    var failure = OnWorkerThread(() => { result = function(); });
    Assert.That(failure, Is.Null,
        "This lifecycle method must fault its operation rather than throw synchronously.");
    return result;
}
```

worker 线程上调用 `StartAsync` **不能**抛（`failure` 必须是 `null`），只能返回一个 faulted Task。这是把协议写进测试里了。

### 5.2 `DisposeAsync` 为什么要自己查一遍

```csharp
// Session.cs:230-237
public ValueTask DisposeAsync()
{
    if (!mainThread.IsMainThread)
        return new ValueTask(
            Task.FromException(mainThread.CreateViolation(nameof(Session) + "." + nameof(DisposeAsync))));

    return new ValueTask(StopAsync(CancellationToken.None));
}
```

如果直接写 `return new ValueTask(StopAsync(CancellationToken.None));`，行为**也是对的**——`StopAsync` 会自己拒绝。但错误消息会说：

> `Session.StopAsync` must be initiated on the Unity main thread...

而调用方写的是 `await session.DisposeAsync()` 或 `await using`，他从来没调过 `StopAsync`。多查一遍只为了让诊断消息指向**调用方实际写的那行代码**。doc comment 把这个理由写明了：

> rejected as a faulted operation off the main thread **under its own name so the diagnostic points at the call the caller actually made**.

一个很小但很体现工程素养的决定：**错误消息的受众是排查问题的人，不是编译器**。

### 5.3 `CreateViolation` 自己也会抛

```csharp
// Threading/UnityMainThreadGuard.cs:67-75
public InvalidOperationException CreateViolation(string operation)
{
    if (string.IsNullOrWhiteSpace(operation))
        throw new ArgumentException("A lifecycle operation name is required.", nameof(operation));
    return new InvalidOperationException(...);
}
```

一个"构造异常对象"的方法自己会抛 `ArgumentException`——看起来矛盾，其实不是。`operation` 参数全部来自 `nameof(...) + "." + nameof(...)` 拼接，是编译期常量，永远不可能为空。这个检查是**给未来的自己看的**：如果哪天有人从配置或反射里传一个 operation 名进来，会立刻炸，而不是产生一条 `" must be initiated on the Unity main thread"` 这样开头缺了主语的残缺消息。

---

## 6. 失败账本模式：为什么不用 `AggregateException`

`03` §4.5 描述了 `cleanupFailure = cleanupFailure ?? exception` 这个"不覆盖"手法，但没问一个更根本的问题：**.NET 里明明有 `AggregateException` 专门干这个，为什么不用？**

### 6.1 当前实现

```csharp
// Session.cs:400-409
static DiagnosticError BuildError(string code, Exception primary, Exception cleanupFailure)
{
    var message = Describe(primary);
    if (cleanupFailure != null)
        message = $"{message} (cleanup also failed: {cleanupFailure.GetType().FullName}: {Describe(cleanupFailure)})";
    return new DiagnosticError(code, message, primary.GetType().FullName);
}
```

- **主异常**：保留类型名（`primary.GetType().FullName` 进 `ExceptionType` 字段）
- **清理异常**：被**字符串化**拼进 message，类型信息只剩一个名字，栈全丢
- 只保留**第一个**清理异常（后续的被 `??` 挡掉）

### 6.2 三个候选方案的对比

| 方案 | 保真度 | 跨边界安全 | 可诊断性 |
|---|---|---|---|
| `AggregateException(primary, cleanup)` | 最高（全部异常对象保留） | ❌ 泄漏内部异常类型 | 好，但 `await` 只解包第一个 InnerException |
| `ExceptionDispatchInfo.Capture(primary).Throw()` + 侧记 cleanup | 高（保留原始栈） | ⚠️ 仍泄漏 primary 类型 | 好 |
| **当前：主异常传播 + cleanup 字符串化** | 中 | ✅ | 好（结构化诊断已单独记录） |

选当前方案的理由，在 spec 里有明确出处（§11.3 最后一条）：

> Exceptions crossing module boundaries shall be **normalized into versioned result/error contracts**.

`AggregateException` 的 `InnerExceptions` 会把 `VContainerException`、`UnityException` 这类**私有实现类型**原封不动地递给 Mod 作者的 catch 块。一旦有 Mod 写了 `catch (VContainerException)`，框架就再也换不掉 DI 容器了——这正是 `PublicApiSurfaceTests` 全力封堵的那种泄漏（它的 `ForbiddenFragments` 第一项就是 `"VContainer"`）。

`ModuleOperationError` 就是那个"versioned error contract"：

```csharp
// ModApi/Lifecycle/ModuleOperationResult.cs:12-21
public ModuleOperationError(string code, string message)
{
    if (!DiagnosticEventName.TryParse(code, out _))
        throw new ArgumentException("Module operation error code must be a canonical lowercase dot-separated identifier.", nameof(code));
    ...
```

只有 `code`（受控词表，必须是规范化命名空间标识符）+ `message`（人类可读文本）。**没有异常类型，没有栈，没有 InnerException。** Mod 作者只能按 `code` 分支——而 `code` 是框架承诺会版本化维护的东西。

### 6.3 那"完整信息"去哪了

关键在于：**Session 的失败走两条完全独立的通道。**

```
                    ┌──── 通道 A：Task 结果（给调用方）────────────────┐
RunStop 里 cleanup 失败 →  completion.TrySetException(cleanupFailure)      (Session.cs:306)
                       原始异常对象，栈完整，仅在 Game.Bootstrap 内部流转

                    ┌──── 通道 B：诊断事件（给运维/日志）──────────────┐
                    →  Emit(Error, SessionFailed,
                             BuildError("framework.session-cleanup-failed", ...))   (Session.cs:302-305)
                       结构化，含 correlationId / sessionId / lifecycleEpisodeId
```

通道 A 只在 `Game.Bootstrap` 内部流转（`ISession` 是 Bootstrap 的类型，不在 ModApi 里，Mod 作者根本拿不到），所以泄漏内部异常类型没关系。通道 B 才是给外部看的，它已经被规格化。

**所以"信息丢失"是假象**——丢的只是"清理异常的完整栈"，而清理异常的栈通常并不有用（它总是指向 `scope.Dispose()` 或 `release(this)` 这两行之一）。真正需要栈的**主异常**被完整保留在通道 A 里。

### 6.4 `??` 而不是 `=` 的深层理由

```csharp
cleanupFailure = cleanupFailure ?? exception;   // 不是 cleanupFailure = exception
```

`RunStop`（`:244-307`）/ `FailStart`（`:314-368`）里有**三个**可能失败的清理步骤：

1. `lifetimeCancellation.Cancel()` — 会同步执行所有注册的取消回调，任何一个回调抛异常都会冒到这里
2. `ownedScope?.Dispose()` — 销毁 VContainer 子 scope，会销毁 Unity 对象
3. `release(this)` — 回调 `SessionFactory.Release`

用 `=` 的话，最后一个失败的会覆盖前面的。

**为什么"第一个"比"最后一个"更值得保留？** 因为清理是**有序的**，前面的失败往往是后面失败的**原因**。如果 `Cancel()` 抛了（说明有注册的回调炸了），那么后续 `scope.Dispose()` 大概率也会因为相同的根因而炸。保留第一个 = 保留根因。

> **拓展：这个模式的通用形式**
>
> 任何"必须全部执行完的清理序列"都可以用它：
>
> ```csharp
> Exception first = null;
> foreach (var step in cleanupSteps)
> {
>     try { step(); }
>     catch (Exception e) { first ??= e; }     // 记账，不中断
> }
> // 走到这里，所有权一定已全部释放
> if (first != null) { /* 报告根因 */ }
> ```
>
> 对比两种常见的错误写法：
>
> - `try { a(); b(); c(); }` —— `a()` 抛了，`b()` `c()` 根本不执行，资源泄漏；
> - `try { a(); } catch {} try { b(); } catch {} ...` —— 全静默吞掉，出了事完全查不到。
>
> 而且注意 `Session` 把整个记账块包在 `try { ... } finally { 状态转终态 }` 里（`:249-293`）——**即使记账逻辑自己炸了，状态机也一定进终态**，`stopTask` 一定被 memoize。这样"调用方 `await` 一个永远不完成的 Task"这种最坏情况被彻底排除。
>
> C# 8 的 `??=` 让这个模式写起来更短。当前代码用的是完整写法 `x = x ?? e`（等价）。

---

## 7. 诊断管线的线程契约与所有权

这是整个 Bootstrap 里**唯一一条没有被测试守住**的重要约束，值得单独写。

### 7.1 契约是什么

由 [`00` §3.4](./00-Review-Report.md) 推出：

```csharp
// ApplicationLifecycleCoordinator.cs:208-212
stop.ContinueWith(
    completed => CompleteShutdown(completion, Failure(completed)),
    CancellationToken.None,
    TaskContinuationOptions.ExecuteSynchronously,
    TaskScheduler.Default);      // ← 不能就地跑时回落到线程池
```

`CompleteShutdown` 会调 `Emit(...)` → `router.Emit(...)` → 每个 `sink.Write(...)`。所以：

> **`IDiagnosticSink.Write` 可能被任意线程调用。所有 sink 实现必须线程安全。**

### 7.2 当前三个 sink 的合规情况

| Sink | 线程安全？ | 依据 |
|---|---|---|
| `InMemoryDiagnosticSink` | ✅ | `lock (sync)` 保护 `List.Add`，`Snapshot` 也在锁内 `ToArray()`（`:16-20`, `:26-29`） |
| `UnityConsoleDiagnosticSink` | ✅ | 只调 `Debug.Log` / `LogWarning` / `LogError`——Unity 明确允许跨线程调用的少数 API 之一；`Format` 是静态纯函数，只用局部 `StringBuilder` |
| `DelegateDiagnosticSink`（测试用） | ⚠️ 取决于传入的委托 | 由每个测试自己负责 |

`InMemoryDiagnosticSink.Snapshot` 的实现值得看一眼：

```csharp
// Core/Diagnostics/InMemoryDiagnosticSink.cs:12-21
public IReadOnlyList<DiagnosticEvent> Snapshot
{
    get { lock (sync) { return events.ToArray(); } }
}
```

每次读都在锁内拷一份数组。这既保证了"读的时候不会撞上并发的 `Add`"（`List<T>` 扩容期间读会读到脏状态），也保证了返回给调用方的快照**不会随后续写入而变化**。测试 `In_memory_sink_returns_stable_snapshots` 断言的就是后半条。代价是每次 `Snapshot` 都分配——测试代码里完全可以接受。

### 7.3 `DiagnosticRouter` 的两个无锁设计

```csharp
// Core/Diagnostics/DiagnosticRouter.cs:22-43
public void Emit(DiagnosticEvent diagnosticEvent)
{
    if (diagnosticEvent == null) throw new ArgumentNullException(nameof(diagnosticEvent));
    foreach (var sink in sinks)
    {
        try { sink.Write(diagnosticEvent); }
        catch (Exception exception)
        {
            try { sinkFailureHandler(exception); }
            catch (Exception handlerException) { UnityEngine.Debug.LogException(handlerException); }
        }
    }
}
```

`03` §9 已经讲了三层 try/catch。补两点：

**(a) `sinks` 是 `readonly IDiagnosticSink[]`，在构造函数里 `ToArray()` 定型**（`:16`）。所以 `Emit` 的 `foreach` 不需要加锁——数组在构造后不可变，多线程并发 `Emit` 各自遍历同一个不可变数组是安全的。**这是无锁并发读的标准做法：把可变性挪到构造期。**

注意构造函数还做了 null 元素检查（`:17-18`），也是在这个"定型"时刻一次做完：

```csharp
this.sinks = sinks.ToArray();
if (this.sinks.Any(sink => sink == null))
    throw new ArgumentException("Diagnostic sink collection cannot contain null entries.", nameof(sinks));
```

先 `ToArray()` 再检查——顺序很重要。如果先对 `IEnumerable` 检查再 `ToArray()`，一个惰性序列会被枚举两次，且第二次可能产出不同的内容（TOCTOU）。

**(b) `Emit` 自己没有锁，这是刻意的。** 如果 `Emit` 加锁，那么"锁持有时间最小化"这条原则（`03` §4.2）就白做了——`Session` 费劲地在锁外调 `Emit`，结果 `Emit` 内部又串行化，一个重入的 sink 照样死锁。

顺序保证也在测试里：`Router_preserves_sink_order_and_isolates_a_failing_sink`（`DiagnosticRouterTests.cs`）同时断言了"按注册顺序调用"和"一个 sink 抛异常不影响后面的"。

### 7.4 重入安全的测试手法（值得单独学）

`SessionLifecycleConcurrencyTests.Reentrant_diagnostics_cannot_deadlock_the_lifecycle` 用了一个很聪明的手法：

```csharp
// SessionLifecycleConcurrencyTests.cs:135-142
var probe = new Thread(() =>
{
    var _  = session.State;   // 这两个 getter 都是 lock (sync) { return ...; }
    var __ = session.Id;
}) { IsBackground = true, Name = "diagnostic-lock-probe" };
probe.Start();
if (probe.Join(TimeSpan.FromSeconds(5))) crossThreadReads++;
else crossThreadTimeouts++;
```

**为什么必须开一个新线程？** 测试自己的注释说明了：

> Because the internal lock is reentrant, a same-thread read alone cannot prove the lock is free.

C# 的 `lock`（`Monitor`）是**可重入的**——同一个线程已经持有锁时再进 `lock` 会直接通过。所以如果 sink 在持锁线程上读 `session.State`，就算锁真的被持有着，也读得出来，**测不出问题**。必须用另一个线程，因为跨线程时 `Monitor` 不可重入，锁被持有就一定会阻塞，`Join(5s)` 就会超时。

最后断言 `crossThreadTimeouts == 0`（`:155`），语义是"没有任何一次 sink 回调期间，生命周期锁是被持有的"。

这个技巧可以直接搬到任何"我要证明我没有在回调期间持锁"的测试里。

### 7.5 缺口

**这条契约目前只存在于代码注释里，没有测试守。** 一个可以加的测试大致长这样：

```csharp
[Test]
public async Task Diagnostic_sinks_may_be_invoked_off_the_main_thread_during_async_shutdown()
{
    var observedThreads = new ConcurrentBag<int>();
    var sink = new DelegateDiagnosticSink(_ => observedThreads.Add(Thread.CurrentThread.ManagedThreadId));
    // 需要一个 StopAsync 返回真正未完成 Task 的假 Session，
    // 在 worker 线程上完成它，然后断言 ApplicationStopped 事件
    // 确实在非主线程上被写出。
}
```

**现在做不了**，因为 `SessionFactory` 只会造真的 `Session`，而真 `Session.StopAsync` 总是同步完成（清理全是同步的），`stop.IsCompleted` 恒为 true，`ContinueWith` 那条分支永远走不到。

等未来有了真正异步的 Session 清理（比如要等 Addressables 释放句柄、等网络优雅断开），这个测试就必须补上——否则很容易有人往 sink 里塞一个非线程安全的实现（比如一个直接写 `List` 的文件缓冲 sink），而且**在同步清理的世界里它一直是对的**，直到某天清理变异步了才炸。

这类"约束现在恰好不会被违反，但没有任何东西守着"的地方，是技术债里最阴险的一种。

---

## 8. asmdef 作为架构工具（而不只是编译单元）

`05` 把架构测试讲透了，但漏了一件事：**这些 asmdef 里有几个字段本身就在做架构强制**，根本不需要测试。

### 8.1 `autoReferenced: false` —— 全部 15 个 asmdef 都开了

这个字段的含义是：**不要把这个程序集自动加入 `Assembly-CSharp` 的引用列表**。

Unity 默认行为是：没有 asmdef 覆盖的脚本落进 `Assembly-CSharp`，而 `Assembly-CSharp` 会**自动引用**所有 `autoReferenced: true` 的程序集。所以默认情况下，随便在 `Assets/` 下扔一个 `.cs` 文件就能 `using Game.Bootstrap;`。

全线设为 `false` 的后果：

> **任何想用框架的代码，都必须先建自己的 asmdef，并显式写出它引用了哪几个框架程序集。**

这是一道**结构性**防线，比测试更硬——它在编译期生效，且不需要任何人去写断言。它和架构测试是互补的：

| | 阻止什么 | 何时生效 | 谁维护 |
|---|---|---|---|
| `autoReferenced: false` | 隐式的、无声的依赖 | 编译期，自动 | 无需维护 |
| `AssemblyDependencyTests` | 显式写错的依赖方向 | 测试期 | 白名单要跟着改 |
| `PublicApiSurfaceTests` | 类型从公共签名泄漏 | 测试期 | 允许列表要跟着改 |

### 8.2 `noEngineReferences` —— 一个没用起来的机会

```jsonc
// Game.Core.Primitives.asmdef
"references": [],
"noEngineReferences": false     // ← 注意
```

`references: []` 说明 Primitives 不依赖任何**其它 asmdef**，`AssemblyDependencyTests.cs:16` 也把它断言成空数组。但 `noEngineReferences: false` 意味着 **UnityEngine 的程序集仍然被加进编译引用集**。

也就是说：现在往 `Core/Primitives/` 里加一行 `using UnityEngine;` 然后用 `Vector3`，**能编译通过**，架构测试**也不会红**——引擎引用不体现在 `references` 数组里，那个数组仍然是空的。

`02` §8 写的"不依赖任何 `UnityEngine.*`"目前是一条**靠自觉维持**的性质。改成 `"noEngineReferences": true` 就能把它变成编译期约束。

**这为什么重要？** 看 spec §8.1：

> The main repository **builds `Game.Core.Primitives.dll`** ... and exports those compiled public contracts into the Mod SDK release package.

`Game.Core.Primitives.dll` 是要**单独打包发给 Mod 作者**的。它越干净越好，理想情况下应该能在任何 .NET 环境里加载——包括未来的服务端校验工具、CI 里的 manifest 检查器、跨语言协议实现的对照测试。一旦它沾上 UnityEngine，这些场景全都要拖一个 Unity 引擎依赖进来。

⚠️ 但**只有 Primitives 和 ModApi 能这么改**。`Game.Core.Diagnostics` 用了 `UnityEngine.Debug`（`DiagnosticRouter.cs:19` 的默认 `sinkFailureHandler`，以及整个 `UnityConsoleDiagnosticSink`），必须保留引擎引用。`Game.ModApi` 当前代码里没用 UnityEngine，而它同样是要发给 Mod 作者的，同样值得改。

> **代价**：`noEngineReferences: true` 之后，那个程序集里连 `[SerializeField]`、`Debug.Log`、`Vector3` 都用不了。对 Primitives / ModApi 这两个纯契约层，这恰恰是想要的效果。

### 8.3 `Game.Framework.Conformance` 的引用集是一个可执行的证明

三个测试 asmdef 和 `Game.Framework.Conformance` 都有 `optionalUnityReferences: ["TestAssemblies"]`，让它们能引用 NUnit 和 Unity Test Framework。

但 **`Game.Framework.Conformance` 不是测试程序集**——它只放 `NeutralModuleFixture`（一个 `IModule` 的中性实现，39 行）。注意它的引用集：

```jsonc
// Game.Framework.Conformance.asmdef
"references": ["Game.Core.Primitives", "Game.ModApi"]
```

**只引用两个公共契约程序集。** 这是 spec §8.4 那行 "`Game.Framework.Conformance.*` | Internal non-shipping synthetic validation assemblies | **ModApi only** unless the test explicitly validates a contract dependency" 的落地。

这个约束的真正意义是：**`NeutralModuleFixture` 必须只用 Mod 作者能用的 API 写出来。** 如果它需要 `Game.Core.Context` 才能实现 `IModule`，那就证明公共契约不完整——**这个夹具本身就是"Mod 作者能不能只靠公共契约干活"的一个可执行证明**。

看它实际写了什么：

```csharp
// Tests/GameFramework/Conformance/NeutralModuleFixture.cs:14-19
Descriptor = new ModuleDescriptor(
    ModuleId.Parse("test.module"),
    ModuleVersion.Parse("0.1.0"),
    new[] { new CapabilityRequirement(CapabilityKey.Parse("test.required"), CapabilityVersion.Parse("1.0.0")) },
    new[] { new CapabilityRequirement(CapabilityKey.Parse("test.optional"), CapabilityVersion.Parse("1.0.0")) },
    new[] { new CapabilityProvision(CapabilityKey.Parse("test.provided"), CapabilityVersion.Parse("1.0.0")) });
```

必需能力、可选能力、提供的能力——三种声明各一个，全部用公共 API 构造出来了。这比任何架构测试都更有说服力：不是"我断言你没越界"，而是"**我用受限的 API 真的写出了一个能跑的模块**"。

这是 spec §6 原则 13（"Framework-only architectural validation"）最直接的体现，也是这份代码里我认为最优雅的一个设计。

### 8.4 `includePlatforms` 的一个容易误解的点

`Game.Framework.Editor`、`Game.Framework.Tests.EditMode`、`Game.ModSdk.Editor` 三个有 `includePlatforms: ["Editor"]`——它们**不会被打进 Player 构建**。

但 `Game.Framework.Tests.PlayMode` 的 `includePlatforms` 是**空数组**（= 所有平台）。所以它在理论上会进 Player 包——实际不会，因为 Unity Test Framework 通过 `optionalUnityReferences: ["TestAssemblies"]` 特殊处理了它（只在测试构建里包含）。

这是个容易误解的点：**`TestAssemblies` 标记本身承担了"不进正式包"的职责**，`includePlatforms` 留空是正确的（PlayMode 测试需要能在目标平台上跑）。

---

## 9. 可执行的改进清单

按"改动成本 / 收益"排序。每一条都给出具体位置和理由，可以直接开 issue。

### P0 — 低成本，明确收益

| # | 改动 | 位置 | 理由 |
|---|---|---|---|
| 1 | `"noEngineReferences": true` | `Game.Core.Primitives.asmdef`（并考虑 `Game.ModApi.asmdef`） | 把"纯 C# 契约层"从注释升级成编译期约束（§8.2）。这两个 DLL 要单独发给 Mod 作者，也可能被非 Unity 的工具链加载。 |
| 2 | 给 `DiagnosticAttributeSet` 写 struct enumerator | `Core/Primitives/Diagnostics/DiagnosticValues.cs:106` | 当前 `((IEnumerable<T>)items).GetEnumerator()` 装箱 + 堆分配。`UnityConsoleDiagnosticSink.Format` 里的 `foreach` 每格式化一条带属性的诊断就分配一次。 |
| 3 | `ModuleOperationResult` 补 `IEquatable<T>` + `GetHashCode`，或在 doc comment 里写明"不支持相等性比较" | `ModApi/Lifecycle/ModuleOperationResult.cs:40` | 当前落到 `ValueType.Equals` 的反射路径（§2.4）。 |
| 4 | 给"`ComparePrecedenceTo` 会抛异常"补文档 | `Core/Primitives/SemanticVersion.cs:88` 的 doc comment | 任何用 `PrecedenceComparer` 或默认 `Sort` 排序的代码，都必须先滤掉 `default`（§2.3）。目前只有读源码才知道。 |
| 5 | 补 `<=` / `>=`，或干脆把 `<` / `>` 也去掉 | `SemanticVersion.cs:144-146` | 当前 `a <= b` 编译不过，而 `a < b` 的语义又不是 SemVer（§2.2）。两条路都比现状清楚。 |

### P1 — 需要设计决定

| # | 改动 | 理由 |
|---|---|---|
| 6 | 给 `ModuleId` / `CapabilityKey` 实现 `IComparable<T>` | 项目对确定性要求很高（lockfile、网络握手）。将来枚举能力注册表时如果依赖 `Dictionary` 的枚举顺序，会引入不确定性。有了全序就能 `OrderBy(k => k)` 得到确定输出。 |
| 7 | 给"sink 必须线程安全"补一个测试 | §7.5。这条契约现在只在注释里，而且"现在恰好不会被违反"。 |
| 8 | 明确 `StableStringHash` 定义在 UTF-16 code unit 上 | §3.3。写进 `Core/Primitives/README.md`，供未来跨语言实现参考。 |
| 9 | 统一 `ModuleOperationError.GetHashCode` 的哈希来源 | §3.1。要么把 `Code` 改成 `DiagnosticEventName` 类型（哈希自动委托出去，还省掉 `IsValid` 里的重复解析），要么在 doc comment 里注明这个哈希不保证跨进程稳定。 |
| 10 | 给 `DiagnosticEvent` 的 `timestamp` 加 UTC 校验或归一化 | `DiagnosticValues.cs:153` 只校验 `!= default`。工厂默认注入 `UtcNow`，但公共构造函数允许任何 offset。日志里混入本地时间会让时序分析出错。 |

### P2 — 面向未来

| # | 改动 | 理由 |
|---|---|---|
| 11 | 引入 `VersionRange` 类型 | `CapabilityRequirement` 现在存的是**精确版本**（doc comment 原文 "the exact capability contract version"）。真实的依赖声明需要 `^1.2`、`>=1.0 <2.0` 这类区间——`06`/`07` 的 manifest 推测里已经在用 `1.x` 了，但类型不存在。这是 Context Runtime 之前必须先做的一块。 |
| 12 | 为 Session 子 scope 显式注册 `EntryPointExceptionHandler` | §4.1 第 3 条。一旦子 scope 开始注册 entry point，VContainer 会给它塞一个默认的 `Debug.LogException`，绕过框架的诊断管线（丢掉 correlationId / sessionId 归属）。 |
| 13 | 给"多 Session"留出扩展路径 | `SessionFactory.Release` 用 `ReferenceEquals(activeSession, session)` 判断（`:85`），是单 Session 假设的硬编码。若将来放开，需要改成集合 + 每个 Session 独立的 release 令牌。 |

---

## 10. 一句话总结

读完全部源码之后，我认为这份代码最值得学的不是任何单个技巧，而是它反复使用的一条元规则：

> **凡是能用类型系统、可见性、编译期配置强制的，就不要写进文档；凡是这三样都强制不了的，就写一个测试；凡是测试也守不住的，才写注释——并且注释里必须说明"为什么这里守不住"。**

按这条规则检查这份代码：

| 约束 | 用什么守 |
|---|---|
| Mod 不能引用 Context | asmdef 依赖 + `AssemblyDependencyTests` |
| 公共 API 不能泄漏内部类型 | `PublicApiSurfaceTests` 的**白名单**（不是黑名单） |
| `IModuleContext` 不能变成 service locator | `Module_context_is_not_an_unrestricted_service_locator`（反射查泛型方法） |
| 公共契约不能绑定 UniTask | 4 个独立测试，从 asmdef 和运行时 `GetReferencedAssemblies()` 两侧查 |
| 生命周期操作必须在主线程 | `IUnityMainThreadGuard` 运行时守 + 10 个 `LifecycleMainThreadTests` |
| 默认值必须无效 | 类型设计（三种手法，§1） |
| 隐式全局可达性 | `autoReferenced: false`（编译期，零维护） |
| 公共契约必须能被中性 Mod 实现 | `NeutralModuleFixture` + 它受限的 asmdef 引用集（可执行的证明） |
| **sink 必须线程安全** | **只有注释** ← 缺口 1 |
| **Primitives 不依赖 UnityEngine** | **只有注释** ← 缺口 2，本可以用 `noEngineReferences` 守住 |

最后两行就是这份代码目前离它自己的标准还差的那一点点。而能把清单列到这个粒度，恰恰说明这套标准是真的被贯彻了——如果只是零散地做，根本列不出这张表。

---

## 参考

- [SemVer 2.0.0 §10（build metadata）与 §11（precedence）](https://semver.org/spec/v2.0.0.html#spec-item-10)
- [FNV 哈希官方页面](http://www.isthe.com/chongo/tech/comp/fnv/)
- [Unity — Assembly Definition 属性说明](https://docs.unity3d.com/Manual/class-AssemblyDefinitionImporter.html)
- [.NET — `Task.ContinueWith` 与 `TaskScheduler.Current` 的陷阱](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.continuewith)
- [VContainer 文档](https://vcontainer.hadashikick.jp/)
- 本仓库内：`docs/superpowers/specs/2026-08-19-modular-game-harness-design.md` §6（13 条架构原则）、§8（程序集架构）、§11（Mod API 设计）
- 同目录笔记：[`00-Review-Report.md`](./00-Review-Report.md)（本篇的由来）、[`03-Bootstrap-Architecture.md`](./03-Bootstrap-Architecture.md)（Session 状态机全解）、[`05-Architecture-Enforcement.md`](./05-Architecture-Enforcement.md)（架构测试全解）
