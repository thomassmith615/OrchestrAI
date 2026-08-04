/**
 * Lexical symbol extraction.
 *
 * The cheapest useful answer to "what does this file define, and what does it
 * mention". No parser, no compiler, no language server: a tokenizer and a table
 * of the keywords that introduce a declaration in the languages this platform
 * is likely to meet. That is deliberately less than a real symbol table, and it
 * is enough for the only question the context resolver asks of it: which files
 * would have to change if this identifier changed.
 *
 * Two limitations are accepted on purpose:
 *
 * - Comments and string literals are not stripped, so an identifier named in a
 *   comment counts as a mention. That is the safe direction. A file whose
 *   comments discuss `Vehicle` is a file a human renaming `Vehicle` would want
 *   to see, and over-inclusion costs tokens where under-inclusion costs
 *   correctness. Stripping comments correctly also means knowing where string
 *   literals begin, which is most of a lexer.
 * - Declarations made without a keyword — `void render()` in Java or C# — are
 *   not detected as definitions. Type, function, and module level declarations
 *   are, which is the granularity cross-file work operates at.
 */

export interface FileSymbols {
  /** Identifiers this file appears to declare. */
  readonly defines: readonly string[];
  /** Every identifier the file uses, declarations included. */
  readonly mentions: readonly string[];
}

/**
 * Keywords across the supported languages, filtered out of both sets. They are
 * never useful as symbols and they are the highest frequency tokens in any
 * source file, so dropping them costs nothing and saves a great deal of memory.
 */
const KEYWORDS: ReadonlySet<string> = new Set([
  "abstract", "and", "any", "as", "assert", "async", "await", "base", "bool",
  "boolean", "break", "byte", "case", "catch", "char", "checked", "class",
  "const", "constructor", "continue", "declare", "def", "default", "defer",
  "delegate", "delete", "do", "double", "elif", "else", "elseif", "end", "enum",
  "event", "except", "explicit", "export", "extends", "extern", "false",
  "final", "finally", "float", "fn", "for", "foreach", "from", "func",
  "function", "get", "global", "go", "goto", "if", "impl", "implements",
  "implicit", "import", "in", "instanceof", "int", "interface", "internal",
  "is", "lambda", "let", "lock", "long", "loop", "match", "mod", "module",
  "mut", "namespace", "new", "nil", "none", "not", "null", "number", "object",
  "operator", "or", "out", "override", "package", "params", "pass", "private",
  "protected", "protocol", "pub", "public", "raise", "range", "readonly",
  "record", "ref", "return", "sealed", "select", "self", "set", "short",
  "sizeof", "static", "std", "string", "struct", "super", "switch", "sync",
  "then", "this", "throw", "throws", "trait", "true", "try", "type", "typedef",
  "typeof", "undefined", "union", "unsafe", "use", "using", "val", "var",
  "virtual", "void", "volatile", "when", "where", "while", "with", "yield",
]);

/**
 * Keywords that introduce a declaration. `const`, `let`, and `var` are included
 * because a great deal of JavaScript and TypeScript declares its exports that
 * way; the resulting local variables are noise, but harmless noise, because a
 * caller only ever asks about identifiers it already has a reason to name.
 */
const DEFINITION = new RegExp(
  "\\b(?:class|interface|type|enum|struct|trait|record|protocol|namespace" +
    "|module|impl|function|func|fn|def|const|let|var|val)\\s+" +
    "([A-Za-z_$][A-Za-z0-9_$]*)",
  "g",
);

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Below this length an identifier carries no signal worth indexing. */
const MIN_LENGTH = 3;

function usable(name: string): boolean {
  return name.length >= MIN_LENGTH && !KEYWORDS.has(name);
}

export function extractSymbols(content: string): FileSymbols {
  const defines = new Set<string>();
  const mentions = new Set<string>();

  for (const match of content.matchAll(DEFINITION)) {
    const name = match[1];
    if (name !== undefined && usable(name)) {
      defines.add(name);
    }
  }

  for (const match of content.matchAll(IDENTIFIER)) {
    const name = match[0];
    if (usable(name)) {
      mentions.add(name);
    }
  }

  return { defines: [...defines], mentions: [...mentions] };
}
