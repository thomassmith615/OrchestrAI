# Version 1 Roadmap

Twelve milestones, each roughly three to six hours of engineering work.
Sequenced so that the tool can propose and verify real code changes by
Milestone 7, before the surrounding infrastructure is built around it.

This file is the source of truth for session continuation. When instructed to
"move on to the next milestone", inspect this file, verify the last completed
milestone, and implement the next unchecked one.

**Status legend:** `[x]` complete, `[ ]` not started.

**Current position:** Version 1 complete. All 12 milestones delivered.

---

## Part 1: Make it run (M1 to M3)

- [x] **M1. Foundation, command contract, and CLI shell**
  TypeScript project, strict compiler settings, ESLint with type aware rules,
  Vitest, CI workflow. Error taxonomy with the full exit code contract,
  injectable logger, neutral command definitions in `src/engine` with a
  registry, universal `--json` rendering, global flags, and the `orch` binary.
  Ships `orch info`. Definition of Done is executable as `npm run verify`.
  See `docs/CLI.md` for the command surface and output contract.

- [x] **M2. Configuration, workspace, and diagnostics**
  Schema validated `orchestrai.config.json` with layered precedence (defaults,
  project file, environment, flags) and `config show` reporting the source of
  each value. Workspace resolution: locate the project root, require git,
  create and validate `.orchestrai/` via `orchestrai init`. `orchestrai doctor`
  checks node, git, config, and credentials.
  Delivers `orch init`, `orch doctor`, `orch config`.

- [x] **M3. Provider layer and the Anthropic provider**
  The central abstraction: `Provider`, `CompletionRequest`, `CompletionResult`,
  capability flags, and a registry. A deterministic mock provider that every
  later test depends on. A working Anthropic implementation with streaming,
  usage accounting, and credential resolution. `orchestrai providers list`.
  Nothing above `src/providers` may reference a vendor SDK or a model name.
  Delivers `orch providers`, `orch provider add <name>`.

## Part 2: Make it useful (M4 to M7)

- [x] **M4. Repository scanner and toolchain fingerprint**
  Filesystem walk with gitignore and config ignore rules, language detection,
  size and binary limits, stable file inventory. Detection of build system,
  package manager, test runner, linter, and CI from manifests (`package.json`,
  `pom.xml`, `pyproject.toml`, `go.mod`). This is what makes the platform
  polyglot without the implementation being polyglot.
  Delivers `orch status` in its inventory form: what the repository contains
  and how it builds. M5 adds git branch state and the pass or fail verdicts.

- [x] **M5. Git integration and verification gates**
  Status, diff, branch, and commit metadata. Dirty tree detection as a
  precondition for automation. Then the Definition of Done as code: run the
  detected build, typecheck, lint, and test commands from M4, capture
  structured results, fail loudly. Pulled forward deliberately so that every
  later milestone can be judged objectively rather than by reading output.
  Delivers `orch build`, `orch test`, and the verdict rows of `orch status`.
  Gate failures exit 3.

- [x] **M6. Context packer and prompt system**
  Relevance ranking and token budgeting, reporting what was included, what was
  dropped, and why. Versioned prompt templates as files with typed
  interpolation, a registry, and snapshot tests. No prompt strings inline in
  logic. Highest risk milestone in the roadmap: everything downstream is only
  as good as what reaches the context window. Delivers `orch context`, an
  inspection surface for what would be sent and what would be dropped.

- [x] **M7. `orch review` and change proposals**
  A repository health and architecture report combining scanner, fingerprint,
  git, and a provider call. Then the first write path: model output becomes a
  reviewable patch in a staging area, never a direct write to the working tree.
  Apply, reject, or partially apply after review, with M5 gates run against the
  result. This is the point where the tool stops being a chat window.
  Delivers `orch review`, `orch propose`, and `orch propose apply|show|list|reject`.

## Part 3: Make it a workflow (M8 to M9)

- [x] **M8. Workflow engine**
  Parse this roadmap file, track completion state in `.orchestrai/`, expose
  `milestone status` and `milestone list`. Declarative workflow steps with
  preconditions, postconditions, dry run mode, and a structured run log. The
  charter's nine step development process expressed as executable stages.
  Delivers `orch roadmap`, `orch milestone`.

- [x] **M9. `orch next`**
  End to end orchestration: analyze, recall, plan, propose, verify, summarize,
  record. Every prior milestone is a component of this one command. When this
  works, the platform is what the charter describes. Delivers `orch next`.

## Part 4: Make it durable (M10 to M12)

- [x] **M10. Project memory**
  Append only, human readable records under `.orchestrai/memory` with a typed
  schema, atomic writes, and integrity checks. Decision records with rationale
  and commit links (`decision add`, `decision list`). Ranked retrieval, keyword
  based first with an optional embedding backend behind the same interface,
  feeding the context packer from M6. Delivers `orch memory`, `orch history`.

- [x] **M11. Hardening**
  Timeouts, retry with exponential backoff and jitter, rate limit handling, per
  request token and cost accounting, provider failover. An OpenAI compatible
  provider covering OpenAI and any base URL compatible endpoint, which is how
  local and open source models are supported without new code. Memory
  compaction, summarization, and `orch memory verify`.

- [x] **M12. Extension, surface, and release**
  Plugin system with capability contracts, discovery, lifecycle hooks, and
  explicit permissions. Read only local dashboard over roadmap state, memory,
  run history, and repository health. Packaging, versioning, and changelog for
  a first tagged release. Delivers `orch plugins`, `orch dashboard`,
  `orch update`.

---

## Sequencing notes

Two deliberate departures from a purely infrastructural ordering:

1. **Verification gates land at M5, not near the end.** Objective build, lint,
   and test results are what separate this platform from a chat window, and
   they make every subsequent milestone measurable.
2. **Project memory lands at M10, after the loop closes.** Memory is durable
   infrastructure, but it improves a working system rather than creating one.
   Building it first risks four milestones of investment before the first
   useful output.

Milestones are larger than a single sitting. Within a milestone, work in
sub-steps and run `npm run verify` after each one so that a failing gate points
at a small change rather than a large one.

## Roadmap change log

| Date | Change |
| --- | --- |
| 2026-08-01 | Initial Version 1 roadmap defined (25 milestones). Milestone 1 complete. |
| 2026-08-01 | Consolidated to 12 milestones. Verification gates moved ahead of context packing; project memory moved after the end to end loop. Scope unchanged. |
| 2026-08-02 | CLI adopted as the primary interface. Binary renamed to `orch`. Milestone 1 reimplemented around a neutral command contract. Command surface mapped to milestones in `docs/CLI.md`. |
| 2026-08-02 | Milestone 2 complete: configuration layering with source tracking, workspace resolution, declared command preconditions, `orch init`, `orch doctor`, `orch config`. |
| 2026-08-02 | Milestone 3 complete: provider interface and registry, deterministic mock provider, Anthropic provider with streaming and usage accounting, `orch providers`, `orch provider add`. |
| 2026-08-02 | Milestone 4 complete: repository scanner with gitignore evaluation, language detection, toolchain fingerprint, `orch status`. `orch status` moved forward from M5 so the milestone has an observable surface. |
| 2026-08-02 | Milestone 5 complete: git status, commit metadata and diff reading, gate runner with timeouts, persisted gate results, `orch build`, `orch test`, `orch status --verify`. Gate failures exit 3. |
| 2026-08-02 | Milestone 6 complete: explainable relevance ranking, token budgeting with reserved headroom, file-based versioned prompts, `orch context`. |
| 2026-08-02 | Milestone 7 complete: change proposals with full-file replacement, staged diffs, clean-tree precondition, gates run after apply. `orch review`, `orch propose` and its sub-commands. |
| 2026-08-02 | Milestone 8 complete: roadmap parsing, milestone state, step runner with pre and post conditions, persisted run log, `orch roadmap`, `orch milestone`. |
| 2026-08-02 | Milestone 9 complete: end to end orchestration. `orch next` plans, `orch milestone` implements and stages, `--apply` completes the loop. |
| 2026-08-02 | Milestone 10 complete: append-only memory with keyword retrieval behind a swappable interface, `orch memory`, `orch memory add`, `orch history`. |
| 2026-08-02 | Milestone 11 complete: retry with full jitter and Retry-After, narrow failover, advisory pricing and a usage ledger, OpenAI-compatible provider, memory verify and compact. Also completed the M10 recall wiring, which had silently failed to apply. |
| 2026-08-02 | Milestone 12 complete: plugin contract with declared permissions, read-only dashboard, `orch update`, CI pipeline, and the 1.0.0 release. Version 1 is done. |
