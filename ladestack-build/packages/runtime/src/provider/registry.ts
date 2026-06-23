import { LLMConfig, Message, CompletionResult, StreamEvent, ProviderHandler } from "./types.js";
import { anthropicCompletion } from "./anthropic.js";
import { openaiCompletion } from "./openai.js";
import { googleCompletion } from "./google.js";

export interface ProviderInfo {
  name: string;
  description: string;
  models: string[];
  isBuiltin: boolean;
}

class ProviderRegistry {
  private handlers = new Map<string, ProviderHandler>();
  private infos = new Map<string, ProviderInfo>();

  registerProvider(name: string, handler: ProviderHandler, info: ProviderInfo): void {
    this.handlers.set(name, handler);
    this.infos.set(name, info);
  }

  getProvider(name: string): ProviderHandler | undefined {
    return this.handlers.get(name);
  }

  listProviders(): ProviderInfo[] {
    return Array.from(this.infos.values());
  }

  hasProvider(name: string): boolean {
    return this.handlers.has(name);
  }

  async executeCompletion(
    providerName: string,
    messages: Message[],
    config: LLMConfig,
    onEvent?: (event: StreamEvent) => void
  ): Promise<CompletionResult> {
    const handler = this.handlers.get(providerName);
    if (!handler) {
      throw new Error(`Unknown provider: ${providerName}. Available providers: ${Array.from(this.handlers.keys()).join(", ")}`);
    }
    return handler.complete(messages, config, onEvent);
  }
}

export const providerRegistry = new ProviderRegistry();

providerRegistry.registerProvider(
  "anthropic",
  {
    complete: (messages, config, onEvent) => anthropicCompletion(messages, config, onEvent),
  },
  {
    name: "anthropic",
    description: "Anthropic Claude models",
    models: [
      "claude-sonnet-4-20250514",
      "claude-sonnet-4",
      "claude-opus-4-20250514",
      "claude-opus-4",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-latest",
      "claude-3-sonnet-latest",
      "claude-3-haiku-latest",
    ],
    isBuiltin: true,
  }
);

providerRegistry.registerProvider(
  "openai",
  {
    complete: (messages, config, onEvent) => openaiCompletion(messages, config, onEvent),
  },
  {
    name: "openai",
    description: "OpenAI GPT models",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-4",
      "gpt-3.5-turbo",
      "o1",
      "o1-mini",
      "o3-mini",
    ],
    isBuiltin: true,
  }
);

providerRegistry.registerProvider(
  "google",
  {
    complete: (messages, config, onEvent) => googleCompletion(messages, config, onEvent),
  },
  {
    name: "google",
    description: "Google Gemini models",
    models: [
      "gemini-2.5-pro-exp-03-25",
      "gemini-2.5-flash-preview-04-17",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
    ],
    isBuiltin: true,
  }
);

export { ProviderRegistry };
