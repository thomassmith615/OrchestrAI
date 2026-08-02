# ADR 0001: Record architecture decisions

**Status:** Accepted
**Date:** 2026-08-01

## Context

Charter Principle 4 states that project memory belongs to Orchestraᵢ and that
critical knowledge must never exist only inside one AI conversation. Decisions
made during a session are lost unless they are written to the repository.

## Decision

Every significant architectural decision is recorded as a numbered markdown file
in `docs/adr`. Records are immutable once accepted. A reversal is a new record
that supersedes the old one rather than an edit.

Format: Context, Decision, Consequences.

## Consequences

- Future sessions can reconstruct reasoning without the original conversation.
- Milestone 10 will make these records machine readable and queryable.
- Slight overhead per decision, which is the point.
