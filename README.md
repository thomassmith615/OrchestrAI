# Orchestraᵢ

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

Version 1 is under construction. Milestone 8 of 12 is complete.

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
| `orch init` | Initialize Orchestraᵢ inside an existing repository |
| `orch doctor` | Diagnose node, git, repository, config, and credentials |
| `orch config` | Show resolved settings and the layer each came from |
| `orch providers` | List AI providers, `--verify` for a live check |
| `orch provider add <name>` | Select and configure a provider |
| `orch status` | Repository, git state, toolchain, provider, and gate verdicts |
| `orch context` | Show what would be sent to a provider, and what would not |
| `orch build` | Run the detected build command |
| `orch test` | Run all detected validation (typecheck, lint, test) |
| `orch review` | Ask the provider for an engineering summary |
| `orch propose <task>` | Stage a change for review. Writes nothing |
| `orch propose apply` | Write a reviewed proposal and run the gates |
| `orch roadmap` | Milestone progression, current one marked |
| `orch milestone` | Run the workflow for the current milestone |
| `orch info` | Report the running environment |
| `orch --version` | Print the version |
| `orch --help` | List available commands |

The full planned surface (`next`, `memory`, `history`, `plugins`, `dashboard`,
`update`) is
specified in [docs/CLI.md](docs/CLI.md) with the milestone that delivers each
one. Planned commands are not stubbed: help output lists only what works.

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
src/memory/   append-only records and ranked retrieval
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
