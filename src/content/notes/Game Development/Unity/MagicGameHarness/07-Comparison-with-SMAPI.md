# Magic Game Harness vs SMAPI（Stardew Valley Modding Platform）

> **这不是 spec 实现笔记，是对比分析笔记**——通过"现有的 mod平台怎么做的"来理解 magic-game-harness-unity 的设计选择。
>
> SMAPI = Stardew Modding API，是 Stardew Valley 游戏的官方 mod 平台，2016 年至今维护。
> 已经有 **5000+** mod 跑在它上面——这是**已经被验证可行**的 mod平台设计。

---

## 0. 为什么对比 SMAPI？

SMAPI 是**最成功的商业游戏 mod 平台之一**——

- 一个 mod 作者**拿不到 Stardew Valley 源码**
- 一个玩家**一键安装/卸载** mod
- 一个存档**跨多个 mod** 仍能工作
- **5000+ mod 在生产中**——说明这套机制在真实玩家手里工作得很好

**而 magic-game-harness-unity 试图做的事**：

> 与 SMAPI **几乎完全相同**，只是更现代、更严格、面向 Unity + HybridCLR

**所以对比 SMAPI 非常有价值**：
- SMAPI 已经踩过的坑 → 这个项目可以**主动避开**
- SMAPI 没解决的问题 → 这个项目**通过 spec 设计**主动解决
- SMAPI 的好设计 → 这个项目**复用**

---

## 1. SMAPI 是什么？快速回顾

### 1.1 架构

```
StardewModdingAPI.exe   ← 玩家启动的是它，不是 Stardew Valley.exe
   │
   ├── 加载游戏程序集，接管入口
   │
   ├── SMAPI core
   │     ├── AssemblyLoader  ── 用 Mono.Cecil 重写 mod IL，再 Assembly.Load
   │     ├── Mod Loader      ── 读 manifest.json、拓扑排序依赖、实例化 IMod
   │     ├── Event system    ── 把游戏循环包装成 SMAPI 事件
   │     └── Content API     ── 拦截资产加载，供 mod 编辑/替换
   │
   ├── mod-1.dll  (可选地自己用 HarmonyLib 打 patch)
   ├── mod-2.dll
   └── ...
```

**关键点**：SMAPI **不是游戏的一部分**——它是一个**第三方工具**，反过来把游戏加载进自己的进程。

> ⚠️ **关于加载机制的一个常见误解**：SMAPI 加载 mod 靠的是 **Mono.Cecil 重写 IL + `Assembly.Load`**，不是 MonoMod / Harmony 的运行时 patch。
>
> 那个重写步骤（社区俗称 "the rewriter"）的作用是**抹平差异**：Stardew 有多平台构建、XNA 与 MonoGame 两套底层、以及跨游戏版本的方法签名变动。SMAPI 在加载每个 mod DLL 前用 Cecil 扫描它的 IL，把过时的类型引用和方法调用改写成当前平台/版本正确的形式。这就是为什么很多老 mod 在游戏更新后**不用重新编译**还能跑。
>
> **Harmony 是各个 mod 自己按需用的**（`Harmony.CreateAndPatchAll(...)`），SMAPI 只是打包提供。它不是加载机制。

这与 magic-game-harness-unity 的**根本不同**：

| 维度 | SMAPI | magic-game-harness-unity |
|---|---|---|
| **框架提供者** | 第三方（SMAPI 团队） | 游戏本体（mimizmi） |
| **代码位置** | 外部启动器 + 运行时接管 | 原生集成（`Game.Bootstrap` 就是游戏的组合根） |
| **Mod 加载方式** | Mono.Cecil 重写 IL + `Assembly.Load` | HybridCLR 加载热更 DLL（解释 + AOT 混合执行） |
| **兼容性做法** | 加载时**改写 mod** 去适配游戏 | 加载前**校验声明**，不匹配就拒绝加载 |
| **Mod API 稳定性** | SMAPI 自己的 API（`IMod` / `IModHelper` / 事件体系）是**正式的、有版本有文档、有弃用周期的**；不官方的是**游戏本体内部实现**——那才是 mod 靠反编译摸索、靠 Harmony patch 去改的部分 | 官方维护的稳定契约（`Game.ModApi`），且**没有** patch 游戏内部这一层 |
| **Mod 兼容保证** | "尽量不破坏" + 中心化兼容性数据库 | 显式版本号 + `FrameworkCompatibility` 四维度，写进 manifest |

> **第 4 行才是最本质的差异。** SMAPI 因为拿不到游戏源码，只能**事后改写 mod** 去适配；harness 因为框架就是游戏本体，可以**事前要求声明**、不匹配直接拒绝。
>
> 前者是"尽力而为的兼容"——好处是老 mod 常常自动就活了，坏处是没人能保证它**语义上**还对（IL 改写只保证不崩，不保证行为没变）。后者是"可证明的兼容"——好处是不匹配会**在加载前**被拒，坏处是对 Mod 作者的约束严格得多（见 §13.1 的门槛风险）。
>
> 第 5 行原先写成"SMAPI 的 Mod API 是反编译推出来的（不官方）"，这**混淆了两层**：SMAPI 给 mod 用的 API 是正经 API；被反编译的是**星露谷本体**。这个区分很重要，否则会得出"harness 比 SMAPI 有官方 API"这种错误结论——两者都有官方 API，差别在于 harness 的 API 背后没有一个需要 patch 的黑盒游戏。

### 1.2 SMAPI 的核心组件

| 组件 | 归属 | 作用 |
|---|---|---|
| **SMAPI core** | SMAPI | mod 发现与加载、生命周期、事件分发、日志 |
| **AssemblyLoader（Mono.Cecil）** | SMAPI | 加载前重写 mod IL，抹平平台/版本差异 |
| **Mod API**（`IMod`、`IModHelper`、事件） | SMAPI | 暴露给 mod 的正式契约 |
| **Content API**（`IAssetEditor` / `IAssetLoader` 及其后继） | SMAPI | 让 mod 拦截、编辑、替换游戏资产 |
| **HarmonyLib** | 第三方库，SMAPI 打包提供 | **各 mod 自行**运行时 patch 游戏方法 |
| **Content Patcher** | **第三方 mod**（Pathoschild 作） | 让不会写代码的作者用 JSON 声明式地改内容 |

> ⚠️ 两处需要澄清：
>
> 1. **MonoMod 不是 SMAPI 的独立组件。** Harmony 2.x 内部构建在 MonoMod.Core 之上，但那是 Harmony 的实现细节；SMAPI 自己的重写层用的是 Mono.Cecil。
> 2. **Content Patcher 是一个第三方 mod，不是 SMAPI 核心。** 而且它并不"编辑 XNB 文件"——它工作在 SMAPI 的 content API 之上，操作的是**加载后的资产对象**。直接改 XNB 是更早期 XNB-hack 时代的做法，正是 Content Patcher 用来取代的东西（那种做法要求玩家覆盖游戏文件，多个 mod 改同一个文件必然冲突）。
>
> 这个区分对本篇的论点有意义：**Content Patcher 的存在本身就说明"声明式内容修改"是一个足够大的需求，大到值得社区在框架之外再造一层。** harness 把 Content 列进 spec §11.1 的 11 个命名空间之一（虽然还是空目录），是把这个教训吸收进了框架层。

---

## 2. 概念对照表

| 概念 | SMAPI | magic-game-harness-unity |
|---|---|---|
| **Mod 入口** | `IMod.Entry(IModHelper)` | `IModule.ActivateAsync(IModuleContext, CancellationToken)` |
| **Mod 描述** | `manifest.json`（含 id/version/依赖/兼容性） | `ModuleDescriptor`（含 CapabilityRequirement/Provision） |
| **依赖系统** | manifest 里写 `"Dependencies": ["SpaceCore"]` | Capability 键 + 版本（`"framework.physics-2d": "1.x"`）|
| **Mod 元数据** | `manifest.json` | `ModuleDescriptor` (代码) + `manifest.json` (分发)|
| **Mod 通信** | 静态 helper 方法 + 事件总线 | Capability 接口 + 版本协商 |
| **Mod 加载顺序** | 按依赖 + manifest 声明 | Topological sort by capability graph |
| **Mod 沙箱** | ❌ 无（full trust）| ❌ 无（spec 5.2 明确） |
| **存档兼容** | ❌ 部分 mod 写存档破坏兼容 | ✅ per-world Lockfile + schema migration |
| **官方版本** | 跟着游戏版本走 | `FrameworkCompatibility` 4 维度检查 |
| **跨 mod 合约** | ❌ 没有强制（mod 作者自己协调） | ✅ Contract-only assembly 机制 |

---

## 3. 关键设计决策对比

### 3.1 决策 A：Mod 加载机制

#### SMAPI

```csharp
// SMAPI 内部：反射加载 mod dll
var assembly = Assembly.LoadFrom(modDllPath);
var modType = assembly.GetTypes()
    .Single(t => typeof(IMod).IsAssignableFrom(t));
var mod = (IMod)Activator.CreateInstance(modType);
mod.Entry(modHelper);
```

**问题**：
- ❌ 反射加载 → **首次启动慢**（JIT + 反射 metadata 处理）
- ❌ 没有 mod 完整性校验（dll 可被篡改）
- ❌ 加载顺序由 manifest 声明，但**没有真正的版本约束**——`"SpaceCore": "1.0.0"` 只是字符串比较

#### magic-game-harness-unity

```csharp
// 推断的实现（Context Runtime 未实现）
var assembly = HybridCLR.RuntimeApi.LoadAssembly(dllBytes);
var sha256 = ComputeSha256(dllBytes);
if (sha256 != manifest.Artifacts.Sha256) throw new ModCorruptedException();
// ↑ 加载时立即校验 hash

// 按 capability graph topological sort
var sortedMods = TopologicalSort(dependencyGraph);
foreach (var mod in sortedMods)
{
    if (!AllRequiredCapabilitiesResolved(mod)) continue;  // optional 可以缺失
    await mod.ActivateAsync(context, cancellationToken);
}
```

**改进**：
- ✅ HybridCLR 编译加载 → **快**（不需要反射 metadata）
- ✅ Hash 校验 → **防篡改**
- ✅ Capability 版本协商 → **真正的版本约束**

### 3.2 决策 B：Mod 通信

#### SMAPI

**Mod 之间通信**主要靠：

```csharp
// Mod A 注册 API
public class MyMod : IMod
{
    public void Entry(IModHelper helper)
    {
        // 直接挂在 helper 上
        helper.Events.GameLoop.SaveLoaded += OnSaveLoaded;
        
        // 或者用 SMAPI 的事件总线
        helper.Events.Player.Warped += OnPlayerWarped;
    }
}

// Mod B 监听
public class OtherMod : IMod
{
    public void Entry(IModHelper helper)
    {
        helper.Events.GameLoop.SaveLoaded += (s, e) => { /* ... */ };
    }
}
```

**问题**：
- ❌ **没有类型检查**——A 改了事件签名，B 编译时发现不了
- ❌ **没有版本协商**——A 升级到 2.0 加了新参数，B 没更新就崩
- ❌ **事件总线是全局的**——任何 mod 可以监听任何事件 → 性能 + 调试困难

#### magic-game-harness-unity

**Mod 之间通信**靠 capability：

> 📌 **代码约定**：下面这段（以及本篇后续所有 `ctx.RegisterCapability<...>` / `ctx.GetCapability<...>`）是**占位伪代码，当前代码库中不存在**。`IModuleContext` 目前只有 `ModuleId` 和 `Diagnostics` 两个属性，而且 `Module_context_is_not_an_unrestricted_service_locator` 明确禁止泛型方法——真实形态只能是 `RegisterCapability(CapabilityKey, CapabilityVersion, object)` 这样的非泛型签名，返回 `IDisposable` 句柄。详见 [`06-Mod-Distribution.md` §1.5](./06-Mod-Distribution.md)。**这不影响本节的论点**（SMAPI 靠运行时握手 vs harness 靠声明式契约），只影响语法。

```csharp
// Mod A 提供 capability（伪代码）
public async Task<ModuleOperationResult> ActivateAsync(IModuleContext ctx, CancellationToken ct)
{
    ctx.RegisterCapability<IGameRules>(new AlphaRules());
    // ↑ 注册 + 版本固定
    return ModuleOperationResult.Success();
}

// Mod B 消费 capability
public async Task<ModuleOperationResult> ActivateAsync(IModuleContext ctx, CancellationToken ct)
{
    var rules = ctx.GetCapability<IGameRules>("game.alpha-rules");
    // ↑ 类型安全的查找 + 编译期类型检查
    rules.SomeMethod();
}
```

**改进**：
- ✅ **类型安全**——`IGameRules` 是 contract dll 里的接口，编译期就检查
- ✅ **版本协商**——capability key + version 锁定，spec 第 11 节"explicit compatibility"
- ✅ **能力是显式的**——`RequiredCapabilities` + `ProvidedCapabilities` 在 descriptor 里说清楚

### 3.3 决策 C：存档兼容性

#### SMAPI

**SMAPI 不直接管存档**——mod 自己管。问题：

- ❌ Mod A 写了存档 → Mod A 卸载 → 存档变成不可用数据
- ❌ Mod A 升级改了字段名 → 旧存档读不出来
- ❌ **没有 per-world mod 集合**——全局 mod 列表改变会破坏存档

**SMAPI 实际上"无解"**——只能靠 mod 作者自己写 schema migration 代码。

#### magic-game-harness-unity

**spec 第 3.1 节明文要求**：

> Preserve save data when a mod is missing, disabled, upgraded, or reinstalled.

**机制**：
- **Per-World Lockfile**（spec 第 3.1 节）——存档绑 Lockfile，不绑当前 mod 集合
- **Schema migration**（spec 第 11 节命名空间有 `Storage`，未实现）——mod 可以声明 schema 转换
- **Missing content handling**（spec 第 10.6 节）——mod 缺失时，世界里的"该 mod 创建的内容"不会被自动删除，而是**保留 + 标记 missing**

**改进**：
- ✅ Lockfile 冻结 → 即使 mod 升级，存档加载的还是旧版本 mod
- ✅ Schema migration framework（计划中）→ 自动升级存档
- ✅ Missing content 保留 → 玩家可以再装回 mod 恢复世界

### 3.4 决策 D：Mod 元数据 / Manifest

#### SMAPI

```jsonc
// SMAPI manifest.json（真实字段集）
{
    "Name": "Crops Anytime Anywhere",
    "Author": "Pathoschild",
    "Version": "1.0.0",
    "Description": "Lets you plant crops in any season and location.",
    "UniqueID": "Pathoschild.CropsAnytimeAnywhere",  // ← 类似 ModuleId
    "EntryDll": "CropsAnytimeAnywhere.dll",          // ← 必填：入口程序集
    "MinimumApiVersion": "3.0.0",                    // ← 只约束 SMAPI 版本
    "Dependencies": [
        { "UniqueID": "SpaceCore", "MinimumVersion": "1.0.0", "IsRequired": true }
    ],
    "UpdateKeys": [ "Nexus:1598" ]                   // ← 更新检查用
}
```

> ⚠️ **SMAPI 的 manifest 里没有"游戏版本兼容性"字段。** 没有 `Compatibility`、没有 `GameVersion`。
>
> 游戏版本兼容性由 SMAPI **中心化维护的 mod 兼容性数据库**负责——SMAPI 启动时拉取这份数据，据此提示"这个 mod 在当前游戏版本下已知会崩"。
>
> **这不是疏漏，是结构决定的。** SMAPI 是第三方框架，它**没有权力**要求 mod 作者去声明一个 SMAPI 自己都不拥有的版本轴——游戏版本由 ConcernedApe 说了算，且随时可能变。唯一可行的办法就是事后由第三方（SMAPI 团队 + 社区）集中记录"哪个 mod 在哪个游戏版本下坏了"。
>
> **而 harness 因为框架就是游戏本体，可以把这件事前置成 manifest 的必填字段**——这正是 `FrameworkCompatibility` 四个维度的意义。下面的对比表因此比"SMAPI 是半自由文本"这种说法有力得多：不是 SMAPI 做得潦草，是它**结构上做不到**。

**对比** magic-game-harness-unity 的 manifest（已推测）：

```json
{
    "manifestVersion": 1,
    "id": "author.alpha-rules",                        // ModuleId
    "version": "1.0.0",                                // ModuleVersion (SemVer)
    "dependencies": [
        {
            "id": "framework.physics-2d",                // CapabilityKey
            "version": "1.x",                            // CapabilityVersion
            "type": "capability"
        }
    ],
    "provides": [
        {
            "id": "game.alpha-rules",                    // CapabilityKey
            "version": "1.0.0",                          // CapabilityVersion
            "type": "capability"
        }
    ],
    "permissions": [
        "world.modify", "world.read", "ui.overlay"
    ],
    "compatibility": {                                  // FrameworkCompatibility 4 维度
        "gameBuild": "framework.phase1_dev-1",
        "modApi": "0.1.0",
        "networkProtocol": 1,
        "contentCompatibility": 1
    },
    "artifacts": {
        "dll": "mod-author-alpha.dll",
        "contentCatalog": "content-author-alpha/catalog.json",
        "size": 4582912,
        "sha256": "abc123..."
    }
}
```

**对比**：

| 字段 | SMAPI | magic-game-harness-unity |
|---|---|---|
| **Mod ID** | `UniqueID: "Pathoschild.CropsAnytimeAnywhere"`（约定俗成的 `Author.Name`，无格式强制） | `id: "author.alpha-rules"`（`ModuleId.Parse` 强制：小写、点分段、段首字母、≤128） |
| **Version** | 字符串，SMAPI 自己解析成 `ISemanticVersion`（它的语义比 SemVer 2.0.0 略宽松） | `SemanticVersion` 严格 SemVer 2.0.0，precedence 与 identity 分离 |
| **Dependencies** | `UniqueID` + `MinimumVersion`（**只有下界**） | Capability + 版本（当前是**精确版本**，区间类型尚未实现——见 [06 §1.5](./06-Mod-Distribution.md)） |
| **Provides** | ❌ 不显式（mod 之间靠 `IModHelper.ModRegistry.GetApi()` 运行时握手） | ✅ `ProvidedCapabilities` 显式声明 |
| **Permissions** | ❌ 没有 | ✅ spec 规划中的显式声明（当前未实现） |
| **游戏兼容性** | ❌ **不在 manifest 里**，由中心化兼容性数据库维护 | ✅ 4 维度独立写进 manifest（GameBuild / ModApi / NetworkProtocol / Content） |
| **Artifact hash** | ❌ 没有（分发靠 Nexus/ModDrop 等平台自己保证） | ✅ spec 规划 SHA256 |

**关键差异不在"谁的字段多"，而在"信息属于谁"**：

- SMAPI 能强制的只有它**自己拥有**的那条轴（`MinimumApiVersion`）。游戏版本、artifact 完整性、mod 提供什么 API——这些它都无权要求，只能靠社区数据库、分发平台、运行时握手来补。
- harness 拥有全部四条轴，所以能把它们**全部前置到 manifest**，在安装/加载前就做完机器校验。

代价是对称的：SMAPI 的 mod 作者填 5 个字段就能发布，harness 的作者要填四维兼容性 + 能力声明 + 权限。**这是 spec §6 原则 12"Professional authoring, consumer simplicity"的直接体现**——复杂度被刻意集中到 SDK 和作者侧，换玩家侧的一键安装与可恢复性。

### 3.5 决策 E：Mod 沙箱

#### SMAPI

**完全无沙箱**——mod 拿到：
- ✅ 整个 Stardew Valley 内部 API（包括私有方法）
- ✅ 文件系统访问
- ✅ 网络访问
- ✅ 进程访问

**实际上 SMAPI 是通过 Harmony "patch" Stardew 的代码**——mod 可以改任何方法的 IL。

**问题**：
- ❌ 恶意 mod 可以读玩家所有文件
- ❌ 恶意 mod 可以上传玩家数据
- ❌ 良性 mod 也会因为版本不兼容而崩溃

#### magic-game-harness-unity

**spec 第 5.2 节明文**：

> the AOT kernel and AOT core rules are a **correctness boundary for conforming modules**, **not a security boundary against a malicious host or a modified client**.

**也就是说**：mod 可以：
- ❌ 不能访问私有程序集（编译期就阻止）
- ❌ 不能访问文件系统（除非显式 permission）
- ❌ 不能访问网络（除非显式 permission）
- ✅ 可以访问 IGameRules 这种 interface
- ✅ 可以访问 capabilities
- ✅ **仍然是 full trust**——可以伪造游戏状态

**与 SMAPI 的区别**：
- magic-game-harness-unity 的 mod **更难写恶意 mod**（SDK 限制 + 编译期阻止私有 API 访问）
- 但 **也不是真沙箱**——spec 明确说这是 correctness boundary 不是 security boundary

---

## 4. SMAPI 已经解决的，magic-game-harness-unity **已经借鉴**

### 4.1 借鉴 #1：Mod Helper 模式

SMAPI 的 `IModHelper` 把"框架服务"打包成 helper：

```csharp
// SMAPI 风格
public class MyMod : IMod
{
    public void Entry(IModHelper helper)
    {
        helper.Events.GameLoop.SaveLoaded += ...;
        helper.Content.Load<Texture2D>(".../texture.png");
        helper.Reflection.GetField<int>(someObj, "fieldName");
        // ...
    }
}
```

**magic-game-harness-unity** 等价物是 `IModuleContext`——但**更窄**：

```csharp
// magic-game-harness-unity 风格
public async Task<ModuleOperationResult> ActivateAsync(IModuleContext ctx, CancellationToken ct)
{
    ctx.Diagnostics.Report(new ModuleDiagnostic(...));
    // ↑ 只有 Diagnostics，没有 Reflection/Content Helper
}
```

**取舍**：magic-game-harness-unity 故意**只暴露最少**——Mod 作者应该**通过 capability 接口**拿到其他服务，而不是通过万能 helper。

**这是进步**：SMAPI 的 `IModHelper.Reflection.GetField` 让 mod 可以 hack 私有字段——magic-game-harness-unity 直接**禁掉这条路**。

### 4.2 借鉴 #2：Mod 配置文件位置约定

SMAPI 约定 mod 配置文件放：
```
~/.config/StardewValley/<game-version>/<mod-UniqueID>/config.json
```

**magic-game-harness-unity** 类似（spec 第 11 节 `Storage`）：

```
<save-location>/<world-id>/mods/<mod-id>/storage.json
```

**好处**：玩家备份/迁移/卸载时 mod 数据跟着走。

### 4.3 借鉴 #3：Mod 版本独立

SMAPI 和 magic-game-harness-unity 都让 **Mod 版本和游戏版本独立**——mod 升级不强制游戏升级。

---

## 5. SMAPI **没解决**的，magic-game-harness-unity **主动解决**

### 5.1 问题 #1：Mod 升级破坏存档

**SMAPI 的现状**：玩家装 mod A，写存档。mod A 升级，存档读不出来。玩家卸载 mod A，存档里的"mod A 制造的东西"变垃圾。

**magic-game-harness-unity 的方案**：
- **Per-World Lockfile**：存档绑 Lockfile，不绑当前 mod 集合
- **Missing content handling**（spec 第 10.6 节）：mod 缺失时数据保留 + 标记 missing
- **Schema migration**（spec 第 11 节 `Storage`）：自动升级存档 schema

### 5.2 问题 #2：Mod 互相依赖的版本约束

**SMAPI 的现状**：`"SpaceCore": "1.0.0"` 是字符串比较——`"1.0.0-beta"`、`"1.0.0+build.1"`、`"1.0"` 全是 1.0.0。

**magic-game-harness-unity 的方案**：
- **SemVer 2.0.0** 严格解析（`SemanticVersion`）
- **Capability 版本 range**（如 `"1.x"` 表示 1.x 任意 patch）
- **3 种比较语义**（PrecedenceComparer / CompareTo / Equals）—— Primitives 笔记里讲过

### 5.3 问题 #3：Mod 之间的接口不官方

**SMAPI 的现状**：mod 作者自己定义接口（比如 `ICropsApi`），其他 mod 通过反射拿 → 编译期不可检查。

**magic-game-harness-unity 的方案**：
- **Contract-only assembly**（spec 第 8.5 节）：跨 mod 接口必须是单独发布的"契约 dll"
- **Capability 声明**（`ProvidedCapabilities` + `RequiredCapabilities`）：接口在 descriptor 里显式
- **类型安全**：mod 作者用 `ctx.GetCapability<IMyApi>()` 而不是反射

### 5.4 问题 #4：Mod 网络同步

**SMAPI 的现状**：mod 自己写网络代码——大多数 mod **不**支持多人模式，因为同步代码太复杂。

**magic-game-harness-unity 的方案**：
- **NGO Custom-Message Bridge**（spec 第 3.1 节）：AOT 内核提供网络桥
- **运行时 mod 不能用 NGO RPC**（spec 第 4 节"no build-time NGO features in unknown runtime mods"）：强制 mod 通过 schema-driven protocol
- **Host-authoritative**（spec 第 5 节）：所有 mod 行为由 host 权威执行

**预期效果**：mod 作者**不需要写网络代码**——网络层透明，host 端执行 + 同步到 client。

### 5.5 问题 #5：Mod 工具链

**SMAPI 的现状**：mod 作者用 IDE + 自己配置 project + 反编译游戏找 API → 工具链碎片化。

**magic-game-harness-unity 的方案**：
- **Mod SDK**（spec 第 8.1 节）：提供 Unity package + CLI + MCP adapter + AI instructions
- **Templates~/**：新 Mod 项目模板
- **TestPlayer**（SDK 自带）：本地测试 mod 的小工具

---

## 6. SMAPI **比 magic-game-harness-unity 做得好的地方**

虽然 magic-game-harness-unity 在很多维度领先 SMAPI，但 SMAPI 也有优势：

### 6.1 优势 #1：**已经被 5000+ mod 验证**

- SMAPI 在生产中跑过 **数千个 mod 组合**
- magic-game-harness-unity 还在写 spec 和脚手架
- 实际玩家行为可能暴露 spec 没考虑到的 edge cases

### 6.2 优势 #2：**低门槛**

- SMAPI 用 Harmony patch 任何方法——mod 作者几乎可以改任何东西
- magic-game-harness-unity 严格限制 → 一些 hack 类 mod 写不出来

**例子**：SMAPI 上有 mod "Can you hear me now?（让你听到远处的 NPC 对话）"——这种需要 hook 私有字段的 mod 在 magic-game-harness-unity 写不出来。

**这是设计权衡**：稳定 vs 灵活。magic-game-harness-unity 选了稳定。

### 6.3 优势 #3：**社区生态成熟**

- 5000+ mod 已经在 SMAPI 上发布
- mod 作者之间有成熟的合作约定
- 教程、文档、Discord 都成熟

**magic-game-harness-unity** 还没发布，生态为零。

### 6.4 优势 #4：**多游戏复用**

- SMAPI 已经 fork 出 SMAPI for Stardew Valley 1.6、SMAPI for Haunted Chocolatier 等
- 模式稳定，多年验证

**magic-game-harness-unity** 单游戏单实例（虽然 spec 强调可复用）。

---

## 7. 关键技术决策评分

| 决策 | SMAPI | magic-game-harness-unity | 评价 |
|---|---|---|---|
| **Mod 加载机制** | 反射 + Harmony patch | HybridCLR 编译 | magic 更好（快 + 校验） |
| **Mod 通信** | 事件总线 + 反射 | Capability 接口 | magic 更好（类型安全）|
| **存档兼容** | Mod 自己处理 | Lockfile + Migration（计划中）| magic 更好（系统化）|
| **Manifest** | 半结构化 JSON | 严格结构化 JSON | magic 更好（机器可读）|
| **Mod 沙箱** | 无 | 无（spec 明确）| 平手（都放弃）|
| **工具链** | 碎片化 | 官方 SDK（计划中）| magic 更好（统一）|
| **生态成熟度** | 5000+ mod | 0 mod | SMAPI 更好（已验证）|
| **跨游戏复用** | 已 fork | 单实例 | SMAPI 更好 |
| **学习曲线** | 低（任何能反编译的人都能写 mod）| 中（需要理解 capability 概念）| SMAPI 更好（低门槛）|
| **网络同步** | Mod 自己写 | AOT 桥（计划中）| magic 更好（透明）|
| **类型安全** | ❌ 反射为主 | ✅ 接口为主 | magic 更好 |
| **热更新** | 重启游戏 | HybridCLR | magic 更好（运行时加载）|

---

## 8. SMAPI 可以向 magic-game-harness-unity 借鉴什么

如果 SMAPI 团队**今天重写** SMAPI，可能会采纳：

1. **Capability-based 通信**——替代事件总线
2. **Per-World Lockfile**——解决存档兼容
3. **SemVer 严格版本**——替代字符串比较
4. **Contract-only assemblies**——替代 mod 之间的反射调用
5. **显式 permissions**——限制 mod 的能力
6. **Hash 校验 + AOT-friendly loading**——加快启动

---

## 9. magic-game-harness-unity 可以向 SMAPI 借鉴什么

反过来，magic-game-harness-unity 可以向 SMAPI 借鉴：

1. **低门槛 onboarding**——SMAPI 教程**一天**就能写 mod。magic-game-harness-unity 学习曲线会更陡。
2. **大社区**——SMAPI 有 Discord、wiki、模版库。magic-game-harness-unity 需要从 0 开始建设。
3. **跨游戏 fork**——SMAPI 模式跨多个 ConcernedApe 游戏复用。magic-game-harness-unity 还没想清楚多游戏复用。
4. **mod "soft" 兼容性**——SMAPI 的 manifest 是半自由的，作者可以加任意字段。magic-game-harness-unity 太严格。

---

## 10. 实际案例对比

### 10.1 案例：SMAPI 上最火的 mod "Crops Anytime Anywhere"

**SMAPI 实现**（简化）：
```csharp
public class ModEntry : Mod
{
    public override void Entry(IModHelper helper)
    {
        // 监听 GameLoop 事件
        helper.Events.GameLoop.DayStarted += OnDayStarted;
        // 监听玩家放种子的事件
        helper.Events.Player.InventoryChanged += ...;
    }

    private void OnDayStarted(object sender, DayStartedEventArgs e)
    {
        // 用 Harmony patch Object.canPlantHere（私有方法）
        // 让所有地块在任何季节都能种
        var harmony = new Harmony(this.ModManifest.UniqueID);
        harmony.Patch(
            original: AccessTools.Method(typeof(Object), "canPlantHere"),
            postfix: new HarmonyMethod(typeof(ModEntry), nameof(AlwaysAllowPlanting))
        );
    }

    private static void AlwaysAllowPlanting(ref bool __result)
    {
        __result = true;
    }
}
```

**magic-game-harness-unity 等价物**（推断）：
```csharp
public class CropsAnywhere : IModule
{
    public ModuleDescriptor Descriptor { get; } = new ModuleDescriptor(
        id: ModuleId.Parse("pathoschild.crops-anytime-anywhere"),
        version: ModuleVersion.Parse("1.0.0"),
        requiredCapabilities: new[]
        {
            // 需要 framework 提供"hook 种地检查"的能力
            new CapabilityRequirement(
                CapabilityKey.Parse("framework.farming.plant-check"),
                CapabilityVersion.Parse("1.x"))
        },
        providedCapabilities: Array.Empty<CapabilityProvision>());

    public async Task<ModuleOperationResult> ActivateAsync(IModuleContext ctx, CancellationToken ct)
    {
        // 拿到框架提供的"种地检查"接口
        var plantCheck = ctx.GetCapability<IPlantCheck>("framework.farming.plant-check");
        // 注册"override"——这是一个 contract 接口
        plantCheck.RegisterOverride((location, season) => true);
        return ModuleOperationResult.Success();
    }

    public Task<ModuleOperationResult> DeactivateAsync(CancellationToken ct)
    {
        var plantCheck = ctx.GetCapability<IPlantCheck>("framework.farming.plant-check");
        plantCheck.UnregisterOverride();
        return Task.FromResult(ModuleOperationResult.Success());
    }
}
```

**对比**：

| 维度 | SMAPI | magic-game-harness-unity |
|---|---|---|
| **修改范围** | 私有方法 `Object.canPlantHere` | 通过 contract 接口 `IPlantCheck` |
| **编译期类型检查** | ❌ | ✅ |
| **撤销机制** | 需要 mod 自己写 | ✅ `UnregisterOverride` 是 contract 接口的一部分 |
| **跨 mod 协调** | ❌（可能多个 mod 都 patch 同一方法，结果冲突）| ✅（framework 注册后所有 mod 通过 capability 协调）|
| **升级兼容性** | 游戏升级改 `canPlantHere` 签名 → mod 崩 | 框架升级 `IPlantCheck` 接口 → contract dll 升级，mod 用新 dll 重编译 |

### 10.2 教训：SMAPI "patch 一切" 的代价

**SMAPI 上常见的 mod 互相冲突**——比如：
- mod A patch `Object.canPlantHere` 改成永远 true
- mod B 也 patch，改成只有夏天可以
- 加载顺序决定哪个生效——但 mod 作者通常不知道加载顺序

**magic-game-harness-unity** 通过 capability 避免这个问题：
- 框架提供 `IPlantCheck.RegisterOverride(...)` 接口
- mod A、B 都注册自己的 override
- 框架决定调用顺序（**可控的**）
- 没有 patch 冲突

---

## 11. 关键 takeaway

读完对比，最大的认知收获：

> **SMAPI 是 magic-game-harness-unity 的"前辈"**——已经在生产中验证了 mod 平台的核心机制。但 SMAPI 是 **hack 出来的**（Harmony patch），magic-game-harness-unity 是 **设计出来的**（capability 系统）。

具体来说：

| 关注点 | SMAPI | magic-game-harness-unity |
|---|---|---|
| **何时好用** | 想 hack 任何东西的 mod 作者 | 想"安全可控地扩展"的 mod 作者 |
| **何时不好用** | 大型 mod 互相依赖时 | 需要 hack 私有字段的 mod |
| **典型 mod 数量** | 5000+ 各种 | 0（未发布）|
| **典型玩家数量** | 100万+ | 0 |
| **核心机制** | IL patch + 事件总线 | Capability + HybridCLR |

**两个系统都成立**——只是适合不同的人群：
- SMAPI = "**Mod 作者能写任何东西**"
- magic-game-harness-unity = "**Mod 作者能安全地写好东西**"

---

## 12. 我对 magic-game-harness-unity 设计的评价

通过对比 SMAPI，我确认了几个 spec 决策的价值：

### 12.1 spec 决策 #1：AOT 框架 + HybridCLR mod（spec 第 6.2 节）

**价值**：解决 SMAPI 的"IL patch 一切"带来的不可控问题。Mod 只能通过 contract 接口，不能 hack。

### 12.2 spec 决策 #2：Capability-based 通信（spec 第 10.4 节）

**价值**：解决 SMAPI 的"事件总线混乱"问题。通信是显式声明的（RequiredCapabilities + ProvidedCapabilities），不是隐式的（事件订阅）。

### 12.3 spec 决策 #3：Per-World Lockfile（spec 第 3.1 节）

**价值**：解决 SMAPI 没解决的存档兼容问题。Lockfile 冻结，存档永远能加载当时的 mod 组合。

### 12.4 spec 决策 #4：4 维度 FrameworkCompatibility（spec 第 3.1 节）

**价值**：解决 SMAPI 的"游戏升级 mod 全崩"问题。每个维度独立检查，可以局部兼容。

### 12.5 spec 决策 #5：显式 permissions（spec 第 10.1 节）

**价值**：解决 SMAPI 的"mod 啥都能做"问题。permissions 在 manifest 里声明，框架可以限制（虽然 spec 还没说怎么限制）。

---

## 13. 风险与不确定性

虽然 spec 设计看起来比 SMAPI 更好，但有几个**未验证的风险**：

### 13.1 风险 #1：mod 作者门槛太高

**SMAPI** 作者：会 C# + 愿意反编译 Stardew
**magic-game-harness-unity** 作者：会 C# + 理解 capability 概念 + 理解 framework API 设计

**预测**：mod 作者数量会比 SMAPI 少。

### 13.2 风险 #2：framework 设计负担太重

**SMAPI** 不需要 framework 设计——任何能 patch 的方法都能用
**magic-game-harness-unity** 每个 capability 都需要 framework 设计 + 维护 + 版本管理

**预测**：framework 团队会变成"最累的团队"。

### 13.3 风险 #3：HybridCLR 是新东西

**SMAPI** 基于成熟的 .NET（Stardew 是 .NET Framework / Mono）
**magic-game-harness-unity** 依赖 HybridCLR——HybridCLR 还在活跃开发，长期兼容性不确定

**预测**：5 年后 HybridCLR 可能被废弃，需要 migration path。

### 13.4 风险 #4：ecosystem cold start

**SMAPI** 有 5000+ mod
**magic-game-harness-unity** 从 0 开始

**预测**：前 6 个月 mod 数量会很少，需要投入社区建设。

---

## 14. 总结

| 维度 | SMAPI | magic-game-harness-unity |
|---|---|---|
| **成熟度** | ✅ 生产 8 年 | ⏳ spec + 脚手架 |
| **设计严谨度** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **类型安全** | ❌ | ✅ |
| **存档兼容** | ❌ | ✅（计划中）|
| **mod 作者门槛** | 低 | 中 |
| **网络同步** | mod 自己 | AOT 桥（计划中）|
| **沙箱** | 无 | 弱（spec 明确） |
| **生态** | 5000+ mod | 0 |
| **跨游戏复用** | ✅ 已 fork | 单实例 |

**最终判断**：magic-game-harness-unity 是 **"spec 完美但还没验证"**——理论上比 SMAPI 更好，但需要实操验证。SMAPI 是 **"spec 不完美但已验证"**——生产中跑过数千 mod 组合。

**最优解**：吸取 SMAPI 的经验，**先小规模发布**，**快速迭代**，**接受不完美**。spec 完美 ≠ 项目成功。

---

## 参考链接

- [SMAPI 源码](https://github.com/Pathoschild/SMAPI) — SMAPI 本体（`src/SMAPI/Framework/ModLoading/AssemblyLoader.cs` 就是那个 Cecil rewriter）
- [Pathoschild/StardewMods](https://github.com/Pathoschild/StardewMods) — Content Patcher 等 mod 的源码（**注意这是 mod 仓库，不是 SMAPI 本体**）
- [SMAPI 官方文档](https://stardewvalleywiki.com/Modding:Index) — Mod 作者教程，含 manifest 字段的权威说明
- [Pathoschild 博客](https://www.pathoschild.me/) — SMAPI 主要维护者
- [Harmony](https://github.com/pardeike/Harmony) — 运行时 IL patch 库，**由各 mod 自行使用**，不是 SMAPI 的加载机制
- [Mono.Cecil](https://github.com/jbevain/cecil) — SMAPI 加载前重写 mod IL 用的库
- [Stardew Valley 销量数据](https://en.wikipedia.org/wiki/Stardew_Valley) — 30M+ 销量
- [魔改工具链](https://github.com/Stardew-Valley-Modding/Modding-Cheat-Sheet) — SMAPI modder cheat sheet

---

**系列续作 #1**。下一篇 [Bevy ECS 对比](./08-Comparison-with-Bevy-ECS.md) 会从**完全不同的角度**（Rust 引擎 vs Unity 框架）继续这个对比分析。

---

## 附：本篇的勘误

本篇对 harness 一侧的描述没有问题；审查发现的 5 处错误**全部在 SMAPI 一侧**，已就地修正：

| # | 原文 | 实际 |
|---|---|---|
| 1 | "Mod 加载方式：MonoMod runtime IL patch" | **Mono.Cecil 重写 + `Assembly.Load`**；Harmony 是各 mod 自行使用的，不是加载机制 |
| 2 | 组件表把 MonoMod 列为 SMAPI 核心组件 | MonoMod 不是 SMAPI 的直接依赖（Harmony 2.x 内部用它，属实现细节） |
| 3 | "Mod API 稳定性：反编译推出来的（不官方）" | 混淆两层：SMAPI **自己的** API 是正式的；被反编译的是**游戏本体内部实现** |
| 4 | manifest 里的 `"Compatibility": { "GameVersion": ... }` | **SMAPI manifest 没有这个字段**；游戏兼容性由中心化数据库维护。示例还漏了必填的 `EntryDll` |
| 5 | "Content Patcher：编辑游戏数据（XNB 文件）" | 它是**第三方 mod**（不是 SMAPI 核心），且工作在 content API 之上，操作加载后的资产对象 |

完整证据见 [`00-Review-Report.md`](./00-Review-Report.md) §6.1。

**这类错误的代价**：拿一个不存在的 SMAPI 特性（或一个被误解的 SMAPI 缺陷）去论证"我们比它强"，论证就是空的。修正第 4 条之后论点反而更硬了——SMAPI 把游戏兼容性放在中心化数据库里**不是做得潦草，是结构上做不到**（它无权要求 mod 作者声明一个它自己都不拥有的版本轴）。而 harness 能把 `FrameworkCompatibility` 四维度做成 manifest 必填字段，正是因为"框架就是游戏本体"。这才是"第三方注入 vs 一等公民"这个根本差异的具体后果。