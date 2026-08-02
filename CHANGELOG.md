# Changelog

All notable changes to this project are documented here.
Format follows Keep a Changelog. Versioning is semantic.

## [Unreleased]

### Added

- Milestone 7: engineering review and change proposals.
  - `orch review`, a read-only engineering summary from the configured
    provider.
  - Change proposals using full-file replacement blocks rather than diffs, with
    path validation that rejects anything outside the repository. See ADR 0010.
  - Proposals staged as real files under `.orchestrai/proposals/<id>/`, so
    diffs come from `git diff --no-index` rather than being reconstructed.
  - `orch propose`, `propose show`, `propose list`, `propose apply`,
    `propose reject`. Applying requires a clean working tree and runs the
    validation gates afterwards, exiting 3 on failure.
  - The mock provider answers the change protocol, so the whole loop runs
    offline with no API key.
  - `review` and `propose` prompt templates.

### Changed

- The CLI is documented as the first interface onto the engine rather than the
  product itself.
- Command output notes carry state and consequences only. Instructional notes
  that duplicated `--help` were removed.
- `CommandDefinition.execute` is now guaranteed to return a promise: the
  registry converts a synchronous throw into a rejection.

### Fixed

- The test filesystem double registered only the immediate parent of a new
  path, so intermediate directories could appear not to exist.

- Milestone 6: context packer and prompt system.
  - Explainable relevance ranking with no embeddings or model call. Every
    ranked file carries the reasons that produced its score.
  - Token budgeting with 25 percent headroom reserved for the system prompt and
    the response. Files that do not fit are skipped, never truncated, and are
    reported with their token cost. See ADR 0009.
  - Recently changed files boosted using the git log.
  - Versioned prompt templates as `.md` files with typed `{{variable}}`
    interpolation. Missing and unused variables are both errors.
  - `contextBudget` configuration setting, and numeric config fields.
  - `orch context`, an inspection surface that makes no network calls.

### Fixed

- Omitted optional command arguments no longer arrive as the string
  `"undefined"`.

- Milestone 5: git integration and verification gates.
  - Git state via porcelain v2: branch, detached head, staged, unstaged and
    untracked counts, ahead and behind, and head commit metadata. Diff reading
    for Milestone 7. Nothing here mutates the repository.
  - Gate runner that executes the detected build, typecheck, lint, and test
    commands with per-gate timeouts and structured verdicts.
  - Gate results persisted to `.orchestrai/gates.json`, with partial runs
    merging rather than replacing. See ADR 0008.
  - `orch build`, `orch test` (with `--all` and `--timeout`), and
    `orch status --verify`. Gate failures exit 3.
  - Exit codes on the process host, plus process timeouts and an injectable
    clock.

- Milestone 4: repository scanner and toolchain fingerprint.
  - Filesystem walk with gitignore evaluation, including nested ignore files,
    negation, anchoring, and directory-only patterns. Ignored directories are
    pruned rather than traversed.
  - Language detection by extension and filename, binary classification, a
    per-file size cap, and a file count cap that reports truncation.
  - Toolchain detection for node (npm, pnpm, yarn, bun), java (maven, gradle),
    python (poetry, uv, pip), go, and rust, plus CI system detection.
    Undetected commands report null rather than a guess. See ADR 0007.
  - `readDir` and `size` on the filesystem host.
  - `orch status`, moved forward from Milestone 5 so that the scanner has an
    observable surface.

- Milestone 3: provider layer and the Anthropic provider.
  - `Provider` interface with normalized `CompletionRequest`,
    `CompletionResult`, streaming chunks, capability flags, and a
    `ProviderError` taxonomy. No vendor type crosses the boundary.
  - Provider registry with metadata available without construction.
  - Deterministic offline `mock` provider, a first class registry member.
  - Anthropic provider over REST with streaming, usage accounting, and status
    to error kind mapping. See ADR 0006.
  - Injectable HTTP host with server sent event decoding.
  - Config file patching that preserves unrecognized settings.
  - Nested command names, so the engine can declare `provider add` without
    knowing anything about the CLI framework.
  - `orch providers` (with opt-in `--verify`), `orch provider add <name>`.

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
