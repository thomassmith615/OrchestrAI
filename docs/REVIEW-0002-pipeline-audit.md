# Architectural Review 0002: The Context Pipeline, Audited

**Status:** Audit only. No changes proposed, none made.
**Date:** 2026-08-03
**Audience:** a new core maintainer, or the owner deciding what Orchestraᵢ is.

Everything below is reverse engineered from the current tree at the commit this
was written against. Line references are real. Where I state a limitation I name
the file that causes it.

---

## 1. End-to-end pipeline

One `orch propose "rename VehicleModel to Chassis"`, terminal to provider.

| # | Stage | File | Function | In | Out |
|---|---|---|---|---|---|
| 1 | Process entry | `src/cli/main.ts` | top level | `process.argv` | `run({argv})` |
| 2 | Global flags | `src/cli/globals.ts` | `readGlobalFlags` | `string[]` | `{cwd, json, level, overrides}` |
| 3 | Host injection | `src/core/hosts.ts` | `nodeHosts()` | — | `Hosts` (fs, proc, env, http, clock) |
| 4 | Runtime assembly | `src/capabilities/index.ts` | `assembleRuntime()` | — | `{registry, activation}` |
| 5 | Workspace + config | `src/cli/context.ts` | `buildBaseContext` | `cwd, Hosts, overrides` | `BaseContext {workspace, config, configError}` |
| 6 | Dispatch | `src/cli/program.ts` | `command.action` | commander argv | `CommandContext` |
| 7 | Preconditions | `src/cli/program.ts:83` | `enforceRequirements` | `requires, BaseContext` | throws `PreconditionError`, or nothing |
| 8 | Command body | `src/engine/commands/propose.ts:103` | `proposeCommand.execute` | `CommandContext` | `CommandResult<ProposeData>` |
| 9 | Memory recall | `src/memory/retrieve.ts` | `defaultRetriever.search` | `query, MemoryRecord[]` | `RankedRecord[]` (≤5) |
| 10 | **Assembly** | `src/engine/ai.ts` | `assembleContext` | `CommandContext, {task, focus?, notes}` | `Assembly {packed, workingSet, focus, toolchain}` |
| 10a | Scan | `src/repo/scan.ts:75` | `scanRepository` | `{root, fs, ignore}` | `ScanSummary` |
| 10b | Toolchain | `src/repo/toolchain.ts` | `detectToolchain` | `fs, root` | `Toolchain` |
| 10c | Term extraction | `src/context/resolve.ts` | `symbolTerms` / `rankingTerms` | `{task, focus}` | `string[]` |
| 10d | Index | `src/repo/symbol-index.ts` | `buildSymbolIndex` | `{root, fs, files}` | `SymbolIndex` (two `Map`s) |
| 10e | Resolution | `src/context/resolve.ts` | `resolveWorkingSet` | `{task, focus, index}` | `WorkingSet {symbols, required}` |
| 10f | Budget | `src/engine/ai.ts` | `resolveBudget` | `ResolvedConfig, Logger` | `number` |
| 10g | Pack | `src/context/pack.ts:106` | `packContext` | `PackOptions` | `PackedContext` |
| 11 | System prompt | `src/prompts/registry.ts` | `renderPrompt("system", …)` | `{repository, ecosystem}` | `string` |
| 12 | User prompt | `src/prompts/registry.ts` | `renderPrompt("propose", …)` | `{context, task}` | `string` |
| 13 | Provider build | `src/providers/index.ts:35` | `createProvider` | `id, ProviderOptions` | `Provider` |
| 14 | Retry wrapper | `src/providers/resilience.ts` | `withRetry` | `() => Promise<T>`, policy | `T` or throws |
| 15 | HTTP body | `src/providers/anthropic.ts:92` | `buildBody` | `CompletionRequest` | JSON `string` |
| 16 | Transport | `src/core/hosts.ts:187` | `nodeHttpHost.send` | `HttpRequest` | `HttpResponse` |
| 17 | Normalise | `src/providers/anthropic.ts` | `complete` | `HttpResponse` | `CompletionResult` |
| 18 | Failover | `src/engine/ai.ts` | inline `catch` | `unknown` | retry on `fallbackProvider`, or rethrow |
| 19 | Cost | `src/providers/pricing.ts` | `estimateCost` | `model, TokenUsage` | `number \| null` |
| 20 | Ledger | `src/memory/usage.ts` | `recordUsage` | `UsageEntry` | appended JSONL |
| 21 | **Parse** | `src/proposals/parse.ts:70` | `parseChangeBlocks` | `string, {existing}` | `ParsedResponse {changes, notes}` |
| 22 | Stage | `src/proposals/store.ts` | `saveProposal` | `Proposal` | `.orchestrai/proposals/<id>/` |
| 23 | Render | `src/cli/render.ts` | `render` | `CommandResult` | stdout + exit code |

The write path (`propose apply`) is a **separate command invocation**. Nothing in
steps 1–23 touches the working tree.

Two things worth internalising immediately:

- **Steps 10a–10g are the entire "orchestration".** Everything else is plumbing,
  and it is good plumbing. The intelligence budget of this product lives in
  about 400 lines across `scan.ts`, `symbol-index.ts`, `resolve.ts`, `rank.ts`,
  and `pack.ts`.
- **There is exactly one provider call.** No planning pass, no tool use, no
  second turn, no verification round trip. `withRetry` retries the *identical*
  request; `fallbackProvider` sends the identical request elsewhere. Neither is
  a feedback loop.

---

## 2. Repository discovery

`scanRepository` (`src/repo/scan.ts:75`) does a synchronous recursive walk from
the workspace root.

**Considered:** every file under the root, in `localeCompare` order per
directory, subject to the exclusions below. It records `{path, bytes, language,
binary, oversized}` per file — **it never opens a file.** `language` comes from
an extension lookup (`src/repo/languages.ts`), `binary` from an extension
denylist, `bytes` from `fs.size()`.

**`.gitignore`:** parsed per directory. `readScope` (`scan.ts:61`) loads a
`.gitignore` at each directory as it descends and pushes it onto a scope stack,
so nested ignore files compose the way git's do. `isIgnored`
(`src/repo/ignore.ts`) evaluates the stack. Ignored **directories are pruned**,
not walked — a `node_modules` costs one check, not a traversal.

**Config ignores:** `config.values.ignore` becomes a root scope via
`configScope`, evaluated alongside the real `.gitignore`.

**Always excluded, regardless of gitignore** (`scan.ts:59`): `.git` and
`.orchestrai`. The second was added today — the state directory is *meant to be
committed*, so nothing else excluded it, and it holds a complete copy of every
proposed file under `proposals/<id>/files/`. Left in, the scanner fed
Orchestraᵢ's own staging area back to the model as repository source. See
ADR 0023.

**Binary files:** inventoried with `binary: true`, never read, and reported by
`packContext` as `dropped` with reason `"binary"`. `buildSymbolIndex` skips them.

**Oversized:** > 1 MB (`DEFAULT_MAX_FILE_BYTES`). Same treatment: counted,
never read, dropped with reason `"oversized"`.

**The cap that matters at scale:** `DEFAULT_MAX_FILES = 20_000` (`scan.ts:18`).
On hitting it the walk sets `truncated = true` and **returns immediately**.
`ScanSummary.truncated` is then read by *nothing in the packing path* — `header()`
(`pack.ts:80`) reports `Files: N` with no indication that N is a ceiling rather
than a count. On a repository above 20,000 files the model is told a confident,
wrong number, and the 20,000 are whichever ones sort first alphabetically from
the root. This is the single most dangerous silent failure in the scanner.

---

## 3. Symbol extraction

`src/repo/symbols.ts`, `extractSymbols(content)`.

- **Lexical.** Two regexes over raw file text.
- **Not** a tokenizer in any real sense, **not** a parser, **not** tree-sitter,
  **not** a compiler API, **not** an LSP.
- **Language-agnostic.** There is no per-language dispatch at all. One
  declaration regex lists declaration-introducing keywords drawn from several
  languages simultaneously (`class|interface|type|enum|struct|trait|record|protocol|namespace|module|impl|function|func|fn|def|const|let|var|val`),
  and one identifier regex `[A-Za-z_$][A-Za-z0-9_$]*` collects mentions.
- Both sets are filtered against a shared `KEYWORDS` set and a 3-character
  minimum.

**Output:** `FileSymbols {defines: string[], mentions: string[]}`. Nothing else.
No positions, no line numbers, no kinds, no scopes, no export/import edges.

### Known false positives

1. **Comments and string literals are not stripped.** `// superseded by Vehicle`
   counts as a mention. This is deliberate and documented — over-inclusion costs
   tokens, under-inclusion costs correctness — but it is a false positive.
2. **Every local variable is a "definition."** `const check = …` inside a
   function makes `check` a repository-wide declaration. This is why
   `resolve.ts` requires terms to be identifier-shaped before it will trust one.
3. **Keyword runs mis-attribute.** `public static void render()` — the regex
   fires on nothing useful, and only survives because results are filtered
   against `KEYWORDS`. In a language it does not anticipate, it will guess.
4. **No scoping.** A `Vehicle` declared in module A and an unrelated local
   `Vehicle` in module B are the same symbol. There is no notion of which
   declaration a reference resolves to.
5. **Identifiers inside markdown, JSON, YAML, and lockfiles** all count. Every
   non-binary, non-oversized file is indexed.

### Known false negatives

1. **Keyword-free declarations.** Java/C# methods (`void render()`), C
   prototypes, most C++ member functions. Type-level declarations are caught;
   member-level ones largely are not.
2. **Destructured and assigned exports.** `export const {a, b} = x` yields `a`
   only via the `const` rule catching the brace — in practice it misses.
3. **Dynamically constructed names.** `obj["Vehicle" + suffix]` is invisible.
4. **Anything under 3 characters**, and anything in the `KEYWORDS` set — so a
   type genuinely named `Type` or `Record` is unindexable.
5. **Files above 1 MB and any file past the 20,000 cap** are simply not indexed.

### Languages understood

Formally, none — there is no language dispatch. Empirically the declaration
regex covers the declaration syntax of TypeScript, JavaScript, Python, Go, Rust,
Java, Kotlin, C#, Swift, and PHP well enough for type- and function-level
symbols. The `mentions` half is genuinely language-agnostic because identifier
syntax is nearly universal.

**Honest summary:** this is `grep` with a keyword table and an inverted index.
That is a real improvement over what preceded it — which was matching task words
against *file paths* — and it should not be mistaken for semantic analysis.

---

## 4. Dependency resolution for "Rename VehicleModel to Chassis"

Precisely, in order:

1. `symbolTerms({task})` (`resolve.ts`) splits on `[^A-Za-z0-9_$]+`, keeps terms
   ≥ 4 characters, drops stopwords (`rename` is one), and keeps only
   **identifier-shaped** terms — containing an uppercase letter, `_`, or `$`.
   → `["VehicleModel", "Chassis"]`
2. `buildSymbolIndex` reads every non-binary, non-oversized file and builds
   `definitions` and `references` maps.
3. For each term, `definitionsOf(index, term)`. A term the repository does not
   **declare** is discarded — so `Chassis`, the destination name, resolves to
   nothing, correctly.
   → surviving symbols: `["VehicleModel"]`
4. `referencesTo(index, "VehicleModel")` returns every path whose `mentions`
   contains it. Each becomes a `RequiredFile` with reason `declares VehicleModel`
   if it is also a definition site, else `references VehicleModel`.
5. Sorted: declaration sites first, then alphabetical.

**Declaration files:** files whose text matched the declaration regex for that
identifier.
**Reference files:** files whose text contains that identifier anywhere at all,
including comments, strings, and markdown.

**Transitive dependencies: none. It does not recurse.** There is exactly one hop:
symbol → files naming that symbol. If `VehicleModel` is constructed by
`VehicleBuilder`, and `VehicleBuilder` is what forty other files actually touch,
those forty files are not required and are not even boosted.

**Supporting architectural files: not resolved at all.** README, ADRs, and
manifests enter only through `rank.ts`'s path heuristics — `ENTRY_NAMES` +6,
`INDEX_STEMS` +3, depth bonus, `docs/` +2 — competing for leftover budget with
every other unrequired file. There is no notion of "this task is architectural,
include the architecture."

**No import graph exists.** `FileSymbols` has no `imports` field. It was
considered and deliberately not built (ADR 0023, second revisit trigger), on the
grounds that no consumer needed it yet. The consequence is that
`neighborhoodOf(file, depth)` — the operation "this file and what it depends on"
— cannot be expressed today.

---

## 5. Context assembly order

`packContext` (`src/context/pack.ts:106`) builds a `sections: string[]` and
returns `sections.join("\n")`. The exact order:

```
1. header()              # Repository overview: file count, languages, ecosystem, manifests
2. Project memory        # recalled records, ONLY if they fit in (usable - required) / 3
3. …required files…      # working set, declaration sites first
4. …ranked files…        # everything else, descending score, until budget exhausted
```

Each file is emitted by `fence()` (`pack.ts:75`):

```
--- src/vehicle/VehicleModel.ts ---
```ts
<complete file contents, trailing whitespace trimmed>
```
```

That entire string becomes `{{context}}` in `propose.md`. So the **full**
ordering of what the provider receives, in one user message:

```
1.  # Repository overview
2.  # Project memory            (conditional)
3.  required file bodies
4.  ranked file bodies
5.  ---
6.  Implement the following task in this repository.
7.  ## Task           → the user's sentence
8.  ## Rules          → 5 fixed rules
9.  ## Output format  → the <<<FILE >>> contract
```

**Not present anywhere:** the roadmap, ADRs as a category, an architecture
section, a file tree, symbol summaries, or any statement of what was *omitted*.
Steps 6–9 are the only instructions, and they arrive **after** up to 75,000
tokens of source.

---

## 6. Budgeting

**Budget selection** (`resolveBudget`, `src/engine/ai.ts`): `contextBudget`
(default 100,000). If the operator never configured it *and* is on the
provider's default model, it is reduced to `capabilities.contextTokens` when
that is smaller. A configured budget or a configured model wins.

**Usable** = `floor(budget × (1 − HEADROOM))`, `HEADROOM = 0.25`. 100,000 → 75,000.
The 25% covers the system prompt, the instruction block, and the response, none
of which are measured.

**Ranking algorithm** (`src/context/rank.ts:62`), additive from a base of 1:

| Signal | Δ |
|---|---|
| filename in `ENTRY_NAMES` (readme, package.json, Makefile, …) | +6 |
| stem in `INDEX_STEMS` (index, main, app, cli, server) | +3 |
| `max(0, 3 − depth)` | +0…3 |
| top-level dir is `docs`/`doc` | +2 |
| path contains test/spec/`__tests__`/fixture | −2 |
| **per focus term appearing as a substring of the path** | +10 each |
| path in the last 50 commits' `--name-only` | +4 |
| `bytes > 40_000` | −2 |

Ties break on `path.localeCompare`. Note that **every signal reads the path or
the size**. Focus matching is `lowerPath.includes(term)` — file *contents* have
never influenced ranking and still do not. The symbol index feeds the required
set only; it does not feed `scoreFile`.

**What gets discarded:** binaries, oversized files, unreadable files, empty
files, and — in descending rank order — any file whose fenced cost would push
the running total past `usable`. That last case is `reason: "budget"`. Packing
`continue`s rather than `break`s, so smaller low-ranked files can still slip in
after a large one was rejected.

**Can a required file still be dropped? No — the failure is loud instead.**
Guaranteed at `pack.ts:193`: required files are read and measured *first*, and if
`headerTokens + requiredTokens > usable` the function throws a
`PreconditionError` (exit 4) naming the file count, the tokens needed, and the
tokens available. There is no code path that emits a `dropped` entry with reason
`"budget"` for a required file.

One caveat: a required file that is **missing or empty** is recorded as
`dropped` with reason `"empty"` and does *not* throw. That is a deliberate
distinction — "the index named a file that has since vanished" is not the same
failure as "your task does not fit" — but it means `packed.required` can be less
than `workingSet.required.length`, and only the `dropped` list says so.

---

## 7. Memory

**Insertion:** `completeWithContext` runs recall *before* assembly, so memory is
budgeted alongside files instead of appended afterward. Query =
`task + objective + explicit focus terms`. `defaultRetriever.search`
(`src/memory/retrieve.ts`) returns at most 5 records.

**Relevance:** TF-IDF over the record corpus. Per matched term: `idf × (1 + log(count))`
in the body, `+idf` for a title hit, `+1.5 × idf` for a tag hit. Then
`score × (0.75 + 0.25 × recency)` with a half-life decay, then `×1.2` if the
record kind is `decision` or `constraint`. Recency is explicitly a tiebreaker,
never a substitute for relevance.

**Competition with source:** memory is rendered as one block and admitted
**all-or-nothing** if `cost ≤ (usable − requiredTokens) / 3`. It is inserted
into `sections` before the required files, so it appears earlier in the prompt,
but it is *budgeted* after them.

**How required code is protected:** by that subtraction. `requiredTokens` is
computed before the memory check, so the cap is a third of what remains once the
working set is paid for. If memory would exceed that, `noteCount` stays 0 and
the entire block is dropped silently — there is no `dropped` entry and no
warning for discarded memory.

**Weakness worth naming:** memory retrieval and symbol resolution share nothing.
A decision record explicitly about `VehicleModel` is retrieved only if the
task's *words* match its text; the fact that `VehicleModel` is a resolved symbol
in this very request does not influence recall at all.

---

## 8. The exact prompt

Two fields reach Anthropic: `system` (top-level) and one `user` message. There
is no developer role, no assistant prefill, no multi-turn history, no tools.

**`system`** — `src/prompts/templates/system.md`, verbatim, with two
substitutions:

```
You are the engineering assistant inside Orchestraᵢ, a coordination layer that
runs a structured software engineering workflow over a git repository.

Operating rules:

1. A human reviews everything you produce. Never assume your output will be
   applied without review, and never write as if it already has been.
2. Work only from the repository content provided below. If something needed is
   missing from the context, say so explicitly rather than inventing it.
3. Preserve the existing architecture and conventions of the repository. Match
   its style rather than introducing your own.
4. Prefer small, verifiable changes over large rewrites.
5. Be concise. Implementation and specifics beat commentary.

Repository: /Users/you/CamperCAD
Ecosystem: node
```

**`messages[0].content`** — `propose.md` with `{{context}}` and `{{task}}`
substituted. Structurally:

```
# Repository overview

Files: 118
Languages: TypeScript (96), Markdown (12), JSON (4)
Ecosystem: node (npm)
Manifests: package.json

# Project memory                      ← only if it fit

## decision: why inches are internal

<record body>

--- src/vehicle/VehicleModel.ts ---
```ts
export class VehicleModel {
  …
}
```

--- src/snapping/SnapEngine.ts ---
```ts
…
```

  … every other packed file, same shape …

---

Implement the following task in this repository.

## Task

rename VehicleModel to Chassis

## Rules

- Change as few files as possible. Prefer the smallest edit that does the job.
- Match the existing architecture, naming, and style exactly.
- Update or add tests alongside any behaviour change.
- Do not reformat, reorganize, or "improve" code unrelated to the task.
- If the task cannot be done safely from what you were shown, emit no change
  blocks and explain what is missing instead.

## Output format

Emit each changed file in full, between markers, with no diff syntax:

<<<FILE path/relative/to/repo/root.ts
complete new contents of the file
>>>

To remove a file:

<<<DELETE path/relative/to/repo/root.ts>>>

Rules for the blocks:

- The path is relative to the repository root. Never absolute, never `..`.
- Emit the entire file contents, not an excerpt and not a patch.
- Any explanation goes outside the blocks, before or after them. Keep it to a
  few sentences.
```

**The JSON body** (`buildBody`, `anthropic.ts:92`):

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 8000,
  "messages": [{"role": "user", "content": "<the above>"}],
  "system": "<the above>"
}
```

`temperature`, `stop_sequences`, and `stream` are omitted unless set — and the
propose path calls `.complete()`, never `.stream()`, so **`stream` is never
sent**. There is **no `cache_control`**, no tool definitions, and no
`anthropic-beta` header. Every proposal re-sends and re-pays for the entire
repository at full input price.

**Two structural observations.** First, the rules that most constrain behaviour
(rule 2 in the system prompt, "say so explicitly rather than inventing it") are
what produced the honest refusal in the session that started all this — the
prompt is doing its job. Second, `renderTemplate` throws on both missing *and
unused* variables, so a template and its call site cannot silently drift.

---

## 9. Response handling

`parseChangeBlocks` (`src/proposals/parse.ts:70`) is a line-oriented state
machine over `response.split("\n")`.

- `^<<<DELETE (.+)>>>$` → a `delete` change, single line.
- `^<<<FILE (.+)$` → consume lines until `^>>>$`; body becomes the content.
- Anything else → appended to `notes`.

**Path safety** (`validatePath`): strips a leading `./`, then rejects empty
paths, absolute paths, anything containing `..`, and Windows drive letters,
throwing `ProposalParseError`. This is the only guard between model output and
the filesystem, and it runs at parse time, not at apply time.

**Failures detected:** exactly one — an unterminated block. Reaching end of input
inside a `<<<FILE` throws with the hint "The response was cut off, or the model
omitted the closing marker." That is the truncation signal, and it is the *only*
one.

**"No change blocks":** not a failure. `changes` is empty, `notes` holds the
model's entire prose, `propose.ts:167` appends `"No changes proposed. Nothing was
staged."`, and the command **exits 0**. A proposal is still written to disk with
zero changes. Scripting against exit codes cannot distinguish "nothing needed
doing" from "the model refused for lack of context."

**Assumptions the parser makes**, each of which is a way to be wrong:

1. Markers appear at the **start of a line**, unindented.
2. The content between markers is literal — **no fence stripping**. A model that
   politely wraps its file in ```` ```ts ```` writes those backticks into your
   source file.
3. `stopReason` is **never inspected**. A response cut off at `max_tokens` mid-block
   throws "unterminated"; one cut off cleanly *between* blocks is silently
   accepted as complete. `CompletionResult.stopReason` is normalised by every
   provider and read by nothing.
4. Later blocks for the same path **silently supersede** earlier ones
   (`parse.ts:141`).
5. Trailing newlines are normalised to exactly one.
6. There is no validation that a proposed file **parses**, compiles, or is even
   the same language as the file it replaces. That is deferred entirely to the
   gates, which run only after `propose apply` has already written to disk.

---

## 10. Observability

The honest answer: **partially, and only for the second half of the pipeline.**

**What is persisted per proposal** (`Proposal`, `src/proposals/types.ts:23`):
id, task, status, createdAt, changes, notes, provider, model, promptRef,
`contextTokens` (a single integer), usage.

**What is persisted per call** (`UsageEntry`, `src/memory/usage.ts:14`):
timestamp, provider, model, promptRef, input/output tokens, cost, retries,
`fellBack`.

**What is never persisted anywhere:** the packed context text, the rendered
prompt, the included file list, the dropped file list with reasons, the working
set, the resolved symbols, the ranking scores, or the budget that was in force.

So, against the failure classes:

| Suspect | Diagnosable after the fact? | Why |
|---|---|---|
| Retrieval | ✅ *re-derivable* | `orch context "<task>"` re-runs the same `assembleContext` and prints resolved symbols and required files |
| Ranking | ⚠️ re-derivable, not recorded | `orch context --show N` shows scores and reasons — for the repo **as it is now** |
| Packing | ⚠️ same | `orch context --dropped` lists budget drops, again re-derived |
| Prompt construction | ✅ | `orch context --prompt propose --print` renders it; `promptRef` pins the template version |
| Provider reasoning | ❌ | only `notes` survives, and only what fell outside the blocks |
| Provider formatting | ❌ | the raw response text is discarded after parsing |
| Parser | ❌ | throws on unterminated blocks, silent on everything else |
| Application logic | ✅ | `applyProposal` returns written/deleted; gates persist a `GateRun` |

**Why the ❌ rows are ❌:** `outcome.result.text` exists only as a local variable
in `proposeCommand.execute`. It is parsed and discarded. If the model emitted a
block the parser silently ignored — indented markers, a fenced wrapper, a
malformed path — there is no artifact anywhere on disk that would let you see
it. You cannot answer "what did the model actually say" for any past proposal.

**Why the ⚠️ rows are only ⚠️:** re-derivation is not a record. `orch context`
today reflects today's working tree, today's config, today's `git log`, and
today's memory store. A proposal from last week cannot be reproduced, so
retrieval quality cannot be regression-tested, and "did resolution get worse"
is an unanswerable question. The pipeline is *inspectable going forward* and
*not auditable backward*.

`contextTokens` being a bare integer is the sharpest version of this: it tells
you the context was 74,979 tokens and nothing whatsoever about what was in it.

---

## 11. Critical evaluation

Would I trust this context engine?

### 300 files — yes

This is the design centre and it works. The whole repository nearly fits;
resolution guarantees the reference closure; ranking fills the remainder
sensibly; the index costs 0.265s against 0.281s without it. For a project this
size the engine is genuinely good, and the surrounding discipline — staged
proposals, gates, exit codes, ledgering — is better than most commercial tools.

### 5,000 files — marginal, and not for the reason you would guess

Retrieval still works; an inverted index does not care about 5,000 files.
Ranking degrades badly — you cannot express a 5,000-file architecture in 75,000
tokens, so everything unrequired becomes noise selected by filename. But the
binding constraint is **output**, not input. See weakness 1.

### 1,000,000-file monorepo — no. Not close.

Five independent blockers, any one of which is disqualifying:

1. **`DEFAULT_MAX_FILES = 20_000`, with silent truncation** and `truncated`
   never surfaced to the model or the user (§2). You would be operating on 2% of
   the repository while being told a confident file count.
2. **Fully synchronous I/O.** `scanRepository` stats every file on the main
   thread; `buildSymbolIndex` then reads and regexes every one of them. No
   parallelism, no streaming, no incremental work.
3. **The index is rebuilt per invocation and held entirely in memory** — every
   identifier in the repository, twice (`definitions` and `references`), as JS
   `Map<string, string[]>`. Not persisted; ADR 0023 defers this with a named
   trigger, which is defensible at 300 files and fantasy at a million.
4. **Every file is read twice** per command: once by `buildSymbolIndex`, once by
   `packContext`.
5. **The required set is uncapped.** Renaming a core type referenced by 5,000
   files produces a 5,000-file required set, which correctly throws
   `PreconditionError` — and correctly refusing every interesting refactor is
   still refusing every interesting refactor.

### The HomeOS vision — the wrong question about the wrong subsystem

The V2 runtime (capabilities, scope, namespaced config and storage, events,
jobs, provider composition) is genuinely well built for hosting unrelated
applications, and I would trust it. **The context engine is not the part that
generalises** — "rank files under a token budget" is a code-specific concern
that a home automation capability would never call. The honest read is that
HomeOS is a bet on `src/runtime/`, and this document is about `src/context/`,
and the two are much less connected than the roadmap implies.

### Every architectural weakness, unsoftened

1. **Whole-file replacement is the hardest ceiling in the product.** Output
   tokens scale with the *size of touched files*, not the size of the change. A
   one-line fix in a 2,000-line file costs 2,000 lines of output. With
   `max_tokens: 8000` that is roughly one or two medium files per proposal,
   forever. Every scaling conversation ends here, and no amount of retrieval
   improvement moves it. The trade was made knowingly (`parse.ts:1` argues
   diffs fail more often) and it was probably right in 2024; it is the first
   thing I would revisit.
2. **No feedback loop.** One request, one response. When the model says "I need
   these files," that is a retrieval instruction and Orchestraᵢ prints it as
   prose (§9). `capabilities.tools` is declared by every provider and read
   nowhere — tool use is the obvious mechanism and is entirely unbuilt.
3. **Nothing about the request is durable.** The prompt, the context, and the
   raw response are all discarded (§10). Retrieval cannot be regression-tested,
   proposals cannot be reproduced, and "why did it do that last Tuesday" has no
   answer.
4. **No prompt caching.** 75,000 tokens of largely unchanged repository are
   re-sent at full price on every call. No `cache_control`, no beta header. For
   a product whose stated thesis includes cost discipline, this is the largest
   unclaimed saving on the table and it is a header away.
5. **`stopReason` is never inspected.** A truncated response is detected only if
   truncation happens to land inside a block.
6. **Ranking still reads only paths.** The index exists now and `scoreFile`
   does not consult it. Content-aware ranking for *unresolved* terms is the
   obvious next win and was deliberately skipped as unnecessary code.
7. **One hop, no graph.** No import edges, no transitive closure, no
   architectural file selection (§4).
8. **No routing.** One `provider`, one `model`, one `fallbackProvider` for
   every call regardless of what the call is for. `fallbackProvider` is
   availability failover, not selection.
9. **The propose path never streams**, so a large request is a blind multi-minute
   wait, and `transport` failures are retried three times at full timeout —
   eight minutes to learn nothing, with a message ("Could not reach the
   Anthropic API") that is actively misleading when the real cause was a
   deadline.
10. **Symbol extraction has no scoping**, so identically-named symbols in
    unrelated modules are one symbol (§3).
11. **Memory recall and symbol resolution are disconnected** (§7).
12. **`scan.truncated` is computed and never read** — the one-line version of
    weakness 1 in §2.

---

## 12. Product evaluation

### What Orchestraᵢ is today

**A disciplined, auditable, single-shot change proposer for repositories that
mostly fit in one context window — wrapped in unusually good engineering
process.**

Be precise about where the value actually sits. The parts that are excellent are
the *process* parts: proposals staged as complete files that never touch the
working tree; a dirty-tree precondition that makes `git checkout .` a total
undo; gates run against the repository's own toolchain; a stable exit-code
contract; a usage ledger; versioned prompts; injectable hosts that make all of
it testable; 498 tests; twenty-three ADRs. That is a professional-grade
*workflow engine* and it is rare.

The AI part — retrieval, packing, generation, parsing — is the **least developed
subsystem in the repository**, and until today its task-awareness was matching
words against filenames. It is now roughly "grep with an index," which is a real
improvement and still the weakest link. The product's own thesis — *help
engineers use LLMs on repositories too large for a single prompt* — is precisely
the claim the engine cannot yet support, because whole-file output caps every
change at one or two files regardless of how good retrieval gets.

### What the architecture naturally wants to become

**A local capability runtime that happens to ship a coding capability first.**

Look at where the design effort went. V2 built a capability contract, scope
resolution, namespaced configuration, namespaced storage with path containment,
an event bus, a job contract, and provider composition — each with its own
composition rule rather than one forced abstraction, each with an ADR arguing
why. `src/engine`'s command registry is surface-agnostic by construction: the
CLI, the dashboard, and any future HTTP or MCP surface consume the same
definitions. `assembleRuntime()` activates capabilities the way an OS activates
services. None of that is about code.

The Placeholder capability was built specifically to prove the runtime can host
something with no domain concepts at all. That was the tell. **The architecture
is a general-purpose local application host, and "engineering" is tenant number
one.**

### Why they differ

Three reasons, and only the third is a problem.

1. **The runtime got the architectural attention; the engine got the feature
   work.** Six V2 milestones with ADRs went into hosting arbitrary capabilities.
   The context engine had one ranking function from Milestone 6 and no
   substantial revision until today's failure forced one.
2. **The runtime's problems were tractable and the engine's were not.**
   Namespacing config is a problem with a correct answer. "What context does
   this task need" is open-ended, and open-ended problems lose to tractable ones
   in any disciplined process — especially one whose stated rule is *build only
   what has a concrete consumer.* That rule is why this codebase is clean. It is
   also why the hardest part stayed unbuilt: nobody could name a consumer for
   "semantic repository understanding" until a rename failed in front of you.
3. **The stated mission and the built artifact are drifting, and the docs do not
   say so.** The charter and roadmap describe an orchestration layer for
   large-repository engineering. The code increasingly describes a local
   application runtime. Both are legitimate products; they imply *different*
   next milestones, different benchmarks, and different definitions of done. The
   V2 completion summary asked what was missing before the runtime felt
   complete, and the answer everyone circled was Home. The answer this audit
   suggests is that **the engineering capability is not finished, and the
   runtime being ready to host a second one is not the same thing as the first
   one being good.**

The decision I would put in front of you is not technical. It is which of those
two products you are building — because "5 million lines, thousands of files,
years of history" and "the orchestration layer for a local AI operating system"
have almost no engineering overlap, and the next six milestones look entirely
different depending on the answer.
