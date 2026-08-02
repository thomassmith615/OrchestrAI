# CLI Philosophy and Contract

## Primary user experience

Orchestraᵢ is a platform that currently exposes a CLI. The `orch` command is
interface number one; the dashboard, REST API, MCP server, and editor
extensions are later interfaces onto the same engine.

The command line is the primary interface. Everything
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

The full Version 1 surface of interface number one, with the milestone that
delivers each command.
Commands not marked as available do not exist yet and are not stubbed.

| Command | Description | Milestone |
| --- | --- | --- |
| `orch info` | Report the running environment | M1, available |
| `orch init` | Initialize Orchestraᵢ inside an existing repository | M2, available |
| `orch doctor` | Run diagnostic checks on the repository configuration | M2, available |
| `orch config` | Inspect resolved configuration and its sources | M2, available |
| `orch context` | Show what would be sent to a provider, and what would be dropped | M6, available |
| `orch propose <task>` | Stage a change for review. Writes nothing | M7, available |
| `orch propose show\|list\|apply\|reject` | The proposal lifecycle | M7, available |
| `orch providers` | Display available AI providers, `--verify` for a live check | M3, available |
| `orch provider add <name>` | Select and configure an AI provider | M3, available |
| `orch status` | Repository inventory, toolchain, and provider | M4, available |
| `orch build` | Execute the configured build pipeline | M5, available |
| `orch test` | Execute all configured validation | M5, available |
| `orch review` | Generate an engineering summary for human review | M7, available |
| `orch roadmap` | Display the roadmap and milestone progression | M8, available |
| `orch milestone` | Execute the current milestone workflow | M8, available |
| `orch next` | Determine the next milestone and prepare the workflow | M9 |
| `orch memory` | Inspect project memory; `verify` and `compact` sub-commands | M10, M11, available |
| `orch history` | Display engineering history and completed milestones | M10, available |
| `orch plugins` | Manage Orchestraᵢ plugins | M12 |
| `orch dashboard` | Launch the optional local web dashboard | M12 |
| `orch update` | Update Orchestraᵢ | M12 |

`orch config`, `orch context`, and the `orch propose` family are additions to
the original surface. The first two make otherwise invisible behaviour
inspectable; the third gives the proposal lifecycle a surface, which
`orch milestone` needs in order to drive it.

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

## Verification gates

```bash
orch build              # the build gate alone
orch test               # typecheck, lint, and test
orch test --all         # the full Definition of Done, build included
orch status             # last recorded verdicts, with their age
orch status --verify    # run every gate now
orch test --timeout 120 # per-gate timeout in seconds, default 600
```

Commands come from the Milestone 4 toolchain fingerprint, so this works on a
Maven or Cargo project without configuration. A gate with no detected command
is skipped, not guessed at, and does not count as a pass.

Results persist to `.orchestrai/gates.json`. Partial runs merge, so `orch build`
does not erase the last test verdict, and `orch status` shows how old each
verdict is.

Failing gates exit **3**, which is what CI should branch on:

```bash
orch test || case $? in
  3) echo "repository failed validation" ;;
  4) echo "nothing configured to run" ;;
  *) echo "orchestrai itself failed" ;;
esac
```

## Context

```bash
orch context                      # what would be sent, and what would not
orch context auth,login           # prioritize files matching these terms
orch context --dropped            # list what fell outside the budget
orch context --print              # print the assembled context itself
orch context --prompt analyze     # render a named prompt around it
```

Nothing here calls a provider. The budget comes from the `contextBudget`
setting; 25 percent is reserved for the system prompt and the response, so a
100,000 token budget packs at most 75,000.

Every included file lists why it was chosen. Files too large for the remaining
budget are skipped, never truncated, and appear under `--dropped` with their
token cost.

## The write path

Model output never reaches the working tree directly.

```bash
orch propose "add retry with backoff to the http host"
orch propose show              # full diff, newest open proposal
orch propose apply             # write it, then run the gates
orch propose reject            # throw it away
orch propose list
```

`propose` stages complete file contents under `.orchestrai/proposals/<id>/` and
writes nothing else. `apply` refuses a dirty working tree (exit 4) so that
`git checkout .` stays a complete undo, then runs the validation gates and exits
3 if they fail. Files are left in place on failure; the clean-tree precondition
is the escape hatch.

Nothing is ever committed. Orchestraᵢ writes files; you decide what becomes
history.

The `mock` provider answers the change protocol with a valid block, so the whole
loop runs offline with no API key:

```bash
orch provider add mock && orch propose "anything"
```

## Workflow

```bash
orch roadmap              # milestone progression, current one marked
orch roadmap --all        # including completed milestones
orch milestone            # run the workflow for the current milestone
orch milestone --dry-run  # list the stages without running them
orch milestone --id 9     # target a specific milestone
```

The roadmap is read from the `roadmapPath` setting, default `docs/ROADMAP.md`.
Orchestraᵢ parses that file and never rewrites it: it is a document a human
maintains.

The workflow runs the charter's development process as stages. It stops at the
first failure and exits 3, recording the remaining stages as skipped. Runs are
logged to `.orchestrai/runs/`.

Stages available now: `understand`, `analyze`, `preflight`, `baseline`,
`verify`, `summarize`. The baseline runs before any change, so a repository that
is already red is reported as such rather than blamed on the run.

## Project memory

```bash
orch memory add "Providers call REST, not SDKs" \
  --kind decision --body "Injected HTTP makes streaming testable." --tags providers
orch memory                       # most recent records
orch memory "truncation budget"   # ranked search, with the reasons
orch memory --kind constraint     # filter
orch memory --full                # include bodies
orch memory verify                # damaged or duplicated records; exits 1 if any
orch memory compact               # repair, archiving the previous file first
orch history                      # completed milestones and the run log
```

Records live in `.orchestrai/memory/records.jsonl`, append only, one JSON object
per line. Kinds: `decision`, `constraint`, `milestone`, `note`. A damaged line
is reported with its line number and exits non-zero rather than being skipped.

Memory is recalled automatically into every provider call, budgeted alongside
the files and capped at a third of the window. `orch context` shows what
reached the model.

`orch history` is the log of what was done; `orch memory` is the record of why.

## Resilience and spend

Rate limits, server errors, and transport failures are retried with exponential
backoff and full jitter, honouring `Retry-After`. Bad credentials and malformed
requests are never retried.

```bash
orch config      # maxRetries, requestTimeout, fallbackProvider, baseUrl
orch history     # calls, tokens, and estimated spend
```

`fallbackProvider` is used only when the primary fails with a retryable error,
after its own retries are spent.

Every call is ledgered to `.orchestrai/usage.jsonl`. Cost is an estimate from an
advisory rate table: a model with no known rate reports no cost rather than a
wrong one, and totals say how many calls were unpriced.

`baseUrl` points the OpenAI-compatible provider at any endpoint speaking the
chat completions format, including local runtimes:

```bash
orch provider add openai --model llama-3.1-70b
orch config --set baseUrl=http://localhost:11434/v1
```

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
