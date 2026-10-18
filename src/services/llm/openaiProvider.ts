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

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Received empty response from OpenAI');
    }

    return { text: content, latencyMs };
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
