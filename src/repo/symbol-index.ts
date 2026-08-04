/**
 * The symbol index.
 *
 * An inverted index from identifier to the files that declare or mention it.
 * This is the piece the platform was missing: without it the only thing known
 * about a file is its path, its size, and its extension, so "which files would
 * a rename touch" could only ever be guessed at from filenames. See ADR 0023.
 *
 * Deliberately not embeddings. For exact identifier work — which is what most
 * refactoring is — an inverted index is better on every axis that matters here:
 * exact rather than approximate, complete rather than top-k, instant rather
 * than a network call, explainable rather than a distance, and provable in a
 * unit test. Embeddings answer a different question ("where is authentication
 * handled") and would be an additive layer over this one, never a replacement.
 *
 * Held in memory for the life of one command. Persisting it is a real
 * optimisation and not yet a needed one: see the revisit trigger in ADR 0023.
 */
import { join } from "node:path";
import { extractSymbols } from "./symbols.js";
import type { FileEntry } from "./scan.js";
import type { FileSystemHost } from "../core/hosts.js";

export interface SymbolIndex {
  /** How many files were read to build it. */
  readonly files: number;
  /** Identifier to the paths declaring it. */
  readonly definitions: ReadonlyMap<string, readonly string[]>;
  /** Identifier to every path naming it, declarations included. */
  readonly references: ReadonlyMap<string, readonly string[]>;
}

export interface SymbolIndexOptions {
  readonly root: string;
  readonly fs: FileSystemHost;
  /** Inventory to index. Binary and oversized entries are skipped. */
  readonly files: readonly FileEntry[];
}

export const EMPTY_SYMBOL_INDEX: SymbolIndex = {
  files: 0,
  definitions: new Map(),
  references: new Map(),
};

function add(
  into: Map<string, string[]>,
  symbol: string,
  path: string,
): void {
  const paths = into.get(symbol);
  if (paths === undefined) {
    into.set(symbol, [path]);
  } else {
    paths.push(path);
  }
}

export function buildSymbolIndex(options: SymbolIndexOptions): SymbolIndex {
  const definitions = new Map<string, string[]>();
  const references = new Map<string, string[]>();
  let files = 0;

  for (const file of options.files) {
    if (file.binary || file.oversized) {
      continue;
    }

    let content: string;
    try {
      content = options.fs.readFile(join(options.root, file.path));
    } catch {
      // Unreadable is not exceptional: the inventory was taken separately and
      // a file can disappear between the two passes.
      continue;
    }

    const symbols = extractSymbols(content);
    files += 1;

    for (const symbol of symbols.defines) {
      add(definitions, symbol, file.path);
    }
    for (const symbol of symbols.mentions) {
      add(references, symbol, file.path);
    }
  }

  return { files, definitions, references };
}

/** Paths declaring `symbol`. Case sensitive: identifiers are. */
export function definitionsOf(
  index: SymbolIndex,
  symbol: string,
): readonly string[] {
  return index.definitions.get(symbol) ?? [];
}

/** Paths naming `symbol` anywhere, declarations included. */
export function referencesTo(
  index: SymbolIndex,
  symbol: string,
): readonly string[] {
  return index.references.get(symbol) ?? [];
}
