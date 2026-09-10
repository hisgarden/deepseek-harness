# Agent Note: Runtime-independent globbing for repository gates

Status: implemented

English | [中文](2026-08-20-runtime-independent-gate-globbing.zh.md)

## Problem

`node:fs` `globSync` is a runtime built-in, so the file set a gate scans depends on which engine executes it.

Under Bun 1.3.11 every pattern whose leading segment is a literal dot directory matches nothing: `.agents/notes/**/*.md` yields 0 entries where Node yields 1390. Nothing reports an error — a gate that scanned no files exits successfully — so Agent Note, skill, and documentation gates would pass while checking an empty set. Of the 56 gate scripts the root manifest launches, 42 reach `globSync` directly or through a helper. The same walk hangs on `packages/**/system-prompt.expected.md`, and Bun's native `Bun.Glob` matches nothing for the dot-directory patterns either, so the exposure is Bun's glob engine rather than one `node:fs` polyfill.

## Decision

`scripts/glob.ts` owns gate globbing: `fdir` walks the filesystem and `picomatch` matches paths, so every gate resolves the same files under any runtime.

Its options are the subset the gates use — `cwd`, `exclude` as glob patterns, and `withFileTypes` — and matching reproduces the built-in: a literal dot segment matches, a wildcard never matches a dot entry, and `**` spans zero or more segments and yields directories as well as files. Every caller under `scripts/` imports it. `scripts/glob.spec.ts` alone imports the built-in, as the reference its differential assertions compare against.

## Walk planning

Each pattern contributes its longest literal directory prefix as a walk root, so `packages/*/*/package.json` crawls `packages/` instead of the repository. A pattern set containing no `**` also carries a depth budget, which stops that crawl three levels down rather than descending every nested `node_modules`. A pattern whose first segment is dynamic collapses the plan to a single whole-tree walk, which is the scope the built-in uses for it.

## Alternatives considered

**tinyglobby or fast-glob with `dot: true`.** Both prune dot directories during traversal unless `dot` is set, and setting it changes the matcher as well: wildcards then match dot entries the built-in skips, and a rooted pattern such as `**/*cordis*.yml` descends `.git` and `.artifacts`. Neither library expresses "literal dot segments match, wildcards do not" in one configuration, so neither reproduces current gate scope.

**Keeping `node:fs` `globSync` and substituting an implementation only under Bun.** Each runtime would keep its own glob engine, so the divergence this note exists to remove would survive as a conditional, and any future difference between the two would again appear as a silently narrowed gate rather than a failure.

**Restricting the runtime migration to the 14 gate scripts that never glob.** This leaves a mixed toolchain across `scripts/`, covers a quarter of the surface, and leaves the silent-scope behavior in place for every gate that does glob.

## Consequences

Gate globbing costs two runtime dependencies and one types package, and the repository owns the walk planning that the built-in previously performed.

Results are verified rather than assumed: 17 pattern forms drawn from the live call sites match the built-in exactly, including `packages/*/*` directory entries, an excluded multi-pattern walk, and the dot-directory patterns Bun loses. The same patterns produce identical output under Node and Bun. Cost is equal or lower — the `**/*cordis*` corpus walk resolves in 69ms against the built-in's 157ms — because the walk plan prunes where the built-in scans.

Gate scope is now independent of the executing runtime, which is the property a later move of `scripts/` onto another runtime depends on.

## Testing

`scripts/glob.spec.ts` asserts agreement with `node:fs` `globSync` across the pattern forms the gates use, and pins the two behaviors a substitute engine gets wrong: a literal dot segment matches, and a wildcard segment never matches a dot entry. Exclusion, `withFileTypes`, and an absent walk root are covered directly.
