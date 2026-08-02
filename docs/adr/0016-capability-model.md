# ADR 0016: Capabilities register themselves; the runtime never names one

**Status:** Accepted
**Date:** 2026-08-02

## Context

Version 1 is complete and tagged 1.0.0. Its command surface, storage, and
configuration all assume a single application: Orchestraᵢ is engineering
tooling, full stop. Version 2's objective is to generalize the platform from
an engineering application into a runtime that can host several applications
— Engineering, then Home, then others — sharing one command contract, one
configuration system, one storage model, and eventually one event model.

Milestone V2-1 is the first step: introduce a capability contract, without
moving any implementation and without breaking a single existing invocation.
`orch status` must remain `orch status`. A naive reading of "the runtime must
not privilege Engineering" would rename every command to `engineering
status` and break every script that calls this tool today.

## Decision

**A capability declares `id`, `summary`, `commandPrefix`, and a `commands()`
method** (`src/runtime/capability.ts`). The runtime's job is lifecycle only:
register a capability, activate it into a command registry, and report what
happened. It does not know what a capability does, and it must never branch
on which one is being activated.

**Backwards compatibility lives in declared data, not in runtime
conditionals.** The rule the runtime applies is the same for every
capability:

```
prefixedName(capability, name) =
  capability.commandPrefix === ""  ?  name
                                   :  `${capability.commandPrefix} ${name}`
```

Engineering declares `commandPrefix: ""`. A future capability declares a real
one, e.g. `"home"`. Only the data differs; `activateCapabilities` runs the
identical loop for both. `tests/capabilities/assemble.test.ts` activates
Engineering alongside a second, throwaway capability under its own prefix and
asserts Engineering's contributed names are still exactly the v1 27 — that is
the test that would catch a privileged path, and the reason it exists is this
ADR.

**Engineering's implementation did not move.** `src/capabilities/engineering/index.ts`
wraps `createRegistry()` from `src/engine`, which is still where the v1
command list is aggregated. This avoids two copies of the same 27-command
list drifting apart, and proves the capability seam works before anything is
relocated. A real file move, if it ever happens, is now a mechanical follow
up with no architectural risk attached.

**A failed capability is reported, never fatal**, the same tolerance already
applied to plugins (ADR 0015): one capability whose `commands()` throws, or
whose commands collide with another's, is recorded in `ActivationResult.failed`
and the rest still activate. `orch capabilities` surfaces this.

**`orch capabilities` is a runtime command, not a capability's.** It reports
on activation, which is exactly the runtime's job description, so it is built
in `src/runtime/command.ts` from an `ActivationResult` rather than declared by
Engineering or anyone else. It knows nothing about what any capability does.

**The composition root — the one place allowed to name Engineering — is
`src/capabilities/index.ts`.** `src/runtime` may not import anything under
`src/capabilities`; the dependency runs the other way; `src/capabilities/index.ts`
imports the runtime's `activateCapabilities` and the concrete Engineering
module and wires them together. Surfaces call `assembleRuntime()` there
instead of reaching into an individual capability or importing `createRegistry()`
directly. `createRegistry()` itself is untouched and still used directly by
tests and by Engineering's own capability wrapper.

## Rejected alternatives

**Renaming Engineering's commands to fit a uniform prefix.** Breaks the
public interface of a 1.0.0, already-released tool for the sake of internal
tidiness. Rejected outright; see the backwards-compatibility principle in
`docs/CHARTER.md`.

**A runtime special case for Engineering** (e.g. `if (capability.id ===
"engineering") { registerBareNames() }`). This is the exact shape of bug the
capability model exists to prevent: it would work today and quietly become
"the runtime privileges whichever capability got special-cased first" the
moment a second one is added. The empty-prefix mechanism keeps the special
case in Engineering's own declared data, where a test can see it.

**Moving `src/engine/commands/*` into `src/capabilities/engineering/` now.**
Deferred, not rejected. It is mechanical and low value until something else
needs the space; see the open question in `docs/ARCHITECTURE.md`.

## Consequences

- `CommandRequirements`, `CommandContext`, and everything else in
  `src/engine/command.ts` is unchanged by this milestone. V2-2 is the
  milestone that touches the command contract itself.
- `src/cli/run.ts` now builds its default registry via `assembleRuntime()`
  instead of calling `createRegistry()` directly. A registry supplied by a
  caller (every existing CLI test that passes one) bypasses the runtime
  entirely, so no existing test needed to change to account for activation.
- The frozen command list in `tests/engine/registry.test.ts` (`createRegistry()`
  called directly) is unaffected and still passes unmodified, as required.
- `orch capabilities` is a 28th command, additive only.
