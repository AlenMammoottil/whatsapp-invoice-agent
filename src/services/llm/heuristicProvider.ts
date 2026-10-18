import { ILLMProvider, ClassificationResponse, ExtractionResponse } from './llmInterface.js';
import {
  ClassificationResultSchema,
  ExtractedInvoiceRequestSchema,
  ExtractedLineItem
} from '../../types/schemas.js';

export class HeuristicProvider implements ILLMProvider {
  name = 'heuristic';
  model = 'rule-based-baseline-v1';

  async classifyIntent(message: string): Promise<ClassificationResponse> {
    const startTime = Date.now();
    const text = message.trim().toLowerCase();

    // 1. Detect questions
    const questionWords = ['what', 'how', 'who', 'where', 'when', 'why', 'can we', 'is there', 'are there', 'do we', 'could you tell'];
    const isQuestion = text.includes('?') || questionWords.some((qw) => text.startsWith(qw) || text.includes(` ${qw} `));

    // 2. Detect invoice requests
    const invoiceKeywords = ['invoice', 'bill', 'charge', 'send bill', 'create invoice', 'generate invoice', 'raise invoice', 'draft bill'];
    const isInvoiceRequest = invoiceKeywords.some((kw) => text.includes(kw));

    let intent: 'INVOICE_REQUEST' | 'QUESTION' | 'GENERAL_CHAT' = 'GENERAL_CHAT';
    let confidence = 0.85;
    let reasoning = 'Classified based on conversation keywords';

    if (isInvoiceRequest && !text.startsWith('how to') && !text.startsWith('what is')) {
      intent = 'INVOICE_REQUEST';
      confidence = 0.95;
      reasoning = 'Message contains explicit invoice creation action verbs';
    } else if (isQuestion) {
      intent = 'QUESTION';
      confidence = 0.9;
      reasoning = 'Message structure represents an inquiry or question';
    } else {
      intent = 'GENERAL_CHAT';
      confidence = 0.8;
      reasoning = 'No invoice action or question patterns detected; conversational chat';
    }

    const latencyMs = Date.now() - startTime;
    const result = ClassificationResultSchema.parse({
      intent,
      confidence,
      reasoning
    });

    return {
      result,
      latencyMs,
      model: this.model,
      provider: this.name
    };
  }

  async extractInvoice(message: string): Promise<ExtractionResponse> {
    const startTime = Date.now();
    const text = message.trim();

    // 1. Extract Customer Name
    // Look for patterns like "for Acme", "bill TechNova", "invoice to GreenLeaf", "to: Charlie Brown"
    let customerName = 'Unknown Customer';
    const customerPatterns = [
      /(?:invoice|bill|charge)\s+(?:to\s+|for\s+)?([A-Za-z0-9\s&]+?)(?:\s+for|\s*:\s*|\s+with|\s*,\s*|\s+due|\s+amount|\s+dated|$)/i,
      /(?:customer|client)\s*[:=]\s*([A-Za-z0-9\s&]+?)(?:,|\n|$)/i,
      /(?:for)\s+([A-Za-z0-9\s&]+?)(?:\s+for|\s*:\s*|\s+with|\s*,\s*|$)/i,
    ];

    for (const pattern of customerPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].trim().length > 1) {
        // Clean customer string from trailing action words
        const cleaned = match[1]
          .replace(/^(to|the|a)\s+/i, '')
          .replace(/\s+(please|kindly|generate|create)$/i, '')
          .trim();
        if (cleaned.length > 1) {
          customerName = cleaned;
          break;
        }
      }
    }

    // 2. Strip greetings, action verbs, and customer clause so we can cleanly parse line items
    let itemText = text;
    itemText = itemText.replace(/^(?:hi|hey|hello|good\s+morning|good\s+afternoon|good\s+evening|please|kindly)\b\s*,?\s*/i, '');
    itemText = itemText.replace(/^(?:create|generate|raise|send|draft|bill|invoice|charge)\s+(?:an?\s+)?(?:invoice|bill)?\s*(?:to|for)?\s*/i, '');
    if (customerName !== 'Unknown Customer') {
      const custEscaped = customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      itemText = itemText.replace(new RegExp(`^(?:to|for)?\\s*${custEscaped}\\s*(?:for|:|with|,)?\\s*`, 'i'), '');
      itemText = itemText.replace(new RegExp(`(?:for|to)?\\s*${custEscaped}\\s*(?:for|:|with|,)?`, 'gi'), ' ');
    }
    itemText = itemText.replace(/^(?:for|with|of)\s+/i, '').trim();

    // 3. Extract Line Items
    // Look for items with quantity and optional rate
    // e.g. "2 hours of web dev", "1 cloud hosting", "3 chairs @ $250", "AMC maintenance"
    const items: ExtractedLineItem[] = [];

    // Split items by commas, "and", or newlines
    const segments = itemText
      .split(/,|\band\b|\n/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const segment of segments) {
      // Regex to match:
      // Group 1: Optional quantity (e.g. "3", "2", "1.5") with optional unit prefix ("hours of", "x", etc.)
      // Group 2: Product/service description (e.g. "chairs", "web dev", "cloud hosting")
      // Group 3: Optional rate (e.g. "@ 250", "at 150", "$50")
      const itemMatch = segment.match(/^(?:(\d+(?:\.\d+)?)\s*(?:x\s+|hours?\s+of\s+|hrs?\s+of\s+|units?\s+of\s+|pcs?\s+of\s+|of\s+)?)?(.+?)(?:\s*(?:@|at|\$)\s*(\d+(?:\.\d+)?))?$/i);

      if (itemMatch && itemMatch[2]) {
        let rawName = itemMatch[2]
          .replace(/^(please|kindly|also|bill|for)\s+/i, '')
          .replace(/(?:for|to)\s+[A-Za-z0-9\s&]+$/i, '')
          .trim();

        // If the item name is empty or matches the customer name, skip
        if (rawName.toLowerCase() === customerName.toLowerCase() || rawName.length < 2) {
          continue;
        }

        const quantity = itemMatch[1] ? parseFloat(itemMatch[1]) : 1;
        const rate = itemMatch[3] ? parseFloat(itemMatch[3]) : undefined;

        items.push({
          raw_item_name: rawName,
          quantity: quantity > 0 ? quantity : 1,
          rate
        });
      }
    }

    // Fallback: If no items found, use fallback from text
    if (items.length === 0) {
      items.push({
        raw_item_name: 'General Consultation / Services',
        quantity: 1
      });
    }

    const latencyMs = Date.now() - startTime;
    const validatedResult = ExtractedInvoiceRequestSchema.parse({
      customer_name: customerName,
      items,
      currency: 'USD',
      notes: `Extracted via heuristic parser from: "${text}"`
    });

    return {
      result: validatedResult,
      latencyMs,
      model: this.model,
      provider: this.name,
      rawResponse: JSON.stringify(validatedResult)
    };
  }
}
