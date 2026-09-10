# Agent Note: CycloneDX SBOM for the shipped runtime closure

Status: implemented

English | [中文](2026-09-10-cyclonedx-sbom.zh.md)

## Problem

`THIRD_PARTY_NOTICES.md` discloses external packages by which workspace area declares them, and records direct declarations only — deliberately, because it answers who takes on a dependency.

A consumer auditing the supply chain asks a different question: what those declarations resolve to. That needs exact versions, the transitive closure, per-component integrity, and an identity a scanner can match against advisory data. Prose tables answer none of it, and the notices file says so itself by naming `pnpm-lock.yaml` as the authority on the full closure. No artifact carried that closure in machine-readable form.

## Decision

`sbom.cdx.json` is a committed CycloneDX 1.6 document covering the transitive closure of `dependencies` and `optionalDependencies` reachable from every workspace package outside `DEV_ONLY_AREAS`, the same shipped-area definition the notices generator owns and now exports.

`scripts/sbom.ts` walks `pnpm-lock.yaml` rather than manifests, so the closure is the resolved graph rather than the declared edges. Each component carries its exact version, its Package URL, the lockfile's integrity as a CycloneDX hash, and its declared license; runtime edges between components are recorded as CycloneDX dependencies. `pnpm run verify-sbom` regenerates and compares, and runs inside `hygiene`, so a dependency change that never reaches the document fails instead of leaving a consumer scanning a stale inventory. The pre-commit hook regenerates it when the lockfile or the generator changes, the way it already does for the notices file.

## Determinism

The document is committed and gate-compared, so every field is a pure function of the lockfile and the installed store. It carries no timestamp and no serial number, its `bom-ref` values are the components' own Package URLs rather than the library's generated identifiers, and lists are serialized sorted.

Platform-restricted packages are the one place where the store cannot answer the same way on every host. A package the lockfile marks with `os` or `cpu` is installed only where it matches, as is any package reachable only through such a parent, so which variant a generating host can read differs by platform. Those components therefore carry version, purl, and integrity but no declared license: recording the one locally installed variant's license would make the committed document depend on where it was generated, and `--check` would then fail on every other platform. 69 of 443 components sit in that set.

## Alternatives considered

**`@cyclonedx/cyclonedx-npm`.** The official npm generator drives `npm ls` to discover the graph. This workspace resolves through pnpm, whose store layout and peer-resolution keys that traversal does not model, so the closure it reports would not be the closure pnpm installs.

**Extending `gen-third-party-notices` to emit the SBOM.** The notices file answers who declares a dependency and reads as prose for a human reviewer; the SBOM answers what is installed and is consumed by tools. Merging them would make one generator serve two audiences and would lose the direct-versus-transitive distinction the notices file exists to draw.

**Giving a platform-restricted package the license of the dependent that declares it.** This is derivable from the lockfile and therefore deterministic, and in practice these split-binary families do share their wrapper's terms. It was rejected because a native binary may legitimately ship under different terms than its JavaScript wrapper, and a compliance artifact that is quietly wrong is worse than one with a stated gap.

**Generating the document in CI instead of committing it.** A closure change would then reach no reviewer: committing it makes each dependency movement a reviewable diff, which is the same reason `THIRD_PARTY_NOTICES.md` is committed.

## Consequences

The repository gains the CycloneDX library, `packageurl-js`, and the `ajv` packages its schema validator needs, and carries a 443-component document that moves whenever the runtime closure does.

Scope is the npm closure and nothing else. Workspace and vendored packages resolve as `link:` entries and are absent, being first-party source rather than resolved components; the bundled Python runtime under `python/` and the native addon's prebuilt binaries carry dependency sets no npm lockfile describes. A reader treating this document as the whole product's inventory would be wrong, which is why the module says so where a generator author will see it.

## Testing

`scripts/sbom.spec.ts` validates the committed document against the CycloneDX 1.6 schema, and asserts that every component carries a purl and a hash and that no timestamp or serial number reintroduces host-dependence. Walk behavior is pinned on a fixture lockfile: shipped-area seeding, `link:` exclusion, transitive reach, and the platform-restriction rule including a package reachable only behind a restricted parent. Key parsing is pinned against a peer group carrying its own `@`. Removing a component from the committed document fails `verify-sbom`.
