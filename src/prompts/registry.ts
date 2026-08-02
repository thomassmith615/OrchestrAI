/**
 * Prompt registry.
 *
 * Every prompt has a stable id and a version. Changing a template's meaning
 * means bumping its version, so that a recorded run can say which prompt
 * produced it. Snapshot tests lock the rendered output.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderTemplate } from "./render.js";
import { PromptError } from "./render.js";
import type { PromptVariables } from "./render.js";

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "templates");

export interface PromptDefinition {
  readonly id: string;
  readonly version: number;
  readonly file: string;
  readonly description: string;
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    id: "system",
    version: 1,
    file: "system.md",
    description: "Base role and rules given to every provider call",
  },
  {
    id: "analyze",
    version: 1,
    file: "analyze.md",
    description: "Repository architecture and health review",
  },
  {
    id: "review",
    version: 1,
    file: "review.md",
    description: "Engineering summary written for a human reviewer",
  },
  {
    id: "propose",
    version: 1,
    file: "propose.md",
    description: "Implement a task and emit full file replacements",
  },
];

export function findPrompt(id: string): PromptDefinition | undefined {
  return PROMPTS.find((prompt) => prompt.id === id);
}

/** Stable identifier recorded alongside any output a prompt produced. */
export function promptRef(prompt: PromptDefinition): string {
  return `${prompt.id}@${String(prompt.version)}`;
}

export function loadTemplate(id: string): string {
  const prompt = findPrompt(id);

  if (prompt === undefined) {
    throw new PromptError(
      `Unknown prompt: ${id}`,
      `Known prompts: ${PROMPTS.map((entry) => entry.id).join(", ")}`,
    );
  }

  try {
    return readFileSync(join(TEMPLATE_DIR, prompt.file), "utf8");
  } catch {
    throw new PromptError(
      `Could not read template for ${id}`,
      "Run `npm run build` so templates are copied into dist",
    );
  }
}

export function renderPrompt(id: string, variables: PromptVariables): string {
  return renderTemplate(loadTemplate(id), variables);
}
