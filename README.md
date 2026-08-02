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

Version 1 is under construction. Milestone 1 of 12 is complete.

## Requirements

Node.js 20.11 or newer.

## Getting started

```bash
npm install
npm run verify        # typecheck + lint + test + build
npm link              # makes `orch` available on PATH
orch info
```

## Available commands

| Command | Description |
| --- | --- |
| `orch info` | Report the running environment |
| `orch --version` | Print the version |
| `orch --help` | List available commands |

The full planned surface (`init`, `status`, `next`, `milestone`, `review`,
`doctor`, `test`, `build`, `providers`, `memory`, `history`, `plugins`,
`dashboard`, `update`) is specified in [docs/CLI.md](docs/CLI.md) with the
milestone that delivers each one. Planned commands are not stubbed: help output
lists only what works.

Every command accepts `--json`, `--verbose`, `--quiet`, and `--cwd <path>`, and
returns a documented exit code.

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
src/core/     platform primitives (errors and exit codes, logging, environment)
src/engine/   command contract and registry, the interface every surface uses
src/cli/      commander adaptation, rendering, global flags. No logic.
tests/        vitest suite, mirrors src structure
docs/         charter, CLI contract, architecture, roadmap, decision records
```

## Adding a command

Write a `CommandDefinition` in `src/engine/commands/`, register it in
`src/engine/index.ts`. Return a `CommandResult` with a `data` payload and a
`report`. Rendering, `--json`, and exit code handling are already done.

## Contributing rules

1. One milestone per commit.
2. `npm run verify` must pass before a milestone is considered complete.
3. Architectural decisions are recorded in `docs/adr`.
