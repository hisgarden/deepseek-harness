# Agent Note: docs/architecture.md 陈述有界的主张，而非绝对断言

Status: implemented

[English](2026-08-15-architecture-doc-states-bounded-claims.md) | 中文

## Problem

`docs/architecture.md` 是改动 `packages/` 下任何内容之前必读的第一份文档，因此它未加限定陈述的主张，就是贡献者据以构建的心智模型。其中四项主张对设计成立、对已发布的代码树不成立，另有两项本应由贡献者履行的义务从未被陈述。

该文档断言"不存在需要打补丁的特权内核"，而 `app-boot` 把根 `include` 挂载在一个没有任何配置行能够指向的固定 id 之下；断言"各项注册都是副作用，会在插件卸载时撤销"，而[防御性模式](../../../../docs/defensive-patterns.md)把被遗留的进程、终端和工作线程记录为本仓库确实发布过的一类缺陷；就"模型可见即已记录"规则断言"由一项运行时不变量断言这一点"，而发布用的 profile 并不挂载任何不变量服务；断言替换一个提供方就"改变整个产品"，而远程路径是一个没有任何组合包挂载的可选接入 POC。它还提到了并不存在的 `telemetry/*` 能力事件族。它的能力 seam 指引描述了三种角色却没有任何策略义务，因此遵循它的贡献者会交付一个既不经审批也不受限制就执行的工具；而添加消费密钥的集成的贡献者，也得不到"配置携带凭据引用而非取值"这一信号。

## Decision

`docs/architecture.md` 中的每一项绝对断言，要么对已发布的代码树成立，要么在不成立之处被明确划定边界。

Cordis 一节把插件可替换性的范围限定为引导胶水层之上的产品部分，并点名只能从源码改动的胶水层：应用 bin、`app-boot` 的环境、home 与配置解析及其 fail-loud 守卫、Cordis Loader 及它挂载的根 `include` 与 `group` 内建项，以及 vendored Cordis。该节陈述副作用回收的是注册项而非外部资源，持有进程、终端、工作线程或远程沙箱的插件需在自己的 disposer 中等待它们静止。

会话日志一节把"模型可见即已记录"的断言归属于开发与测试组合中的可选不变量伴生包，并陈述发布用 profile 不挂载任何不变量服务，依据[将运行时不变量排除在发布配置之外](../simplification/2026-08-03-omit-invariants-from-shipped-config.md)。

能力 seam 一节陈述：新增的 Consumer 默认既不经审批也不受限制，因为没有监听器认领调用时 `tools/pre-execute` 解析为 `allow`；并点名可改变这一点的三道关卡：该 waterfall、`ctx.tools.guard()` 和 sandbox 后端。该节把提供方替换的主张范围限定为该 seam 的全部消费方，记录远程替换会把文件与进程副作用移过一道信任属性不同的进程与网络边界，并指明远程路径是可选接入的 [E2B POC](../../../../packages/e2b/e2b/README.md)，它只搬迁文件系统与进程世界。

能力事件示例改为 `session-telemetry/*`，即确实存在的事件族。

"新行为的归属位置"表格路由贡献者可触达的能力 seam：密钥用 `ctx.credentials`，以及 `ctx.lsp`、`ctx.web` 和 `ctx.workflowEngine`，与原有的 shell、终端和后台工作各行并列。

## Alternatives considered

- **把 `adapter` / `backend` / `provider` 统一为一个术语。** 经核实后否决："LLM adapter" 已确立于 18 个文件，其中包括本文档所链接的 `docs/cookbook/adding-an-llm-adapter.md`，统一术语会破坏它自己的交叉引用。每个术语都是其归属包所用的那个。
- **删除这些绝对断言，而非为其划定边界。** 否决，因为这些主张正是文档的要点——插件模型与 seam 收益都是真实的，读者需要先掌握整体形状再了解例外。划定边界既保留主张，又补上它失效的位置。
- **只把策略义务放到[工具实操手册](../../../../docs/cookbook/adding-a-tool.md)。** 否决，因为该义务适用于 seam 设计阶段，而这正是本文档所拥有的决定；贡献者读到实操手册时已经选定了形状。
- **给路由表加一条"覆盖不全"的说明，而不是补行。** 否决，因为该表是文档的路由界面，而说明不路由任何人。Core packages 表格明确是示例，这张表不是。

## Consequences

添加能力的贡献者会从本文档得知，审批、限制和凭据引用都由自己接入——这是仅有三角色 seam 描述时无法传达的。首次编写持有进程的插件的贡献者会得知，销毁并不回收该进程。

Cordis 一节多出一个段落，插件可替换性主张现在要求读者同时记住一份例外清单。这一代价换来的是：贡献者不必在补丁失效之后才通过阅读 `app-boot` 发现引导胶水层。

本文档现在依赖若干可能漂移的事实：不变量排除决定、E2B 的 POC 状态，以及 `tools/pre-execute` 的默认解析。每一项都陈述在能够找到其归属包或 Agent Note 的位置，因此其中任何一项发生变化都有一条有文档记录的入向引用。

## Related

各项发现来自一次五角色 `ce-doc-review` 评审（coherence、feasibility、scope-guardian、security-lens、adversarial）。feasibility 一轮对照源码核实了文档其余部分并确认其准确：全部 15 个 `ctx.*` 键都解析到文档所归属的包，全部 11 个包路径和 20 个相对链接均存在，两个锚点片段均可解析，`ctx.sessions.fork(source, boundary?, childSessionId?)` 与其声明一致，补丁层顺序与 `composeEntries([bundlePatches, profile.patches, homePatches, overlays])` 一致。

该评审提出的两个问题未在此处解决：Core packages 表格是否应当收录 `ctx.codeRuntime`；以及 `AGENTS.md` 中的仓库布局是否应当列出 `jobs/`、`goal/`、`client/`、`code-runtime/`、`storage/`、`schedule/`、`attachment/`、`workspace/`、`feedback/` 这些包分组以及顶层 `apps/` 目录。
