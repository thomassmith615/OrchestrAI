/**
 * Provider invocation with packed context.
 *
 * One place where scanning, ranking, prompt rendering, and the provider call
 * come together, so that every command that talks to a model does it the same
 * way and records the same metadata.
 */
import {
  EMPTY_WORKING_SET,
  packContext,
  rankingTerms,
  recentlyChanged,
  resolveWorkingSet,
  symbolTerms,
} from "../context/index.js";
import {
  buildSymbolIndex,
  detectToolchain,
  scanRepository,
} from "../repo/index.js";
import {
  createProvider,
  estimateCost,
  findProvider,
  isRetryable,
  withRetry,
} from "../providers/index.js";
import { defaultRetriever, readMemory, recordUsage } from "../memory/index.js";
import { findPrompt, promptRef, renderPrompt } from "../prompts/index.js";
import { requireConfig, requireWorkspace } from "./command.js";
import type {
  ContextNote,
  PackedContext,
  TermOptions,
  WorkingSet,
} from "../context/index.js";
import type { Toolchain } from "../repo/index.js";
import type { CompletionResult } from "../providers/index.js";
import type { CommandContext } from "./command.js";
import type { AiCall, AiPort, AiReply } from "../workflow/index.js";

export interface AiRequest {
  /** Prompt id from the registry, rendered with `context` plus any extras. */
  readonly promptId: string;
  readonly variables?: Readonly<Record<string, string>>;
  readonly focus?: readonly string[];
  readonly maxTokens?: number;
}

export interface AiOutcome {
  readonly result: CompletionResult;
  readonly packed: PackedContext;
  /** Files the task was resolved to require, and the symbols that named them. */
  readonly workingSet: WorkingSet;
  /** Ids of the memory records recalled into the context. */
  readonly recalled: readonly string[];
  readonly retries: number;
  /** True when the primary provider failed and the fallback answered. */
  readonly fellBack: boolean;
  /** Null when the model has no known rate. */
  readonly costUsd: number | null;
  /** e.g. `review@1`, recorded so a run can name what produced it. */
  readonly promptRef: string;
  readonly systemRef: string;
}

export const DEFAULT_MAX_TOKENS = 8000;

/**
 * Adapter from the engine to the workflow's `AiPort`. The workflow declares
 * what it needs from a model; this supplies it without the workflow ever
 * seeing a provider or a command context.
 */
export function aiPort(
  context: CommandContext,
  defaults: { readonly maxTokens?: number } = {},
): AiPort {
  return async (call: AiCall): Promise<AiReply> => {
    const outcome = await completeWithContext(context, {
      promptId: call.promptId,
      ...(call.variables === undefined ? {} : { variables: call.variables }),
      ...(call.focus === undefined ? {} : { focus: call.focus }),
      ...(call.maxTokens ?? defaults.maxTokens
        ? { maxTokens: call.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS }
        : {}),
    });

    return {
      text: outcome.result.text,
      provider: outcome.result.provider,
      model: outcome.result.model,
      promptRef: outcome.promptRef,
      contextTokens: outcome.packed.tokens,
      usage: outcome.result.usage,
    };
  };
}

export interface AssemblyRequest {
  /** The task or objective as the user phrased it. */
  readonly task?: string;
  /** Terms the user named explicitly. Absent means "derive them from the task". */
  readonly focus?: readonly string[];
  readonly notes?: readonly ContextNote[];
}

export interface Assembly {
  readonly packed: PackedContext;
  readonly workingSet: WorkingSet;
  /** The ranking terms actually used, derived or explicit. */
  readonly focus: readonly string[];
  readonly toolchain: Toolchain;
}

/**
 * How much context this call may use.
 *
 * A configured budget is an instruction and is obeyed. An unconfigured one is
 * just the built in default, and the provider's own declared window is a better
 * number than a constant — packing 75,000 tokens for a local model that accepts
 * 8,000 fails at the API boundary when it could have been decided here. The
 * window is only trusted when the default model is in use, because a configured
 * model has a window the descriptor knows nothing about.
 */
function resolveBudget(
  config: ReturnType<typeof requireConfig>,
  logger: CommandContext["logger"],
): number {
  const configured = config.values.contextBudget;

  if (config.sources.contextBudget !== "default" || config.values.model !== null) {
    return configured;
  }

  const window = findProvider(config.values.provider)?.capabilities.contextTokens;

  if (window === undefined || window >= configured) {
    return configured;
  }

  logger.debug(
    `context budget reduced to ${String(window)} for ${config.values.provider}`,
  );
  return window;
}

/**
 * Scan, resolve, and pack, in that order.
 *
 * Resolution is the step that makes this more than a ranking function: before
 * anything is packed, the task is turned into the set of files it demonstrably
 * requires, and those are packed first and never dropped.
 */
export function assembleContext(
  context: CommandContext,
  request: AssemblyRequest,
): Assembly {
  const workspace = requireWorkspace(context);
  const config = requireConfig(context);

  const scan = scanRepository({
    root: workspace.root,
    fs: context.hosts.fs,
    ignore: config.values.ignore,
  });
  const toolchain = detectToolchain(context.hosts.fs, workspace.root);

  const terms: TermOptions = {
    ...(request.task === undefined ? {} : { task: request.task }),
    ...(request.focus === undefined ? {} : { focus: request.focus }),
  };

  // Indexing reads every file, so it is skipped entirely when the task names
  // nothing identifier shaped. `orch review` and friends pay nothing for this.
  const symbols = symbolTerms(terms);
  const workingSet =
    symbols.length === 0
      ? EMPTY_WORKING_SET
      : resolveWorkingSet({
          ...terms,
          index: buildSymbolIndex({
            root: workspace.root,
            fs: context.hosts.fs,
            files: scan.files,
          }),
        });

  const focus = rankingTerms(terms);

  const packed = packContext({
    root: workspace.root,
    fs: context.hosts.fs,
    scan,
    toolchain,
    budget: resolveBudget(config, context.logger),
    focus,
    required: workingSet.required,
    recent: recentlyChanged(context.hosts.proc, workspace.root),
    ...(request.notes === undefined ? {} : { notes: request.notes }),
  });

  return { packed, workingSet, focus, toolchain };
}

export async function completeWithContext(
  context: CommandContext,
  request: AiRequest,
): Promise<AiOutcome> {
  const workspace = requireWorkspace(context);
  const config = requireConfig(context);

  const task = [
    request.variables?.["task"] ?? "",
    request.variables?.["objective"] ?? "",
  ]
    .join(" ")
    .trim();

  // Recall runs before packing so that what memory contributes is budgeted
  // alongside the files rather than appended after the fact.
  const query = [task, ...(request.focus ?? [])].join(" ").trim();

  const recalled =
    query.length === 0
      ? []
      : defaultRetriever.search(
          query,
          readMemory(context.hosts.fs, workspace.stateDir).records,
          { limit: 5, now: context.hosts.clock.now() },
        );

  const { packed, workingSet, toolchain } = assembleContext(context, {
    task,
    ...(request.focus === undefined ? {} : { focus: request.focus }),
    notes: recalled.map((entry) => ({
      title: `${entry.record.kind}: ${entry.record.title}`,
      body: entry.record.body,
    })),
  });

  const system = renderPrompt("system", {
    repository: workspace.root,
    ecosystem: toolchain.ecosystem,
  });

  const user = renderPrompt(request.promptId, {
    context: packed.text,
    ...request.variables,
  });

  const completion = {
    system,
    messages: [{ role: "user" as const, content: user }],
    maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  const providerOptions = {
    env: context.hosts.env,
    http: context.hosts.http,
    model: config.values.model,
    baseUrl: config.values.baseUrl,
    timeoutMs: config.values.requestTimeout * 1000,
  };

  context.logger.debug(
    `${config.values.provider}: ${String(packed.tokens)} context tokens, prompt ${request.promptId}`,
  );

  let retries = 0;
  let fellBack = false;

  const call = async (id: string): Promise<CompletionResult> =>
    withRetry(
      () => createProvider(id, providerOptions).complete(completion),
      {
        policy: {
          maxRetries: config.values.maxRetries,
          baseDelayMs: 500,
          maxDelayMs: 30_000,
        },
        onRetry: (attempt) => {
          retries += 1;
          context.logger.warn(
            `${id} ${attempt.error.kind}, retry ${String(attempt.attempt)} in ${String(attempt.delayMs)}ms`,
          );
        },
      },
    );

  let result: CompletionResult;

  try {
    result = await call(config.values.provider);
  } catch (error: unknown) {
    const fallback = config.values.fallbackProvider;

    // Failover only for failures a different provider could plausibly survive.
    // A malformed request will fail identically everywhere.
    if (fallback === null || fallback === config.values.provider || !isRetryable(error)) {
      throw error;
    }

    context.logger.warn(
      `${config.values.provider} unavailable, falling back to ${fallback}`,
    );
    fellBack = true;
    result = await call(fallback);
  }

  const costUsd = estimateCost(result.model, result.usage);

  const prompt = findPrompt(request.promptId);
  const systemPrompt = findPrompt("system");
  const reference = prompt === undefined ? request.promptId : promptRef(prompt);

  // Every call is ledgered, including ones that failed over or retried, so the
  // record reflects what was actually spent rather than what was intended.
  recordUsage(context.hosts.fs, workspace.stateDir, {
    at: context.hosts.clock.now(),
    provider: result.provider,
    model: result.model,
    promptRef: reference,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd,
    retries,
    fellBack,
  });

  return {
    result,
    packed,
    workingSet,
    recalled: recalled.map((entry) => entry.record.id),
    retries,
    fellBack,
    costUsd,
    promptRef: reference,
    systemRef: systemPrompt === undefined ? "system" : promptRef(systemPrompt),
  };
}
