# ADR 0003: Thin CLI over injected dependencies

**Status:** Accepted
**Date:** 2026-08-01

## Context

The charter names a CLI, a dashboard, and an API as eventual surfaces. If logic
accumulates in command handlers, the second surface forces a rewrite. Similarly,
code that reads `process`, the filesystem, or the clock directly is untestable
without mutating global state.

## Decision

1. Command handlers parse arguments and call library functions. They contain no
   business logic.
2. Environment access is expressed as injectable interfaces. `describeEnvironment`
   accepts an `EnvironmentHost`; the logger accepts `LogSink` destinations.
3. Nothing outside `src/cli/main.ts` may call `process.exit`. The run boundary
   returns an exit code.
4. `no-console` is an ESLint error. `src/core/logger.ts` is the only sanctioned
   console boundary.

## Consequences

- Tests drive the real command tree with no process level mocking, as seen in
  `tests/cli/run.test.ts`.
- Adding the dashboard in milestone 12 requires no changes to core logic.
- Marginally more ceremony when adding a command, which is an acceptable trade
  for a codebase intended to be maintained for years.
