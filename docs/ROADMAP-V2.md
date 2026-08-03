# Version 2 Roadmap

Six milestones. The objective of Version 2 is to generalize Orchestraᵢ from an
engineering application into a coordination runtime that can host several
applications — Capabilities — sharing one command contract, one configuration
system, one storage model, and eventually one event model. Engineering becomes
the first Capability rather than the thing the runtime is made of.

This file is the source of truth for session continuation, the same role
`docs/ROADMAP.md` played for Version 1. When instructed to "move on to the
next milestone", inspect this file, verify the last completed milestone, and
implement the next unchecked one.

**Status legend:** `[x]` complete, `[ ]` not started.

**Current position:** V2-6 complete. All six milestones delivered.

**The phase's Definition of Done, and where it actually stands:** the
runtime hosts two capabilities; Engineering is one; a trivial placeholder
(`src/capabilities/placeholder/`) is the other; the placeholder executes
entirely under user scope with no git repository anywhere; and at no point
does the runtime branch on a capability's identity. **This is proven, not
shipped.** `tests/capabilities/placeholder.test.ts` drives both capabilities
through the real `run()` CLI entry point end to end — not a simulation of
it — against a fake filesystem with no `.git` anywhere at all. The `orch`
binary as built and run today still activates Engineering alone;
Placeholder is deliberately not part of `defaultCapabilities`. Whether to
promote it, or a real capability, into the shipped default set is a product
decision left open for the project owner. See ADR 0021.
**Home implementation does not begin until that decision is made.**

---

- [x] **V2-1. Capabilities**
  `src/runtime/` introduces the capability contract (`Capability`: id,
  summary, declared command prefix, `commands()`), a `CapabilityRegistry`, and
  `activateCapabilities`, which registers every capability's commands into a
  command registry under its declared prefix. The runtime's job is lifecycle
  only — register, activate, assemble, report — and it never branches on
  which capability is being activated.
  `src/capabilities/engineering/index.ts` declares Engineering as the first
  capability, with an empty command prefix (a backwards-compatibility
  concession, not a precedent) and no implementation moved: it wraps the
  existing `createRegistry()` aggregation rather than duplicating it.
  `src/capabilities/index.ts` is the composition root — the one place allowed
  to name Engineering — and assembles the default runtime the CLI now drives.
  Delivers `orch capabilities`. See ADR 0016.

- [x] **V2-2. Scope**
  Replaces the assumption that every command runs inside a git repository
  with an explicit `Scope`: repository scope (rooted at the git root, exactly
  as Version 1) or user scope (rooted at `~/.orchestrai`, with no repository
  anywhere). `CommandRequirements.repository` is replaced by
  `CommandRequirements.scope: "repository" | "user" | "either"`, defaulting
  to repository when a command declares requirements without specifying one,
  which is what keeps all 27 v1 commands unchanged. `CommandContext` gains a
  resolved `scope` field; `orch info` and `orch doctor` report it. See
  ADR 0017.

- [x] **V2-3. Namespaced configuration**
  `Capability.configSchema?()` lets a capability declare its own fields
  (specs and defaults, unprefixed), and `composeConfigSchemas` merges every
  capability's into one flat table, namespaced with a dot the same way
  commands are namespaced with a space, rejecting a same-namespace field
  collision the way duplicate command registration already is. Engineering
  keeps the root namespace as its own backwards-compatibility concession —
  its declared table is `CONFIG_FIELDS`/`DEFAULT_CONFIG`, byte for byte.
  `resolveConfig`, `ConfigValues`, and `orch config` are deliberately left
  untouched: there is no second capability with a real field yet to justify
  widening tested, load-bearing code, so that wiring is a named revisit
  trigger rather than done speculatively. See ADR 0018.

- [x] **V2-4. Namespaced storage**
  `Capability.storageNamespace?: string` and `createCapabilityStorage(scope,
  namespace, fs)` (`src/runtime/storage.ts`) give a capability a
  `FileSystemHost` confined to its own directory under the resolved scope's
  state directory — not a new interface, the same one every command already
  receives, just with every path checked for containment before it reaches
  the real filesystem. Two differently-namespaced capabilities cannot
  collide or reach each other's files, proven in
  `tests/runtime/storage.test.ts` with an actual `../` escape attempt, not
  just by directory naming. Engineering declares the root namespace, proven
  equal to `.orchestrai/` by test; nothing in `src/memory`, `src/gates`, or
  `src/proposals` was touched. `CommandContext` deliberately does not gain a
  live storage field yet — no command has anything to persist through it —
  so that wiring is a named revisit trigger, not done speculatively. See
  ADR 0019.

- [x] **V2-5. Events, jobs, and provider registration**
  Three extension points, each with a genuinely different composition shape
  once examined closely — the milestone's own finding. `EventBus`
  (`src/runtime/events.ts`) is a shared, un-namespaced pub-sub bus: event
  names are a `<capability>.<noun>.<verb>` convention, not an enforced
  namespace, since multiple listeners sharing a name is the point, not a
  collision; a throwing or rejecting handler is logged and never breaks
  another's. `JobDefinition`/`JobContext` (`src/runtime/jobs.ts`) are a
  contract only — no scheduler, no cross-capability name composition, since
  nothing yet addresses a job by name. `composeProviders`
  (`src/runtime/providers.ts`) merges a capability's declared providers with
  the existing built-in three into one flat, collision-checked registry,
  matching providers' existing flat, human-facing convention (`orch provider
  add <name>`); Engineering declares no `providers()`, since providers were
  never capability-mediated even in v1. None of `orch providers`, `orch
  provider add`, `createProvider`, or `assembleRuntime()` were touched — all
  three mechanisms are proven correct without a live consumer, each with its
  own named revisit trigger. See ADR 0020.

- [x] **V2-6. The second capability, and the proof**
  `src/capabilities/placeholder/` is a real, production-quality second
  capability — not a test fixture — whose only purpose is proving the
  runtime: a real command prefix, its own config namespace and field, its
  own storage namespace, and `requires: { scope: "user" }` on every command
  it declares. `tests/capabilities/placeholder.test.ts` assembles it
  alongside Engineering and drives both through the actual `run()` CLI
  entry point against a filesystem with no `.git` anywhere, proving:
  `orch capabilities` reports both with neither privileged; `placeholder
  ping`/`placeholder status` succeed under user scope with no repository;
  state persists, isolated per capability; and Engineering's own `orch
  status` still requires a repository and still exits 4, completely
  unaffected by Placeholder's presence in the same registry. Placeholder is
  deliberately not part of `defaultCapabilities` — the real `orch` binary is
  unchanged. Route and page registries, named in this milestone's original
  description, were not built: there is no HTTP surface or generalized
  dashboard consumer to give their shape any discipline, so building them
  would have been a guess wearing a contract's clothing. See ADR 0021.

---

## Roadmap change log

| Date | Change |
| --- | --- |
| 2026-08-02 | Version 2 roadmap defined (6 milestones), continuing directly from the Version 1 1.0.0 release. |
| 2026-08-02 | Milestone V2-1 complete: capability contract, registry, and activation in `src/runtime/`; Engineering declared as the first capability in `src/capabilities/engineering/`, with no implementation moved; `orch capabilities`. See ADR 0016. |
| 2026-08-02 | Milestone V2-2 complete: `Scope` (repository or user) replaces the git-repository assumption in the command contract; `CommandRequirements.repository` replaced by `CommandRequirements.scope`, defaulting to repository; `orch info` and `orch doctor` report the active scope. See ADR 0017. |
| 2026-08-02 | Milestone V2-3 complete: `Capability.configSchema?()` and `composeConfigSchemas` let capabilities declare and merge namespaced config fields; Engineering's table composes byte for byte with `CONFIG_FIELDS`/`DEFAULT_CONFIG`. `resolveConfig`/`orch config` deliberately left unwired pending a second capability with a real field. See ADR 0018. |
| 2026-08-02 | Milestone V2-4 complete: `Capability.storageNamespace?` and `createCapabilityStorage` give a capability a `FileSystemHost` confined to its own directory, with containment enforced on every path, not just implied by naming. Engineering's declared namespace resolves to `.orchestrai/` itself, proven by test, with no file I/O rewired. `CommandContext` deliberately does not carry a live storage handle yet. See ADR 0019. |
| 2026-08-02 | Milestone V2-5 complete: `EventBus` (shared, un-namespaced pub-sub, failing handlers logged not fatal), `JobDefinition`/`JobContext` (a contract only, no scheduler, no cross-capability composition), and `composeProviders` (a flat, collision-checked merge with the built-in three, unlike commands/config/storage's namespacing). None wired into a live surface yet; each has its own named revisit trigger. See ADR 0020. |
| 2026-08-02 | Milestone V2-6 complete: `src/capabilities/placeholder/`, a real second capability proving the runtime — user scope, its own config field, its own storage, its own command prefix — driven through the actual `run()` CLI entry point in `tests/capabilities/placeholder.test.ts`, not just composition-level tests. Not part of `defaultCapabilities`; the shipped `orch` binary is unchanged. Route/page registries not built: no consumer exists to give them shape. Version 2's phase Definition of Done is proven, not shipped; promoting it is a product decision left to the project owner. See ADR 0021. |
