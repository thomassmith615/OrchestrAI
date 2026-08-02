# ADR 0010: Full file replacement, staged, applied only on a clean tree

**Status:** Accepted
**Date:** 2026-08-02

## Context

Milestone 7 is the first time model output can reach the working tree. Charter
Principle 2 says humans remain responsible, and Principle 6 says automation must
increase trust. Both have to be structural, not advisory.

## Decision

**The change protocol is full file replacement, not a diff.**

```
<<<FILE src/thing.ts
...complete new contents...
>>>

<<<DELETE src/old.ts>>>
```

Models produce diffs with wrong line numbers and drifting context often enough
that applying them becomes the dominant failure mode, and a partially applied
patch is worse than no patch. A whole file either parses or it does not. The
cost is output tokens, which is the cheaper side of the trade.

Paths are validated: absolute paths, `..` segments, and drive letters are
rejected before anything is staged. A model cannot propose a write outside the
repository.

**Proposals are staged as real files.** Each lives under
`.orchestrai/proposals/<id>/files/`, mirroring its repository path. Staging the
actual bytes means the diff shown to a human comes from `git diff --no-index`
against real files rather than being reconstructed, so it reads exactly like a
diff they already know how to review.

**Applying requires a clean working tree.** Refused otherwise, exit 4,
overridable with `--force`. Two reasons: `git checkout .` stays a complete undo,
and the human reviewing the result is looking at the model's work rather than a
mixture of theirs and its.

**Applying does not revert on failure.** Gates run after the write and a failure
exits 3, but the files stay. Reverting automatically would throw away work the
operator may want to fix by hand, and the clean-tree precondition already
guarantees a one-command escape. The failure note says so explicitly.

**Nothing is committed.** Orchestraᵢ writes files. Whether they become history
is the operator's decision, every time.

## Consequences

- `orch propose` is an addition to the command surface, with `apply`, `show`,
  `list`, and `reject` beneath it. The specification has `orch review` and
  `orch milestone` but no verb for the proposal lifecycle, and Milestone 8
  cannot drive a workflow over machinery that has no surface.
- The mock provider answers the change protocol with a valid block, so the
  whole propose, review, apply, verify loop runs offline and deterministically
  with no API key.
- Large files cost a full rewrite in output tokens. If that becomes the binding
  constraint, the fix is smaller focused files or a targeted edit protocol for
  specific cases, not a general move to diffs.

## Related

`CommandDefinition.execute` now always returns a promise: the registry wraps
every command so a synchronous throw becomes a rejection. Surfaces call
`execute` directly, and the previous behaviour only worked because the CLI
happened to await it inside an async frame.
