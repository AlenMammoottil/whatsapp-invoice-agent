import { ILLMProvider, ClassificationResponse, ExtractionResponse } from './llmInterface.js';
import { CLASSIFICATION_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT } from './prompts.js';
import {
  ClassificationResultSchema,
  ExtractedInvoiceRequestSchema
} from '../../types/schemas.js';

export class GeminiProvider implements ILLMProvider {
  name = 'gemini';
  model: string;
  private apiKey: string;

  private maxRetries: number;
  private timeoutMs: number;

  constructor(options?: { apiKey?: string; model?: string; maxRetries?: number; timeoutMs?: number }) {
    this.apiKey = options?.apiKey || process.env['GEMINI_API_KEY'] || '';
    this.model = options?.model || process.env['GEMINI_MODEL'] || 'gemini-1.5-flash';
    this.maxRetries = options?.maxRetries ?? (process.env['GEMINI_MAX_RETRIES'] ? parseInt(process.env['GEMINI_MAX_RETRIES'], 10) : 2);
    this.timeoutMs = options?.timeoutMs ?? (process.env['GEMINI_TIMEOUT_MS'] ? parseInt(process.env['GEMINI_TIMEOUT_MS'], 10) : 15000);
  }

  private async callGenerateContent(systemPrompt: string, userMessage: string): Promise<{ text: string; latencyMs: number }> {
    if (!this.apiKey) {
      throw new Error(`Gemini API Key is missing. Please set GEMINI_API_KEY in your .env file.`);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nTask:\n${userMessage}` }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        clearTimeout(timer);
        const isTimeout = fetchErr.name === 'AbortError' || fetchErr.message?.includes('abort');
        const isNetwork = fetchErr.message?.includes('fetch failed') || fetchErr.code === 'ECONNRESET';
        if ((isTimeout || isNetwork) && attempt < this.maxRetries) {
          console.warn(`  ⚠️  Gemini ${isTimeout ? 'timeout' : 'network error'} on attempt ${attempt}/${this.maxRetries} — retrying in 1s...`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw new Error(`Gemini request failed: ${isTimeout ? 'Request timed out after ' + this.timeoutMs + 'ms' : fetchErr.message}`);
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        const latencyMs = Date.now() - startTime;
        const data: any = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) throw new Error('Received empty response from Gemini');
        return { text: content, latencyMs };
      }

      // Retry once on 503 (high demand) or 429 (rate limit) with shorter delay
      if ((response.status === 503 || response.status === 429) && attempt < this.maxRetries) {
        const waitMs = attempt * 1000; // 1s
        console.warn(`  ⚠️  Gemini ${response.status} on attempt ${attempt}/${this.maxRetries} — retrying in ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      const errorText = await response.text();
      const err = new Error(`Gemini API error (${response.status}): ${errorText}`);
      (err as any).status = response.status;
      throw err;
    }

    throw new Error('Gemini: max retries exceeded');
  }


  async classifyIntent(message: string): Promise<ClassificationResponse> {
    const { text, latencyMs } = await this.callGenerateContent(
      CLASSIFICATION_SYSTEM_PROMPT,
      `Classify this WhatsApp message:\n"${message}"`
    );

    const parsedJson = JSON.parse(text);
    const result = ClassificationResultSchema.parse(parsedJson);

    return {
      result,
      latencyMs,
      model: this.model,
      provider: this.name,
    };
  }

  async extractInvoice(message: string): Promise<ExtractionResponse> {
    const { text, latencyMs } = await this.callGenerateContent(
      EXTRACTION_SYSTEM_PROMPT,
      `Extract invoice data from this message:\n"${message}"`
    );

    const parsedJson = JSON.parse(text);
    const result = ExtractedInvoiceRequestSchema.parse(parsedJson);

    return {
      result,
      latencyMs,
      model: this.model,
      provider: this.name,
      rawResponse: text,
    };
  }
}
