# Changelog

All notable changes to this project are documented here.
Format follows Keep a Changelog. Versioning is semantic.

## [Unreleased]

### Added

- Milestone 2: configuration, workspace, and diagnostics.
  - Workspace resolution by walking upward to the git root, with the state
    directory and config path derived from it.
  - Layered configuration (defaults, `orchestrai.config.json`, `ORCH_*`
    environment variables, `--set key=value`) with per-field source tracking
    and typed validation. See ADR 0005.
  - Injectable filesystem, subprocess, and environment hosts so that commands
    are testable without touching the machine.
  - Declared command preconditions (`repository`, `initialized`, `config`)
    enforced by the surface, mapping to exit codes 4 and 5.
  - `orch init`, `orch doctor`, `orch config`.
  - Status fields now render a verdict plus its detail on one line.

- Milestone 1: foundation, command contract, and CLI shell.
  - TypeScript project with strict compiler settings, ESM output, and the
    `orch` binary.
  - Executable Definition of Done via `npm run verify` (typecheck, lint, test,
    build) and a matching GitHub Actions workflow.
  - Core primitives: error taxonomy with the full exit code contract, leveled
    logger with injectable sinks, environment snapshot with injectable host.
  - Engine layer: neutral `CommandDefinition` contract, `CommandResult` with
    both a machine readable payload and a human readable report, and a command
    registry that every surface consumes.
  - CLI layer: commander adaptation, aligned human rendering, universal
    `--json`, and global `--verbose`, `--quiet`, `--cwd` flags.
  - `orch info`.
  - Charter, CLI contract, architecture document, Version 1 roadmap, and ADRs
    0001 to 0004.

### Changed

- Version 1 roadmap consolidated from 25 milestones to 12. Verification gates
  resequenced ahead of context packing; project memory resequenced after the
  end to end orchestration loop. Total scope is unchanged.
- Binary renamed from `orchestrai` to `orch`. The npm package name is
  unchanged.
- Milestone 1 reimplemented around the engine command contract after the CLI
  first product decision. See ADR 0004.
