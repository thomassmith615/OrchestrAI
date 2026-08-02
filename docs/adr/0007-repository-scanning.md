# ADR 0007: Scanner classifies, it does not interpret

**Status:** Accepted
**Date:** 2026-08-02

## Context

Milestone 4 needs to answer "what is in this repository" for two later
consumers: the context packer (Milestone 6), which decides what a model sees,
and the verification gates (Milestone 5), which need to know how the project
builds and tests itself.

## Decision

**The scanner produces an inventory, not a judgement.** It records path, size,
language, and binary and oversized flags. It never reads file contents for
classification and never ranks relevance. Ranking is Milestone 6's job, and
mixing the two would make both harder to test.

**Language detection is a lookup table.** Extension and filename only. Content
sniffing would mean reading every file in a repository to answer a question
that an extension answers correctly almost always.

**Gitignore is implemented directly, not via a dependency.** The supported
subset is comments, blank lines, negation, anchoring, directory-only patterns,
and the `*`, `**`, `?` wildcards, with nested `.gitignore` files scoped to
their own subtree. Not supported: escaped literal `#` and `!`, and re-inclusion
of a file beneath an excluded directory. Excluded directories are pruned during
the walk, which is what git does for that case anyway.

Shelling out to `git check-ignore` was rejected: it would make the scanner
depend on a subprocess per path, and would not work on a directory that is not
yet a repository.

**Undetected means null, never a guess.** A toolchain with no lint command
reports `lint: null`. Milestone 5 skips gates it has no command for rather than
running something that was never configured.

**Two hard limits.** A per-file size cap flags oversized files without removing
them from the inventory, and a file count cap stops the walk and sets
`truncated`. A tool that hangs on a pathological repository is worse than one
that reports an incomplete answer.

## Consequences

- The scanner is pure over an injected filesystem, so the whole suite runs
  in memory with no temp directories.
- Polyglot repositories report the first matching ecosystem. Revisit if a
  repository with, say, a Java backend and a Node frontend needs both sets of
  gates. That is a Milestone 5 concern, not a scanner one.
- `.gitignore` edge cases will surface eventually. The failure mode is a file
  being scanned that git would have skipped, which is visible in
  `orch status --json` rather than silent.
