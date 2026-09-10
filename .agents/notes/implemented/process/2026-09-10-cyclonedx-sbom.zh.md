# Agent Note: 面向已发布运行时闭包的 CycloneDX SBOM

Status: implemented

[English](2026-09-10-cyclonedx-sbom.md) | 中文

## Problem

`THIRD_PARTY_NOTICES.md` 按声明外部包的工作区区域来披露它们，并且只记录直接声明——这是刻意为之，因为它回答的是谁承担了某个依赖。

审计供应链的消费者问的是另一个问题：这些声明最终解析成了什么。这需要精确版本、传递闭包、逐组件的完整性校验值，以及扫描器能与漏洞数据匹配的标识。散文表格无法回答其中任何一项，而 notices 文件本身也指明 `pnpm-lock.yaml` 才是完整闭包的权威来源。此前没有任何产物以机器可读的形式承载该闭包。

## Decision

`sbom.cdx.json` 是一份已提交的 CycloneDX 1.6 文档，覆盖从 `DEV_ONLY_AREAS` 之外的每个工作区包出发、经 `dependencies` 与 `optionalDependencies` 可达的传递闭包，其中已发布区域的定义沿用 notices 生成器所拥有、现已导出的那一份。

`scripts/sbom.ts` 遍历 `pnpm-lock.yaml` 而非清单文件，因此闭包是解析后的依赖图，而不是声明的边。每个组件携带其精确版本、Package URL、来自 lockfile 并转换为 CycloneDX hash 的完整性校验值，以及其声明的许可证；组件之间的运行时依赖边记录为 CycloneDX dependencies。`pnpm run verify-sbom` 重新生成并比对，且在 `hygiene` 中运行，因此未同步到该文档的依赖变更会失败，而不是让消费者扫描一份过期清单。pre-commit 钩子在 lockfile 或生成器变更时重新生成它，与它对 notices 文件的既有做法一致。

## Determinism

该文档已提交并由门禁比对，因此每个字段都是 lockfile 与已安装 store 的纯函数。它不携带时间戳与序列号，其 `bom-ref` 取组件自身的 Package URL 而非库生成的标识符，且序列化时列表有序。

受平台限制的包是 store 唯一无法在所有主机上给出相同答案的地方。lockfile 中标记了 `os` 或 `cpu` 的包只在匹配的平台上安装，仅经由此类父包可达的包同样如此，因此生成主机能读到哪一个变体因平台而异。这些组件因而携带版本、purl 与完整性校验值，但不携带声明的许可证：记录本地恰好安装的那一个变体的许可证会使已提交文档依赖于生成地点，`--check` 随后会在其他所有平台上失败。443 个组件中有 69 个属于该集合。

## Alternatives considered

**`@cyclonedx/cyclonedx-npm`。** 官方 npm 生成器通过 `npm ls` 发现依赖图。本工作区经 pnpm 解析，其 store 布局与 peer 解析键并不在该遍历的模型之内，因此它报告的闭包不会是 pnpm 实际安装的闭包。

**扩展 `gen-third-party-notices` 来输出 SBOM。** notices 文件回答谁声明了依赖，并以散文形式供人工评审阅读；SBOM 回答安装了什么，供工具消费。合并两者会让同一个生成器服务两类受众，并丢失 notices 文件存在的意义所在——直接声明与传递依赖之间的区分。

**让受平台限制的包继承声明它的依赖方的许可证。** 这可从 lockfile 推导因而具备确定性，实践中这些拆分二进制的包族也确实与其封装包共享条款。之所以否决，是因为原生二进制完全可能以不同于其 JavaScript 封装包的条款分发，而一份悄然出错的合规产物比一份带有明示缺口的更糟。

**在 CI 中生成该文档而不提交它。** 那样闭包变更将不会到达任何评审者：提交它使每次依赖变动成为可评审的 diff，这与 `THIRD_PARTY_NOTICES.md` 被提交的理由相同。

## Consequences

仓库引入了 CycloneDX 库、`packageurl-js`，以及其 schema 校验器所需的 `ajv` 系列包，并承载一份 443 个组件的文档，该文档随运行时闭包变动而变动。

范围仅限 npm 闭包。工作区包与 vendored 包解析为 `link:` 条目因而不出现在其中，它们是第一方源码而非解析出的组件；`python/` 下捆绑的 Python 运行时与原生 addon 的预构建二进制所携带的依赖集合，任何 npm lockfile 都不描述。把该文档当作整个产品清单的读者会因此判断错误，所以模块在生成器作者能看到的位置写明了这一点。

## Testing

`scripts/sbom.spec.ts` 依据 CycloneDX 1.6 schema 校验已提交文档，并断言每个组件都携带 purl 与 hash，且没有时间戳或序列号重新引入对主机的依赖。遍历行为以 fixture lockfile 固定：已发布区域的种子选取、`link:` 排除、传递可达性，以及包含仅位于受限父包之后的包在内的平台限制规则。键解析针对携带自身 `@` 的 peer 分组固定。从已提交文档中删除一个组件会使 `verify-sbom` 失败。
