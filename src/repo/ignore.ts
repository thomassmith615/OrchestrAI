/**
 * Gitignore evaluation.
 *
 * Implements the subset of gitignore semantics that matters for deciding what
 * a model is allowed to see: comments, blank lines, negation, anchoring,
 * directory-only patterns, and the `*`, `**`, `?` wildcards. Nested
 * `.gitignore` files apply to their own subtree.
 *
 * Not implemented: escaped literal `#` and `!`, and re-inclusion of files
 * beneath an excluded directory. Excluded directories are pruned during the
 * walk, which matches git's own behaviour for that case.
 */

export interface IgnoreRule {
  readonly pattern: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly matcher: RegExp;
}

/** Rules from one `.gitignore`, scoped to the directory that contained it. */
export interface IgnoreScope {
  /** Directory the rules are relative to, posix, relative to the repo root. */
  readonly base: string;
  readonly rules: readonly IgnoreRule[];
}

const REGEX_SPECIALS = /[.+^${}()|\\]/g;

function toRegex(pattern: string, anchored: boolean): RegExp {
  let source = "";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index] ?? "";

    if (char === "*") {
      const isDouble = pattern[index + 1] === "*";
      if (isDouble) {
        // `**/` spans zero or more directories; a bare `**` spans anything.
        if (pattern[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 3;
          continue;
        }
        source += ".*";
        index += 2;
        continue;
      }
      source += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    if (char === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close > index) {
        source += pattern.slice(index, close + 1);
        index = close + 1;
        continue;
      }
    }

    source += char.replace(REGEX_SPECIALS, "\\$&");
    index += 1;
  }

  const prefix = anchored ? "" : "(?:.*/)?";
  return new RegExp(`^${prefix}${source}$`);
}

export function parseIgnoreRule(line: string): IgnoreRule | null {
  const trimmed = line.trimEnd();

  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null;
  }

  const negated = trimmed.startsWith("!");
  let pattern = negated ? trimmed.slice(1) : trimmed;

  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) {
    pattern = pattern.slice(0, -1);
  }

  // A slash anywhere but the end anchors the pattern to the ignore file's
  // directory. Otherwise it matches at any depth below it.
  const anchored = pattern.includes("/");
  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  }

  if (pattern.length === 0) {
    return null;
  }

  return {
    pattern,
    negated,
    directoryOnly,
    matcher: toRegex(pattern, anchored),
  };
}

export function parseIgnoreFile(content: string): readonly IgnoreRule[] {
  return content
    .split("\n")
    .map(parseIgnoreRule)
    .filter((rule): rule is IgnoreRule => rule !== null);
}

/** Builds a scope from patterns supplied in configuration, rooted at the repo. */
export function configScope(patterns: readonly string[]): IgnoreScope {
  return {
    base: "",
    rules: patterns
      .map(parseIgnoreRule)
      .filter((rule): rule is IgnoreRule => rule !== null),
  };
}

function relativeTo(base: string, path: string): string | null {
  if (base.length === 0) {
    return path;
  }
  const prefix = `${base}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/**
 * Evaluates every scope in order. The last matching rule wins, which is how
 * negation re-includes a path.
 */
export function isIgnored(
  path: string,
  isDirectory: boolean,
  scopes: readonly IgnoreScope[],
): boolean {
  let ignored = false;

  for (const scope of scopes) {
    const candidate = relativeTo(scope.base, path);
    if (candidate === null) {
      continue;
    }

    for (const rule of scope.rules) {
      if (rule.directoryOnly && !isDirectory) {
        continue;
      }
      if (rule.matcher.test(candidate)) {
        ignored = !rule.negated;
      }
    }
  }

  return ignored;
}
