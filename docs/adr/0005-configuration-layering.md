# ADR 0005: Hand written config schema with per-field source tracking

**Status:** Accepted
**Date:** 2026-08-02

## Context

Configuration must resolve through four layers: built-in defaults, the project
config file, environment variables, then command line overrides. `orch config`
must show not only the resolved value but which layer supplied it, because
precedence bugs are otherwise invisible.

The obvious choice is a validation library such as zod.

## Decision

Declare fields in a single table in `src/core/config/schema.ts` and resolve
them in `src/core/config/resolve.ts`. No validation library.

The deciding factor is source tracking. A schema library validates a finished
object; it does not know which layer contributed each field. The layering pass
has to be written either way, and once it exists, validating a field while
applying it costs a switch statement over four field kinds. Adding a dependency
to avoid that switch would buy little and add a runtime dependency to a tool
intended for global installation.

Environment variables and `--set` overrides arrive as strings and are coerced
per field kind. File values arrive as JSON and are validated without coercion,
so `{"ignore": "dist"}` is an error rather than a silently wrapped array.

Overrides use `--set key=value`, repeatable, rather than a dedicated flag per
setting. A flag per setting would need maintenance in two places every time the
schema grows.

## Consequences

- `orch config` reports a source for every field with no extra machinery.
- Adding a setting means adding one row to `CONFIG_FIELDS` plus its default.
- A field kind that does not fit the four existing kinds requires extending the
  coercion switch, which is the cost of not using a library.
- Revisit if the schema grows past roughly twenty fields or gains nested
  objects. At that point zod earns its place.

## Related

Secrets are never stored in the config file. Credentials are read from
environment variables, and `orch doctor` reports presence only, never values.
