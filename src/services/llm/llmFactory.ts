import { ILLMProvider } from './llmInterface.js';
import { HeuristicProvider } from './heuristicProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import { GeminiProvider } from './geminiProvider.js';

export class LLMFactory {
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

  static getPrimaryProvider(): ILLMProvider {
    // If Gemini key is set, prefer Gemini; if OpenAI key is set, prefer OpenAI; otherwise Heuristic
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

  static getSecondaryProvider(): ILLMProvider {
    if (process.env['SECONDARY_LLM_PROVIDER']) {
      return this.getProvider(process.env['SECONDARY_LLM_PROVIDER']);
    }
    // If primary is Gemini and OpenAI key is available, use OpenAI; otherwise fallback to Heuristic
    if (process.env['OPENAI_API_KEY'] || process.env['GROQ_API_KEY']) {
      return new OpenAIProvider();
    }
    return new HeuristicProvider();
  }
}
