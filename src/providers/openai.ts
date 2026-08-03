/**
 * OpenAI compatible provider.
 *
 * One implementation covers OpenAI and every service that speaks the chat
 * completions format at a configurable base URL, including local runtimes.
 * That is the whole point of Charter Principle 1: supporting another endpoint
 * is configuration, not code. `ollama.ts` is the other configuration of the
 * same transport, `chat-completions.ts`; a credential is required here
 * because OpenAI's hosted API rejects an unauthenticated request outright.
 */
import { createChatCompletionsProvider } from "./chat-completions.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o";
const CREDENTIAL_ENV = "OPENAI_API_KEY";

export const openaiProvider = createChatCompletionsProvider({
  id: "openai",
  displayName: "OpenAI compatible",
  credentialEnv: CREDENTIAL_ENV,
  credentialRequired: true,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultModel: DEFAULT_MODEL,
  capabilities: { streaming: true, tools: true, contextTokens: 128_000 },
});
