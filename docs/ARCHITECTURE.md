# Architecture

## Purpose of this document

This describes the target shape of Orchestraᵢ and the rules that keep it
coherent as milestones land. It is intentionally written ahead of the code so
that each milestone has a place to attach to. Layers that do not yet exist are
marked as planned.

## The one sentence model

Orchestraᵢ observes a repository, assembles context, asks an interchangeable
model to propose a change, verifies the result against objective gates, records
what happened, and hands the decision to a human.

## Layer map

```
                    +-------------------------------+
   surfaces         |  cli        dashboard   api    |   (M1, M12, later)
                    |  thin clients, no logic       |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
   runtime          |  capability contract, registry |   (V2-1)
                    |  activation. Lifecycle only.  |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
   engine           |  command contract, registry   |   (M1)
                    |  CommandResult: data + report |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
   orchestration    |  workflow engine, milestones  |   (M8-M9)
                    |  planning, gates, proposals   |
                    +---------------+---------------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
+-------v--------+        +---------v---------+       +---------v---------+
|  repository    |        |     context       |       |      memory       |
|  scanner, git, |        |  packer, prompts, |       |  decisions, runs, |
|  toolchain     |        |  token budgeting  |       |  retrieval        |
|  (M4-M5)       |        |       (M6)        |       |       (M10)       |
+-------+--------+        +---------+---------+       +---------+---------+
        |                           |                           |
        +---------------------------+---------------------------+
                                    |
                    +---------------v---------------+
   providers        |  Provider interface, registry |   (M3, M11)
                    |  anthropic | mock | openai... |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
   core             |  config, logging, errors,     |   (M1-M2)
                    |  workspace, exit codes        |
                    +-------------------------------+
```

Dependencies point downward only. `core` knows nothing about providers.
Providers know nothing about workflows. Surfaces are thin. `src/runtime`
knows nothing about any capability; `src/capabilities` is the one layer
allowed to name one. See ADR 0016.

## Package intent

| Package | Responsibility | Introduced |
| --- | --- | --- |
| `src/core` | Errors, exit codes, logging, injectable hosts, config, workspace and scope. No AI awareness. | M1, M2, V2-2 |
| `src/engine` | Command contract and registry. The stable interface every surface uses. | M1 |
| `src/runtime` | Capability contract, `CapabilityRegistry`, activation, config/storage/provider composition, the event bus, the job contract. Lifecycle only: register, activate, assemble, report. Never names a capability. | V2-1, V2-3, V2-4, V2-5 |
| `src/capabilities` | First-party capabilities and the composition root that names them (`assembleRuntime`). Engineering is the first; its implementation still lives where M1-M12 put it. Placeholder is a second, real, proof-only capability, not part of `defaultCapabilities`. | V2-1, V2-6 |
| `src/cli` | Commander adaptation, rendering, global flags. Contains no logic. | M1 |
| `src/providers` | One file per provider behind a single interface, plus the registry. | M3 |
| `src/prompts` | Versioned `.md` templates, typed interpolation, registry. | M6 |
| `src/repo` | Scanning, ignore rules, language and toolchain detection, git state, the symbol index. | M4, M5, E1 |
| `src/context` | Working set resolution, ranking, token budgeting, and assembly of what a model sees. | M6, E2 |
| `src/memory` | Append-only records and ranked retrieval behind one interface. | M10 |
| `src/gates` | Gate execution against the detected toolchain, and result persistence. | M5 |
| `src/proposals` | Change parsing, staging, diffing, and application. The write path. | M7 |
| `src/workflow` | Roadmap parsing, step contract, execution, and run log. | M8 |
| `src/plugins` | Plugin contract, loading, and granted capabilities. | M12 |
| `src/dashboard` | Read only snapshot and its renderer. No build step. | M12 |

## Standing rules

1. **Provider neutrality.** Nothing outside `src/providers` may import a vendor
   SDK or reference a model name. Model selection is configuration.
2. **Dependency injection at the edges.** Filesystem, clock, network, and
   process access are passed in as interfaces. This is why `describeEnvironment`
   takes a host in milestone 1 rather than reading `process` directly.
3. **The CLI is a client, not the platform.** Commands are neutral definitions
   in `src/engine`. `src/cli` adapts and renders them. The dashboard and a
   future HTTP or MCP surface consume the same registry. See `docs/CLI.md`.
4. **Every capability is reachable from the CLI.** If a feature cannot be
   exposed cleanly as a command, reconsider whether it belongs in the core.
5. **Every command is scriptable.** Structured `--json` output and a meaningful
   exit code are part of the definition of done for a command, not an extra.
6. **No console outside the logger.** ESLint enforces this.
7. **Errors are typed.** Anything reaching the process boundary is an
   `OrchestraiError` with a stable code and an exit code.
8. **Commands declare preconditions, they do not check them.** `scope`,
   `initialized`, and `config` requirements are enforced by the surface before
   `execute` runs. See `docs/CLI.md` and ADR 0017.
9. **State lives in `.orchestrai/`.** Memory, roadmap state, and run history
   are files, readable and diffable by humans — inside the target repository
   for repository-scoped work, or under `~/.orchestrai` for user-scoped work.
   See ADR 0017.
10. **Nothing is committed or pushed without explicit human approval.**
   Orchestraᵢ proposes; the operator disposes.
11. **A capability declares what it offers; the runtime never names one.**
   No `if (capability.id === "...")` in `src/runtime` or `src/core`. See
   ADR 0016.

## Runtime and capabilities (V2)

A **capability** is a self-contained module — Engineering, later Home — that
declares commands (and, as later milestones land, configuration, storage,
events, routes, and pages) under its own namespace. The **runtime**
(`src/runtime`) registers capabilities and activates them into a command
registry; that is its entire job. It never branches on which capability it is
looking at. `src/capabilities/index.ts` is the composition root: the one
place first-party capabilities are listed and wired into `assembleRuntime()`,
which `src/cli` calls to build its default registry.

Engineering, the first capability, declares an empty command prefix so every
v1 invocation (`orch status`, `orch next`, ...) is unchanged; that emptiness
is a backwards-compatibility concession specific to the one capability that
predates this model, not a pattern to copy. See ADR 0016 and
`docs/ROADMAP-V2.md`.

## Scope (V2)

A command runs under a **`Scope`**: repository scope, rooted at a git root
exactly as in Version 1, or **user scope**, rooted at `~/.orchestrai`, with no
repository anywhere. `CommandRequirements.scope` (`"repository"`, `"user"`,
or `"either"`, defaulting to `"repository"`) replaces the old
`repository: boolean` flag; `CommandContext.scope` carries the resolved
value alongside the still-present `workspace: Workspace | null`. This is what
lets a future capability's commands declare `scope: "user"` and run with no
git repository involved at all — the proof V2-6 exists to demonstrate. See
ADR 0017.

## Config namespacing (V2)

A capability declares its own configuration fields via an optional
`configSchema()` (specs and defaults, unprefixed, plus a declared namespace),
the config equivalent of `commands()`. `composeConfigSchemas` merges every
capability's fields into one flat table, namespacing each with a dot
(`home.token`) the way commands are namespaced with a space (`home status`),
and rejects a same-namespace collision. Engineering's table composes to
exactly `CONFIG_FIELDS`/`DEFAULT_CONFIG` at the root namespace — its usual
concession.

**`resolveConfig` and `orch config` do not consume a composed table yet.**
They still resolve directly against `CONFIG_FIELDS`/`DEFAULT_CONFIG`, exactly
as in Version 1. Wiring them to the composed mechanism is deferred until a
second capability declares a real field worth resolving — a named revisit
trigger, not an oversight. See ADR 0018.

## Storage namespacing (V2)

A `CapabilityStorage` is a `FileSystemHost` — the same interface
`context.hosts.fs` already is, not a new one — confined to one directory:
`createCapabilityStorage(scope, namespace, fs)` roots it at the active
scope's state directory plus the capability's declared
`storageNamespace`, joined with `/` the way commands join with a space and
config fields join with a dot. Every path passed to it is checked for
containment before reaching the real filesystem, so a capability cannot
address another's files, or its own parent directory, even by construction.
Engineering declares the root namespace, resolving to `.orchestrai/` itself
— its usual concession — with `src/memory`, `src/gates`, and `src/proposals`
untouched.

**`CommandContext` does not carry a live storage handle yet.** No command
has anything to persist through this mechanism today. Wiring it in is
deferred until a capability's command actually needs to read or write its
own state during execution — a named revisit trigger, not an oversight. See
ADR 0019.

## Events, jobs, and providers (V2)

Three more extension points, each composed differently because each
resource behaves differently:

- **`EventBus`** (`src/runtime/events.ts`) is a shared, un-namespaced
  pub-sub emitter. Event names (`<capability>.<noun>.<verb>`) are a
  convention, not enforced, because multiple listeners sharing a name is
  the point of a bus, not a collision — unlike a command name, a config
  key, or a storage path, none of which tolerate two owners. A handler
  that throws or rejects is logged and never breaks another's, or the
  caller's `emit`.
- **`JobDefinition`/`JobContext`** (`src/runtime/jobs.ts`) are a contract
  only: `{ name, description, run(context) }`. No scheduler exists or is
  planned — `launchd` already serves a single always-on Mac — and job
  names are not composed or checked for collision across capabilities,
  because nothing yet addresses one by name.
- **`composeProviders`** (`src/runtime/providers.ts`) merges a capability's
  declared `ProviderDescriptor`s with the built-in three into one flat,
  collision-checked list — flat, not namespaced, because provider ids are
  already a shared, human-facing vocabulary (`orch provider add <name>`).
  Engineering declares no `providers()`: unlike commands, config, and
  storage, providers were never capability-mediated even in Version 1.

**None of the three has a live production consumer yet.**
`assembleRuntime()`, `orch providers`, `orch provider add`, and
`createProvider` are all untouched. Each has its own named revisit trigger,
recorded in ADR 0020, rather than being wired in speculatively.

`JobContext`'s `{ logger, hosts }` is not an early draft of a future runtime
service container — logger, scope, configuration, storage, providers, and
events will eventually want one clean injection mechanism, but building it
before three or four of these narrow, per-purpose context types have
actually accumulated would be designing for a shape not yet known. See ADR
0020.

## The second capability, and what "proven" means (V2-6)

`src/capabilities/placeholder/` is a real, second `Capability` module,
written to the same standard as Engineering's: a real command prefix
(`placeholder`), its own config namespace and field, its own storage
namespace, and `requires: { scope: "user" }` on every command it declares —
exercising, deliberately, every axis a capability can currently claim as its
own. It has no domain and must never grow one.

**It is not part of `defaultCapabilities`.** The `orch` binary, built and
run, still activates Engineering alone. The architectural claim — that the
runtime hosts more than one capability without branching on identity — is
proven instead by `tests/capabilities/placeholder.test.ts`, which assembles
Engineering and Placeholder into one registry and drives both through the
real `run()` CLI entry point: `placeholder ping`/`placeholder status`
succeed under user scope with no `.git` anywhere in the fake filesystem;
state persists, isolated per capability; `orch status` (Engineering's,
unprefixed) still requires a repository and still exits 4, unaffected by
Placeholder's presence in the same registry; `orch capabilities` reports
both with neither privileged.

Whether to promote Placeholder, or a real second capability, into
`defaultCapabilities` — making this true of the shipped product rather than
of the test suite — is a product decision, left open rather than made here.
See ADR 0021.

## Data flow for a milestone run (target state, M9)

1. Resolve workspace and configuration.
2. Scan repository and load relevant memory.
3. Determine current milestone from the roadmap.
4. Pack a context window under an explicit token budget.
5. Ask the configured provider for a plan, then for a change set.
6. Apply the change set to a working area, not the working tree.
7. Run verification gates (build, typecheck, lint, test).
8. Present a diff plus gate results to the human.
9. On approval, apply, record the decision in memory, and stage the commit.

Steps 7 and 8 are what separate this from a chat window.
