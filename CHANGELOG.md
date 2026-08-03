# Changelog

All notable changes to this project are documented here.
Format follows Keep a Changelog. Versioning is semantic.

## [Unreleased]

Version 2's six milestones are complete: the runtime hosts capabilities,
proven with a real second one, without shipping it. See `docs/ROADMAP-V2.md`.

### Changed

- **The default provider is now `ollama`**, not `anthropic`. A fresh install
  works immediately against a local Ollama instance with no credential, no
  spend, and no network dependency beyond `localhost:11434`; a frontier
  model remains one explicit `orch provider add anthropic`/`openai` away.
  See ADR 0022.

### Added

- Ollama provider (`src/providers/ollama.ts`), and a `credentialRequired?`
  flag on `ProviderDescriptor` so `orch doctor`/`orch providers`/`orch
  provider add` stop treating a local provider's absent credential as a
  warning. `openai.ts` and `ollama.ts` now share one transport,
  `src/providers/chat-completions.ts`, rather than duplicating the identical
  chat-completions wire protocol between them; `openai.ts`'s existing test
  suite passes unmodified against the refactor, which is the regression
  proof that its behaviour didn't change. `doctor.ts`'s hand-maintained
  credential map was replaced with a lookup against the real provider
  registry, incidentally dropping a phantom `gemini` entry no provider ever
  backed. See ADR 0022.

- Milestone V2-6: the second capability, and the proof.
  - `src/capabilities/placeholder/`: a real, production-quality second
    capability whose only purpose is proving the runtime — a real command
    prefix, its own config namespace and field, its own storage namespace,
    and `requires: { scope: "user" }` on every command it declares. No
    domain; never shipped.
  - `tests/capabilities/placeholder.test.ts`: assembles Engineering and
    Placeholder into one registry and drives both through the real `run()`
    CLI entry point, against a fake filesystem with no `.git` anywhere at
    all — not a composition-level test, an end-to-end one. Proves `orch
    capabilities` reports both with neither privileged; Placeholder's
    commands succeed under user scope with no repository; state persists,
    isolated per capability; and Engineering's own `orch status` still
    requires a repository and still exits 4, unaffected by Placeholder's
    presence in the same registry.
  - Placeholder is deliberately not part of `defaultCapabilities`; the
    shipped `orch` binary is unchanged, still Engineering alone.
  - Route and page registries, named in this milestone's original roadmap
    description, were not built: no HTTP surface or generalized dashboard
    consumer exists to give their shape any discipline.
  - Version 2's phase Definition of Done is proven, not shipped; promoting
    Placeholder (or a real capability) into the default set is a product
    decision left open. See ADR 0021.

- Milestone V2-5: events, jobs, and provider registration.
  - `EventBus` (`src/runtime/events.ts`): a shared, synchronous, in-process
    pub-sub emitter. Event names (`<capability>.<noun>.<verb>`) are a
    convention, not an enforced namespace — multiple listeners sharing a
    name is the point. A handler that throws or rejects is logged as a
    warning and never stops another handler, or `emit`, from completing.
  - `JobDefinition`/`JobContext` (`src/runtime/jobs.ts`): a contract for a
    capability-declared unit of work. No scheduler; no cross-capability name
    composition, since nothing yet addresses a job by name.
  - `composeProviders` (`src/runtime/providers.ts`): merges a capability's
    declared `ProviderDescriptor`s with the built-in three
    (`anthropic`/`openai`/`mock`) into one flat, collision-checked list —
    flat rather than namespaced, matching the existing `orch provider add
    <name>` convention. `src/providers/index.ts` is untouched.
  - `Capability` gained two more optional methods, `jobs?()` and
    `providers?()`. Engineering declares neither: it has no jobs, and
    providers were never capability-mediated even in Version 1.
  - None of the three is wired into a live surface (`assembleRuntime()`,
    `orch providers`, `orch provider add`, `createProvider` are all
    unchanged); each has its own named revisit trigger. See ADR 0020.

- Milestone V2-4: namespaced storage.
  - `CapabilityStorage` (`src/runtime/storage.ts`): a `FileSystemHost`
    confined to one directory — not a new interface, the same one every
    command already receives via `context.hosts.fs`. Every path is checked
    for containment (`path.relative` against the root) before it reaches the
    real filesystem, so a capability cannot address another's files or
    anything above its own root.
  - `Capability.storageNamespace?: string`: an optional declaration, kept
    independent of `commandPrefix` so a capability can choose bare top-level
    commands without also giving up storage isolation.
  - `createCapabilityStorage(scope, namespace, fs)` and `storageRoot`,
    namespacing with `/` under the active scope's state directory the way
    commands namespace with a space and config fields namespace with a dot.
  - Engineering declares the root storage namespace, proven by test to
    resolve to `.orchestrai/` itself; `src/memory`, `src/gates`, and
    `src/proposals` were not touched.
  - `tests/runtime/storage.test.ts` proves the milestone's actual claim: two
    differently-namespaced capabilities persist same-named files with no
    collision, and neither can reach the other's via a `../` escape attempt.
  - `CommandContext` deliberately does not gain a live storage field yet —
    no command has anything to persist through it. See ADR 0019.

- Milestone V2-3: namespaced configuration.
  - `Capability.configSchema?()`: an optional method a capability uses to
    declare its own configuration fields (specs and defaults, unprefixed,
    under its own namespace), mirroring `commands()`.
  - `composeConfigSchemas` (`src/runtime/config.ts`): merges every
    capability's fields into one flat table, namespacing each with a dot
    (`home.token`) the way commands are namespaced with a space, and
    rejecting a same-namespace field collision.
  - Engineering declares an empty config namespace; its composed table is
    `CONFIG_FIELDS`/`DEFAULT_CONFIG`, byte for byte — the same
    backwards-compatibility concession as its empty command prefix.
  - `resolveConfig` and `orch config` are deliberately not wired to a
    composed table yet: there is no second capability with a real field to
    resolve, so that integration is a named revisit trigger rather than
    speculative work. See ADR 0018.

- Milestone V2-2: scope.
  - `Scope` (`src/core/workspace.ts`): repository scope, unchanged from
    Version 1, or user scope, rooted at `~/.orchestrai` with no repository
    anywhere, resolved through the injected environment host rather than
    `process.env` directly.
  - `CommandRequirements.repository: boolean` replaced by
    `CommandRequirements.scope: "repository" | "user" | "either"`, defaulting
    to `"repository"` — the default that kept all 27 Version 1 commands'
    behaviour unchanged.
  - `CommandContext` gains a resolved `scope` field, alongside the unchanged
    `workspace` field. A command declaring user scope now runs with no git
    repository anywhere on the filesystem.
  - `orch info` and `orch doctor` report the active scope. `doctor` still
    never fails merely for being outside a repository.
  - See ADR 0017.

- Milestone V2-1: capabilities.
  - `src/runtime/`: the `Capability` contract (id, summary, declared command
    prefix, `commands()`), a `CapabilityRegistry`, and `activateCapabilities`,
    which registers a capability's commands into a command registry under its
    declared prefix. The runtime's job is lifecycle only — register,
    activate, assemble, report — and it never branches on which capability is
    being activated. See ADR 0016.
  - `src/capabilities/engineering/`: Engineering declared as the first
    capability, with an empty command prefix (a backwards-compatibility
    concession) and no implementation moved — it wraps the existing
    `createRegistry()` aggregation rather than duplicating it.
  - `src/capabilities/index.ts`: the composition root that lists first-party
    capabilities and assembles the runtime the CLI drives by default.
  - `orch capabilities`, reporting what activated and what, if anything,
    failed to.
  - A test that activates Engineering alongside a second, throwaway
    capability under its own prefix and asserts Engineering's contributed
    command names are still exactly the v1 27 — the test that would catch a
    privileged path.

## [1.0.0] - 2026-08-02

First tagged release. Version 1 is complete: all 12 milestones delivered.

### Added

- Milestone 12: extension, surface, and release.
  - Plugin contract with declared permissions (`read-repo`, `write-repo`,
    `network`, `state`). The loader hands a plugin only the hosts it asked for.
    Permissions are a declaration, not a sandbox, and that limit is documented
    wherever they are. See ADR 0015.
  - Plugin commands registered at runtime, only when `plugins` is configured.
    A failed plugin is a warning, never fatal.
  - `examples/plugin-example.mjs`, a working plugin that adds a command.
  - Read-only dashboard: one self-contained document, no build step, no script,
    no external request, no mutating route. Binds to localhost by default.
    `GET /api/snapshot` serves the same data as JSON.
  - `orch update`, which reports whether a newer version was published and
    never installs anything.
  - GitHub Actions pipeline: the Definition of Done on node 20 and 22, plus a
    smoke job that exercises the built binary against this repository.
  - Packaging for release: MIT license, `files`, `prepack`, version 1.0.0.

- Milestone 10: project memory.
  - Append-only records in `.orchestrai/memory/records.jsonl`, one JSON object
    per line, with kind, tags, originating milestone, and commit. Damaged lines
    are reported with line numbers rather than skipped. See ADR 0013.
  - Keyword retrieval behind a `Retriever` interface: inverse document
    frequency with title, tag, recency, and record-kind weighting. Every result
    explains itself. An embedding backend implements the same interface.
  - Recall wired into every provider call, budgeted alongside files and capped
    at a third of the context window.
  - A `record` stage so each milestone run leaves knowledge behind.
  - `orch memory`, `orch memory add`, and `orch history`.

### Fixed

- When a command group and its sub-command declared the same flag, commander
  assigned the value to the group, so `orch memory add --kind` was ignored.
  Commands now read options merged across the ancestor chain.

- Milestone 8: workflow engine.
  - Roadmap parsing from the `roadmapPath` setting. Tolerant by design:
    Orchestraᵢ reads the file, a human owns it. See ADR 0011.
  - Step contract with preconditions and postconditions, where skipping is not
    failing. Steps import neither the engine nor a provider.
  - Workflow execution that stops at the first failure and records the rest as
    skipped, with a persisted run log under `.orchestrai/runs/`.
  - Built-in stages: understand, analyze, preflight, baseline, verify,
    summarize. The baseline runs before any change so an already-red repository
    is reported rather than blamed on the run.
  - `orch roadmap` and `orch milestone`, with `--dry-run` and `--id`.

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
