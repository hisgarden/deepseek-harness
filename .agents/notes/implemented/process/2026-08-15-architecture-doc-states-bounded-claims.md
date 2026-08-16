# Agent Note: docs/architecture.md states bounded claims, not absolutes

Status: implemented

English | [中文](2026-08-15-architecture-doc-states-bounded-claims.zh.md)

## Problem

`docs/architecture.md` is the mandated first read before changing anything under `packages/`, so a claim it states without qualification is the model a contributor builds against. Four of its claims were true of the design and false of the shipped tree, and two obligations it never stated were the contributor's to honor.

The doc asserted "there is no privileged core to patch" while `app-boot` mounts the root `include` under a pinned id that no config row can target; asserted "registrations are effects that unwind" while [defensive-patterns.md](../../../../docs/defensive-patterns.md) documents orphaned processes, terminals, and worker threads as a defect class that shipped here; asserted "a runtime invariant asserts it" for the model-visible-means-logged rule while shipped profiles mount no invariant service; and asserted that one provider swap "changes the whole product" while the remote path is an opt-in POC no bundle mounts. It named a `telemetry/*` capability-event family that does not exist. Its capability-seam guidance described three roles and no policy obligation, so a contributor who followed it shipped a tool that executes with no approval and no confinement, and a contributor adding a secret-consuming integration got no signal that configuration carries credential references rather than values.

## Decision

Every absolute in `docs/architecture.md` is either true of the shipped tree or explicitly bounded where it is not.

The Cordis section scopes plugin replaceability to the product above the boot glue and names the glue that changes only in source: the app bins, `app-boot`'s environment, home, and config resolution with its fail-loud guards, the Cordis Loader with the root `include` and `group` builtins it mounts, and vendored Cordis. It states that effects reclaim registrations rather than external resources, and that a plugin owning processes, terminals, worker threads, or remote sandboxes awaits their quiescence in its own disposer.

The session-log section attributes the model-visible-means-logged assertion to the optional invariant companion in development and test compositions, and states that shipped profiles mount no invariant service, per [omit runtime invariants from shipped config](../simplification/2026-08-03-omit-invariants-from-shipped-config.md).

The capability-seam section states that a new Consumer runs unapproved and unconfined because `tools/pre-execute` resolves to `allow` when no listener claims the call, and names the three gates that change it: the waterfall, `ctx.tools.guard()`, and a sandbox backend. It scopes the provider-swap claim to every consumer of that seam, records that a remote swap moves file and process effects across a process and network boundary with different trust properties, and identifies the remote path as the opt-in [E2B POC](../../../../packages/e2b/e2b/README.md) that relocates the filesystem and process world only.

The capability-event examples name `session-telemetry/*`, the family that exists.

The "Where new behavior goes" table routes the capabilities whose seams a contributor can reach: `ctx.credentials` for secrets, `ctx.lsp`, `ctx.web`, and `ctx.workflowEngine` alongside the shell, terminal, and job rows that were already there.

## Alternatives considered

- **Normalize `adapter` / `backend` / `provider` to one term.** Rejected on verification: "LLM adapter" is established across 18 files including `docs/cookbook/adding-an-llm-adapter.md`, which this document links, so normalizing would break its own cross-reference. Each term is the one its owning package uses.
- **Delete the absolutes instead of bounding them.** Rejected because the claims are the document's point — the plugin model and the seam payoff are real, and a reader needs the shape before the exceptions. Bounding keeps the claim and adds where it stops.
- **Move the policy obligation to the [tool cookbook](../../../../docs/cookbook/adding-a-tool.md) alone.** Rejected because the obligation applies at seam-design time, which is the decision this document owns; the cookbook is reached after the contributor has already chosen a shape.
- **Add a partial-coverage disclaimer to the routing table rather than rows.** Rejected because the table is the document's routing surface, and a disclaimer routes nobody. The Core packages table is explicitly a sample; this one is not.

## Consequences

A contributor adding a capability learns from this document that approval, confinement, and credential-referencing are theirs to wire, which the three-role seam description alone did not convey. A contributor writing a first plugin that owns a process learns that disposal does not reclaim it.

The Cordis section is longer by a paragraph, and the plugin-replaceability claim now requires the reader to hold an exception list. That cost buys the contributor not discovering the boot glue by reading `app-boot` after a patch fails to take.

The document now depends on facts that can drift: the invariant-omission decision, E2B's POC status, and `tools/pre-execute`'s default resolution. Each is stated where its owning package or note can be found, so a change to any of them has a documented inbound reference.

## Related

Findings came from a five-persona `ce-doc-review` pass (coherence, feasibility, scope-guardian, security-lens, adversarial). The feasibility pass verified the rest of the document against source and found it accurate: all 15 `ctx.*` keys resolve to the packages it attributes them to, all 11 package paths and 20 relative links exist, both anchor fragments resolve, `ctx.sessions.fork(source, boundary?, childSessionId?)` matches its declaration, and the patch-layer order matches `composeEntries([bundlePatches, profile.patches, homePatches, overlays])`.

Two questions the pass raised are not settled here: whether the Core packages table should carry `ctx.codeRuntime`, and whether the repository layout in `AGENTS.md` should list the `jobs/`, `goal/`, `client/`, `code-runtime/`, `storage/`, `schedule/`, `attachment/`, `workspace/`, and `feedback/` package groups and the top-level `apps/` directory.
