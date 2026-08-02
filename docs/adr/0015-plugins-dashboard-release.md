# ADR 0015: Declared permissions, a read-only dashboard, and an update that does not update

**Status:** Accepted
**Date:** 2026-08-02

## Context

Milestone 12 closes Version 1: third parties can extend the workflow, the state
can be watched, and the package can be released.

## Decision

**Plugin permissions are a declaration, not a sandbox, and that is stated
plainly.**

A plugin declares `read-repo`, `write-repo`, `network`, or `state`, and the
loader hands it only the hosts it asked for: without `network` there is no HTTP
host, and with `read-repo` alone the filesystem host throws on write. But
plugins run in this process, and one that imports `node:fs` directly bypasses
the host entirely.

Pretending otherwise would be worse than not having permissions at all, because
an operator would trust a boundary that does not hold. `orch plugins` prints
what each plugin requested so the decision to trust it is made with the facts
visible, and the limitation is documented everywhere it is described. Real
isolation needs a separate process and is out of scope for Version 1.

**A failed plugin is reported, never fatal.** One broken extension must not stop
a repository from being worked on. Load failures are warnings, and the rest of
the plugins still load.

**The dashboard is read only and has no affordance to be otherwise.** No form,
no button, no mutating route, no script tag, no external request. It is one
self contained document assembled from the same modules the CLI uses, so the two
surfaces cannot disagree. Everything that causes a change stays in the CLI,
which is the product decision from `docs/CLI.md` expressed as an absence.

It binds to `127.0.0.1` by default. A dashboard that exposes a repository's
memory and spend on `0.0.0.0` by default is a mistake made once.

**`orch update` reports, it does not install.** A tool that silently replaces
itself is a tool you cannot reason about, and the package manager already knows
how to upgrade. This says whether you should, prints the command, and stops. An
unreachable registry is a warning rather than a failure.

## Consequences

- Plugin commands are registered at runtime only when `plugins` is non-empty,
  so an ordinary invocation pays nothing for a feature it is not using.
- The dashboard needs no build step, no framework, and no network, which means
  it cannot rot independently of the code it displays.
- Version 1.0.0 is tagged with the package publishable: `bin`, `files`,
  `prepack`, and a license.

## On continuous integration

The workflow runs the Definition of Done on the lowest supported runtime and
current LTS, then a separate smoke job that exercises the built binary against
the repository itself: init, doctor, status, context budgeting, a memory round
trip, an offline orchestration loop, the three meaningful exit codes, and the
dashboard. Unit tests prove the parts; the smoke job proves the thing that ships
actually runs.

It checks out with `fetch-depth: 0` because the CLI reads real git state and a
shallow clone would give it a single synthetic commit.
