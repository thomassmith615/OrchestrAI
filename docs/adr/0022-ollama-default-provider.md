# ADR 0022: Ollama is the default provider

**Status:** Accepted
**Date:** 2026-08-02

## Context

`DEFAULT_CONFIG.provider` (`src/core/config/schema.ts`) has been `anthropic`
since Milestone 2. That means a fresh install of Orchestraᵢ is, by default,
unusable for anything that calls a provider — `orch propose`, `orch next`,
`orch review --verify`, `orch providers --verify` — until an operator sets a
credential and spends money, unless they already knew to reach for the
`mock` provider. The project owner asked for the default to be local and
free instead, falling back to a frontier model only on explicit request.

## Decision

**`DEFAULT_CONFIG.provider` is now `"ollama"`.** A fresh `orch init` writes
a config file that works immediately against a local Ollama instance, with
no credential, no network dependency beyond `localhost:11434`, and no cost.
`orch provider add anthropic` (or `openai`) remains the explicit,
one-command opt-in to a hosted model — nothing about that path changed.

**Ollama is implemented as a new `ProviderDescriptor` (`src/providers/ollama.ts`),
not a special case of `openai`.** It defaults `baseUrl` to
`http://localhost:11434/v1` and `model` to `llama3.1`, and — the part that
actually required new code — it does not require a credential.

**`ProviderDescriptor` gained one optional field: `credentialRequired?: boolean`.**
Unset means required, which is every provider's behaviour before this field
existed, so `anthropic`, `openai`, and `mock` are untouched. Ollama sets it
`false`: `OLLAMA_API_KEY`, if present, is still sent as a bearer token (for
the less common case of a remote or authenticated Ollama-compatible
gateway), but its absence is not a failure or a warning anywhere —
`orch doctor`, `orch providers`, and `orch provider add` all consult this
flag now instead of assuming every provider needs a key. Without it, a
correctly-working local setup would have shown a permanent, misleading
`WARN` on every `orch doctor` run.

**`openai.ts` and `ollama.ts` share one transport, `chat-completions.ts`.**
Ollama's OpenAI-compatible endpoint is, structurally, the identical wire
protocol `openai.ts` already implemented — same request shape, same SSE
event format, same error codes. Duplicating that HTTP and streaming logic
into a second file for zero protocol difference would be exactly the
parallel abstraction this project's coding philosophy warns against, so the
shared request-building, SSE parsing, and error-mapping logic was extracted
into a factory both providers configure themselves from. `openai.ts` is now
eleven lines of configuration; its behaviour is unchanged, verified by its
existing, untouched test suite passing without modification against the
refactored implementation.

**`doctor.ts`'s hardcoded `CREDENTIAL_ENV` map was replaced with a real
lookup against the provider registry** (`findProvider`), rather than adding
a fourth hand-maintained entry. This incidentally fixes a latent
inconsistency: the map listed `gemini`, for which no provider has ever been
registered — `orch provider add gemini` was always rejected as unknown, so
`doctor` could show a credential check for a provider that could never
actually be selected. The registry-derived lookup can't drift from what is
actually selectable, because it isn't a separate list.

## Rejected alternatives

**Pointing the existing `openai` provider at Ollama by default**, via
`baseUrl` alone, with no new descriptor. This is the documented way to reach
*any* local runtime today (`docs/CLI.md`'s "Providers" section), and it was
the first approach tried. It fails outright: `openai.ts`'s transport calls
`requireCredential` unconditionally, throwing `OPENAI_API_KEY is not set`
before a request is even attempted — confirmed by running the exact sequence
against a clean checkout. A local runtime that needs no key cannot be the
default through a provider whose transport hard-requires one.

**Making the credential check silent instead of adding a typed flag** — e.g.
having `doctor`/`providers`/`provider-add` special-case the string `"ollama"`.
Rejected on the same grounds the rest of this codebase rejects identity
special-cases: the next local-runtime provider (a self-hosted vLLM instance,
say) would need the same treatment, copied by hand. A declared, typed
capability of the descriptor is the one place this only has to be decided
once.

**A default `contextTokens` of 128,000** for Ollama, matching `openai`'s.
Rejected as dishonest: Ollama's actual context window depends entirely on
which model was pulled and its configured `num_ctx`, which is frequently
much smaller (2,048–4,096) unless the operator raises it themselves. `8,000`
is a clearly-commented, conservative placeholder, not a claim about any
specific model.

## Consequences

- A fresh `orch init` in an environment with Ollama running and a model
  pulled works end to end — `orch propose`, `orch next`, `orch review
  --verify` — with zero configuration and zero spend. Confirmed by hand
  against a clean checkout: `orch doctor` reports "All checks passed", not a
  credential warning.
- Every existing test that relied on the *default* provider being
  `anthropic` (as opposed to explicitly selecting it, which the large
  majority of the suite already did) was updated to expect `ollama`; every
  test that explicitly selects `anthropic` or `openai` is untouched, because
  neither provider's behaviour changed.
- `tests/providers/ollama.test.ts` and `tests/providers/openai.test.ts`
  (unmodified) together are the regression test for the `chat-completions.ts`
  extraction: if the refactor had changed openai's behaviour, its existing
  suite would have caught it without needing a single assertion rewritten.
- **Revisit trigger:** if a second local-runtime provider is ever added
  (vLLM, LM Studio, llama.cpp's server, ...), and it also needs
  `credentialRequired: false` plus its own default base URL and model, that
  is the moment to ask whether "local provider" deserves to be its own
  declared category rather than three independent descriptors that happen to
  agree — the same "two implementations before an abstraction is trusted"
  standard the rest of this project already holds itself to.
