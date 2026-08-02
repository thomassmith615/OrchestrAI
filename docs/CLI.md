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
| `orch init` | Initialize Orchestraᵢ inside an existing repository | M2, available |
| `orch doctor` | Run diagnostic checks on the repository configuration | M2, available |
| `orch config` | Inspect resolved configuration and its sources | M2, available |
| `orch providers` | Display available AI providers, `--verify` for a live check | M3, available |
| `orch provider add <name>` | Select and configure an AI provider | M3, available |
| `orch status` | Repository inventory, toolchain, and provider | M4, available |
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
| `--set <key=value>` | Override a configuration value, repeatable |
| `-v, --version` | Print the version |
| `-h, --help` | Print help |

## Configuration

Settings resolve through four layers, lowest precedence first:

1. Built-in defaults
2. `orchestrai.config.json` at the repository root
3. Environment variables (`ORCH_PROVIDER`, `ORCH_MODEL`, and so on)
4. `--set key=value` on the command line

`orch config` prints the resolved value and its source for every setting.
Credentials are never stored in the config file: they are read from provider
specific environment variables, and `orch doctor` reports presence only.

State lives in `.orchestrai/` at the repository root. It is meant to be
committed, apart from `.orchestrai/cache/`.

## Providers

Provider selection lives in configuration, not in code:

```bash
orch providers                  # what is available and whether it is usable
orch provider add anthropic     # select it
orch provider add anthropic --model claude-opus-5
orch providers --verify         # minimal live request, opt in
export ANTHROPIC_API_KEY=...    # credentials come from the environment only
```

The `mock` provider is deterministic and offline. Use it to exercise
orchestration without spending anything: `orch provider add mock`.

`--verify` propagates the provider's exit code, so a bad key exits 5 and a
transport failure exits 1.

## Repository awareness

`orch status` reports what the repository contains and how it builds:

```bash
orch status
orch status --json | jq '.toolchain'
orch status --languages 10
```

The scanner honours `.gitignore` (including nested ones) plus any patterns in
the `ignore` setting. Detection is conservative: a command that was not found
reports as `-` rather than a guess, and Milestone 5 skips gates it has no
command for.

Supported ecosystems: node (npm, pnpm, yarn, bun), java (maven, gradle),
python (poetry, uv, pip), go, rust.

## Preconditions

Commands declare what they need, and the surface enforces it before the command
runs. A command that needs a repository never has to check for one.

| Requirement | Failure | Exit |
| --- | --- | --- |
| `repository` | Not inside a git repository | 4 |
| `initialized` | `orch init` has not been run | 4 |
| `config` | Configuration is missing or invalid | 5 |

`orch doctor` deliberately declares none of these, so that it can diagnose a
broken setup instead of failing with it.

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
