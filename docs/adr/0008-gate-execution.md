# ADR 0008: Gates execute detected commands, and status reads their record

**Status:** Accepted
**Date:** 2026-08-02

## Context

The charter's Definition of Done lists build, type checking, lint, and tests.
Milestone 5 turns that list from prose into something executable, and
`orch status` is supposed to show the verdicts (see the example output in
`docs/CLI.md`).

Two problems follow. Running four gates takes tens of seconds on a small
project and minutes on a real one, so `orch status` cannot execute them on every
invocation and stay useful. And running only some gates must not erase the
verdict of the others.

## Decision

**Gate results are persisted.** Every gate run writes to
`.orchestrai/gates.json` as human readable JSON with a schema version.
`orch status` reads that record and shows the age of the verdict. `--verify`
executes the gates instead.

**Partial runs merge, they do not replace.** `orch build` updates only the build
row. The previous typecheck, lint, and test verdicts survive, so `orch status`
shows a complete picture assembled from whenever each gate last ran. The age
note is what stops a stale row from being mistaken for a fresh one.

**A missing command is skipped, never guessed.** A skipped gate does not count
as a pass and does not fail the run. But a command that was explicitly
requested and does not exist exits 4, because reporting success for work that
never happened is worse than reporting a setup problem.

**Failures exit 3.** Distinct from 1 (the tool broke), 4 (precondition), and 5
(configuration). This is the code CI branches on, and it is the reason the exit
code taxonomy was defined in Milestone 1 rather than grown ad hoc.

**`orch test` means all validation.** Type checking, lint, and tests, matching
the CLI specification's "execute all configured validation". `--all` adds the
build gate for the full Definition of Done. `orch build` is the build alone.

## Consequences

- Gates run through `spawnSync`, so output appears when a gate finishes rather
  than streaming. Acceptable while gates are the leaf of the call tree.
  Milestone 9 revisits this if a long build makes an orchestration run feel
  hung.
- Every gate has a timeout, defaulting to ten minutes and overridable with
  `--timeout`. A hung build must not hang the platform.
- Failure output is truncated to a trailing window per gate. The full output is
  in the terminal of whoever ran it; Orchestrai keeps enough to act on.
- `.orchestrai/gates.json` is committed by default. A teammate cloning the repo
  sees the last known verdicts, which is useful and harmless. Add it to
  `.orchestrai/.gitignore` if that is not wanted.
