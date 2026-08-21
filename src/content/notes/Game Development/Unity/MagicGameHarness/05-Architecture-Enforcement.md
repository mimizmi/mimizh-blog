# Magic Game Harness — 架构守门（Architecture Enforcement）

> 源码位置：`Assets/Tests/GameFramework/EditMode/Architecture/`
> 2 个文件 / ~450 行
> **这是用代码守 spec 的"测试宪兵"**——把架构约束从文档变成 CI 红线。

---

## 0. 为什么需要架构守门测试？

spec 第 8.2 节画了依赖方向，第 8.3 节列出 10 个 AOT 程序集。但**纸上的图不会自己守住自己**。

考虑这些"无意中的违规"：

| 违规 | 后果 |
|---|---|
| 有人给 `Game.Core.Primitives` 加了对 `Game.Core.Diagnostics` 的引用 | 破坏"Primitives 零依赖"约束 |
| 有人给 `Game.ModApi` 加了对 `VContainer` 的引用 | Mod 作者需要编译 VContainer |
| 有人把 `IUnityMainThreadGuard` 改成 `public` | Spec 明确说它必须 internal |
| 有人给 ModApi 加了 `class GameplayManager` | 破坏"genre-neutral"约束 |
| 有人偷偷把 `Game.Bootstrap` 升级 VContainer 1.20 | 锁版本测试立刻红 |

**没有架构测试**——这些违规要等"代码 review 时被发现"或"出 bug 后才被发现"。
**有了架构测试**——CI 立刻红，PR 不能合并。

---

## 1. 两个测试文件覆盖的 10 个维度

| 测试文件 | 行数 | 维度 |
|---|---|---|
| `AssemblyDependencyTests.cs` | 143 | ① asmdef 依赖图、② acyclic 检测、③ 第三方包白名单、④ 包版本锁、⑤ SDK 分发包内容 |
| `PublicApiSurfaceTests.cs` | 303 | ⑥ public surface 类型白名单、⑦ service-locator 反模式检测、⑧ genre-neutral 检测、⑨ private 类型未泄漏、⑩ 构造器签名 |

**加起来 10 个架构约束**，全部用 NUnit Assert 表达。

---

## 2. 维度一：依赖方向（`ExpectedReferences` 白名单）

**测试**：`Core_assembly_references_follow_the_approved_dependency_direction`

```csharp
static readonly Dictionary<string, string[]> ExpectedReferences = new Dictionary<string, string[]>
{
    ["Game.Core.Primitives"] = Array.Empty<string>(),
    ["Game.ModApi"] = new[] { "Game.Core.Primitives" },
    ["Game.Core.Diagnostics"] = new[] { "Game.Core.Primitives" },
    ["Game.Core.Context"] = new[] { "Game.Core.Primitives", "Game.ModApi" },
    ["Game.Bootstrap"] = new[]
    {
        "Game.Core.Primitives", "Game.ModApi", "Game.Core.Context", "Game.Core.Rules",
        "Game.Core.Networking", "Game.Core.Persistence", "Game.Core.HotUpdate", "Game.Core.Diagnostics", "VContainer",
    },
};

[Test]
public void Core_assembly_references_follow_the_approved_dependency_direction()
{
    var definitions = LoadFrameworkDefinitions();
    foreach (var expected in ExpectedReferences)
    {
        Assert.That(definitions, Contains.Key(expected.Key));
        Assert.That(definitions[expected.Key].references, Is.EqualTo(expected.Value), expected.Key);
    }

    foreach (var definition in definitions.Values.Where(value => value.name.StartsWith("Game.Core.", StringComparison.Ordinal)))
        Assert.That(definition.references, Does.Not.Contain("Game.Bootstrap"), definition.name);
}
```

**两个断言**：

#### (a) 期望引用必须**完全等于**白名单

```csharp
Assert.That(definitions[expected.Key].references, Is.EqualTo(expected.Value), expected.Key);
// ↑ 集合完全相同，不是子集！
```

**`Is.EqualTo` 而不是 `Is.SubsetOf`**——因为依赖方向是**严格单向**，多一个都不行。

#### (b) **所有 `Game.Core.*` 都不能引用 `Game.Bootstrap`**

```csharp
foreach (var definition in definitions.Values.Where(value => value.name.StartsWith("Game.Core.", StringComparison.Ordinal)))
    Assert.That(definition.references, Does.Not.Contain("Game.Bootstrap"), definition.name);
```

**Bootstrap 是"叶子"**——只能被外部引用，**不能反过来依赖 Core**。

### 2.1 如何加载 asmdef JSON？

```csharp
static Dictionary<string, AsmdefData> LoadFrameworkDefinitions()
{
    var root = Path.GetFullPath(Path.Combine(Application.dataPath, "GameFramework"));
    return Directory.GetFiles(root, "*.asmdef", SearchOption.AllDirectories)
        .Select(path => JsonUtility.FromJson<AsmdefData>(File.ReadAllText(path)))
        .ToDictionary(value => value.name);
}

[Serializable]
sealed class AsmdefData
{
    public string name;
    public string[] references;
}
```

**3 个步骤**：
1. **遍历** `Assets/GameFramework/**/*.asmdef`
2. **用 `JsonUtility.FromJson`** 解析——Unity 内置的 JSON 解析器，无需 Newtonsoft
3. **`[Serializable]` 标 `AsmdefData`**——`JsonUtility` 只认 `[Serializable]` 字段

**为什么不用 System.Text.Json？** 因为它在 Unity 6 之前可能不可用，且需要 NuGet 包。**JsonUtility 是 Unity 默认可用**。

---

## 3. 维度二：依赖图必须 acyclic

**测试**：`Project_assembly_graph_is_acyclic`

```csharp
[Test]
public void Project_assembly_graph_is_acyclic()
{
    var definitions = LoadFrameworkDefinitions();
    var states = new Dictionary<string, int>();
    foreach (var name in definitions.Keys) Visit(name, definitions, states);
}

static void Visit(string name, IReadOnlyDictionary<string, AsmdefData> definitions, IDictionary<string, int> states)
{
    if (states.TryGetValue(name, out var state))
    {
        if (state == 1) Assert.Fail($"Assembly dependency cycle detected at {name}.");
        if (state == 2) return;
    }
    states[name] = 1;        // ← 灰色（visiting）
    foreach (var dependency in definitions[name].references ?? Array.Empty<string>())
        if (definitions.ContainsKey(dependency)) Visit(dependency, definitions, states);
    states[name] = 2;        // ← 黑色（done）
}
```

### 3.1 三色 DFS 算法

**这是经典的**三色 DFS 环检测**算法**：

| 颜色 | 状态 | 值 |
|---|---|---|
| ⚪ 白 | 未访问 | 不在 `states` 里 |
| ⚫ 灰 | 正在访问（栈上）| `states[name] == 1` |
| ⚪ 黑 | 访问完 | `states[name] == 2` |

**环检测**：
- DFS 走到一个**灰色节点** → 这是 back edge → **环！**
- DFS 走到**黑色节点** → 已访问，跳过
- DFS 走到**白色节点** → 继续深入

### 3.2 为什么不用现成的图算法库？

**理由**：
- NUnit 跑在 Unity Test Runner 里——依赖要受控
- 这个算法 12 行——加库是 overkill
- **测试**的代码也要被测试守门——`Visit` 函数自己也很简单，自己看自己即可

### 3.3 `Assert.Fail` vs `throw`

```csharp
Assert.Fail($"Assembly dependency cycle detected at {name}.");
```

**故意用 `Assert.Fail`**——而不是 `throw new Exception(...)`——因为 NUnit 框架会捕获并报告（红 ✗），而裸抛异常可能不被识别为"测试失败"。

---

## 4. 维度三：第三方包隔离

### 4.1 公共契约层不能依赖第三方包

**测试**：`Contract_assemblies_declare_no_third_party_async_or_container_dependency`

```csharp
[Test]
public void Contract_assemblies_declare_no_third_party_async_or_container_dependency()
{
    var definitions = LoadFrameworkDefinitions();
    var forbidden = new[] { "UniTask", "Cysharp", "VContainer", "Unity.Netcode", "Addressables", "HybridCLR" };

    foreach (var name in new[] { "Game.Core.Primitives", "Game.ModApi", "Game.Core.Diagnostics" })
    {
        Assert.That(definitions, Contains.Key(name));
        foreach (var reference in definitions[name].references ?? Array.Empty<string>())
            foreach (var fragment in forbidden)
                Assert.That(
                    reference,
                    Does.Not.Contain(fragment).IgnoreCase,
                    $"{name} must not reference {fragment}.");
    }
}
```

**3 个 contract 程序集** × **6 个 forbidden 包** = **18 个断言**。

**`IgnoreCase`** — `"UniTask"` 和 `"unitask"` 都拒掉。

### 4.2 Bootstrap 允许 VContainer，不允许 UniTask

**测试**：`Bootstrap_declares_no_third_party_async_dependency`

```csharp
[Test]
public void Bootstrap_declares_no_third_party_async_dependency()
{
    var definitions = LoadFrameworkDefinitions();
    Assert.That(definitions, Contains.Key("Game.Bootstrap"));

    foreach (var reference in definitions["Game.Bootstrap"].references ?? Array.Empty<string>())
        foreach (var fragment in new[] { "UniTask", "Cysharp" })
            Assert.That(
                reference,
                Does.Not.Contain(fragment).IgnoreCase,
                $"Game.Bootstrap must not reference {fragment}.");
}
```

**只查 `UniTask` 和 `Cysharp`**（UniTask 的命名空间）——不查 VContainer，因为 **Bootstrap **故意**引用 VContainer**。

**为什么 Bootstrap 可以引 VContainer**？因为 Bootstrap 是 private 实现层（不进 Mod SDK），它的依赖只影响**主程序**，不影响 Mod 作者。

### 4.3 注释解释了为什么

```csharp
/// <summary>
/// The contract assemblies must stay free of third-party async and container dependencies.
/// UniTask may be used later inside private implementation assemblies, but never here: a Mod
/// author must not have to compile against a specific UniTask version to implement the
/// public lifecycle contract.
/// </summary>
```

**注释直接引用了 spec 第 1 节的目标**——**Mod 作者不应该被迫 import UniTask**。这条规则不是作者偏好，是 spec 要求。

---

## 5. 维度四：包版本锁

**测试**：`Relevant_package_versions_are_unchanged`

```csharp
[Test]
public void Relevant_package_versions_are_unchanged()
{
    var packages = PackageInfo.GetAllRegisteredPackages().ToDictionary(package => package.name, package => package.version);
    Assert.That(packages["jp.hadashikick.vcontainer"], Is.EqualTo("1.19.0"));
    Assert.That(packages["com.unity.test-framework"], Is.EqualTo("1.6.0"));
    Assert.That(packages["com.unity.addressables"], Is.EqualTo("2.9.1"));
    Assert.That(packages["com.unity.netcode.gameobjects"], Is.EqualTo("2.13.1"));
    Assert.That(packages["com.unity.pipeline"], Is.EqualTo("0.5.0-exp.1"));
}
```

**5 个包 × 1 个版本断言** = 5 个硬编码版本号。

**为什么锁版本**：
- **VContainer 1.19.0 → 1.20.0**：可能引入 breaking change
- **Netcode 2.13.1 → 2.14.0**：自定义消息系统可能变
- **Addressables / test-framework / com.unity.pipeline**：构建与测试基础设施，版本漂移会让 CI 结果不可复现

**为什么只锁这 5 个？** 看 `Packages/manifest.json` 就清楚了——它一共有 60 多条依赖，但其中三条是 **git URL** 形式：

```jsonc
"com.code-philosophy.hybridclr": "https://github.com/focus-creative-games/hybridclr_unity.git",
"com.cysharp.unitask":           "https://github.com/Cysharp/UniTask.git?path=src/UniTask/Assets/Plugins/UniTask",
"jp.hadashikick.vcontainer":     "https://github.com/hadashiA/VContainer.git?path=VContainer/Assets/VContainer#1.19.0",
```

git 依赖**没有可断言的注册表版本号**——除非像 VContainer 那样在 URL 里挂了 `#1.19.0` 这样的 tag，`PackageInfo.version` 才会报出 `"1.19.0"`。HybridCLR 和 UniTask 都没挂 tag，所以它们**没法**进这个版本锁测试。锁的是"能锁的那部分"，不是"重要的那部分"。

> ⚠️ **HybridCLR 和 UniTask 都已经安装在项目里**——这不是"当前没引用"。而这恰恰是那批"禁止引用 UniTask"的测试（`Contract_assemblies_declare_no_third_party_async_or_container_dependency`、`Public_contract_assemblies_do_not_depend_on_UniTask`、`Bootstrap_declares_no_third_party_async_dependency`、`Enforcing_the_main_thread_policy_introduced_no_UniTask_dependency`）**有意义的前提**：UniTask 就躺在依赖里，`using Cysharp.Threading.Tasks;` 随时能写出来、随时能编译过。测试守的是"虽然装了但公共契约不许碰"，而不是"没装所以碰不到"。
>
> 这也是 `AssemblyDependencyTests.cs:49-54` 那段注释的意思：
>
> > UniTask may be used later inside **private implementation** assemblies, but never here: a Mod author must not have to compile against a specific UniTask version to implement the public lifecycle contract.
>
> 换句话说这不是"禁用 UniTask"，而是**把它挡在公共契约之外**——将来 Context Runtime 内部完全可以用 UniTask 优化分配，只要它不出现在 `Game.ModApi` 的任何签名或引用里。

**`PackageInfo.GetAllRegisteredPackages()`** — Unity API，**直接读 Unity PackageManager**——比读 `Packages/manifest.json` 更可靠（manifest 可能脱节于实际安装）。

### 5.1 锁版本是双刃剑

**好处**：
- 防止"昨天还工作的代码今天坏了"
- CI 红 → 知道是版本更新引入的回归

**坏处**：
- **必须**手动更新版本号（不能自动 bump）
- **如果忽略测试**，版本会被锁死，新版本修的 bug 进不来

**正确做法**：升级包时**同步更新**这个测试的期望值，并在 PR 描述里说明升级原因。

---

## 6. 维度五：SDK 分发边界

**测试**：`Distributed_sdk_contains_no_private_source_or_contract_binaries`

```csharp
[Test]
public void Distributed_sdk_contains_no_private_source_or_contract_binaries()
{
    var root = Path.GetFullPath(Path.Combine(Application.dataPath, "../Packages/com.mimizh.game-mod-sdk"));
    var sources = Directory.GetFiles(root, "*.cs", SearchOption.AllDirectories);
    var forbiddenArtifacts = Directory.GetFiles(root, "*.*", SearchOption.AllDirectories)
        .Where(path => path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".xml", StringComparison.OrdinalIgnoreCase));

    Assert.That(sources.Select(Path.GetFileName), Is.EquivalentTo(new[] { "AssemblyAnchor.cs", "AssemblyAnchor.cs" }));
    Assert.That(forbiddenArtifacts, Is.Empty);
    Assert.That(sources.Any(path => path.Contains("GameFramework")), Is.False);
}
```

### 6.1 3 个断言

#### (a) SDK 里**只有** AssemblyAnchor.cs

```csharp
Assert.That(sources.Select(Path.GetFileName), Is.EquivalentTo(new[] { "AssemblyAnchor.cs", "AssemblyAnchor.cs" }));
//                                                                ↑ 注意：两个，因为 Templates~/ 或 Tests/ 都有同名文件
```

`Is.EquivalentTo` 而不是 `Is.EqualTo`——**不要求顺序**。

#### (b) 不能有 .dll 或 .xml

```csharp
Assert.That(forbiddenArtifacts, Is.Empty);
```

**禁止预先编译的 DLL 在 SDK 包里**——因为 Mod 作者应该自己编译，SDK 提供的 DLL 会被作者覆盖。

#### (c) 不能含 GameFramework 路径

```csharp
Assert.That(sources.Any(path => path.Contains("GameFramework")), Is.False);
```

**防止**有人把 `Assets/GameFramework` 的源码意外拷到 SDK 包。

### 6.2 测试体现 spec 第 8.1 节

spec 第 8.1 节说 SDK 必须**不含**：
- `Game.Core.Context`
- `Game.Core.Rules`
- `Game.Core.Networking`
- `Game.Core.Persistence`
- `Game.Core.HotUpdate`
- `Game.Core.Diagnostics`
- `Game.Bootstrap`

**当前实现方式**：SDK 包里只有 AssemblyAnchor（空 anchor），**任何**额外的源码都会让 `sources.Select(Path.GetFileName)` 失败。

**未来实现方式**：SDK 包里会放 `Game.Core.Primitives.dll`、`Game.ModApi.dll` 和 XML doc——测试要相应更新（放过这两个 DLL）。

---

## 7. 维度六：API surface 白名单（Allowlist）

**测试**：`Public_mod_api_signatures_use_only_BCL_and_public_contract_types`

```csharp
static readonly string[] ForbiddenFragments =
{
    "VContainer", "UnityEngine", "Cysharp", "UniTask", "Unity.Netcode",
    "Unity.Addressables", "HybridCLR",
    "Game.Core.Context", "Game.Core.Diagnostics", "Game.Bootstrap",
};

static readonly string[] AllowedAssemblies =
{
    "Game.Core.Primitives",
    "Game.ModApi",

    // The BCL, across the runtimes Unity may report for these types.
    "mscorlib", "System", "System.Core", "System.Private.CoreLib", "System.Runtime",
    "System.Collections", "System.Threading", "System.Threading.Tasks", "netstandard",
};

[Test]
public void Public_mod_api_signatures_use_only_BCL_and_public_contract_types()
{
    var assembly = typeof(IModule).Assembly;
    foreach (var type in assembly.GetExportedTypes())
    {
        AssertTypeIsAllowed(type);
        foreach (var memberType in GetPublicMemberTypes(type))
            AssertTypeIsAllowed(memberType);
    }
}
```

### 7.1 Allowlist vs Blacklist 的设计哲学

```csharp
/// <summary>
/// The only assemblies a public Mod API signature may draw types from. This is an allowlist
/// on purpose: a blacklist would need a new entry for every third-party package added to the
/// project, and would silently pass the first time one was missed.
/// </summary>
static readonly string[] AllowedAssemblies = { ... };
```

**Allowlist 的好处**：
- 添加新第三方包时**默认不允许**（"fail-safe"）
- 引入前必须显式加白
- 每次 review 都看得见

**Blacklist 的坏处**：
- 添加新包时**默认允许**
- 如果忘了加黑名单，**默默通过**
- 一旦泄漏，回滚需要重新加黑名单

**`AllowedAssemblies` + `ForbiddenFragments` 双层防御**——allowlist 是"白名单"（必须在这几个里），forbidden 是"已知坏人"（这些字符串绝对不能出现）。

### 7.2 遍历所有 public 类型

```csharp
foreach (var type in assembly.GetExportedTypes())
{
    AssertTypeIsAllowed(type);
    foreach (var memberType in GetPublicMemberTypes(type))
        AssertTypeIsAllowed(memberType);
}

static IEnumerable<Type> GetPublicMemberTypes(Type type)
{
    foreach (var constructor in type.GetConstructors())
        foreach (var parameter in constructor.GetParameters())
            yield return parameter.ParameterType;
    foreach (var property in type.GetProperties())
        yield return property.PropertyType;
    foreach (var method in type.GetMethods().Where(method => !method.IsSpecialName))
    {
        yield return method.ReturnType;
        foreach (var parameter in method.GetParameters())
            yield return parameter.ParameterType;
    }
}
```

**3 个反射检查**：
- 构造器参数类型
- 属性类型
- 方法返回类型 + 参数类型

**`!method.IsSpecialName`** — 排除 `op_Equality`、`get_Item` 这种编译器生成的特殊方法（避免噪音）。

### 7.3 类型展开（数组、指针、泛型）

```csharp
static void AssertTypeIsAllowed(Type type)
{
    if (type == null) return;
    if (type.IsByRef || type.IsPointer || type.IsArray)
    {
        AssertTypeIsAllowed(type.GetElementType());  // ← 递归剥开
        return;
    }
    if (type.IsGenericParameter) return;             // ← T 这种 generic param 不查
    if (type.IsGenericType)
    {
        foreach (var argument in type.GetGenericArguments())
            AssertTypeIsAllowed(argument);            // ← 泛型参数也要查
        type = type.GetGenericTypeDefinition();       // ← List<int> → List<>
    }

    var fullName = type.FullName ?? type.Name;
    var assembly = type.Assembly.GetName().Name;
    Assert.That(AllowedAssemblies, Contains.Item(assembly), $"...");
    foreach (var forbidden in ForbiddenFragments)
        Assert.That(fullName, Does.Not.Contain(forbidden), $"...");
}
```

**5 个边界**：
1. `null` — `void` 等
2. `IsByRef` / `IsPointer` / `IsArray` — 剥开 element type
3. `IsGenericParameter` — `T`（开放泛型）
4. `IsGenericType` — `List<int>` 要查 `List<>` 也要查 `int`
5. `FullName ?? Name` — 有些 dynamic 类型没有 FullName

---

## 8. 维度七：service-locator 反模式检测

**测试**：`Module_context_is_not_an_unrestricted_service_locator`

```csharp
[Test]
public void Module_context_is_not_an_unrestricted_service_locator()
{
    var methods = typeof(IModuleContext).GetMethods();
    Assert.That(methods.Any(method => method.Name.StartsWith("Resolve", StringComparison.Ordinal)), Is.False);
    Assert.That(methods.Any(method => method.IsGenericMethod), Is.False);
}
```

**2 个断言**：

| 断言 | 阻止的反模式 |
|---|---|
| 无方法名以 `Resolve` 开头 | `Resolve<T>()` service locator 模式 |
| 无泛型方法 | `Resolve<T>(string key)` 这种"按 key 查"反模式 |

**为什么禁？** spec 第 6.1 节"Stable contracts, replaceable implementations"——Mod 作者不应该**自己解析服务**，而是**通过具体的能力注册接口**。如果 `IModuleContext` 有 `Resolve<T>`，Mod 就会开始**直接拿** Context Runtime 的内部服务，导致循环依赖。

---

## 9. 维度八：Genre-neutral 词表

**测试**：`Public_contract_vocabulary_is_genre_and_product_neutral`

```csharp
[Test]
public void Public_contract_vocabulary_is_genre_and_product_neutral()
{
    var forbidden = new[]
    {
        "Gameplay", "Survival", "Card", "Board", "Rpg", "Strategy", "World",
        "Inventory", "Recipe", "Building", "OfficialContent", "ProductModule",
    };
    foreach (var type in typeof(IModule).Assembly.GetExportedTypes())
    {
        foreach (var word in forbidden)
        {
            Assert.That(type.FullName, Does.Not.Contain(word).IgnoreCase, type.FullName);
            foreach (var member in type.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
                Assert.That(member.Name, Does.Not.Contain(word).IgnoreCase, $"{type.FullName}.{member.Name}");
        }
    }
}
```

**12 个 forbidden word** × **所有 public type 全名** × **所有 public member 名字** = **几十个断言**。

**`BindingFlags.DeclaredOnly`** — 只查**直接声明的**成员，不查继承的（避免噪音）。

**12 个词的来源**：
- **类型**：`Gameplay`、`Survival`、`Card`、`Board`、`Rpg`、`Strategy`、`World`、`Inventory`、`Recipe`、`Building` — 都是游戏类型词汇
- **产品**：`OfficialContent`、`ProductModule` — spec 禁止的内容

**`IgnoreCase`** — `GamePlay` 和 `gameplay` 都不允许。

### 9.1 为什么需要这个测试？

spec 第 1 节：

> The framework deliverable intentionally contains no genre implementation, gameplay skeleton, official gameplay mod, or community mod.

**Genre-neutral 是 spec 的核心要求**——如果有人在 ModApi 里加了 `IInventoryManager`，spec 就破了。

**测试用词表方式**——简单暴力，但**有效**。

---

## 10. 维度九：Private 类型未泄漏

### 10.1 SessionLifetime 必须 private

**测试**：`Session_lifetime_and_cancellation_stay_private_to_bootstrap`

```csharp
[Test]
public void Session_lifetime_and_cancellation_stay_private_to_bootstrap()
{
    var bootstrap = typeof(Game.Bootstrap.ApplicationLifecycleCoordinator).Assembly;
    var lifetime = bootstrap.GetType("Game.Bootstrap.Session.ISessionLifetime");
    var implementation = bootstrap.GetType("Game.Bootstrap.Session.SessionLifetime");

    Assert.That(lifetime, Is.Not.Null, "The Session lifetime contract must exist.");
    Assert.That(implementation, Is.Not.Null);
    Assert.That(lifetime.IsPublic, Is.False, "The Session lifetime contract must stay private.");
    Assert.That(implementation.IsPublic, Is.False);

    Assert.That(
        typeof(IModule).Assembly.GetExportedTypes().Any(type => type.Name.Contains("SessionLifetime")),
        Is.False,
        "The Session lifetime must not be exported from the Mod API.");
    Assert.That(
        bootstrap.GetExportedTypes().Any(type => type.Name.Contains("SessionLifetime")),
        Is.False,
        "The Session lifetime must not be publicly exported at all.");
}
```

**5 个断言**：

| 断言 | 守住什么 |
|---|---|
| `lifetime != null` | 类型必须存在 |
| `lifetime.IsPublic == false` | 不能变 public |
| `implementation.IsPublic == false` | 同上 |
| ModApi **不导出**含 `SessionLifetime` 的类型 | 防泄漏到 Mod SDK |
| Bootstrap **不导出**含 `SessionLifetime` 的类型 | 防 private 变 public |

**双重检查**：
1. **存在性**（`Not.Null`）
2. **可见性**（`Is.Public == false`）
3. **跨程序集导出**（`GetExportedTypes`）

### 10.2 UnityMainThreadGuard 必须 private

**测试**：`Unity_main_thread_guard_stays_private_to_bootstrap`

```csharp
[Test]
public void Unity_main_thread_guard_stays_private_to_bootstrap()
{
    var bootstrap = typeof(Game.Bootstrap.ApplicationLifecycleCoordinator).Assembly;
    var contract = bootstrap.GetType("Game.Bootstrap.Threading.IUnityMainThreadGuard");
    var implementation = bootstrap.GetType("Game.Bootstrap.Threading.UnityMainThreadGuard");

    Assert.That(contract, Is.Not.Null);
    Assert.That(implementation, Is.Not.Null);
    Assert.That(contract.IsPublic, Is.False, "The guard contract must stay private to Game.Bootstrap.");
    Assert.That(implementation.IsPublic, Is.False, "The guard implementation must stay private to Game.Bootstrap.");
    Assert.That(
        contract.IsAssignableFrom(implementation),
        Is.True,
        "The implementation must satisfy the guard contract.");

    foreach (var assembly in new[] { typeof(IModule).Assembly, typeof(Game.Core.Primitives.SemanticVersion).Assembly, bootstrap })
        Assert.That(
            assembly.GetExportedTypes().Any(type => type.Name.Contains("MainThreadGuard")),
            Is.False,
            $"{assembly.GetName().Name} must not export the main-thread guard.");
}
```

**新增**：`contract.IsAssignableFrom(implementation)` — **确保实现满足接口**（不能只是空 anchor）。

---

## 11. 维度十：构造器签名守门

**测试**：`Application_root_owns_an_explicit_session_shutdown_path`

```csharp
[Test]
public void Application_root_owns_an_explicit_session_shutdown_path()
{
    var coordinator = typeof(Game.Bootstrap.ApplicationLifecycleCoordinator);

    var shutdown = coordinator.GetMethod("ShutdownAsync");
    Assert.That(shutdown, Is.Not.Null);
    Assert.That(shutdown.ReturnType, Is.EqualTo(typeof(Task)));
    Assert.That(
        shutdown.GetParameters().Single().ParameterType,
        Is.EqualTo(typeof(System.Threading.CancellationToken)));

    Assert.That(
        typeof(IDisposable).IsAssignableFrom(coordinator),
        Is.True,
        "The App root must still provide the synchronous disposal fallback.");

    // The composition constructor is internal: it takes the private main-thread guard
    var constructor = coordinator
        .GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
        .Single();
    Assert.That(
        constructor.GetParameters().Any(parameter => parameter.ParameterType == typeof(Game.Bootstrap.Session.SessionFactory)),
        Is.True,
        "The App root must depend on the Session factory so it can stop the active Session.");
    Assert.That(
        coordinator.GetConstructors(),
        Is.Empty,
        "The application root must not be publicly constructible.");
}
```

**6 个断言**：

| 断言 | 守住什么 |
|---|---|
| `ShutdownAsync` 存在 | 不能删掉 |
| 返回 `Task` | 不能换成 UniTask |
| 单一参数 `CancellationToken` | 不能换成自定义类型 |
| 实现 `IDisposable` | 必须有同步 fallback |
| 构造器参数含 `SessionFactory` | 必须能 stop active session |
| `GetConstructors()` (只看 public) 为空 | **public 构造器不能存在**（必须是 internal） |

### 11.1 为什么"public 构造器为空"是断言？

```csharp
Assert.That(
    coordinator.GetConstructors(),
    Is.Empty,
    "The application root must not be publicly constructible.");
```

**`GetConstructors()`** 不带 `BindingFlags` 时**只返回 public 构造器**。**空 = 没有 public 构造器**。

这强制 `ApplicationLifecycleCoordinator` 的构造器**必须是 `internal`**——这样 VContainer 才能通过 `RegisterEntryPoint` 构造它，但**外部代码不能 `new` 它**。

**对比**：

```csharp
GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).Single();
// ↑ 包含 internal，所以 Single() = 1
// ↑ 这是为了下一个断言（拿构造器参数）

GetConstructors()
// ↑ 只 public，所以 Empty()
// ↑ 验证没有 public 构造器
```

---

## 12. 测试密度与覆盖

| 测试 | 守门维度 | 断言数量（估算）|
|---|---|---|
| `Core_assembly_references_follow_the_approved_dependency_direction` | 依赖方向 | ~20 |
| `Project_assembly_graph_is_acyclic` | acyclic | 1（DFS 调用）|
| `Contract_assemblies_declare_no_third_party_async_or_container_dependency` | 第三方包 | ~18 |
| `Bootstrap_declares_no_third_party_async_dependency` | 第三方包 | ~2 |
| `Relevant_package_versions_are_unchanged` | 版本锁 | 5 |
| `Distributed_sdk_contains_no_private_source_or_contract_binaries` | SDK 边界 | 3 |
| `Public_mod_api_signatures_use_only_BCL_and_public_contract_types` | API surface | ~50 |
| `Module_context_is_not_an_unrestricted_service_locator` | 反模式 | 2 |
| `Module_lifecycle_uses_standard_repeatable_Task_contracts` | Async policy | 2 |
| `Public_contract_vocabulary_is_genre_and_product_neutral` | Genre-neutral | ~100 |
| `Public_contract_assemblies_do_not_depend_on_UniTask` | Async policy | 6 |
| `Session_lifetime_and_cancellation_stay_private_to_bootstrap` | Private leak | 5 |
| `Unity_main_thread_guard_stays_private_to_bootstrap` | Private leak | 8 |
| `Enforcing_the_main_thread_policy_introduced_no_UniTask_dependency` | Async policy | 8 |
| `Application_root_owns_an_explicit_session_shutdown_path` | 构造器签名 | 6 |

**~240 个架构断言**——用代码守住 spec 的每一行。

---

## 13. 这套测试可以学什么？

### 13.1 三种"读取约束"的方法

| 约束来源 | 读取方式 | 测试方法 |
|---|---|---|
| **asmdef 依赖** | 文件系统 + JSON 解析 | `JsonUtility.FromJson<AsmdefData>` |
| **运行时包** | Unity PackageInfo API | `PackageInfo.GetAllRegisteredPackages()` |
| **API surface** | .NET 反射 | `Assembly.GetExportedTypes()` |
| **private 可见性** | .NET 反射 | `Type.IsPublic` |
| **构造器签名** | .NET 反射 | `GetConstructors() / GetParameters()` |
| **方法签名** | .NET 反射 | `GetMethod / GetParameters` |
| **SDK 文件** | 文件系统 | `Directory.GetFiles` |
| **genre 词表** | 字符串匹配 | `Does.Not.Contain` |

### 13.2 测试断言的精确度

```csharp
// ❌ 太松：
Assert.That(references.Length, Is.GreaterThan(0));

// ✅ 太严（白名单完整匹配）：
Assert.That(definitions[expected.Key].references, Is.EqualTo(expected.Value), expected.Key);
```

**严格匹配（Is.EqualTo）** 是架构测试的**正确姿势**——你必须**精确**知道依赖是什么，**不能模糊**。

### 13.3 自描述的失败消息

```csharp
Assert.That(
    reference,
    Does.Not.Contain(fragment).IgnoreCase,
    $"{name} must not reference {fragment}.");
```

**第三参数是失败消息**——失败时 NUnit 会显示："Game.ModApi must not reference UniTask."——比默认的"Expected: not contain 'UniTask' but: ..."可读得多。

### 13.4 Allowlist vs Blacklist 的选择

| 场景 | 用 Allowlist | 用 Blacklist |
|---|---|---|
| **API surface** | ✅（默认不允许新包）| ❌ |
| **genre 词表** | ❌（无限词汇）| ✅（"Gameplay" 等明确禁止）|
| **第三方包** | ✅（contract 层：只允许 BCL + Primitives + ModApi）| ✅（Bootstrap：只禁止 UniTask）|

**原则**：
- **防止意外的依赖**→ Allowlist（fail-safe）
- **防止已知错误**→ Blacklist（cheap second signal）

`PublicApiSurfaceTests` 用 allowlist + blacklist**两层**——这是好做法。

---

## 14. 我对架构守门测试的整体评价

### 优点

1. **10 个维度全覆盖**——依赖方向、版本、API surface、private 泄漏、反模式、genre、构造器、SDK 边界
3. **Allowlist 为主**——fail-safe，新依赖默认禁止
4. **失败消息自描述**——grep 友好的错误消息
5. **反射 + 白名单 + 黑名单三层**——任何一处漏掉都被另一处抓住
6. **测试代码本身就是文档**——读完测试就知道 spec 怎么落到代码

### 局限与可改进点

1. **`AssemblyDependencyTests` 只检查 5 个程序集**——Rules/Networking/Persistence/HotUpdate 还都是空 anchor。**等 Context Runtime 实现后**这测试会自动覆盖。
2. **`Genre_vocabulary` 黑名单可能漏掉**——比如加 `Mmo` 或 `Fps` 这种缩写，黑名单没列。**需要每次新游戏类型时手动加**。
3. **测试依赖 Unity Editor API**（`Application.dataPath`、`PackageInfo`）——不能纯 .NET runner 跑。
4. **`Visit` 函数的 cycle detection 不抛具体异常**——只 `Assert.Fail`。可以换成 `throw new InvalidOperationException` 让 CI 抓得更明确。
5. **没有"过期测试"提醒**——比如 package 版本锁过期了，没人主动改测试就永远过期。

### 可借鉴的设计模式

| 模式 | 适用 | 学习难度 |
|---|---|---|
| 三色 DFS 环检测 | 任何"图必须无环"的约束（依赖、状态机、schema）| 🟢 简单 |
| 反射 + Allowlist 守 API | 任何 SDK / 公共包 | 🟡 中等 |
| Genre-neutral 词表 | 任何"通用框架"项目 | 🟢 简单 |
| 包版本锁 | 任何依赖第三方库的项目 | 🟢 简单 |
| 构造器签名守门 | 任何"组合根"模式 | 🟢 简单 |
| `Is.EqualTo` 严格匹配 | 任何"必须严格等于"的约束 | 🟢 简单 |

---

## 15. 与 spec 对照

| spec 章节 | 守门测试 |
|---|---|
| 8.1 Source Distribution Boundary | `Distributed_sdk_contains_no_private_source_or_contract_binaries` |
| 8.2 Dependency Direction | `Core_assembly_references_follow_the_approved_dependency_direction` |
| 11.1 Namespace Policy（genre-neutral） | `Public_contract_vocabulary_is_genre_and_product_neutral` |
| 11.2 Stable Contracts | `Public_mod_api_signatures_use_only_BCL_and_public_contract_types` |
| Async Policy (Task vs UniTask) | `Bootstrap_declares_no_third_party_async_dependency` 等 3 个 |
| Main-thread policy | `Enforcing_the_main_thread_policy_introduced_no_UniTask_dependency` |

---

## 16. 关键 takeaway

读完架构守门，最大的认知收获：

> **架构约束 = 文档约束 + 测试约束。文档约束是 spec，测试约束是 CI。两者必须同步。**

具体到这个项目：
- **10 个架构测试**对应 **spec 的 10 条架构规则**
- **每个测试有 doc comment** 说明 spec 出处
- **失败消息直接引用 spec 章节**——出问题时能 grep 到

这套模式可以应用到：
- **微服务架构**（服务依赖图必须 acyclic）
- **Monorepo**（包依赖方向）
- **插件系统**（host API 不能泄漏到插件）
- **SDK 设计**（第三方包依赖必须守门）

---

## 17. 整套阅读路线图（5 篇笔记合集）

读完 5 篇笔记，你对 magic-game-harness-unity 应该有完整的理解：

| # | 笔记 | 核心内容 |
|---|---|---|
| 1 | [项目总览](./01-Index.md) | 15 个 asmdef（10 个 AOT 产品程序集）的依赖图、设计原则、阅读路线 |
| 2 | [Primitives 深度解读](./02-Primitives-Deep-Dive.md) | 命名空间 ID、SemVer 2.0.0、Compat ID、Runtime ID、诊断原语 |
| 3 | [Bootstrap 架构](./03-Bootstrap-Architecture.md) | VContainer 装配、App/Session 状态机、主线程守门、诊断路由 |
| 4 | [ModApi 契约](./04-ModApi-Contract-Surface.md) | 11 个 public 类型、Module 加载契约、safe message |
| 5 | [架构守门](./05-Architecture-Enforcement.md)（本篇）| 依赖方向、API surface、genre-neutral、第三方包隔离 |
| 6 | [实现思路深挖](./09-Implementation-Deep-Dives.md) | 值类型哨兵、比较语义矩阵、VContainer 装配、拒绝协议、失败账本、asmdef 强制 |
| — | [审查报告](./00-Review-Report.md) | 本系列的勘误、证据与修订记录 |

### 学习的核心概念（贯穿全系列）

| 概念 | 体现位置 |
|---|---|
| **readonly struct + 私有构造 + Parse/TryParse** | Primitives 全部值对象 |
| **FNV-1a + Ordinal 比较** | 跨进程稳定的 hash/比较 |
| **状态机 + memoization + 双层失败** | Session、ApplicationLifecycleCoordinator |
| **锁持有时间最小化** | Session.RunStop / ApplicationLifecycleCoordinator.RunShutdown |
| **Allowlist vs Blacklist** | API surface 守门 |
| **Defense in depth** | UnityMainThreadGuard 三层守门 |
| **构造时验证 + 默认值无效** | 所有 readonly struct 的 `IsValid` |
| **"safe caller-facing"错误模型** | ModuleOperationResult + ModuleOperationError |
| **测试守门** | 10 个架构测试 = 240 个断言 |

### 学习曲线建议

| 阶段 | 时间投入 | 完成度 |
|---|---|---|
| 读完 5 篇笔记 | ~3 小时 | 100% 概念理解 |
| 把 Primitives 单独跑测试 | ~1 小时 | 验证理解 |
| 试着给 Primitives 加新 ID 类型 | ~2 小时 | 实践模式 |
| 给 Session 加一个新状态 | ~3 小时 | 实践状态机 |
| 试着让 Context Runtime 解析 capability | ~10 小时 | 触及下一个 plan |

---

## 参考链接

- [三色 DFS 环检测](https://en.wikipedia.org/wiki/Three-color_algorithm)
- [.NET Reflection API](https://learn.microsoft.com/en-us/dotnet/api/system.reflection)
- [Unity JsonUtility](https://docs.unity3d.com/ScriptReference/JsonUtility.html)
- [Unity PackageInfo](https://docs.unity3d.com/ScriptReference/PackageManager.PackageInfo.html)

---

## 附：本篇的勘误与延伸

本篇是 8 篇里事实密度最高、错误最少的一篇——所引用的测试名、代码片段全部与仓库逐字一致。审查只发现两处：§1 标题的维度数（写 5，正文列 10）、以及 §5 说 HybridCLR "当前没引用"（实际它在 `manifest.json` 里，只是 git URL 依赖没有可断言的版本号）。均已就地修正并补充了完整解释。证据见 [`00-Review-Report.md`](./00-Review-Report.md) §1.2（A-11）与 §8。

**本篇讲的是"测试怎么守规则"，但项目里还有一层守门不需要测试**——见 [`09-Implementation-Deep-Dives.md` §8](./09-Implementation-Deep-Dives.md)：

- **`autoReferenced: false`**（全部 15 个 asmdef 都开了）在**编译期**阻止 `Assembly-CSharp` 隐式引用任何框架程序集。零维护、无需断言。
- **`noEngineReferences`** 是一个**没用起来**的机会：`Game.Core.Primitives.asmdef` 现在是 `false`，所以往 Primitives 里写 `using UnityEngine;` 能编译过，而架构测试**不会红**（引擎引用不体现在 `references` 数组里）。`02` §8 说的"不依赖任何 `UnityEngine.*`"目前靠自觉维持。
- **`Game.Framework.Conformance` 的引用集**（只有 `Game.Core.Primitives` + `Game.ModApi`）本身就是一个**可执行的证明**：`NeutralModuleFixture` 必须只用 Mod 作者能用的 API 写出来。这比"我断言你没越界"更强——它是"我用受限的 API 真的写出了一个能跑的模块"。

按"能强制的就不写文档"这条标准检查全项目，目前只剩两个缺口：**sink 必须线程安全**、**Primitives 不依赖 UnityEngine**——两者都只有注释在守。清单见 [`09` §10](./09-Implementation-Deep-Dives.md)。
- [Allowlist vs Blacklist in Software Architecture](https://en.wikipedia.org/wiki/Whitelist)
- [Architecture Tests as Code (演讲)](https://www.youtube.com/results?search_query=architecture+tests+net)

---

**系列完结。**这 5 篇笔记覆盖了 magic-game-harness-unity 当前的所有实现（脚手架 + Primitives + Bootstrap + ModApi + 架构守门），让你在不打开 Unity 编辑器的情况下，对这个项目有完整的源码级理解。