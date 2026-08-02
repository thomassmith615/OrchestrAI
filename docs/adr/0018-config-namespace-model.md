# ADR 0018: Config field composition, without touching the resolver yet

**Status:** Accepted
**Date:** 2026-08-02

## Context

`ConfigValues` is a closed interface of eleven fields, and `CONFIG_FIELDS` is
a closed table (`src/core/config/schema.ts`). A capability cannot add a
setting without editing core, and every capability would share one flat
namespace — the same problem V2-1 solved for commands, not yet solved for
configuration. `docs/ROADMAP-V2.md`'s description of V2-3 is: "capabilities
declare their own fields under their own namespace... reusing the existing
layered resolver, coercion, and per-field source tracking verbatim."

Unlike V2-2 (Scope), this milestone came with a one-line roadmap description
rather than a fully specified design, so the implementation choices below are
this engineer's, made in the spirit of the two ADRs that came before it and
recorded here for the same reason they were: so a plausible alternative
doesn't get silently re-litigated later.

## Decision

**A capability's config fields are declared the same shape commands are**:
`Capability.configSchema?(): CapabilityConfigSchema`, an optional method
(`src/runtime/capability.ts`) returning `{ namespace, fields, defaults }`,
where `fields`/`defaults` are unprefixed — exactly like `commands()` returns
unprefixed command names before the runtime applies a capability's prefix.

**Namespacing uses `.` instead of a space.** `prefixedCommandName` (ADR 0016)
joins a capability's prefix and a command name with a space, because the
result is a CLI invocation (`home status`). `namespacedFieldKey`
(`src/runtime/config.ts`) joins a capability's namespace and a field name
with a dot (`home.token`), because the result is a config key, and dotted
paths are the idiomatic shape for one in this ecosystem. Empty string
composes at the root, the identical rule commands already use.

**`composeConfigSchemas(capabilities)` merges every capability's fields into
one flat table** and throws on a same-namespace, same-field collision — the
config equivalent of `CommandRegistry.register` throwing on a duplicate
command name. This is a pure function, not tied to capability activation
lifecycle, because unlike command registration there is not yet a live
resolver consuming the merged result (see below), so there is nothing for a
broken capability's config to silently corrupt at activation time. It can be
attached to activation's error-tolerance model later, if and when it starts
mutating something live.

**`resolveConfig`, `ConfigValues`, `orch config`, and `CONFIG_FIELDS` are
completely unchanged by this milestone.** This is the deliberate part of the
decision. `resolveConfig` is heavily tested, load-bearing code that every one
of Version 1's 27 commands depends on through `context.config.values.provider`
and friends, with full static typing. Generalizing it to resolve against an
arbitrary composed table — accepting namespaced string keys instead of the
closed `ConfigKey` union — would mean either:

- widening `ConfigValues` to `ConfigValues & Record<string, unknown>`
  wherever a composed table might be in play, which loses static typing for
  every existing `config.values.X` call site without a second capability's
  real fields to justify the loss, or
- making `resolveConfig` generic over the table, which is a real interface
  change to code with no second caller yet.

Nothing today has a config field to resolve outside Engineering's own table,
the same situation V2-1 was in for commands before its "second capability"
test — except V2-1's runtime construct (`assembleRuntime`) had an immediate,
real production consumer: `src/cli/run.ts` had to build *some* registry every
invocation, so wiring it to the new mechanism cost nothing and proved it
under real use. Config resolution has no equivalent forcing function yet:
`orch config` displaying Engineering's eleven fields via the composed table
would be observably identical to displaying them via `CONFIG_FIELDS`
directly, for no present benefit, at the cost of threading a table parameter
through tested code. That is the shape of premature abstraction the coding
philosophy warns against, so it is not done here.

**The revisit trigger is named, matching the project's convention** (ADR
0013 names one for memory storage; this names one for config resolution):
when a second capability declares a real config field of its own —
Home's OAuth client ID, most likely — `resolveConfig` gains an optional
`table: ConfigFieldTable` parameter defaulting to `ENGINEERING_CONFIG_TABLE`,
and `orch config` renders whatever composed table the active capability set
produced. At that point there is a real value to display and a real
regression to guard against, and the change is justified.

**Engineering declares an empty config namespace**, packaged as
`ENGINEERING_CONFIG_TABLE` (`CONFIG_FIELDS`/`DEFAULT_CONFIG`, unchanged,
wrapped for composition) — the same backwards-compatibility concession its
empty command prefix already is. `orchestrai.config.json`'s existing keys are
unaffected.

## Rejected alternatives

**Nested JSON objects per namespace** (`{"home": {"token": "..."}}`) instead
of dotted flat keys (`{"home.token": "..."}`). More natural to hand-author,
but it would require `resolveConfig`'s file-reading and `--set` override
parsing to become namespace-aware recursively, which is exactly the
generalization this ADR defers. Dotted keys stay flat, which is what lets a
future resolver reuse the existing four-layer loop over `Object.entries`
essentially unchanged when that day comes.

**Wiring `resolveConfig` and `orch config` to the composed table now, with
only Engineering's fields in it.** Rejected as premature: see above. Nothing
observable would differ from today's behaviour, and the risk is not zero —
`resolveConfig` is exercised by dozens of existing tests.

**Making `configSchema()` required on every capability**, with an empty
table for capabilities that need none. Rejected to match `commands()`'s
sibling `configSchema?()` being optional: a capability with nothing to
configure should not have to say so explicitly, the same reasoning that will
apply to routes, jobs, and event subscriptions as those land.

**Detecting field collisions inside `activateCapabilities` itself**, the way
command collisions are caught by the shared `CommandRegistry`. Rejected for
now: activation has no equivalent shared, mutated sink for config fields
today (there is no live resolver to register into), so collision detection
lives in `composeConfigSchemas`, the function that actually merges tables,
and will move or extend if activation ever gains one.

## Consequences

- `Capability` gained one optional method; every capability declared before
  this milestone (only Engineering) is unaffected by its absence, which
  nothing enforces or types as an error.
- `tests/runtime/config.test.ts` proves composition is empty-safe, exactly
  reproduces `CONFIG_FIELDS`/`DEFAULT_CONFIG` for Engineering alone,
  namespaces a second capability's fields without collision, and throws on a
  genuine collision.
- No command's behaviour, no config file format, and no `--json` output
  changed. `npm run verify` did not need a single existing test edited.
