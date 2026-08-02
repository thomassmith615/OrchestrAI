# ADR 0013: Append-only JSONL, keyword retrieval, and a capped share of context

**Status:** Accepted
**Date:** 2026-08-02

## Context

Charter Principle 4: critical knowledge must never exist only inside one AI
conversation. Milestone 10 makes that real. Three things had to be decided:
where memory lives, how the right records are found, and how much of a context
window they are allowed to take.

## Decision

**One append-only JSONL file, `.orchestrai/memory/records.jsonl`.**

Append-only because rewriting history is how a record of decisions stops being
trustworthy. JSONL because appending a line is the smallest possible write and
produces a diff showing exactly what was added, nothing else. A record carries a
kind, a title, a body, tags, the milestone it came from, and the commit the
repository was on when it was written.

A malformed line is reported with its line number, never silently skipped, and
`orch memory` exits non-zero when any exist. Memory that quietly loses records
is worse than memory that admits it is damaged.

**Retrieval is keyword based, behind an interface.**

Inverse document frequency over the record corpus, with boosts for title and
tag matches, a mild recency term, and a preference for decisions and
constraints over plain notes. No embedding service, no index to rebuild, no
network. Every result carries the reasons that produced its score, for the same
reason the context ranker does.

Recency is a tiebreaker, never a substitute for relevance: an old decision that
answers the question beats a new note that does not. An embedding backed
retriever implements the same `Retriever` interface, and nothing that consumes
retrieval knows which one answered.

**Memory takes at most a third of the context window.**

Recall runs before packing, so what memory contributes is budgeted alongside
files rather than appended after the fact, and it is included first because it
is denser than source and is the part a fresh conversation cannot reconstruct.
The cap exists because a context that is all history explains nothing about the
code.

The packer receives neutral `ContextNote` values, not memory records, so
`src/context` stays unaware of where recalled knowledge came from.

**Every milestone run writes a record.** The `record` stage runs last, so it
describes what happened rather than what was intended, and it captures the
plan, the proposal, and the gate outcome together.

## Consequences

- `orch memory` and `orch memory add` give both halves: memory a human cannot
  add to is a log, not a shared record.
- `orch history` is deliberately separate. History is what was done; memory is
  why it is the way it is.
- Compaction and summarization are Milestone 11. Until then an old repository
  will accumulate records, and the cap is what stops that from degrading
  answers.

## Related

Dogfooding exposed a real CLI bug: when a group and its sub-command declare the
same flag, commander assigns the value to the group, so `orch memory add --kind`
was silently ignored. Commands now read merged options from the ancestor chain.
