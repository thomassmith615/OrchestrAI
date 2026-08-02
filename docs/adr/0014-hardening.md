# ADR 0014: Retry only what could succeed, price advisorily, compact explicitly

**Status:** Accepted
**Date:** 2026-08-02

## Context

Milestone 11 is the milestone that makes the loop survivable in practice:
transient failures, spend visibility, a second real vendor, and a way to repair
memory.

## Decision

**Only transient failures are retried.** Rate limits, server errors, and
transport failures are retried; a bad credential or a malformed request never
is. Retrying an error that cannot succeed converts a clear failure into a slow
one, which is worse for the operator and worse for the bill.

Backoff is exponential with **full jitter**, uniform over `[0, ceiling]` rather
than a fixed delay. Several clients that fail together otherwise retry together,
which is how a recovering service gets knocked over a second time. A
`Retry-After` header overrides the computed delay: when the service says how
long to wait, that is an instruction, not a suggestion.

**Failover is opt in and narrow.** `fallbackProvider` is tried only when the
primary fails with a retryable error, and only after its own retries are spent.
A malformed request fails identically everywhere, so failing over on it would
just double the latency and the spend.

**Pricing is advisory; tokens are the fact.** The rate table will go stale.
A model with no known rate records its tokens and reports a null cost rather
than a wrong one, and totals count how many calls were unpriced so a total is
never mistaken for complete. Money is an estimate; tokens are measured.

Every call is ledgered to `.orchestrai/usage.jsonl`, including retries and
failovers, so the record reflects what was actually spent.

**One OpenAI-compatible provider, not one per vendor.** The chat completions
format at a configurable `baseUrl` covers OpenAI, self-hosted runtimes, and
anything else speaking that shape. Supporting another endpoint is configuration,
not code, which is Principle 1 stated as a test rather than an aspiration.

**Compaction is explicit and archives first.** It is the only operation that is
not append-only, so it is never automatic: a human asks for it, the previous
file is archived beside the new one, and the counts are reported. An unattended
process that rewrites the record of decisions is precisely what append-only
exists to prevent. `orch memory verify` reports damage and exits non-zero;
`orch memory compact` repairs it.

## Consequences

- `orch history` reports spend alongside milestones and runs.
- Adding a rate for a new model is one line in a table nobody has to consult to
  use the tool.
- A repository whose memory has been hand-edited into an invalid state has a
  documented recovery path rather than requiring a manual repair.

## Related: a process failure worth recording

Three edits during Milestone 10 silently failed to apply and were not caught by
the suite: memory recall was never wired into the provider path, the context
packer never learned to render notes, and the memory commands were never
registered. Each individually type checked and linted, because a command that
is written but never registered is still valid code.

The fix is structural, not vigilance: `tests/engine/coverage.test.ts` walks the
command directory and asserts every exported definition reached the registry,
and the packer's note handling now has tests that fail if the feature is absent.
The general lesson is that a feature spanning two files needs a test that spans
both.
