import { ILLMProvider, ClassificationResponse, ExtractionResponse } from './llmInterface.js';

export interface FallbackProviderOptions {
  primary: ILLMProvider;
  secondary?: ILLMProvider;
  /**
   * Optional custom transient error detector.
   * If not provided, defaults to checking for 503, 429, timeouts, network errors, etc.
   */
  isTransientError?: (error: any) => boolean;
}

/**
 * Checks if an error is transient (e.g. 503 high demand, 429 rate limit, network timeout)
 * and should trigger fallback to the secondary provider.
 */
export function isTransientLLMError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || String(error)).toLowerCase();
  const status = error.status || error.statusCode || error.response?.status;

  // HTTP status codes: 503 (service unavailable / high demand), 429 (rate limit),
  // 502 (bad gateway), 504 (gateway timeout), 500 (internal server error)
  if (status === 503 || status === 429 || status === 502 || status === 504 || status === 500) {
    return true;
  }

  // Common transient error messages from Gemini, Groq, OpenAI, and fetch
  const transientPatterns = [
    '503',
    '429',
    'high demand',
    'overloaded',
    'rate limit',
    'quota',
    'resource exhausted',
    'temporarily unavailable',
    'service unavailable',
    'timeout',
    'timed out',
    'econnreset',
    'etimedout',
    'enotfound',
    'econnrefused',
    'fetch failed',
    'network error',
    'max retries exceeded',
  ];

  return transientPatterns.some((pattern) => msg.includes(pattern));
}

/**
 * FallbackProvider implements ILLMProvider with automatic failover
 * from a primary LLM (e.g. Gemini) to a secondary LLM (e.g. Groq)
 * when transient errors (503, 429, timeout, network failure) occur.
 */
export class FallbackProvider implements ILLMProvider {
  name: string;
  model: string;
  primary: ILLMProvider;
  secondary?: ILLMProvider;
  private isTransient: (error: any) => boolean;

  constructor(options: FallbackProviderOptions) {
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.isTransient = options.isTransientError || isTransientLLMError;
    this.name = this.secondary ? `${this.primary.name}+${this.secondary.name}` : this.primary.name;
    this.model = this.primary.model;
  }

  async classifyIntent(message: string): Promise<ClassificationResponse> {
    try {
      return await this.primary.classifyIntent(message);
    } catch (primaryError: any) {
      if (this.secondary && this.isTransient(primaryError)) {
        console.warn(
          `⚠️ [LLM Fallback] Primary provider "${this.primary.name}" encountered transient error (${primaryError.message}). Falling back to "${this.secondary.name}"...`
        );
        try {
          const res = await this.secondary.classifyIntent(message);
          return {
            ...res,
            provider: `${res.provider} (fallback from ${this.primary.name})`,
          };
        } catch (secondaryError: any) {
          console.error(
            `❌ [LLM Fallback] Secondary provider "${this.secondary.name}" also failed: ${secondaryError.message}`
          );
          throw new Error(
            `All LLM providers failed. Primary (${this.primary.name}): ${primaryError.message}; Secondary (${this.secondary.name}): ${secondaryError.message}`
          );
        }
      }
      throw primaryError;
    }
  }

  async extractInvoice(message: string): Promise<ExtractionResponse> {
    try {
      return await this.primary.extractInvoice(message);
    } catch (primaryError: any) {
      if (this.secondary && this.isTransient(primaryError)) {
        console.warn(
          `⚠️ [LLM Fallback] Primary provider "${this.primary.name}" encountered transient error (${primaryError.message}). Falling back to "${this.secondary.name}"...`
        );
        try {
          const res = await this.secondary.extractInvoice(message);
          return {
            ...res,
            provider: `${res.provider} (fallback from ${this.primary.name})`,
          };
        } catch (secondaryError: any) {
          console.error(
            `❌ [LLM Fallback] Secondary provider "${this.secondary.name}" also failed: ${secondaryError.message}`
          );
          throw new Error(
            `All LLM providers failed. Primary (${this.primary.name}): ${primaryError.message}; Secondary (${this.secondary.name}): ${secondaryError.message}`
          );
        }
      }
      throw primaryError;
    }
  }
}
