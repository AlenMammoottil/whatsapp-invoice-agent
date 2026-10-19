import { ILLMProvider, ClassificationResponse, ExtractionResponse } from './llmInterface.js';
import { CLASSIFICATION_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT } from './prompts.js';
import {
  ClassificationResultSchema,
  ExtractedInvoiceRequestSchema
} from '../../types/schemas.js';

export class OpenAIProvider implements ILLMProvider {
  name = 'openai';
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(options?: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = options?.apiKey || process.env['OPENAI_API_KEY'] || process.env['GROQ_API_KEY'] || '';
    this.model = options?.model || process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
    this.baseUrl = options?.baseUrl || process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1';
  }

  private async callChatCompletion(systemPrompt: string, userMessage: string): Promise<{ text: string; latencyMs: number }> {
    if (!this.apiKey) {
      throw new Error(`OpenAI API Key is missing. Please set OPENAI_API_KEY in your .env file.`);
    }

    const startTime = Date.now();
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1, // low temperature for deterministic, consistent extraction
        }),
      });

      if (response.ok) {
        const latencyMs = Date.now() - startTime;
        const data: any = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('Received empty response from OpenAI');
        }
        return { text: content, latencyMs };
      }

      // Retry on 429 (rate limit) or 503 (service unavailable)
      if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
        const errorText = await response.text();
        // Parse "try again in X ms/s" if provided by Groq
        const delayMatch = errorText.match(/try again in ([\d\.]+)(m?s)/i);
        let waitMs = Math.pow(2, attempt) * 1500;
        if (delayMatch) {
          const val = parseFloat(delayMatch[1]);
          const unit = delayMatch[2].toLowerCase();
          waitMs = Math.ceil(unit === 'ms' ? val : val * 1000) + 500; // add 500ms safety buffer
        }
        console.warn(`  ⚠️  Groq/OpenAI ${response.status} on attempt ${attempt}/${maxRetries} — retrying in ${(waitMs / 1000).toFixed(1)}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    throw new Error('OpenAI/Groq: max retries exceeded');
  }

  async classifyIntent(message: string): Promise<ClassificationResponse> {
    const { text, latencyMs } = await this.callChatCompletion(
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
    const { text, latencyMs } = await this.callChatCompletion(
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
