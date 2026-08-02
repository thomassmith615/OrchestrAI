# ADR 0009: Explainable ranking, reserved headroom, no truncation

**Status:** Accepted
**Date:** 2026-08-02

## Context

The context packer decides what a model is allowed to see. Everything
downstream is bounded by that decision, and when an answer is wrong the first
question is always what the model actually had in front of it.

## Decision

**Ranking is heuristic and explainable, not learned.** No embeddings, no model
call, no index to maintain. Signals are: project manifests, entry point names,
depth from the root, documentation directories, a penalty for test files, a
penalty for very large files, a large boost for paths matching the task's focus
terms, and a boost for files touched by recent commits.

Every file carries the list of reasons that produced its score, and `orch
context` prints them. A packer whose decisions cannot be inspected cannot be
debugged, and this is the component most likely to need debugging.

Embedding based retrieval is the obvious upgrade. It is deferred to Milestone
10, behind the same interface, because it needs a store and an embedding
provider and neither exists yet.

**Token counts are estimated, not tokenized.** A real tokenizer is a per vendor
dependency with its own vocabulary files, which would undo provider neutrality
for a few percent of accuracy. The ratio runs low on dense code, which is why
the packer reserves 25 percent of the budget as headroom for the system prompt
and the response rather than filling the budget exactly.

**Files are skipped, never truncated.** A model shown half a file has no way to
know it saw half a file, and will reason confidently about code that does not
exist. A skipped file is recorded as dropped with its token cost, so the gap is
visible instead of silent.

**Prompts are `.md` files, not string literals.** Prompts about code contain
fenced blocks, which cannot survive inside a TypeScript template literal
without escaping, and a prompt that must be escaped to be stored is a prompt
nobody will read in a diff. The build copies them into `dist`.

**Missing and unused prompt variables are both errors.** A prompt that silently
renders `undefined` produces a plausible looking request that quietly omits
what mattered. Rejecting unused variables catches the typo case, where a
renamed placeholder would otherwise leave the old text in place.

## Consequences

- `orch context` was added to the command surface. It is not in the original
  specification, and it is justified on the same grounds as `orch config`: the
  behaviour is invisible without it. It makes no network calls and costs
  nothing.
- Ranking quality is unproven until Milestone 7 runs real tasks through it.
  That is the expected outcome, and `orch context` is the instrument for
  measuring it.
- Prompt templates carry a version. Changing a template's meaning means bumping
  it, so a recorded run can name what produced it.
