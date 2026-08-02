# CLI Philosophy and Contract

## Primary user experience

The command line interface is the primary interface to Orchestraᵢ. Everything
else (dashboard, APIs, integrations) is built around the CLI rather than
replacing it. The CLI exposes nearly every capability of the platform. The web
dashboard is a visualization and monitoring layer.

The CLI should feel like git, docker, npm, cargo, kubectl, and terraform:
concise, composable, predictable, and scriptable. A power user should be able to
operate nearly the entire platform without opening the dashboard, and should be
able to automate it from shell scripts, CI pipelines, and cron jobs.

If a feature cannot be exposed cleanly through the CLI, reconsider whether it
belongs in the core platform.

## The binary

```bash
orch
```

Single verbs, no noun-verb ceremony except where a command genuinely manages a
collection (`orch provider add`).

## Command surface

The full Version 1 surface, with the milestone that delivers each command.
Commands not marked as available do not exist yet and are not stubbed.

| Command | Description | Milestone |
| --- | --- | --- |
| `orch info` | Report the running environment | M1, available |
| `orch init` | Initialize Orchestraᵢ inside an existing repository | M2 |
| `orch doctor` | Run diagnostic checks on the repository configuration | M2 |
| `orch config` | Inspect resolved configuration and its sources | M2 |
| `orch providers` | Display installed AI providers | M3 |
| `orch provider add <name>` | Install or configure an AI provider | M3 |
| `orch status` | Repository health, milestone progress, providers, pending work | M5 |
| `orch build` | Execute the configured build pipeline | M5 |
| `orch test` | Execute all configured validation | M5 |
| `orch review` | Generate an engineering summary for human review | M7 |
| `orch roadmap` | Display the roadmap and milestone progression | M8 |
| `orch milestone` | Execute the current milestone workflow | M8 |
| `orch next` | Determine the next milestone and prepare the workflow | M9 |
| `orch memory` | Inspect project memory | M10 |
| `orch history` | Display engineering history and completed milestones | M10 |
| `orch plugins` | Manage Orchestraᵢ plugins | M12 |
| `orch dashboard` | Launch the optional local web dashboard | M12 |
| `orch update` | Update Orchestraᵢ | M12 |

`orch config` is an addition to the original surface, on the grounds that
configuration precedence is impossible to debug without it.

## Global flags

Accepted by every command, before or after the command name.

| Flag | Effect |
| --- | --- |
| `--json` | Emit machine readable JSON instead of human output |
| `--verbose` | Include debug output |
| `--quiet` | Suppress everything except errors |
| `--cwd <path>` | Directory to operate against |
| `-v, --version` | Print the version |
| `-h, --help` | Print help |

## Exit codes

Exit codes are a public interface. Scripts depend on them.

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unexpected failure |
| 2 | Usage error (unknown command, bad arguments) |
| 3 | Validation gate failed (build, typecheck, lint, or test) |
| 4 | Precondition not met (not a repository, not initialized, dirty tree) |
| 5 | Configuration or credentials missing or invalid |

Code 3 is the one CI cares about: it distinguishes "the tool worked and the
repository failed" from "the tool broke".

## Output rules

Human output is an aligned label and value block. Status values are rendered as
uppercase verdicts.

```text
Repository:  camper-cad
Branch:      feature/milestone-12
Milestone:   Furniture Snapping
Build:       PASS
Tests:       PASS
Typecheck:   PASS
Lint:        PASS

Ready for review.
```

Detailed logs appear only under `--verbose`. Under `--json`, the payload is the
command's data object with no wrapper, so that `orch status --json | jq` works
without unwrapping. Errors under `--json` are emitted to stderr as
`{"error": {"code", "message", "hint"}}`.

## Architecture consequence

The CLI is a client of Orchestraᵢ, not Orchestraᵢ itself.

Commands are defined in `src/engine` as neutral `CommandDefinition` objects: a
name, a summary, declared arguments and options, and an `execute` function that
returns a `CommandResult` containing both a machine readable `data` payload and
a human readable `report`. `src/engine` may not import a CLI framework.

`src/cli` adapts those definitions into commander commands and renders the
results. It contains no business logic. The dashboard, an HTTP API, and an MCP
server are later clients of the same registry, which is why `--json` works
universally rather than being implemented command by command.

Adding a command means writing a `CommandDefinition` and registering it in
`src/engine/index.ts`. No CLI code changes.
