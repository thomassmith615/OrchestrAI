# ADR 0017: Scope replaces the git-repository assumption

**Status:** Accepted
**Date:** 2026-08-02

## Context

Every command in Version 1, and the capability model added in V2-1, assumed a
command either runs inside a git repository or doesn't need anything from the
environment at all (`orch info`, `orch doctor`, `orch update`). That
assumption is baked into `CommandRequirements.repository: boolean` and into
`Workspace`, which `resolveWorkspace` returns as `null` anywhere outside a
repository.

Home, the second capability (not yet implemented; see `docs/ROADMAP-V2.md`),
has no repository. It has a user and a machine. Milestone V2-2 generalizes
the command contract so a capability can declare that it needs a user, not a
repository, while every one of Version 1's 27 commands keeps behaving exactly
as it does today.

## Decision

**A `Scope` is either repository scope or user scope**
(`src/core/workspace.ts`):

```
RepositoryScope = { kind: "repository", workspace: Workspace }
UserScope       = { kind: "user", root: string, stateDir: string }
```

Repository scope is Version 1 unchanged: rooted at the git root, located by
walking upward for `.git`. User scope is rooted at `~/.orchestrai`, resolved
through the injected `EnvHost` (`HOME`, falling back to `USERPROFILE`) rather
than reading `process.env` directly, so resolution stays testable the same
way every other host-backed value in this codebase is. `root` and `stateDir`
are the same directory for user scope today; they are kept as separate
fields only so a capability-scoped subdirectory (planned for V2-4) has
somewhere to attach without introducing a second concept then.

**`CommandRequirements.repository: boolean` is replaced by
`CommandRequirements.scope?: "repository" | "user" | "either"`.** The default,
when a command declares a `requires` object without a `scope`, is
`"repository"` — this is what kept all 27 v1 commands' behaviour identical
without editing their intent, only their syntax (removing the now-redundant
`repository: true` from each). A command that declares no `requires` object
at all (`doctor`, `info`, `update`) is unaffected by this default: it was
scope-agnostic before this milestone and still is, because
`enforceRequirements` returns immediately when `requirements` is `undefined`,
exactly as in Version 1.

**Why repository is the default and not "either".** Every command that
declared `repository: true` in Version 1 meant it, unconditionally: `orch
init`, `orch propose`, `orch milestone` do not have a sensible behaviour
outside a repository. Defaulting an unspecified `scope` to `"either"` would
have silently loosened those commands' preconditions. Repository as the
default preserves the exact meaning of the flag it replaces.

**`CommandContext` gains a resolved `scope: Scope | null` field**, alongside
the existing `workspace: Workspace | null`, which is untouched. `scope` is
computed once per invocation in `src/cli/program.ts`, from whatever the
matched command declared:

- declared `"repository"` → repository scope (precondition enforcement
  already guaranteed a workspace exists)
- declared `"user"` → user scope (enforcement already guaranteed a home
  directory resolves)
- declared `"either"`, or nothing at all → repository scope if a workspace is
  present, otherwise user scope, otherwise `null`

That last `null` case is real and stays real rather than being papered over
with a guessed fallback: a command that required nothing specific, running
somewhere with neither a repository nor a resolvable `HOME`, has no scope to
report. `orch doctor` shows this as a warning, never a failure — it reports
scope, it does not require one.

**Precondition enforcement gains one new failure mode**: a command declaring
`scope: "user"` when no home directory resolves exits 4, the same
precondition code repository absence has always used, with a hint to set
`HOME`. No Version 1 command declares user scope, so this is purely additive.

**`orch info` and `orch doctor` report the active scope** in their `data`
payload and their report fields, using the same `resolveContextScope` result
every other command receives. Neither command's own requirements changed:
`doctor` still declares none, and still never fails merely for being outside
a repository — that guarantee predates this milestone and this milestone did
not touch it.

## Rejected alternatives

**Making `scope` required with no default**, forcing every command to state
it explicitly. Rejected: it would have turned a one-line mechanical edit
(deleting `repository: true`) into 24 commands each choosing a value, for no
behavioural gain, and increased the chance of one of them choosing wrong.

**Rooting user scope at `process.cwd()`-relative state**, mirroring
repository scope's walk-upward search. Rejected: user scope's entire point is
to exist independent of any directory a command happens to be invoked from.
`~/.orchestrai` is fixed regardless of `cwd`, the same way `git config
--global` is not affected by which repository you are standing in.

**A new `HomeHost` interface for resolving the home directory.** Considered
and rejected as unnecessary: `EnvHost` is already the injected interface for
environment variables, and reading `HOME`/`USERPROFILE` through it is exactly
as testable as reading any other environment variable this codebase depends
on. A dedicated host would have been an abstraction with only one real
implementation, which the project's own standing rule (two implementations
before an abstraction is trusted) argues against.

**Silently falling back to a synthetic scope** (e.g. `process.cwd()`) when
neither a repository nor `HOME` resolves. Rejected per the project's house
style: undetected means null, never a guess.

## Consequences

- `docs/CLI.md`'s precondition table now documents `scope` in place of
  `repository`.
- Every command in `src/engine/commands/` that declared `repository: true`
  had that key removed from its `requires` object; none had any other part
  of its behaviour touched. `init.ts`'s `requires: { repository: true }`
  became `requires: {}`.
- `tests/support/fakes.ts`'s `fakeContext()` gained a `scope: null` default,
  matching what `resolveContextScope` would actually produce for its other
  defaults (no workspace, no `HOME`).
- The open question of where user scope lives is answered for now:
  `~/.orchestrai`, unconditionally. `$XDG_STATE_HOME` and a config override
  remain open for later if it matters.
