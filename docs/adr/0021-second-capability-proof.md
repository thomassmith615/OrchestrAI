# ADR 0021: Placeholder, the second capability, and what "the proof" means

**Status:** Accepted
**Date:** 2026-08-02

## Context

`docs/ROADMAP-V2.md` names the phase's Definition of Done: "the runtime
hosts two capabilities; Engineering is one; a trivial placeholder is the
other; the placeholder executes entirely under user scope with no git
repository anywhere; and at no point does the runtime branch on a
capability's identity." V2-1 through V2-5 proved five separate compositional
mechanisms (commands, config, storage, events, jobs, providers) each in
isolation, mostly with throwaway capability-shaped test fixtures. This
milestone was explicitly framed by the project owner as different in kind:
not "add routes and pages," but prove, as strongly as this codebase can
prove anything, that the runtime genuinely hosts more than one capability —
"the proof is the product."

## Decision

### Placeholder is a real module, not a test fixture

`src/capabilities/placeholder/index.ts` is written to the same standard as
`src/capabilities/engineering/index.ts`: real JSDoc, real types, no
shortcuts taken because "it's just for testing." This is deliberate. A
throwaway object literal inside a test file (the pattern V2-1 through V2-5
used for their own narrower proofs) would prove the *mechanism* works; it
would not give a future engineer — building CamperCAD, or Trading, or
something this project has never imagined — a real example to read. Treating
Placeholder as production-quality code, even though it ships in no product,
is what makes it useful as documentation, not just as a test.

It declares, deliberately, exactly the four things the project owner asked
it to exercise: a real command prefix (`placeholder`, not Engineering's
empty backwards-compatibility one), a real config namespace with one field,
a real storage namespace, and `requires: { scope: "user" }` on every command
it has — the way a capability with no concept of a repository, like Home,
actually would declare every command it has, not just some.

### Placeholder is not part of `defaultCapabilities`

`src/capabilities/index.ts` is untouched. The real `orch` binary, built and
run, still activates only Engineering — verified directly: `orch
capabilities` after `npm run build` reports exactly one capability, 27
commands, unchanged from every prior milestone.

This was a real decision, not an oversight, and it is worth stating the
reasoning plainly because it could reasonably have gone the other way.
Shipping Placeholder in `defaultCapabilities` would make "the runtime hosts
two capabilities" true of the actual product a user runs, which is a
stronger everyday statement than "true of the test suite." It was rejected
for three reasons. First, the project owner's own framing: "it exists only
to prove architecture," "avoid introducing any domain concepts that might
accidentally become Home" — a capability permanently visible in
`orch capabilities` output invites exactly that kind of accretion over time,
the way a "temporary" debug flag never gets removed. Second, a real,
identity-agnostic, `assembleRuntime([engineeringCapability,
placeholderCapability])` driven through the actual `run()` CLI entry point
— not a mock of it — is not a weaker proof than shipping it; it exercises
the identical code path (`enforceRequirements`, `resolveContextScope`,
command dispatch, rendering, exit codes) that a shipped invocation would.
Third, and most simply: nothing about Placeholder is a product decision
Engineering, another capability, or the project owner has asked for — adding
it to the default set is a scope change this ADR is not the place to make
unilaterally. See Consequences for how this cuts against the phase's
Definition of Done as literally written, and the choice being left open.

### Config: Placeholder reads its own default directly, not through `resolveConfig`

Placeholder's `status` command reads `greeting` from its own declared
`CapabilityConfigSchema.defaults` directly — not through `resolveConfig`,
which still resolves only against `CONFIG_FIELDS`/`DEFAULT_CONFIG`, exactly
as ADR 0018 left it. This was the most tempting trigger to pull early:
Placeholder is, literally, "a second capability declaring a real config
field," the exact condition ADR 0018 named as the moment to wire
`resolveConfig` to a composed table. It was not pulled, because doing so now
would answer a real, undecided design question (what does
`ResolvedConfig.values`'s type look like once it can carry namespaced keys
beyond the closed `ConfigValues` interface?) under the pressure of a
milestone whose explicit brief was "boring," "avoid unnecessary
complexity," and "prefer stable interfaces over complete features." Reading
a capability's own declared default is a true, honest, minimal proof that
declaration and value are connected; it does not claim layered env/file/flag
resolution works for a second capability, because it does not.

### Storage: Placeholder calls `createCapabilityStorage` directly, `CommandContext` still carries no storage field

`pingCommand.execute` calls `createCapabilityStorage(requireScope(context),
"placeholder", context.hosts.fs)` inline. This is the first real command, in
either capability, to use `CapabilityStorage` for actual persistence rather
than a test asserting the mechanism in isolation — and it required zero
changes to `CommandContext`, `program.ts`, or any other part of the engine,
because everything `createCapabilityStorage` needs (`context.scope`,
`context.hosts.fs`) was already there from V2-2 and Version 1 respectively.

ADR 0019 named "a capability's command actually needs to read or write its
own persistent state during execution" as the trigger for giving
`CommandContext` a live `storage` field. That condition is now true. It was
still not pulled, deliberately: the trigger was about *ergonomics* (not
having to call `createCapabilityStorage` by hand every time), not
*capability* (the mechanism was already fully usable without it, as this
milestone demonstrates). One real call site does not yet answer what every
other command — most of which have no `storageNamespace` at all — should
see in that field, or whether it should be null, absent, or lazily
constructed. Building that now would be answering an unforced question.

### Routes and pages: not built

The original V2-6 roadmap line named "route and page registries." They are
not introduced in this milestone. The project owner's brief for this
milestone was explicit that, unlike jobs, providers, and events in V2-5 —
each of which had at least a plausible near-term consumer named — routes and
pages have none: there is no HTTP surface in this codebase (`docs/
ARCHITECTURE.md`'s own "Future HTTP surface" section says "Not built"), and
generalizing the read-only dashboard was explicitly ruled in-scope-only-as-
contract-if-there-is-a-concrete-consumer, and there is not one. Introducing
`RouteDefinition`/`PageDefinition` types with nothing capable of ever
calling them would be exactly the speculative work this entire phase has
practiced avoiding — worse than V2-5's jobs contract, which at least had a
`run(context)` shape forced on it by "a job is a thing you run." A route or
page contract invented with no HTTP framework, no request/response shape,
and no rendering consumer to constrain it would be a guess, not a contract.

### Events, jobs, and providers: not exercised by Placeholder

The project owner asked Placeholder to exercise "optional runtime
registration points where appropriate." Judged not appropriate here:
`Capability.jobs?()`/`providers?()`/event subscription were already proven
in V2-5 with their own dedicated tests, against their own dedicated
composition (or deliberate non-composition) logic. Having Placeholder also
declare a trivial job or provider would add surface area to the one module
meant to stay smallest-possible, without adding proof value — it would
re-demonstrate a claim already demonstrated, not a new one.

## Rejected alternatives

**Shipping Placeholder in `defaultCapabilities`.** See Decision above. Left
open rather than decided unilaterally; see Consequences.

**Beginning Home instead of a placeholder**, on the theory that a real
second capability proves the claim more convincingly than a fake one.
Explicitly rejected by the project owner's brief, and for good reason: Home
carries product decisions (OAuth, a knowledge store, a dashboard) that have
nothing to do with whether the *runtime* can host two capabilities, and
entangling them would make this milestone's proof inseparable from Home's
correctness.

**Wiring `resolveConfig` to a composed table now that a real second field
exists.** See Decision above — the trigger's letter was satisfied, its
spirit (an unforced, carefully considered generalization) was not, given
this milestone's explicit brief to avoid exactly that kind of complexity
growth.

**Adding `storage: CapabilityStorage | null` to `CommandContext` now that a
real call site exists.** Same reasoning: capability existed without it;
only convenience would be gained; the field's meaning for every other
command is still an open, unforced question.

**Building `RouteDefinition`/`PageDefinition` as bare types anyway, matching
V2-5's treatment of jobs.** Rejected because jobs had a real shape forced by
what a job structurally is; routes and pages have no analogous forcing
function without an HTTP or rendering framework to react against, and a
contract with no discipline behind its shape is a guess wearing a contract's
clothing.

## Consequences

- `tests/capabilities/placeholder.test.ts` is the strongest test in the
  codebase for this project's central architectural claim: it drives the
  actual `run()` CLI entry point, with a fake filesystem containing no `.git`
  anywhere at all, and proves — not asserts, proves, by making it actually
  happen — that Engineering's `orch status` still requires a repository and
  still exits 4, that `placeholder ping`/`placeholder status` succeed with
  none, that state persists and is isolated per capability, and that `orch
  capabilities` reports both with neither privileged.
- **The phase's Definition of Done, read literally, is proven rather than
  shipped.** "The runtime hosts two capabilities" is true of what this
  codebase can be assembled into and has been proven to do; it is not true
  of the `orch` binary as built today, which is Engineering alone, exactly
  as in every prior V2 milestone. Whether to promote Placeholder — or a real
  capability — into `defaultCapabilities` is a product decision the project
  owner should make explicitly, not one this ADR makes on their behalf.
- **Revisit triggers, named per the project's convention, updated by this
  milestone's findings**:
  - Config: `resolveConfig` gains an optional composed-table parameter when
    a *shipped* capability needs layered (not just default-value) resolution
    of its own field — Placeholder's existence did not, by itself, meet that
    bar, because "shipped" is now understood to matter, not just "declared."
  - Storage: `CommandContext` gains a live `storage` field when a *second
    shipped command site* needs it, so the field's meaning for
    storage-less commands is informed by more than one example.
  - Routes/pages: when an HTTP surface or a generalized dashboard is
    actually being built, not before.
  - Home: begins only once the project owner decides Placeholder's proof —
    or a version of it promoted into `defaultCapabilities` — satisfies the
    phase's Definition of Done to their own standard, per the paragraph
    above.
