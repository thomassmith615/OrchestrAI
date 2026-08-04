# Architectural Review 0001: Context Resolution

**Status:** E0–E3 implemented, see ADR 0023. E4–E5 still proposals.
**Date:** 2026-08-03
**Trigger:** `orch propose "rename Vehicle to VehicleModel"` in CamperCAD returned
zero change blocks and a correct explanation of why it could not proceed.

This is the analysis that produced ADR 0023. It is kept as written, including
the parts implementation contradicted, because the reasoning is the useful part
and a review edited to look prescient is worth nothing. Three corrections, all
discovered by building it:

- **§5's labelled slices are wrong for `propose`.** That command requires the
  model to emit *complete file contents*, so a model shown a slice cannot
  answer correctly. Whole files and an honest budget failure, not slices.
- **§7's task taxonomy is unnecessary.** `refactor` / `localized` / `broad`
  collapses to one code path: whether a task is mechanical or open ended is
  answered by whether its terms resolve to real declarations, which is a fact
  about the repository rather than a guess about the sentence. No classifier
  was built, and none is needed.
- **§9's E1 "cached, incremental" was premature.** Measured after building it:
  0.265s with the index against 0.281s without, on this repository. Caching
  would also require widening `FileSystemHost` with an mtime it does not
  expose. Deferred, with the trigger named in ADR 0023.

E4 (task-specific proposal paths, including a deterministic zero-token refactor)
and E5 (role-based routing and escalation) remain untouched proposals for the
owner to accept, reorder, or reject.

---

## 1. Diagnosis: Orchestraᵢ has a repository inventory, not a repository model

The `propose` failure was not a prompt problem, a model problem, or a budget
tuning problem. It is a missing subsystem.

Three facts from the code:

**`scanRepository` never reads file contents.** `FileEntry` (`src/repo/scan.ts:20`)
is `{path, bytes, language, binary, oversized}`. `language` comes from the file
extension. Nothing in `src/repo/` opens a source file to see what is inside it.

**Ranking therefore scores filenames, not code.** Every signal in
`scoreFile` (`src/context/rank.ts:62`) reads `file.path` or `file.bytes`:
manifest names, index stems, directory depth, a `docs/` bonus, a test-name
penalty, a large-file penalty. The `focus` signal — the only task-aware input
in the entire pipeline — is `lowerPath.includes(term)` (`rank.ts:101`). A path
substring test.

**So the focus terms boosted exactly the wrong half of the task.** `propose.ts:116`
derives focus from the task string by splitting on non-alphanumerics and keeping
terms longer than three characters: `["rename", "Vehicle", "VehicleModel"]`.
Against a path substring test, that scores:

| File | focus score | why |
|---|---|---|
| `src/vehicle/VehicleModel.ts` | +20 | path contains `vehicle` and `vehiclemodel` |
| `src/vehicle/VehicleBuilder.ts` | +10 | path contains `vehicle` |
| `src/ui/panels/WeightPanel.ts` | **0** | uses the symbol; path says nothing |
| `src/snapping/SnapEngine.ts` | **0** | uses the symbol; path says nothing |

A rename is defined entirely by its reference sites. The ranker boosted the
declaration site — the one file that needs the least help — and was blind to
every reference site, which is the whole job. For this class of task the
ranking function is not merely weak; it is inverted.

Two secondary signals make it worse. `looksLikeTest` subtracts 2 (`rank.ts:92`),
and a rename must update tests. The depth bonus rewards shallow files
(`rank.ts:81`), and reference sites live deep.

**And the budget genuinely ran out.** Default `contextBudget` is 100,000
(`src/core/config/schema.ts:123`); `HEADROOM` is 0.25 (`pack.ts:19`), so usable
is 75,000. The session reported **74,979 tokens**. The packer filled the window
to 99.97% and stopped. 70 of CamperCAD's 118 files were dropped with reason
`"budget"`, and the order in which they were sacrificed was decided by a
filename heuristic that had no idea which files contain the word `Vehicle`.

> **The one-sentence diagnosis:** Orchestraᵢ cannot answer "which files mention
> `Vehicle`" — a question `grep` answers in twelve milliseconds — so it guessed,
> and the guess was structurally biased against the files that mattered.

## 2. Why this failed despite correct model behavior

The model did the right thing, and it did it for the right reason: the packed
header states `Files: 118` (`pack.ts:89`) while only 48 arrived. Orchestraᵢ
honestly reported its own blindness, and the model reasoned correctly from that
report. Both halves behaved as designed.

The design is what's wrong, in three specific ways.

**The orchestrator delegated a question it should have answered.** The set of
files a rename must touch is *computable exactly*, cheaply, deterministically,
with no model involved. Orchestraᵢ instead sampled the repository by filename
heuristic and asked the model to perform an operation that requires
completeness. No prompt can repair that: the information was discarded before
the prompt was rendered.

**There is no feedback loop.** `PackedContext.dropped` records every dropped
file and why (`pack.ts:30`), and `propose.ts` holds it in `outcome.packed`.
Nothing reads it. When the model replied "what I would need to proceed: the
file(s) that actually declare or reference a bare `Vehicle` symbol," that was a
*retrieval request* — the most actionable output of the entire session — and
Orchestraᵢ printed it as prose and exited 0. A single-shot pipeline cannot
repair its own retrieval mistakes, and on large repositories retrieval mistakes
are the dominant failure mode.

**One workflow is serving three different problems.** `propose` handles, with
one prompt and one packing strategy:

- **Mechanical refactors** — need *complete* reference closure, near-zero reasoning.
- **Localized features** — need a *neighborhood*: one module, its tests, its interfaces.
- **Cross-cutting work** — needs *shape*: entry points, manifests, docs, interfaces.

The current ranker is well tuned for the third. Manifests +6, entry points +3,
shallow +3, docs +2, tests −2 is a rather good description of "show me the shape
of an unfamiliar project." That is why `orch review` produced an excellent
summary minutes before `orch propose` failed, in the same repository, over the
same machinery. **The same session contains both the proof that the foundation
works and the proof that one strategy cannot serve all three task classes.**

## 3. A confirmed bug found while reviewing this

The CamperCAD review's risk #1 was
`.orchestrai/proposals/26080303402/files/src/core/Server.ts` — "a stray
Node/Express fragment inside a browser-only project."

That file is not CamperCAD's. It is Orchestraᵢ's own staged proposal content.

`applyProposal` stages complete file copies under
`.orchestrai/proposals/<id>/files/`. `init` writes `.orchestrai/.gitignore`
containing only `cache/` (`src/engine/commands/init.ts:22`), because the state
directory is meant to be committed. `scan.ts`'s `ALWAYS_IGNORED` is
`new Set([".git"])` (`scan.ts:59`). Nothing else excludes the state directory.

So the scanner walks Orchestraᵢ's own proposal archive and packs staged file
copies as though they were repository source. Consequences, in order of
severity:

1. **Every proposal permanently degrades all future context** for that
   repository. The archive only grows, and it competes for the same 75,000
   tokens as real code.
2. **The model sees rejected and superseded code as current**, with no marker
   distinguishing it. A rejected proposal is indistinguishable from source.
3. **Duplicate near-identical files** actively confuse symbol-level reasoning —
   the exact reasoning `propose` depends on.

In this session it cost real money and real attention: Opus spent output tokens
analyzing Orchestraᵢ's own staging artifact and reported it to the user as an
architectural risk in their project. It was right to be confused.

**Recommendation:** add `.orchestrai` to `ALWAYS_IGNORED` in `scan.ts`. This is
a small, self-contained fix that does not depend on anything else in this
review, and it should not wait for the rest of it.

## 4. What repository analysis should happen before any model call

Introduce a **resolution phase** between "user typed a task" and "render a
prompt." Its job is to produce a *working set*: the specific files this task
requires, each with a reason. It runs before any provider is constructed, costs
nothing, and is fully testable without a model.

Three tiers, cheapest first. The honest headline is that **Tier 0 alone would
have made the CamperCAD rename succeed.**

**Tier 0 — lexical index.** For each file: the identifiers it defines and the
identifiers it mentions. A regex tokenizer over the token stream, language
agnostic, no dependencies, no compiler, cached under `.orchestrai/cache/`
(already gitignored), invalidated by `(mtime, size)`. Roughly 200 lines. This
answers "which files mention `Vehicle`" exactly and completely.

**Tier 1 — import graph.** Parse `import` / `require` / `from` / `use`
statements per language. Yields module neighborhoods: the file defining X, its
direct importers, its tests. Still regex-tractable, still no compiler.

**Tier 2 — real symbol resolution.** TypeScript's compiler API, `tree-sitter`,
or LSP. Distinguishes the `Vehicle` in a comment from the type, resolves
re-exports, handles shadowing. Expensive, per-language, and — the important
part — **not required to fix this bug.** It should be gated behind the same
"prove the need first" standard the rest of this project holds, and the trigger
should be named: the first time a Tier 0/1 working set is measurably wrong in a
way that costs a user a bad proposal.

The false-positive concern about Tier 0 (a comment mentioning `Vehicle` pulls in
an irrelevant file) is the *right* error direction here. Over-inclusion costs
tokens. Under-inclusion produced this bug.

## 5. How context packing should evolve

From "rank every file, fill the window, drop the rest" to "resolve a working
set, then pack it, and refuse loudly when it does not fit."

**Required and optional sets.** `packContext` should take files the task cannot
be done without, separately from files that help. A required file that does not
fit is an **error** — exit 4, "this task needs 91,000 tokens against a 75,000
budget; narrow it, raise the budget, or route to a larger model" — not a silent
`dropped` entry. Today the difference between "I omitted a README" and "I
omitted 40 of the 47 files you must edit" is invisible at the call site.

**Slices, not only whole files.** Reference sites need the lines around the
symbol, not the file. Seventy reference sites as labeled slices cost a fraction
of seventy whole files. `pack.ts`'s current refusal to truncate is *correct*
instinct — "so the model never sees half a file and assumes it saw all of it"
(`pack.ts:103`) — and the resolution is **labeled** slices carrying explicit
line ranges and an unambiguous partial marker, not silent truncation. The
invariant to preserve: the model must always know whether it is seeing all of
something.

**Budget from the provider, not from config.** `contextBudget: 100_000` is a
global constant while `ProviderCapabilities.contextTokens` already declares each
provider's real window (`types.ts:58`) and is read nowhere. Packing 75,000
tokens for an 8,000-token local Ollama model — now the default — will fail at
the API boundary rather than at the decision point. Config should express intent
(a ceiling, a cost preference); capability should express the physical limit.

**Report the working set, not the ranking.** `orch context` currently explains
"matches vehicle" (a path substring). It should explain "defines `Vehicle`",
"references `Vehicle` at 3 sites", "tests `VehicleModel`". That is a strictly
better answer to "why was that chosen", which the module's own header
(`pack.ts:5`) names as its purpose.

## 6. How semantic understanding should be represented

A `RepositoryIndex`, persisted at `.orchestrai/cache/index.json`, incremental,
rebuilt only for files whose `(mtime, size)` changed:

```
file  → { defines[], mentions[], imports[], exports[], hash }
symbol → files[]        (inverted)
```

Three operations the rest of the system consumes: `definitionsOf(symbol)`,
`referencesTo(symbol)`, `neighborhoodOf(file, depth)`. `rank`, `pack`, `propose`,
`review`, and `context` all become consumers. The index is derived state and
disposable: deleting the cache costs a rebuild, never correctness.

**This should not be embeddings, and that is a deliberate position.**
`rank.ts`'s header already states the principle — "No embeddings and no model
call: ranking must be cheap enough to run before every request." That principle
is correct and this review reaffirms it. For *exact symbol* work, which is most
refactoring, an inverted index is strictly better than embeddings on every axis
that matters: exact rather than approximate, complete rather than top-k,
instant rather than a network call, explainable rather than a cosine distance,
and verifiable in a unit test. Embeddings earn their place only for conceptual
queries — "where is authentication handled" — and belong later, as an additive
layer over a working index, never as the foundation.

## 7. Should proposal generation become task-specific? Yes.

But as **one workflow parameterized by a declared task kind**, not as N parallel
workflows. A `TaskKind` selects four things: a resolution strategy, a packing
strategy, a prompt, and a model tier.

| Kind | Resolution | Packing | Model tier |
|---|---|---|---|
| `refactor` — rename, move, signature change | exact reference closure | slices, complete | small / local |
| `localized` — a feature in a known area | neighborhood of entry file + tests | whole files | mid |
| `broad` — architecture, cross-cutting | today's ranker (it is good at this) | whole files, shape first | large |

Classification should be rule-first (imperative verb + a symbol that exists in
the index is a strong `refactor` signal) with a cheap model call as fallback,
and always overridable by an explicit flag. A misclassification must degrade to
`broad` — today's behavior — never to something worse than today.

**The strongest form of this recommendation:** some `refactor` tasks should not
call a model at all. A rename with a complete reference set is a deterministic
transformation. Orchestraᵢ can emit the proposal itself — same `<<<FILE>>>`
staging, same diff, same `propose show`, same gates, same human review — for
zero tokens, zero dollars, and 100% accuracy. `Proposal` already records
`provider` and `model` and would simply record `orchestrai` / `deterministic`.

That reframes the command from "ask a model for a change" to "produce a
proposal, by whatever means is correct." **A tool that knows when *not* to call
the model is worth more than one that calls it well** — and for the stated
mission, an orchestration layer that solves the problem without the model is the
purest possible demonstration of what the layer is for.

## 8. How multiple models should be orchestrated

The provider abstraction is genuinely good at interchangeability, which is what
Charter Principle 1 asked of it, and it has no concept of *selection*, which is
a different problem it was never asked to solve. Config carries one `provider`,
one `model`, one `fallbackProvider`; `ProviderOptions` carries one `model`;
`completeWithContext` reads `config.values.model` for every call regardless of
what the call is for.

The cost of that in the reviewed session: 116,042 input and 1,797 output tokens
at Opus rates — **about $1.87** — for a rename that produced zero changes, and
that a local model with the right seven files could have done for nothing.

Four changes, in dependency order:

**Roles instead of model names at call sites.** Config gains a role map:
`{ refactor: "ollama/qwen2.5-coder", implement: "anthropic/claude-sonnet-5",
architect: "anthropic/claude-opus-5", summarize: "ollama/llama3.1" }`. Call
sites request a role. A `resolveRole(role, config) → {provider, model}` shim is
a small addition above `createProvider(id, options)`, which already takes both.
**The `Provider` interface does not change at all** — the layer is fine; the
selection layer above it does not exist.

**Make declared capabilities load-bearing.** `capabilities.contextTokens` and
`capabilities.tools` are declared and read nowhere in the codebase. Routing
should refuse to send a 75,000-token pack to an 8,000-token model at the
decision point rather than discovering it at the API boundary — which, with
Ollama now the default, is a live failure path today.

**Escalation as a first-class outcome.** A small model returning "insufficient
context," or producing changes that fail gates, escalates one tier and retries.
This is the loop absent from §2. `withRetry` and `fallbackProvider` already
handle *availability* failure correctly and are the wrong mechanism for this:
`isRetryable` gates on transport errors, and a capability shortfall is not one.
Escalation is a new axis, not an extension of failover.

**Ledger the routing decision.** `recordUsage` already records provider, model,
cost, retries, and `fellBack` per call. Adding the role and the escalation path
makes "what did this task actually cost, and why that model" answerable from
`orch history` — which is what makes cost claims auditable rather than
aspirational.

## 9. Roadmap implications

**The V2 runtime work is unaffected and remains sound.** Capabilities, scope,
namespaced config and storage, events, jobs, and provider composition are the
hosting substrate; everything in this review is Engineering-capability work that
sits *inside* that substrate. The index is a capability-owned storage namespace;
task kinds are engineering concerns; role routing composes through the provider
registry V2-5 established. Nothing here asks V2 to be revisited.

**This is not a rewrite.** Scanning, ignore handling, token budgeting, prompt
versioning, usage ledgering, proposal staging, diffing, gates, and the exit-code
contract all did their jobs in the failing session. The gap is one missing
subsystem (repository semantics) and one missing decision point (what does this
task actually need), inserted between two layers that already exist and already
work.

Proposed sequence. E0 is independent; E1–E3 involve no model calls at all and
are therefore the parts that can be *proven* correct:

- **E0 — Exclude `.orchestrai` from scanning.** §3. Standalone bug fix, hours.
- **E1 — Repository index, lexical.** `defines` / `mentions` / `imports`,
  cached, incremental. No command behavior changes; `orch context` gains a
  symbol view. Proves the index before anything depends on it.
- **E2 — Working-set resolution.** `TaskKind` classification and resolvers.
  `orch context "rename Vehicle to VehicleModel"` prints the resolved set and
  each file's reason. Still no model changes. **This is the milestone at which
  the CamperCAD failure stops being possible.**
- **E3 — Packing v2.** Required/optional sets, labeled slices, hard failure when
  required content does not fit, budget from provider capabilities.
- **E4 — Task-specific proposal paths**, including the deterministic, zero-token
  refactor path.
- **E5 — Role-based routing and escalation**, with routing decisions ledgered.

A useful acceptance test for the whole sequence, runnable at E2 and again at E4:
**`orch propose "rename Vehicle to VehicleModel"` in CamperCAD must either
produce a complete, correct change set, or state exactly which files it needs
and why it cannot see them — never silently sample and hope.**

---

## Appendix: evidence

| Claim | Source |
|---|---|
| Scanner never reads contents | `src/repo/scan.ts:20-27`, `141-147` |
| Ranking uses only path and bytes | `src/context/rank.ts:62-126` |
| Focus is a path substring test | `src/context/rank.ts:99-107` |
| Focus terms derived by naive split | `src/engine/commands/propose.ts:112-116` |
| Budget exhausted: 74,979 of 75,000 usable | `schema.ts:123` × `pack.ts:19`; session output |
| Dropped files recorded, never consumed | `pack.ts:30-34`, `174-179`; `propose.ts:124-131` |
| Model told 118 files, given 48 | `pack.ts:89`; session output |
| `.orchestrai` scanned as source | `scan.ts:59`; `init.ts:22`; CamperCAD review risk #1 |
| One model for every call | `ai.ts:137-143`, `schema.ts:119-126` |
| `capabilities.tools` / `contextTokens` unread | no reads anywhere in `src/` |
| Session cost ≈ $1.87 for zero changes | 116,042 in / 1,797 out at `pricing.ts` Opus rates |
