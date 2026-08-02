# ADR 0011: The roadmap stays a document, and the workflow stops at failure

**Status:** Accepted
**Date:** 2026-08-02

## Context

The charter defines a nine step development workflow and a session continuation
protocol driven by `docs/ROADMAP.md`. Milestone 8 turns both into code.

Two questions had to be settled: who owns the roadmap file, and what a workflow
does when a stage fails.

## Decision

**The roadmap file remains a document a human maintains.** Orchestraᵢ parses it;
it never rewrites it. The parser is deliberately tolerant: headings become
phases, `- [x]` and `- [ ]` items become milestones, everything else is ignored
rather than treated as an error. If keeping the file parseable ever conflicts
with keeping it readable, readability wins and the parser gets more forgiving.

The alternative, a state file that owns milestone status with the markdown
generated from it, would make the plan something you query instead of something
you read. The roadmap is the one artifact whose whole value is that a person
opens it.

Run history does live in `.orchestrai/runs/`, because that is a log rather than
a plan.

**A workflow stops at the first failed step.** Remaining steps are recorded as
skipped with the reason. Continuing past a failure means later stages operate on
state the workflow already knows is wrong, which is precisely the behaviour that
makes automation untrustworthy (Principle 6).

**Steps declare preconditions and postconditions.** A precondition returns a
reason to skip, and skipping is not failing: a repository with no lint command
should not fail a workflow. A postcondition rejects a result that arrived
without an error but is unusable anyway, such as an analysis stage that found no
files.

**The baseline runs before anything changes.** A workflow that starts on a red
repository cannot distinguish its own breakage from breakage it inherited, so
the gates run first and a pre-existing failure stops the run with that stated
plainly.

**A dry run lists every stage, including ones that would skip.** Preconditions
are evaluated against runtime state that a dry run has not established, so
judging them would show a plan narrower than the real one.

**Steps do not import the engine or a provider.** They receive hosts, a logger,
a toolchain, and a milestone. Stages that need a model will receive an injected
function in Milestone 9. This keeps the workflow usable from any surface and
testable with no network.

## Consequences

- `orch roadmap` reads the same file a human edits, which immediately caught a
  documentation edit that had silently failed to apply during Milestone 7.
- The step list is data, so Milestone 9 splices design and implement stages into
  the same pipeline rather than writing a second one.
- Run records are append only and versioned. Milestone 10 reads them as history.
