# ADR 0020: Events, jobs, and provider registration

**Status:** Accepted
**Date:** 2026-08-02

## Context

`docs/ROADMAP-V2.md`'s description of V2-5: "a typed, synchronous, in-process
event emitter... job definitions as contracts only — no scheduler... providers
become something a capability can register rather than something only core
knows about." As with V2-3 and V2-4, this milestone's design was not
otherwise specified in advance.

These are three separate extension points, not one abstraction, and this ADR
treats them separately because they turned out to need genuinely different
shapes — the first architecturally interesting finding of this milestone.

## Decision

### Events: a shared bus, not a namespaced one

`EventBus` (`src/runtime/events.ts`) is a plain `Map<string, handler[]>` with
`on`/`emit`/`listenerCount`. Unlike commands, config fields, and storage,
event names are **not** namespaced or enforced by the bus — `<capability>.
<noun>.<verb>` is a convention participants are expected to follow, the same
way a `.gitignore` pattern is a convention rather than something git parses
semantically. This is a deliberate asymmetry with V2-1/V2-3/V2-4, not an
oversight: those three needed namespacing because they compose *exclusive*
resources (a command name resolves to exactly one implementation; a config
key to exactly one value; a storage path to exactly one file). An event name
is not exclusive — multiple handlers listening to the same name is the
entire point of a pub-sub bus, not a collision to prevent.

What the bus does guarantee, and what the tests in
`tests/runtime/events.test.ts` prove directly: a handler that throws or
rejects is logged as a warning and never stops another handler from running,
or `emit` from resolving. That is the one property worth enforcing — one
capability's broken listener cannot break another's, or the caller that
triggered the event.

**The runtime does not yet construct a shared `EventBus` instance or mediate
how a capability subscribes to it.** `assembleRuntime()` is untouched.
Wiring this in requires deciding a capability lifecycle hook — some `setup()`
called once, with access to the bus, at a point in activation that does not
exist yet — and inventing that hook for a bus with no real subscriber would
be exactly the premature interface commitment this project's discipline
exists to avoid. The tests prove the bus itself works correctly using
capability-shaped throwaway objects that each get handed the same `EventBus`
instance directly, which is sufficient to prove the architectural claim
without deciding how production wiring will look.

### Jobs: a contract with nothing to compose

`JobDefinition` (`src/runtime/jobs.ts`) is `{ name, description, run(context)
}`. `JobContext` is `{ logger, hosts }` — the two things a job's `run`
plausibly needs today, and nothing else.

**There is no `composeJobs`, and job names are not namespaced.** This was
the second finding: unlike providers (one shared registry) or config fields
(one shared table), nothing today addresses a job by name *across*
capabilities — there is no `orch jobs run <name>`, no scheduler, no shared
structure a second capability's job could collide in. Building collision
detection for an address space nothing addresses yet would be solving a
problem that does not exist. `tests/runtime/jobs.test.ts` proves the
opposite property instead: two unrelated capabilities can each declare a job
named `sync` and run them independently, because there is nothing to
reconcile between them.

**No scheduler, and none is planned.** `launchd` already runs jobs on a
schedule on a single always-on Mac; a scheduler earns its place only when
jobs exist whose timing genuinely interacts with each other, which is a
condition this runtime is nowhere near yet.

### Providers: a flat, shared registry, not a namespaced one

`composeProviders(capabilities, builtins?)` (`src/runtime/providers.ts`)
merges `Capability.providers?(): readonly ProviderDescriptor[]` with the
existing built-in three (`anthropic`, `openai`, `mock`), throwing on a
duplicate `id` — against a built-in or against another capability's
declaration.

**Unlike config fields and storage, provider ids are not namespaced.**
`orch provider add <name>` and `provider: "<name>"` in configuration both
address one flat, global vocabulary today, the same way two organizations
publishing to one npm registry share one namespace of package names. Adding
a namespace prefix here would change the existing, human-facing convention
for zero benefit; instead, uniqueness is enforced directly, the same
mechanism `CommandRegistry.register` already uses for duplicate command
names.

**Engineering does not declare a `providers()` method.** This is the third
finding, and the one that most changed the shape of this ADR from what V2-3
and V2-4 might have predicted: commands, config, and storage all needed
Engineering to formally "wrap" pre-existing v1 machinery as its own
declaration, because in each of those cases the v1 machinery was already
consumed *through* something the runtime now mediates (`createRegistry()`
feeds the CLI's registry; `CONFIG_FIELDS` feeds `resolveConfig`, which the
CLI calls; `stateDir` is where Engineering's files already live).
Providers were never capability-mediated, even before this milestone —
`createProvider(id, options)` is called directly by command implementations
(`src/engine/commands/providers.ts`, `next.ts`, ...), with zero relationship
to capability activation. There is nothing for Engineering to wrap; the
built-in three simply are `composeProviders`'s default `builtins`.

**`src/providers/index.ts` is completely untouched**, and neither
`orch providers`, `orch provider add`, nor `createProvider` consult the
composed set. `composeProviders` exists and is proven correct — including
against Engineering's own real built-in list, not a stand-in — without a
live consumer.

### On the eventually consolidated runtime context

`JobContext` (`{ logger, hosts }`) is a small, deliberately narrow type,
scoped to exactly what a job needs. It is **not** an early draft of a future
`RuntimeContext` or service container — the project owner has flagged that
logger, scope, configuration, storage, providers, scheduler, and events will
eventually need one clean injection mechanism, and that it should not be
built prematurely. `JobContext` is not that; it is the smallest thing that
lets a job run, following the same instinct that gave `CommandContext` its
shape one field at a time across M1 and V2-2 rather than as a single
upfront design. When a third or fourth of these narrow, per-purpose context
types accumulates — `JobContext` today, something for event subscription
setup tomorrow, whatever a route handler needs after that — that
accumulation is itself the signal to consolidate, not a prediction made now.

## Rejected alternatives

**Namespacing event names, the same way commands and config fields are.**
Rejected because it solves the wrong problem: namespacing prevents
*exclusive* resources from colliding, and an event name is not exclusive.
Enforcing it would also require the bus to parse names, adding real
behaviour (validation, rejection) in service of a convention that costs
nothing to leave as a convention.

**A `composeJobs` merge function with collision detection**, built now for
symmetry with commands/config/storage. Rejected as speculative: there is no
shared structure for two jobs to collide in until a scheduler or `orch jobs
run` exists to address one by name, and inventing the collision rule ahead
of the thing that would enforce it risks guessing wrong about what "the same
job" even means once one exists (same name? same name and capability? case
sensitivity?).

**Namespacing provider ids** (`home.ollama`) instead of a flat, collision-
checked registry. Rejected: it would change `orch provider add <name>` and
the `provider` config value's existing, human-facing, flat convention for a
problem (id collision) that a direct uniqueness check already solves without
touching the UX.

**Giving Engineering a `providers()` method that returns `listProviders()`**,
for surface consistency with `commands()`/`configSchema()`. Considered, then
rejected once it produced a genuine bug: composing it against the default
`builtins` (also `listProviders()`) collides with itself. The deeper reason
it is wrong, not just buggy, is in the Decision section above — providers
were never capability-mediated, so there is nothing to wrap.

**Wiring a shared `EventBus` instance into `assembleRuntime()` now.**
Rejected: nothing constructs, emits to, or listens on it in production
today, and doing so would require also inventing how a capability
subscribes — a lifecycle hook this milestone has no concrete requirement to
shape correctly.

## Consequences

- `Capability` gained two more optional methods, `jobs?()` and
  `providers?()`, following the same "optional, present-day-empty is valid"
  pattern `configSchema?()` established in V2-3.
- `tests/runtime/events.test.ts`, `tests/runtime/jobs.test.ts`, and
  `tests/runtime/providers.test.ts` prove each extension point's actual
  claim directly, using throwaway capability-shaped values, the same
  pattern V2-1's privileged-path test established.
- **Revisit triggers**, named per the project's convention:
  - Events: when a second capability needs to actually subscribe to
    something emitted by the CLI or another capability, `assembleRuntime()`
    constructs one shared `EventBus`, and `Capability` gains a lifecycle
    hook to register handlers against it.
  - Jobs: when something needs to address a job by name across capabilities
    (`orch jobs run <name>`, most plausibly), a `composeJobs` merge with
    collision detection is added then, informed by whatever addressing
    scheme that consumer actually needs.
  - Providers: when a capability registers a real, non-built-in provider,
    `orch providers`/`orch provider add`/`createProvider` are wired to
    consult `composeProviders`'s output instead of the closed built-in list.
  - Runtime context: when a third narrow, per-purpose context type
    (following `CommandContext` and `JobContext`) is about to be
    introduced, that is the signal to consolidate into one runtime service
    container rather than adding a fourth.
