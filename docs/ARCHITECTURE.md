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
                    |  anthropic | openai | mock    |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
   core             |  config, logging, errors,     |   (M1-M2)
                    |  workspace, exit codes        |
                    +-------------------------------+
```

Dependencies point downward only. `core` knows nothing about providers.
Providers know nothing about workflows. Surfaces are thin.

## Package intent

| Package | Responsibility | Introduced |
| --- | --- | --- |
| `src/core` | Errors, exit codes, logging, injectable hosts, config, workspace. No AI awareness. | M1, M2 |
| `src/engine` | Command contract and registry. The stable interface every surface uses. | M1 |
| `src/cli` | Commander adaptation, rendering, global flags. Contains no logic. | M1 |
| `src/providers` | One folder per provider behind a single interface. | M3 |
| `src/prompts` | Versioned, testable prompt templates. Never inline strings. | M6 |
| `src/repo` | Repository scanning, git access, toolchain detection. | M4 |
| `src/context` | Selection and budgeting of what a model is allowed to see. | M6 |
| `src/memory` | Durable project knowledge in `.orchestrai/`. | M10 |
| `src/workflow` | Milestone state, step execution, verification gates. | M5 |
| `src/plugins` | Third party extension points. | M12 |
| `src/dashboard` | Read only local web surface. | M12 |

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
8. **Commands declare preconditions, they do not check them.** `repository`,
   `initialized`, and `config` requirements are enforced by the surface before
   `execute` runs. See `docs/CLI.md`.
9. **State lives in `.orchestrai/`.** Memory, roadmap state, and run history are
   files in the target repository, readable and diffable by humans.
10. **Nothing is committed or pushed without explicit human approval.**
   Orchestraᵢ proposes; the operator disposes.

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
