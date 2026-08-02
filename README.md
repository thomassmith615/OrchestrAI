# Orchestraᵢ

[![CI](https://github.com/thomassmith615/OrchestrAI/actions/workflows/ci.yml/badge.svg)](https://github.com/thomassmith615/OrchestrAI/actions/workflows/ci.yml)

The coordination layer that sits above AI models and orchestrates the software
engineering lifecycle.

Orchestraᵢ is not a model, an IDE, or a coding assistant. It is the workflow
engine that turns AI assisted development into a structured, repeatable,
human supervised process.

- [docs/CHARTER.md](docs/CHARTER.md) project constitution
- [docs/CLI.md](docs/CLI.md) CLI philosophy, command surface, exit codes
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) layer map and standing rules
- [docs/ROADMAP.md](docs/ROADMAP.md) Version 1 plan and current milestone

## Status

Version 1 is complete: all 12 milestones delivered. See
[docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

Node.js 20.11 or newer.

## Getting started

```bash
npm install
npm run verify        # typecheck + lint + test + build
npm link              # makes `orch` available on PATH
orch info
```

## The first interface

The `orch` CLI is interface number one. The engine underneath it is surface
agnostic: commands are neutral definitions in `src/engine`, and a dashboard,
REST API, MCP server, or editor extension consumes the same registry without
touching command code. See [docs/CLI.md](docs/CLI.md).

Available today:

| Command | Description |
| --- | --- |
| `orch build` | Execute the configured build pipeline |
| `orch config` | Show the resolved configuration and the source of each value |
| `orch context [focus]` | Show what would be sent to a provider, and what would be dropped |
| `orch dashboard` | Serve a read-only local dashboard |
| `orch doctor` | Run diagnostic checks on the repository configuration |
| `orch history` | Display engineering history and completed milestones |
| `orch info` | Show the current Orchestrai environment |
| `orch init` | Initialize Orchestrai inside an existing repository |
| `orch memory [query]` | Inspect project memory |
| `orch memory add <title>` | Record a decision, constraint, or note |
| `orch memory compact` | Rewrite memory, dropping damaged and duplicated records |
| `orch memory verify` | Check project memory for damaged or duplicated records |
| `orch milestone` | Execute the workflow for the current milestone |
| `orch next` | Determine the next milestone and prepare the engineering workflow |
| `orch plugins` | List configured plugins and the permissions they request |
| `orch propose <task>` | Ask the provider for a change, staged for review. Writes nothing. |
| `orch propose apply [id]` | Write a proposal to the working tree and run the gates |
| `orch propose list` | List change proposals, newest first |
| `orch propose reject [id]` | Mark a proposal rejected without applying it |
| `orch propose show [id]` | Show a proposal's full diff |
| `orch provider add <name>` | Select and configure an AI provider |
| `orch providers` | Display available AI providers and whether they are usable |
| `orch review [focus]` | Generate an engineering summary for human review |
| `orch roadmap` | Display the roadmap and milestone progression |
| `orch status` | Show repository health, toolchain, and configured provider |
| `orch test` | Execute all configured validation (typecheck, lint, test) |
| `orch update` | Report whether a newer Orchestrai has been published |
| `orch --version` | Print the version |
| `orch --help` | List available commands |

Every command is implemented; see [docs/CLI.md](docs/CLI.md) for the contract.

Every command accepts `--json`, `--verbose`, `--quiet`, `--cwd <path>`, and
`--set key=value`, and returns a documented exit code.

## Getting a repository ready

```bash
cd /path/to/your/repo
orch init      # writes orchestrai.config.json and .orchestrai/
orch doctor    # verifies the setup
orch config    # shows what resolved and from where
```

Settings resolve through defaults, then `orchestrai.config.json`, then
`ORCH_*` environment variables, then `--set`. Credentials are read from the
environment and never written to the config file.

```bash
export ANTHROPIC_API_KEY=...
orch provider add anthropic
orch providers --verify        # opt in, makes one small live request
```

The `mock` provider is deterministic and offline: `orch provider add mock`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile `src` to `dist` |
| `npm run typecheck` | Type check sources and tests without emitting |
| `npm run lint` | ESLint with type aware rules |
| `npm test` | Vitest suite |
| `npm run verify` | Full Definition of Done gate |

`./scripts/dump-context.sh > context.md` writes a ~27 kB summary of the
repository (roadmap, architecture, decisions, command surface, core contracts)
for handing to someone who has not seen it.

## Layout

```
src/core/     errors and exit codes, logging, injectable hosts, config, workspace
src/providers/  one file per provider behind a single interface, plus registry
src/repo/     scanner, gitignore evaluation, toolchain detection, git state
src/gates/    gate execution against the detected toolchain, result persistence
src/context/  relevance ranking, token budgeting, context assembly
src/prompts/  versioned .md templates, typed interpolation, registry
src/proposals/ change parsing, staging, diffing, application. The write path.
src/workflow/ roadmap parsing, step contract, execution, run log
src/memory/   append-only records, ranked retrieval, usage ledger
src/plugins/  plugin contract, loading, granted capabilities
src/dashboard/ read-only snapshot and renderer
src/engine/   command contract and registry, the interface every surface uses
src/cli/      commander adaptation, rendering, context building. No logic.
tests/        vitest suite, mirrors src structure
docs/         charter, CLI contract, architecture, roadmap, decision records
```

## Adding a command

Write a `CommandDefinition` in `src/engine/commands/`, register it in
`src/engine/index.ts`. Return a `CommandResult` with a `data` payload and a
`report`. Declare what the command needs via `requires` and the surface enforces
it. Rendering, `--json`, preconditions, and exit codes are already handled.

## Contributing rules

1. One milestone per commit.
2. `npm run verify` must pass before a milestone is considered complete.
3. Architectural decisions are recorded in `docs/adr`.
