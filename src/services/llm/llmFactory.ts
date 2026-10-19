import { ILLMProvider } from './llmInterface.js';
import { HeuristicProvider } from './heuristicProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import { GeminiProvider } from './geminiProvider.js';
import { FallbackProvider } from './fallbackProvider.js';

export class LLMFactory {
  /**
   * Instantiates a single standalone provider by name.
   */
  static getProvider(providerName?: string): ILLMProvider {
    const requested = (providerName || process.env['PRIMARY_LLM_PROVIDER'] || 'heuristic').toLowerCase();

    switch (requested) {
      case 'openai':
      case 'groq':
        return new OpenAIProvider();

      case 'gemini':
      case 'google':
        return new GeminiProvider();

      case 'heuristic':
      case 'mock':
      default:
        return new HeuristicProvider();
    }
  }

  /**
   * Returns the primary LLM provider without fallback wrapper.
   */
  static getBasePrimaryProvider(): ILLMProvider {
    if (process.env['PRIMARY_LLM_PROVIDER']) {
      return this.getProvider(process.env['PRIMARY_LLM_PROVIDER']);
    }
    if (process.env['GEMINI_API_KEY']) {
      return new GeminiProvider();
    }
    if (process.env['OPENAI_API_KEY'] || process.env['GROQ_API_KEY']) {
      return new OpenAIProvider();
    }
    return new HeuristicProvider();
  }

  /**
   * Returns the secondary/fallback LLM provider if configured.
   */
  static getSecondaryProvider(): ILLMProvider {
    if (process.env['SECONDARY_LLM_PROVIDER']) {
      return this.getProvider(process.env['SECONDARY_LLM_PROVIDER']);
    }
    // If primary is Gemini and OpenAI/Groq key is available, use OpenAIProvider as secondary
    if (process.env['OPENAI_API_KEY'] || process.env['GROQ_API_KEY']) {
      return new OpenAIProvider();
    }
    return new HeuristicProvider();
  }

  /**
   * Returns the operational provider for the agent.
   * If both a primary and secondary provider are available (e.g. Gemini + Groq),
   * returns a FallbackProvider that automatically fails over on transient errors (503, 429, timeouts).
   */
  static getPrimaryProvider(): ILLMProvider {
    const primary = this.getBasePrimaryProvider();

    // If DISABLE_LLM_FALLBACK is true, return primary directly
    if (process.env['DISABLE_LLM_FALLBACK'] === 'true') {
      return primary;
    }

    const secondary = this.getSecondaryProvider();

    // Do not wrap if primary and secondary are the same provider type or if primary is heuristic
    if (primary.name === secondary.name || primary.name === 'heuristic') {
      return primary;
    }

    return new FallbackProvider({
      primary,
      secondary,
    });
  }

  /**
   * Creates a FallbackProvider with explicit primary and secondary providers.
   * Useful for testing and custom composition.
   */
  static createWithFallback(primary: ILLMProvider, secondary?: ILLMProvider): ILLMProvider {
    if (!secondary) return primary;
    return new FallbackProvider({ primary, secondary });
  }
}
