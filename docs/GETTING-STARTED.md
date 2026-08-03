# Getting Started: Your First 30 Minutes

This is a hands-on walkthrough, not a reference. For the complete command
surface see [docs/CLI.md](CLI.md); for how the pieces fit together see
[docs/ARCHITECTURE.md](ARCHITECTURE.md).

## What you're installing

Orchestraᵢ is not a model, an IDE, or a coding assistant. It's the layer
that sits *above* an AI model and turns "ask the model for a change" into a
structured, verifiable, human-supervised loop: it understands your
repository, packs context under a token budget, asks a provider for a
change, stages that change as a reviewable diff, runs your repository's own
build/lint/test as objective gates, and records what happened — all before
anything ever touches your working tree.

The one rule to internalize before anything else: **Orchestraᵢ never
commits, and never writes to your working tree without an explicit apply
step you run yourself.** Everything below is safe to experiment with.

---

## 0:00–0:05 — Install and verify

Requirements: Node.js 20.11+.

```bash
git clone <this repository>
cd OrchestrAI
npm install
npm run verify        # typecheck + lint + test + build — should end green
npm link               # makes `orch` available on PATH
orch info               # confirms the binary is wired up
```

`orch info` prints the version, Node version, platform, and whether you're
standing inside a git repository. If that works, the install is done.

---

## 0:05–0:10 — Point it at a repository

Orchestraᵢ operates on a git repository — either this one, or (more
realistically) whatever project you actually want help with:

```bash
cd /path/to/your/repo
orch init      # writes orchestrai.config.json and .orchestrai/
orch doctor    # diagnoses the setup: node version, git, config, credentials
orch config    # shows every resolved setting and which layer set it
```

`orch doctor` is designed to never refuse to run — it reports problems, it
doesn't require a perfect environment first. If something's wrong, this is
where you'll see it, with a status of `FAIL` or `WARN` per check rather than
a stack trace.

`.orchestrai/` is meant to be committed alongside your code (except
`.orchestrai/cache/`) — it's how project memory and gate history persist
across sessions, the same way `.git/` persists history.

---

## 0:10–0:15 — Pick a provider

**You don't have to do anything here.** The default provider is `ollama` —
local, free, no credential, nothing written to `orchestrai.config.json`.
`orch doctor` you ran a moment ago should already show `Credentials: PASS`.
The only setup is having [Ollama](https://ollama.com) installed, running,
and a model pulled:

```bash
ollama pull llama3.1     # the default model; any pulled model works with --model
```

Two other options, if you want them:

**No local runtime at all — the mock provider**, deterministic and fully
offline. It answers the same protocol a real model would, so you can
exercise the entire loop below with nothing installed and nothing spent:

```bash
orch provider add mock
```

**A frontier model**, once you want its actual quality:

```bash
export ANTHROPIC_API_KEY=...
orch provider add anthropic
orch providers --verify        # opt-in: makes one small live request to confirm it works
```

Credentials always come from the environment — `orch provider add` never
writes a secret into `orchestrai.config.json`. `orch providers` shows what's
available and whether each one is currently usable; a provider that needs no
credential (`ollama`) reports that plainly instead of warning about one.

---

## 0:15–0:25 — The core loop: propose, review, apply

This is the actual product. Nothing here writes to your working tree until
the last step, and you tell it to.

```bash
orch status                          # what's in this repo, its toolchain, its provider
orch context                         # what would be sent to the model, and what's dropped
orch propose "add a health check endpoint"
orch propose show                    # the full diff of the newest open proposal
orch propose apply                   # writes it, then runs your build/lint/test as gates
```

What just happened:

- `propose` asked the provider for a change and staged it under
  `.orchestrai/proposals/<id>/` as **complete file contents**, not a patch.
  Nothing in your working tree moved.
- `propose show` let you read the full diff before committing to anything.
- `propose apply` refused to run at all if your working tree was dirty
  (exit code 4) — that's deliberate, so `git checkout .` is always a
  complete undo if you don't like the result. Once applied, it immediately
  ran your project's own build/typecheck/lint/test as verification gates
  and reports whether they passed.

If you'd rather throw the proposal away: `orch propose reject`. If you want
to see everything you've proposed so far: `orch propose list`.

The default `ollama` or the offline `mock` are both free ways to run this
loop before you spend real tokens on `anthropic`/`openai` — the mechanics
are identical either way, only the quality of what comes back differs.

---

## 0:25–0:30 — The rest of the surface, briefly

```bash
orch build / orch test / orch test --all   # run verification gates directly
orch status --verify                       # re-run every gate and refresh the verdicts
orch memory add "why we chose X" --kind decision --tags architecture
orch memory "budget"                       # ranked search over what's been recorded
orch roadmap                               # milestone progression, if you maintain one
orch milestone --dry-run                   # preview the workflow stages, run nothing
orch dashboard                             # read-only web view at http://127.0.0.1:4173
orch capabilities                          # what's actually running under the hood
orch history                               # what's been done, and what it cost
```

A few things worth knowing before you go further:

- **Exit codes are meaningful and stable**, not incidental — `3` means "your
  repository failed a gate," `4` means "a precondition wasn't met" (dirty
  tree, not a repository, not initialized), `5` means "configuration or
  credentials." Script against them; see the exit-code table in
  [docs/CLI.md](CLI.md).
- **Every command takes `--json`.** The payload is the command's data with
  no wrapper, so `orch status --json | jq '.toolchain'` works without
  unwrapping anything.
- **Settings resolve through four layers**: built-in defaults →
  `orchestrai.config.json` → `ORCH_*` environment variables → `--set
  key=value`, highest precedence last. `orch config` shows you the winner
  and its source for every setting, which is the fastest way to debug "why
  is it doing that."

---

## Where to go from here

- **[docs/CLI.md](CLI.md)** — the complete command reference: every command,
  every flag, the full precondition and exit-code contract.
- **[docs/ARCHITECTURE.md](ARCHITECTURE.md)** — how it's actually built: the
  layer map, the capability model, what runs where.
- **[docs/CHARTER.md](CHARTER.md)** — the project's founding principles,
  including why nothing is ever committed automatically and why AI providers
  are treated as interchangeable.
- **`docs/adr/`** — every non-obvious decision, with the alternatives that
  were considered and rejected, and why.
- **[docs/ROADMAP.md](ROADMAP.md)** and **[docs/ROADMAP-V2.md](ROADMAP-V2.md)**
  — what's been built and what's next, if you want the full history.
