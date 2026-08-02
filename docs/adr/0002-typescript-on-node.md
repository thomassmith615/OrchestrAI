# ADR 0002: TypeScript on Node.js as the implementation platform

**Status:** Accepted
**Date:** 2026-08-01

## Context

The charter does not specify a language. Orchestraᵢ is primarily a CLI that
coordinates AI providers, reads repositories, and later serves a local
dashboard. Candidates considered: TypeScript on Node, Java, Python, Go.

## Decision

Implement in TypeScript targeting Node.js 20.11 or newer, ESM only, compiled
with `tsc` under strict settings.

Rationale:

- CLI distribution is a solved problem via npm and a `bin` entry.
- Every major provider ships a first class TypeScript SDK.
- The milestone 12 dashboard shares one language and one type system with the
  core, avoiding a second toolchain.
- The plugin system benefits from a dynamic module loader.

Java was rejected for CLI startup cost and packaging friction. Python was
rejected for weaker refactoring safety on a codebase intended to last years.
Go was rejected because the dashboard and plugin story would split the stack.

## Consequences

- Node 20.11 or newer is required (`import.meta.dirname`).
- Strict compiler options are mandatory, not optional, to compensate for the
  looseness of the ecosystem.
- Language of implementation is independent of the languages Orchestraᵢ can
  analyze. Milestone 4 handles polyglot target repositories.
