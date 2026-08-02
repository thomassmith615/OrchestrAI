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
| `src/runtime` | Capability contract, `CapabilityRegistry`, activation. Lifecycle only: register, activate, assemble, report. Never names a capability. | V2-1 |
| `src/capabilities` | First-party capabilities and the composition root that names them (`assembleRuntime`). Engineering is the first; its implementation still lives where M1-M12 put it. | V2-1 |
| `src/cli` | Commander adaptation, rendering, global flags. Contains no logic. | M1 |
| `src/providers` | One file per provider behind a single interface, plus the registry. | M3 |
| `src/prompts` | Versioned `.md` templates, typed interpolation, registry. | M6 |
| `src/repo` | Scanning, ignore rules, language and toolchain detection, git state. | M4, M5 |
| `src/context` | Ranking, token budgeting, and assembly of what a model sees. | M6 |
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
