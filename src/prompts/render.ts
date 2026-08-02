/**
 * Prompt rendering.
 *
 * Templates live as `.md` files beside this module rather than as string
 * literals in code. Prompts about code contain fenced blocks, which cannot
 * survive inside a TypeScript template literal without escaping, and a prompt
 * that must be escaped to be stored is a prompt nobody will read in a diff.
 *
 * Interpolation is `{{name}}`. Unknown placeholders and missing variables are
 * both errors: a prompt that silently renders `undefined` is worse than one
 * that refuses to render.
 */
import { EXIT_CODES, OrchestraiError } from "../core/errors.js";

export type PromptVariables = Readonly<Record<string, string>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export class PromptError extends OrchestraiError {
  constructor(message: string, hint?: string) {
    super(message, {
      code: "prompt.invalid",
      exitCode: EXIT_CODES.failure,
      ...(hint === undefined ? {} : { hint }),
    });
  }
}

/** Every placeholder appearing in a template, in order of first appearance. */
export function placeholdersOf(template: string): readonly string[] {
  const seen = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined) {
      seen.add(name);
    }
  }

  return [...seen];
}

export function renderTemplate(
  template: string,
  variables: PromptVariables,
): string {
  const required = placeholdersOf(template);

  const missing = required.filter((name) => variables[name] === undefined);
  if (missing.length > 0) {
    throw new PromptError(
      `Missing prompt variables: ${missing.join(", ")}`,
      `Template expects: ${required.join(", ")}`,
    );
  }

  const extra = Object.keys(variables).filter(
    (name) => !required.includes(name),
  );
  if (extra.length > 0) {
    throw new PromptError(
      `Unused prompt variables: ${extra.join(", ")}`,
      "Remove them, or add the placeholder to the template",
    );
  }

  return template.replace(PLACEHOLDER, (_match, name: string) =>
    variables[name] ?? "",
  );
}
