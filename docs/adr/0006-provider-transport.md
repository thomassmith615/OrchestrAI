# ADR 0006: Provider implementations call REST directly, not vendor SDKs

**Status:** Accepted
**Date:** 2026-08-02

## Context

Charter Principle 1 requires that AI providers be interchangeable and that no
implementation couple the platform to one model. `src/providers` is the only
place vendor specifics are allowed. The question is what those implementations
should be built on: the official vendor SDKs, or the HTTP APIs directly.

## Decision

Provider implementations call the vendor REST APIs through the injectable
`HttpHost`. No vendor SDK dependency.

Reasons:

1. **Testability.** With HTTP injected, the entire Anthropic provider including
   streaming is tested against canned server sent events. No SDK mocking, no
   network, no credentials, no flake.
2. **Dependency surface.** A tool intended for global installation should not
   carry one SDK per supported vendor, each with its own transitive tree and
   release cadence.
3. **Interface honesty.** Writing the transport by hand makes it obvious when a
   vendor concept is leaking upward. An SDK makes it easy to pass a vendor type
   through the abstraction without noticing.

The surface used is small and stable: one endpoint, a documented request body,
and a documented SSE event sequence.

## Consequences

- Provider errors are normalized in one place: HTTP status maps to a
  `ProviderErrorKind`, and `401` carries the configuration exit code so that
  scripts can distinguish a bad key from a bad request.
- New vendor features (tool use, prompt caching, batching) require implementing
  the wire format rather than calling a method.
- **Revisit when** tool use or another feature with a complex multi-turn wire
  protocol lands. At that point an SDK behind the same `Provider` interface may
  be worth the dependency, and only files inside `src/providers` would change.

## Related decisions

- The deterministic `mock` provider is a first class member of the registry,
  not a test fixture. Every later milestone tests orchestration against it, so
  suites stay fast, free, and repeatable.
- `orch providers --verify` is opt in. Listing providers must never spend money
  or require network access.
- Credentials are read from the environment only. `orch provider add` writes the
  provider selection to the config file and never the key.
