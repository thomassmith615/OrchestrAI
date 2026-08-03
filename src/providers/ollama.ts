/**
 * Ollama provider: a local runtime, reached through the same chat
 * completions transport `openai.ts` uses.
 *
 * The default provider (`DEFAULT_CONFIG.provider` in
 * `src/core/config/schema.ts`) so that a fresh install works with no
 * credential, no network dependency beyond localhost, and no cost, before a
 * frontier model is ever chosen. `orch provider add anthropic` (or
 * `openai`) opts back into a hosted model explicitly. See ADR 0022.
 *
 * No credential is required: Ollama's OpenAI-compatible endpoint answers an
 * unauthenticated request by default. `OLLAMA_API_KEY`, if set, is still
 * sent as a bearer token, for the less common case of a remote or
 * authenticated Ollama-compatible gateway.
 */
import { createChatCompletionsProvider } from "./chat-completions.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
/** A broadly available, commonly pulled model. Requires `ollama pull
 *  llama3.1` (or an equivalent) before first use; `--model` overrides it. */
const DEFAULT_MODEL = "llama3.1";
const CREDENTIAL_ENV = "OLLAMA_API_KEY";

export const ollamaProvider = createChatCompletionsProvider({
  id: "ollama",
  displayName: "Ollama (local)",
  credentialEnv: CREDENTIAL_ENV,
  credentialRequired: false,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultModel: DEFAULT_MODEL,
  capabilities: {
    streaming: true,
    tools: false,
    // Conservative and approximate: the real window depends on which model
    // was pulled and its configured `num_ctx`, not on anything Orchestraᵢ
    // can detect. Lower `contextBudget` (`orch config --set
    // contextBudget=...`) if your model's actual window is smaller.
    contextTokens: 8_000,
  },
});
