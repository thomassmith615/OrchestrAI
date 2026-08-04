/**
 * Working set resolution.
 *
 * The step that was missing. Before this, a task description reached the packer
 * as a bag of words matched against *file paths*, and every file was equally
 * droppable once the budget ran out. That is fine for "describe this project"
 * and structurally wrong for "rename `Vehicle`": a rename is defined entirely
 * by its reference sites, and path matching boosts the declaration site — the
 * one file needing the least help — while being blind to every reference.
 *
 * So this module answers, before any model is involved, the question the model
 * should never have been asked: which files does this task actually require?
 * When the answer is "these seven", the packer must include all seven or say
 * plainly that it cannot. When the answer is "nothing in particular", the
 * behaviour is exactly what it always was. See ADR 0023.
 *
 * Note what is *not* here: no task taxonomy, no classifier, no per-kind
 * workflow. Whether a task is mechanical or open ended falls out of whether its
 * terms resolve to real declarations, which is a fact about the repository
 * rather than a guess about the sentence.
 */
import { definitionsOf, referencesTo } from "../repo/symbol-index.js";
import type { SymbolIndex } from "../repo/symbol-index.js";
import type { RequiredFile } from "./pack.js";

export interface WorkingSet {
  /** Task terms that named something the repository actually declares. */
  readonly symbols: readonly string[];
  /** Files the task cannot be done correctly without. */
  readonly required: readonly RequiredFile[];
}

export const EMPTY_WORKING_SET: WorkingSet = { symbols: [], required: [] };

export interface TermOptions {
  /** The task or objective as the user phrased it. */
  readonly task?: string;
  /** Terms the user named explicitly, via `--focus` or a focus argument. */
  readonly focus?: readonly string[];
}

/** Shortest term worth considering. Below this, everything matches. */
const MIN_LENGTH = 4;

/**
 * English that shows up in task descriptions and never names code. Kept short
 * on purpose: the `looksLikeIdentifier` test below does the real filtering, and
 * a long stopword list is a maintenance burden that buys very little.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "about", "add", "adds", "after", "all", "also", "and", "any", "are", "back",
  "before", "both", "but", "can", "change", "changes", "code", "create", "each",
  "file", "files", "fix", "for", "from", "have", "into", "make", "more", "move",
  "must", "need", "new", "not", "now", "only", "onto", "over", "remove",
  "rename", "should", "some", "support", "than", "that", "the", "their", "them",
  "then", "there", "these", "this", "through", "under", "update", "use", "when",
  "where", "which", "while", "with", "would",
]);

function words(text: string): readonly string[] {
  return text.split(/[^A-Za-z0-9_$]+/).filter((term) => term.length > 0);
}

/**
 * An identifier-shaped term: `Vehicle`, `VehicleModel`, `MAX_SIZE`, `snap_to`.
 * An all lower case word is indistinguishable from prose, so it only counts as
 * a symbol when the user named it explicitly. Without that rule, "add a health
 * check endpoint" would resolve `check` against some unrelated local variable
 * and drag thirty irrelevant files into the required set.
 */
function looksLikeIdentifier(term: string): boolean {
  return /[A-Z]/.test(term) || term.includes("_") || term.includes("$");
}

function candidates(options: TermOptions): readonly string[] {
  const explicit = options.focus ?? [];

  const terms =
    explicit.length > 0
      ? explicit
      : words(options.task ?? "").filter(looksLikeIdentifier);

  return [
    ...new Set(
      terms.filter(
        (term) =>
          term.length >= MIN_LENGTH && !STOPWORDS.has(term.toLowerCase()),
      ),
    ),
  ];
}

/**
 * Terms used to bias *ranking*, which still matches against paths. Broader than
 * the symbol rule on purpose: a path hit is a cheap hint, not a claim that the
 * file is required, so it costs nothing to be generous. This is the behaviour
 * `orch propose` has always had, moved here so there is one definition of it.
 */
export function rankingTerms(options: TermOptions): readonly string[] {
  const explicit = options.focus ?? [];

  if (explicit.length > 0) {
    return explicit;
  }

  return [
    ...new Set(words(options.task ?? "").filter((term) => term.length > 3)),
  ];
}

/**
 * Terms that plausibly name a declaration, and are therefore worth the cost of
 * building an index to look up. Exported so a caller can skip that work
 * entirely when a task names nothing identifier-shaped.
 */
export function symbolTerms(options: TermOptions): readonly string[] {
  return candidates(options);
}

export interface ResolveOptions extends TermOptions {
  readonly index: SymbolIndex;
}

export function resolveWorkingSet(options: ResolveOptions): WorkingSet {
  const symbols: string[] = [];
  // Path to the reasons it is required, so a file pulled in by two symbols is
  // listed once and explains both.
  const reasons = new Map<string, string[]>();

  for (const term of candidates(options)) {
    const declared = definitionsOf(options.index, term);

    // A term the repository never declares names nothing here. It may be a verb
    // ("Rename"), a type from a dependency, or the *new* name in a rename,
    // which by definition does not exist yet.
    if (declared.length === 0) {
      continue;
    }

    symbols.push(term);
    const defining = new Set(declared);

    for (const path of referencesTo(options.index, term)) {
      const reason = defining.has(path)
        ? `declares ${term}`
        : `references ${term}`;
      const existing = reasons.get(path);
      if (existing === undefined) {
        reasons.set(path, [reason]);
      } else {
        existing.push(reason);
      }
    }
  }

  // Declaration sites first, then alphabetical: a stable order the model reads
  // top down, and one a test can assert against.
  const required: RequiredFile[] = [...reasons.entries()]
    .map(([path, why]) => ({ path, reason: why.join(", ") }))
    .sort(
      (a, b) =>
        Number(b.reason.startsWith("declares")) -
          Number(a.reason.startsWith("declares")) ||
        a.path.localeCompare(b.path),
    );

  return { symbols, required };
}
