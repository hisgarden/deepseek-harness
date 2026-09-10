# Agent Note: 与运行时无关的仓库门禁 glob

Status: implemented

[English](2026-08-20-runtime-independent-gate-globbing.md) | 中文

## Problem

`node:fs` 的 `globSync` 是运行时内置实现，因此门禁扫描到的文件集合取决于由哪个引擎执行它。

在 Bun 1.3.11 下，凡是首段为字面量点号目录的模式都匹配不到任何内容：`.agents/notes/**/*.md` 返回 0 个条目，而 Node 返回 1390 个。这个过程不会报错——扫描不到文件的门禁仍以成功退出——因此 Agent Note、skill 与文档门禁会在检查空集合的情况下通过。根清单启动的 56 个门禁脚本中，有 42 个直接或经由辅助模块调用 `globSync`。同一套遍历在 `packages/**/system-prompt.expected.md` 上还会挂起，而 Bun 原生的 `Bun.Glob` 对这些点号目录模式同样匹配不到内容，因此问题出在 Bun 的 glob 引擎，而非某一个 `node:fs` polyfill。

## Decision

`scripts/glob.ts` 负责门禁的 glob：由 `fdir` 遍历文件系统、`picomatch` 匹配路径，因此所有门禁在任何运行时下都解析出相同的文件。

它的选项只覆盖门禁实际使用的子集——`cwd`、以 glob 模式表达的 `exclude`，以及 `withFileTypes`——匹配行为复刻内置实现：字面量点号段可以匹配，通配符段永远不匹配点号条目，`**` 跨越零个或多个路径段并且既产出文件也产出目录。`scripts/` 下的每个调用方都改为引入该模块。只有 `scripts/glob.spec.ts` 仍引入内置实现，作为其差分断言所比对的基准。

## Walk planning

每个模式以其最长的字面量目录前缀作为遍历根，因此 `packages/*/*/package.json` 只爬取 `packages/`，而不是整个仓库。不含 `**` 的模式集合还会附带深度预算，使该次爬取在向下三层处停止，而不是深入每一个嵌套的 `node_modules`。首段为动态段的模式会把计划收敛为一次全树遍历，这正是内置实现对它采用的范围。

## Alternatives considered

**使用 tinyglobby 或 fast-glob 并设置 `dot: true`。** 两者在未设置 `dot` 时都会在遍历过程中剪掉点号目录，而设置它同时也改变了匹配器：通配符随之匹配内置实现会跳过的点号条目，且 `**/*cordis*.yml` 这类根级模式会深入 `.git` 与 `.artifacts`。两个库都无法用一套配置表达“字面量点号段匹配、通配符不匹配”，因此都无法复刻当前的门禁范围。

**保留 `node:fs` 的 `globSync`，仅在 Bun 下替换实现。** 这样每个运行时仍各自保留一套 glob 引擎，本 Agent Note 要消除的分歧会以条件分支的形式存续，而两者之间未来的任何差异仍会表现为被静默收窄的门禁，而非一次失败。

**把运行时迁移限制在 14 个不使用 glob 的门禁脚本上。** 这会让 `scripts/` 内部形成混合工具链，只覆盖四分之一的范围，并且对所有确实使用 glob 的门禁保留了静默收窄范围的行为。

## Consequences

门禁 glob 的代价是两个运行时依赖与一个类型包，并且仓库自行承担了原先由内置实现完成的遍历规划。

结果经过验证而非假定：取自真实调用点的 17 种模式形式与内置实现完全一致，其中包括 `packages/*/*` 的目录条目、一次带排除项的多模式遍历，以及 Bun 会丢失的点号目录模式。同样这些模式在 Node 与 Bun 下产出相同的输出。开销持平或更低——`**/*cordis*` 的全库遍历耗时 69ms，内置实现为 157ms——因为遍历计划会在内置实现仍全量扫描的地方剪枝。

门禁范围自此与执行它的运行时无关，后续把 `scripts/` 迁移到其他运行时正依赖这一性质。

## Testing

`scripts/glob.spec.ts` 针对门禁使用的各种模式形式断言其与 `node:fs` `globSync` 的一致性，并固定住替代引擎会弄错的两个行为：字面量点号段可以匹配，通配符段永远不匹配点号条目。排除项、`withFileTypes` 以及不存在的遍历根均有直接覆盖。
