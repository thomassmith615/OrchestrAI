# ADR 0023: Context is resolved before it is ranked

**Status:** Accepted
**Date:** 2026-08-03

## Context

`orch propose "rename Vehicle to VehicleModel"` in a 118 file repository
returned no change blocks. The model refused, correctly, because it had been
shown 48 files and told there were 118, and a rename cannot be done safely from
a sample.

The cause was not the prompt and not the model. Nothing in the platform read
file *contents* before deciding what to send. `FileEntry` held a path, a size,
and an extension; every signal in `scoreFile` scored one of those; and the only
task-aware input in the whole pipeline was `focus`, matched with
`lowerPath.includes(term)`. A path substring test.

For a rename that is not merely weak, it is inverted. A rename is defined
entirely by its reference sites, and path matching boosts the *declaration*
site — the one file that needs the least help — while being blind to every file
that uses the symbol without naming it in its path. Two secondary signals made
it worse: test files score −2, and a rename must update tests; shallow files get
a depth bonus, and reference sites live deep.

The budget then ran out (74,979 tokens against a 75,000 usable ceiling) and 70
files were dropped in an order decided by that same filename heuristic.

`docs/REVIEW-0001-context-resolution.md` has the full analysis.

## Decision

**A resolution step runs before packing, and it answers the question the model
was previously asked to guess at: which files does this task actually require.**

**`src/repo/symbols.ts` extracts, lexically, what each file declares and
mentions.** A tokenizer and a table of declaration-introducing keywords. No
parser, no compiler, no language server. Comments and string literals are not
stripped, and keyword-free declarations (`void render()` in Java) are not
detected; both limitations are documented at the top of the file and both err
toward over-inclusion, which costs tokens where under-inclusion costs
correctness.

**`src/repo/symbol-index.ts` inverts that into identifier → files.** Two maps,
`definitions` and `references`. Built in memory for the life of one command.

**`src/context/resolve.ts` turns a task into a working set.** A term qualifies
as a symbol if it is identifier-shaped (`Vehicle`, `MAX_SIZE`, `snap_to`) *and*
the repository actually declares it. Every file referencing a qualifying symbol
becomes required, carrying a reason (`declares Vehicle`, `references Vehicle`).

**`packContext` takes a required set, packs it first, and throws rather than
sampling it.** A required file that does not fit is a `PreconditionError` with
the numbers and a hint, not a silent `dropped` entry. Memory is budgeted against
what remains after the required set, so recalled history can no longer crowd out
code the task demonstrably needs.

**`.orchestrai` is excluded from scanning unconditionally.** The state directory
is meant to be committed, so no gitignore excluded it, and it contains a
complete copy of every proposed file under `proposals/<id>/files/`. The scanner
was feeding Orchestraᵢ's own staging area back to the model as repository
source: rejected code indistinguishable from current code, duplicate files
competing for the budget, and a context that degraded with every proposal ever
made. In the session that prompted this ADR the model reported one of those
staged files to the user as an architectural risk in *their* project.

**An unconfigured context budget defers to the provider's declared window.**
`capabilities.contextTokens` was declared by every provider and read nowhere.
Packing 75,000 tokens for a local model that accepts 8,000 now fails at the
decision point instead of the API boundary. A budget the operator set is an
instruction and is obeyed; so is a configured model, whose window the descriptor
cannot know.

## Rejected alternatives

**A task classifier and per-kind workflows** — the shape the review proposed,
with `refactor` / `localized` / `broad` kinds each selecting a resolution
strategy, a prompt, and a model tier. Rejected because the interesting half
falls out for free: whether a task is mechanical or open ended is answered by
whether its terms resolve to real declarations, which is a fact about the
repository rather than a guess about the sentence. A task naming no symbol
resolves to nothing and packs exactly as it always did. That is one code path
instead of three, no classifier to be wrong, and no taxonomy to maintain.

**Embeddings.** For exact identifier work — which is what most refactoring is —
an inverted index is better on every axis that matters here: exact rather than
approximate, complete rather than top-k, instant rather than a network call,
explainable rather than a distance, and provable in a unit test. `rank.ts`
already stated the principle ("no embeddings and no model call: ranking must be
cheap enough to run before every request") and this ADR reaffirms it. Embeddings
answer a genuinely different question — "where is authentication handled" — and
would be an additive layer over this one, never a replacement for it.

**Labelled slices instead of whole files**, so seventy reference sites cost a
fraction of seventy files. The review recommended this; implementing it showed
it to be wrong for the primary consumer. `propose` requires the model to emit
*complete file contents*, so a model shown a slice cannot answer correctly. The
honest failure — "these files need 91,000 tokens and 75,000 are available" — is
better than a context that looks complete and is not. Slices may earn their
place in `review`, which only reads.

**Requiring every task term, not only identifier-shaped ones.** "add a health
check endpoint" would resolve `check` against some unrelated local variable and
drag thirty irrelevant files into the required set — actively worse than the
behaviour being fixed. An explicit `--focus` remains the escape hatch for a
genuinely lower-case identifier, because a term the user typed deliberately is
evidence a term inferred from prose is not.

**Persisting the index to `.orchestrai/cache/`.** Measured first: on this
repository, `orch context` with a task takes 0.265s against 0.281s without one —
the index is free at this scale, because scanning already stats every file and
reading them is not the expensive part. Caching would also need an invalidation
key, and `FileSystemHost` exposes size but not mtime, so it would mean widening
a core interface for a problem that does not yet exist.

## Consequences

- `orch propose "rename VehicleModel to Chassis"` now packs the declaration site
  and every reference site first, each labelled with why it is there, and says
  so in its report (`Resolved: VehicleModel in 3 files`). Confirmed by hand
  against a reconstruction of the repository that failed: ranking alone included
  one of the three files, resolution includes all three.
- `orch context "<a task>"` answers "which files would that touch, and would
  they all fit" for free, before any token is spent finding out. Its positional
  argument is now read as a task rather than as focus terms; bare terms still
  work, because a bare term is a task that mentions nothing else.
- All 464 pre-existing tests pass unchanged. A task that names no symbol
  resolves to nothing, and the packer's behaviour in that case is what it always
  was — which is the compatibility claim, and the reason it can be asserted.
- Deriving focus terms from a task moved out of `propose` and into
  `rankingTerms`, so there is one definition of it. `propose` now forwards
  `--focus` only when the user actually gave one.
- `assembleContext` in `src/engine/ai.ts` is the single place scanning,
  resolution, and packing come together; `orch context` and every provider call
  go through it, so what the inspection command shows is what the model gets.
- **Revisit trigger:** the index reads every non-binary file on every task that
  names a symbol. Persist it — and widen `FileSystemHost` with the mtime needed
  to invalidate it — the first time that read is measurably slower than the
  provider call it precedes, which on a repository near the 20,000 file cap it
  eventually will be.
- **Revisit trigger:** `defines` and `mentions` are the only relations
  extracted. Import edges, and the module neighbourhoods they would make
  possible, are the obvious next relation, and the moment to add them is when a
  task type genuinely needs "this file and what it depends on" rather than
  "everything naming this symbol".
