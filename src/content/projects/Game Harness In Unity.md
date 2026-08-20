---
title: Magic Game Harness for Unity
status: 开发中
tags:
  - CSharp
  - Unity
  - Harness
  - Framework
  - Modding
  - AI
icon: ⬡
tagline: 面向 Mod、Agent 与长期生态演进的模块化 Unity 游戏框架
---

## 介绍

`Magic Game Harness` 是一个构建在 Unity 6 上的模块化游戏框架实验。它借鉴 Agent Harness 的思路：框架本身不规定某一种玩法，而是提供稳定的运行时、能力边界、生命周期、诊断和工具接口，让后续游戏内容以模块的形式接入。

这里的 Agent 并不是游戏中的聊天机器人。它可以是能够读取项目约束、调用 Unity 工具、编写代码、运行测试并打包内容的开发代理；玩家在游戏中仍然通过移动、建造、战斗、交互等正常行为参与世界。

项目希望同时服务两类人：

- **专业 Mod 作者**使用 Unity、C# 和 SDK 开发深度模块；
- **普通玩家**只负责安装、启用、更新和分享经过验证的内容。

框架负责把“开发自由度”和“玩家使用体验”连接起来，而不是试图把所有玩家都变成程序员。

## 为什么要做 Game Harness

传统游戏通常把玩法、资源、网络、存档和场景紧密写在一个工程里。随着功能增加，Mod 往往只能依赖反射、补丁或非公开实现；一旦游戏更新，兼容性、资源释放、依赖顺序和联机一致性都很难保证。

Game Harness 将游戏拆成两个层次：

1. **稳定的 AOT 框架内核**负责启动、组合、版本、诊断、网络桥接、存档基础设施和模块生命周期；
2. **可演进的内容模块**负责未来的具体游戏规则、界面、角色、物品、世界和社区 Mod。

最终目标不是制作一个“什么都做”的万能游戏，而是让新游戏和大型玩法迭代尽量变成模块开发，而不必反复推翻底层工程。

## 核心设计原则

### 框架保持品类中立

公共 API 中不出现生存、卡牌、沙盒、RPG 或策略游戏专属概念。具体品类的规则属于未来产品契约或内容模块，而不是底层框架。

### 公共契约与私有实现分离

私有框架源码保留在主游戏工程中：

```text
Assets/GameFramework
```

对 Mod 作者公开的是版本化 SDK：

```text
Packages/com.mimizh.game-mod-sdk
```

SDK 最终只分发经过批准的公共契约 DLL、XML 文档、验证工具和打包流程，不公开 Context、网络、存档、热更新和 Bootstrap 的私有实现。

### 使用 Capability，而不是全局 Service Locator

模块声明自己需要和提供的能力，由 Context Runtime 负责解析。公共模块上下文不会暴露任意 `Resolve<T>()`，避免 Mod 绕过权限、生命周期和诊断体系直接访问内部服务。

### 生命周期必须可撤销

模块注册事件、创建对象、加载资源或启动异步任务时，框架需要知道这些副作用由谁拥有、何时取消以及如何释放。逻辑卸载和物理程序集卸载是两个不同概念：即使 DLL 暂时不能从内存中移除，模块行为也必须能够被可靠停用。

### 兼容性显式化

框架分别维护：

- Game Build ID；
- Mod API Version；
- Network Protocol Version；
- Content Compatibility Version。

资源更新、公共 API 更新和网络协议更新不再被混成一个模糊的“游戏版本”。

### 所有关键行为都可观测

结构化诊断事件携带 Session、Module、Fiber、Capability、生命周期和关联 ID。未来的工具可以据此展示依赖图、加载过程、回滚路径、资源泄漏和性能热点，而不是只留下难以检索的字符串日志。

## 运行时结构

```text
App LifetimeScope
├─ Framework Identity
├─ Diagnostics
├─ Session Factory
└─ Session LifetimeScope
   ├─ Session Identity
   ├─ Session Cancellation
   ├─ Context Runtime        (后续阶段)
   ├─ Networking / Storage   (后续阶段)
   └─ Module Fibers          (后续阶段)
```

`App LifetimeScope` 在应用运行期间只存在一份。一次单机世界、联机会话或测试运行对应一个可创建、停止并重新创建的 `Session LifetimeScope`。未来模块实例会由 Context Runtime 表示为 Fiber，并通过 Capability 建立依赖关系。

## 技术选型

| 技术 | 在框架中的职责 |
| --- | --- |
| Unity 6 / IL2CPP | 主运行时和 AOT Player |
| VContainer | App 与 Session 的组合根和静态依赖注入 |
| HybridCLR | 可信 C# 模块与热更新程序集执行 |
| Addressables | 模块资源、Catalog 和资源句柄管理 |
| Unity Netcode for GameObjects | AOT 网络会话与自定义消息桥接基础 |
| UniTask | 私有实现中的 Unity PlayerLoop 异步适配，不进入公共 Mod API |
| Unity Test Framework | EditMode、PlayMode 与 Player 验证 |
| Unity Pipeline / MCP | 让开发 Agent 安全操作 Editor、资源、测试和构建 |

公共 Mod API 使用标准 BCL `Task` 与 `CancellationToken`，避免让外部分发的契约绑定特定 UniTask 版本。Addressables、网络请求和帧等待等 Unity 特有操作可以在私有实现内部使用 UniTask，再通过稳定边界向外暴露。

## Mod 与 Agent 工作流

面向专业作者的目标流程是：

```text
安装 Mod SDK
→ 在 Unity 中编写模块与资源
→ 编译 HybridCLR DLL
→ 构建 Addressables
→ 生成 Manifest / Schema / 验证报告
→ 在专用 Test Player 中运行兼容性测试
→ 发布模块
```

项目还计划提供 `AGENTS.md`、开发约束 Skills、CLI 和 MCP 适配。Claude Code、Codex 等工具可以读取同一套架构和 Mod 约束，打开 Unity 后执行代码生成、资源创建、测试和打包。AI 的作用是降低专业开发流程中的重复劳动，而不是绕过验证规则直接修改玩家数据。

## 当前进度

目前已经完成第一阶段的主体实现：

- 私有 Framework 与外部 Mod SDK 的目录和程序集边界；
- 强类型 ID、SemVer 和四类兼容版本；
- 初始 Module、Capability、Lifecycle 与 Diagnostics 公共契约；
- VContainer App Project Root；
- 可创建、停止和重建的 Session 子 Scope；
- 结构化诊断路由、内存 Sink 和 Unity Console Sink；
- 程序集依赖和公共 API 泄漏检查；
- EditMode、PlayMode 和 Player 测试基础；
- HybridCLR 初始化与 Generate/All 工作流。

当前仍在进行 Phase 1 的审查修正，包括 App 退出时的 Session 协调、失败清理、Session Cancellation、SemVer 边界行为、诊断属性验证和最终 Player Smoke Test。

## 路线图

1. **Kernel and Composition Roots** — 完成 App/Session、公共值类型和诊断基础；
2. **Context Runtime MVP** — 实现 Module Spec、Fiber、Capability、Effect、回滚和依赖解析；
3. **HybridCLR / Addressables Pipeline** — 实现模块 DLL、资源、Manifest 和加载顺序；
4. **Framework Conformance Harness** — 使用中立测试模块持续验证生命周期、泄漏和兼容性；
5. **Mod API Stabilization** — 发布 API 1.0 候选与迁移策略；
6. **Networking and Persistence** — 加入自定义消息协议、Schema、快照和迁移；
7. **Professional Mod SDK and AI Tooling** — 完成 SDK、Test Player、CLI、MCP 和开发 Skills；
8. **Hardening and Distribution** — 完成签名、权限、性能门槛和内容分发。

## 不是什么

- 不是已经完成的游戏成品；
- 不是面向所有玩家的无代码编辑器；
- 不是不受限制的脚本沙箱；
- 不是依赖 LLM 才能运行的游戏；
- 不是把所有游戏类型强行塞进同一套玩法接口。

它首先是一套用于长期演进的游戏运行时边界。具体世界和玩法将在这套边界之上以模块形式出现。

## 链接

- [GitHub — magic-game-harness-unity](https://github.com/mimizmi/magic-game-harness-unity)
- [Deepseek Harness Paper](./assets/magic-game-harness-unity/paper.pdf)
