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

  constructor(options?: { apiKey?: string; model?: string }) {
    this.apiKey = options?.apiKey || process.env['GEMINI_API_KEY'] || '';
    this.model = options?.model || process.env['GEMINI_MODEL'] || 'gemini-1.5-flash';
  }

  private async callGenerateContent(systemPrompt: string, userMessage: string): Promise<{ text: string; latencyMs: number }> {
    if (!this.apiKey) {
      throw new Error(`Gemini API Key is missing. Please set GEMINI_API_KEY in your .env file.`);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const startTime = Date.now();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${systemPrompt}\n\nTask:\n${userMessage}` },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Received empty response from Gemini');
    }

    return { text: content, latencyMs };
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
