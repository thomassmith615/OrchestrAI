# ADR 0012: `next` plans, `milestone` implements, and applying is opt in

**Status:** Accepted
**Date:** 2026-08-02

## Context

Milestone 9 closes the loop: every prior milestone becomes a component of one
command. Three questions had to be settled before wiring it together.

## Decision

**`orch next` ends at a plan. `orch milestone` implements.**

The CLI specification describes `next` as determining the next milestone and
*preparing* the workflow, and `milestone` as *executing* it. That split turns
out to be the right engineering boundary too. A design is the cheapest artifact
to argue with: reading it costs a minute, and rejecting it costs nothing.
Reading a diff costs far more, and rejecting one wastes the tokens that
produced it.

So `next` runs understand, analyze, preflight, baseline, plan, summarize, and
writes nothing but a run log. `milestone` runs the same stages and then
implements, using the plan as agreed context for the change.

**Applying is opt in per invocation.** `orch milestone` stops at a staged
proposal. `--apply` completes the loop. The flag is the consent: a human typed
it on this invocation, for this change. Consent stored in configuration would
decay into a setting nobody remembers enabling, which is the failure mode
Principle 6 warns about.

**The workflow reaches a model through a port it declares itself.**
`src/workflow` defines `AiPort` in terms of a prompt id, variables, focus terms,
and a reply. The engine supplies the adapter. Nothing in the workflow imports a
provider, a command context, or a surface, so the same pipeline is usable from
the dashboard and testable with a three line fake.

**Steps produce data; the run log records what happened.** `executeWorkflow`
returns the produced values alongside the run. Plans and proposals are large,
and copying them into the log would turn a compact history into a transcript.
The log says a plan was produced; the caller reads the plan.

## Consequences

- The stage list is data, so `PREPARE_WORKFLOW` and `MILESTONE_WORKFLOW` share
  every step definition and differ only in composition.
- A dirty working tree stops the run at `preflight`, before any tokens are
  spent. Ordering the cheap gates ahead of the expensive ones is not an
  accident.
- The baseline still runs before planning, so a repository that is already red
  never gets blamed on the model.

## Related

Prompt templates now place the packed context first and the instructions last.
Two reasons: generation happens immediately after the rules, and a repository
that contains the change protocol in its own source no longer looks like a
request to use it. The mock provider inspects only the tail of a request for
the same reason, which is a real bug this milestone's own dogfooding exposed.
