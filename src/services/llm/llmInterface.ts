import { ClassificationResult, ExtractedInvoiceRequest } from '../../types/schemas.js';

export interface ClassificationResponse {
  result: ClassificationResult;
  latencyMs: number;
  model: string;
  provider: string;
}

export interface ExtractionResponse {
  result: ExtractedInvoiceRequest;
  latencyMs: number;
  model: string;
  provider: string;
  rawResponse?: string;
}

export interface ILLMProvider {
  name: string;
  model: string;

  /**
   * Classify whether a WhatsApp message is an INVOICE_REQUEST, QUESTION, or GENERAL_CHAT
   */
  classifyIntent(message: string): Promise<ClassificationResponse>;

  /**
   * Extract customer name, product descriptions, quantities, and rates from informal text
   */
  extractInvoice(message: string): Promise<ExtractionResponse>;
}
