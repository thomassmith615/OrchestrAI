# ADR 0004: CLI first, behind a neutral command contract

**Status:** Accepted
**Date:** 2026-08-02

## Context

A product decision was made after milestone 1 was first implemented: the CLI is
the primary interface to Orchestraᵢ, the dashboard is a visualization layer, and
the CLI must be scriptable with meaningful exit codes and structured output on
every command. The invocation name is `orch`.

The original milestone 1 implementation put command behaviour directly in
commander action handlers. That works for one surface and quietly fails for
three, because `--json` support, exit code discipline, and output formatting all
end up duplicated per command.

## Decision

1. The binary is `orch`. The npm package remains `orchestrai`.
2. Commands are defined in `src/engine` as `CommandDefinition` objects with a
   name, summary, declared arguments and options, and an `execute` function.
   `src/engine` may not import commander or any other CLI framework.
3. `execute` returns a `CommandResult` carrying both a machine readable `data`
   payload and a human readable `report` of labelled fields. Commands never
   format their own output and never write to a stream.
4. `src/cli` adapts definitions into commander and renders results. Rendering,
   global flags, and exit code translation live there and nowhere else.
5. Exit codes are enumerated once in `src/core/errors.ts` and documented in
   `docs/CLI.md`. Validation failures get their own code, distinct from tool
   failures.
6. Planned commands are documented but not stubbed. Help output lists only what
   works.

## Consequences

- `--json` is universal by construction rather than by discipline.
- The milestone 12 dashboard consumes the same registry with no changes to
  command code.
- Adding a command touches two files: the command and the registry.
- Slightly more indirection than calling commander directly, which is the cost
  of the CLI not being the only surface.
- Rejected for now: colorized output and a `--no-color` flag. Alignment carries
  the readability, and color adds a terminal capability matrix to maintain.
