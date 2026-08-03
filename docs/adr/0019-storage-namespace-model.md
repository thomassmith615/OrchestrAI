# ADR 0019: Capability storage as a confined `FileSystemHost`

**Status:** Accepted
**Date:** 2026-08-02

## Context

`docs/ROADMAP-V2.md`'s description of V2-4: "each capability gets a storage
handle rooted at its own directory (under the resolved scope's state
directory) and unable to address anything above it. Engineering keeps the
shared `.orchestrai/` root it has always used." Like V2-3, this milestone's
design was not otherwise specified in advance.

The claim this milestone exists to prove is narrower than "add storage": a
capability owns a private, structurally-isolated slice of persistent state,
determined entirely by what it declares (a namespace) and where the runtime
resolved it to be running (a `Scope`, from ADR 0017) — with the runtime never
knowing or caring whose data it is. Two capabilities' storage must not
collide, and neither must be able to reach the other's, or reach above its
own root, by construction rather than convention.

## Decision

**`CapabilityStorage` *is* a `FileSystemHost`, confined to one directory,
not a new parallel interface.** `src/runtime/storage.ts` defines it as
`FileSystemHost & { root: string }`. Every command already receives a
`FileSystemHost` through `context.hosts.fs`; extending that exact interface,
rather than inventing `CapabilityFileStore` or similar, means a capability's
storage is usable everywhere a `FileSystemHost` already is, and the
containment guarantee is the only new thing to understand — not a new API
shape to learn on top of it. This is the same instinct behind ADR 0018's
choice to reuse the four-layer config resolver's shape rather than invent a
second one.

**`Capability.storageNamespace?: string`, independent of `commandPrefix`.**
Considered and rejected: reusing `commandPrefix` as the storage namespace
too, since in practice they will usually be the same string. Rejected
because they are not the same *concept* — a future capability could
reasonably want bare, unprefixed top-level commands (a UX choice) while
still wanting its files isolated from `.orchestrai/memory`,
`.orchestrai/gates.json`, and Engineering's other root-level state (a safety
property). Coupling the two would make that combination inexpressible for no
structural reason. Keeping them as two independent optional-ish strings costs
one extra field and forecloses nothing.

**Namespacing is structural, not merely a naming convention.** Every path
passed to a `CapabilityStorage` method is resolved with `path.join(root,
path)` and then checked with `path.relative(root, resolved)`: a result
starting with `..`, or an absolute result, throws `StorageContainmentError`
before the underlying host ever sees the path. A capability cannot address
another's files or its parent directory even if it tried — this is what
"unable to address anything above it" means concretely, and it is exercised
by `tests/runtime/storage.test.ts` with an actual `../` attempt, not just
asserted by directory naming.

**Namespaces compose the same way commands and config do, with a different
separator.** `storageRoot(scope, namespace)` joins with `path.join`, the
filesystem-idiomatic separator, exactly as `prefixedCommandName` joins with a
space (a CLI invocation) and `namespacedFieldKey` joins with a dot (a config
key). Empty string resolves to the scope's state directory itself —
Engineering's concession, the same shape its empty command prefix and config
namespace already take.

**Engineering declares `storageNamespace: ""`, and nothing else changes.**
`src/memory`, `src/gates`, and `src/proposals` were not touched, and none of
Engineering's 27 commands were routed through `CapabilityStorage`. The
declaration is proven correct by test — `storageRoot(scope, "")` equals
`workspace.stateDir`, the exact directory Engineering has always used — but
it is a declaration alongside the real thing, not a rewire of it. Moving
Engineering's actual file I/O onto this abstraction is exactly the kind of
large-blast-radius change V2-1 and V2-3 already declined to make for
commands and config, for the same reason: proving the seam matters more than
using it everywhere immediately, and nothing forces the move today.

**`CommandContext` does not gain a `storage` field, and `src/cli/program.ts`
is untouched.** No command today has anything to persist through this
mechanism — Engineering doesn't need it (it has its own storage paths
already), and no second capability with real commands exists yet. Wiring a
live storage handle into every command's context would be exactly the
"implementing features" this milestone was asked to resist in favor of
"proving architecture." The two-capability, no-collision proof is
demonstrated entirely in tests, against throwaway namespaces, the same way
V2-1's privileged-path guard used a throwaway second capability rather than
waiting for Home to exist.

**Collision detection is per-call, not registry-mediated.** Unlike commands
(one shared `CommandRegistry.register`) or config (one shared
`composeConfigSchemas` merge with an explicit duplicate-key check), storage
has no shared structure to register into — each capability's handle is
created independently, and "no collision" is a property of the two roots
being different directories, not the outcome of a merge step. There is
nothing to compose because there is nothing to share; two `CapabilityStorage`
handles for different namespaces are simply unrelated objects pointing at
unrelated directories.

## Rejected alternatives

**A quota, size limit, or usage accounting for capability storage.**
Speculative: nothing today has approached a limit worth enforcing, and the
project's memory-storage ADR (0013) already demonstrates the pattern for
introducing a limit when there is a real corpus to measure against, not in
advance of one.

**An async or streaming storage API**, anticipating large files (documents,
indexes) a capability like Home might eventually store. Rejected: every
other host in this codebase (`FileSystemHost`, `ProcessHost`) is
synchronous, matching Node's synchronous `fs` calls and the project's
existing style; introducing async here alone would be inconsistent with
everything `CapabilityStorage` extends, for a need that does not exist yet.

**A capability-storage registry**, analogous to `CapabilityRegistry`,
tracking which namespaces are in use and rejecting duplicates at
declaration time. Rejected as premature: uniqueness only matters once two
capabilities are actually activated together and their storage is actually
used, and `activateCapabilities` already has nothing structural to attach
this check to (see above). If it becomes worth enforcing, it belongs beside
command-name collision detection in activation, not as a separate registry.

## Consequences

- `scopeStateDir(scope)` (`src/core/workspace.ts`) is the one addition to
  core: a uniform accessor for "this scope's state directory," regardless of
  kind. It was anticipated in ADR 0017's own commentary on `UserScope`.
- `tests/runtime/storage.test.ts` proves the milestone's actual claim:
  two differently-namespaced capabilities, same scope, same underlying
  filesystem host, write a same-named file with no collision, and neither
  can read the other's via a relative escape.
- **Revisit trigger, named as the project's convention requires**: when a
  capability's *command* actually needs to read or write its own persistent
  state during execution — Home's OAuth token storage is the likely first
  case — `CommandContext` gains a resolved `storage: CapabilityStorage | null`
  field and `src/cli/program.ts` wires it in, the same way `scope` was wired
  in V2-2 once a real precondition depended on it. Until then, this stays a
  proven, tested contract with no live consumer, and that absence is
  intentional rather than an oversight.
