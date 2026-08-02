/**
 * Copies non-TypeScript assets that `tsc` does not emit.
 *
 * Prompt templates are `.md` files so that they stay diffable and can contain
 * fenced code blocks. They still need to reach `dist` for a published binary.
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const pairs = [["src/prompts/templates", "dist/prompts/templates"]];

for (const [from, to] of pairs) {
  if (!existsSync(from)) {
    console.error(`missing asset directory: ${from}`);
    process.exit(1);
  }
  cpSync(from, to, { recursive: true });
}

console.log(`copied ${String(pairs.length)} asset director${pairs.length === 1 ? "y" : "ies"}`);
