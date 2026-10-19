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
    const invoiceKeywords = [
      'invoice', 'bill', 'charge', 'send bill', 'create invoice', 'generate invoice',
      'raise invoice', 'raise inv', 'draft bill', 'needs', 'make an invoice', 'prepare bill'
    ];

    // Detect format patterns like "VK\nred lenzo alloy..." or "Sharma motors - 17 inch..."
    const isStructuredRequest = /^[A-Za-z0-9\s&]{2,30}\s*[-:]\s*\d+/i.test(text) ||
                                /^[A-Za-z0-9\s&]{2,20}\n[a-z0-9\s"']+/i.test(text);

    const isInvoiceRequest = invoiceKeywords.some((kw) => text.includes(kw)) || isStructuredRequest;

    let intent: 'INVOICE_REQUEST' | 'QUESTION' | 'GENERAL_CHAT' = 'GENERAL_CHAT';
    let confidence = 0.85;
    let reasoning = 'Classified based on conversation keywords';

    if (isInvoiceRequest && !text.startsWith('how to') && !text.startsWith('what is') && !text.startsWith('where is') && !text.startsWith('who is')) {
      intent = 'INVOICE_REQUEST';
      confidence = 0.95;
      reasoning = 'Message contains explicit invoice creation action verbs or structured order lines';
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
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    let customerName = 'Unknown Customer';
    let contentToParse = text;

    // Pattern A: Multiline format where first line is just the customer (e.g. "VK\nred lenzo alloy...")
    if (lines.length >= 2 && lines[0].length <= 35 && !/^(please|invoice|bill|charge|send|create|need)/i.test(lines[0])) {
      customerName = lines[0];
      contentToParse = lines.slice(1).join('\n');
    }
    // Pattern B: Dash separator format (e.g. "Sharma motors - 17\" Lenzo wheel black, 2 pcs @ 4800")
    else if (/^[A-Za-z0-9\s&]{2,35}\s*-\s*.+$/i.test(text) && !/^(please|invoice|bill|charge)/i.test(text)) {
      const parts = text.split(/\s*-\s*/);
      customerName = parts[0].trim();
      contentToParse = parts.slice(1).join(' - ');
    }
    // Pattern C: Natural language clauses
    else {
      const customerPatterns = [
        /(?:raise\s+inv\s+for|raise\s+invoice\s+for|make\s+an\s+invoice\s+for|prepare\s+bill\s+for)\s+([A-Za-z0-9\s&]+?)(?:\s*,\s*|\s+for|\s*\n|$)/i,
        /(?:invoice|bill|charge)\s+(?:to\s+|for\s+)?([A-Za-z0-9\s&]+?)(?:\s+for|\s*:\s*|\s+with|\s*,\s*|\s+due|\s+amount|\s+dated|\s*\n|$)/i,
        /([A-Za-z0-9\s&]{2,30})\s+(?:needs|requires)\s+/i,
        /(?:for)\s+([A-Za-z0-9\s&]+?)(?:\s+for|\s*:\s*|\s+with|\s*,\s*|$)/i,
      ];

      for (const pattern of customerPatterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].trim().length > 1) {
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
    }

    // Clean customer string
    customerName = customerName.replace(/^(please|kindly)\s+/i, '').trim();

    // 2. Prepare remaining text for item extraction
    let itemText = contentToParse;
    itemText = itemText.replace(/^(?:hi|hey|hello|good\s+morning|good\s+afternoon|good\s+evening|please|kindly)\b\s*,?\s*/i, '');
    itemText = itemText.replace(/^(?:create|generate|raise|send|draft|bill|invoice|charge|prepare)\s+(?:an?\s+)?(?:invoice|inv|bill)?\s*(?:to|for)?\s*/i, '');

    if (customerName !== 'Unknown Customer') {
      const custEscaped = customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      itemText = itemText.replace(new RegExp(`^(?:to|for)?\\s*${custEscaped}\\s*(?:for|:|with|,)?\\s*`, 'i'), '');
      itemText = itemText.replace(new RegExp(`(?:for|to)\\s+${custEscaped}\\b`, 'gi'), ' ');
    }
    itemText = itemText.replace(/^(?:for|with|of)\s+/i, '').trim();

    // 3. Extract Global Rate if written as "rate 5200" or "@ 5200"
    let globalRate: number | undefined;
    const rateMatch = itemText.match(/\b(?:rate|price|@)\s*[:=]?\s*(?:rs\.?|inr|\$)?\s*(\d+(?:\.\d+)?)/i);
    if (rateMatch && rateMatch[1]) {
      globalRate = parseFloat(rateMatch[1]);
      itemText = itemText.replace(/\b(?:rate|price|@)\s*[:=]?\s*(?:rs\.?|inr|\$)?\s*(\d+(?:\.\d+)?)/gi, '');
    }

    // Convert word numbers to digits
    const wordNumbers: Record<string, string> = {
      one: '1', two: '2', three: '3', four: '4', five: '5',
      six: '6', seven: '7', eight: '8', nine: '9', ten: '10'
    };
    for (const [w, n] of Object.entries(wordNumbers)) {
      itemText = itemText.replace(new RegExp(`\\b${w}\\b`, 'gi'), n);
    }

    // 4. Extract Line Items
    const items: ExtractedLineItem[] = [];
    const segments = itemText
      .split(/,|\band\b|\n/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.toLowerCase().includes('rate same as last time'));

    for (const segment of segments) {
      // Formats:
      // "red lenzo alloy 18 inch x 4" -> item: "red lenzo alloy 18 inch", qty: 4
      // "4 units of Car Tyre 14-inch" -> item: "Car Tyre 14-inch", qty: 4
      // "8 nos 18 alloy red lenzo"    -> item: "18 alloy red lenzo", qty: 8
      // "2 pcs @ 4800"
      let qty = 1;
      let rawName = segment;
      let lineRate = globalRate;

      // Extract trailing "x 4" or "x4"
      const trailingQty = rawName.match(/\s+x\s*(\d+(?:\.\d+)?)\s*$/i);
      if (trailingQty) {
        qty = parseFloat(trailingQty[1]);
        rawName = rawName.replace(/\s+x\s*(\d+(?:\.\d+)?)\s*$/i, '').trim();
      } else {
        // Extract leading quantity: "4 units of...", "8 nos...", "3 chairs..."
        const leadingQty = rawName.match(/^(\d+(?:\.\d+)?)\s*(?:x\s+|hours?\s+of\s+|hrs?\s+of\s+|units?\s+of\s+|pcs?\s+of\s+|nos?\s+of\s+|nos?\s+|pcs?\s+|of\s+)?(.+)$/i);
        if (leadingQty && leadingQty[1] && leadingQty[2]) {
          qty = parseFloat(leadingQty[1]);
          rawName = leadingQty[2].trim();
        }
      }

      // Check inline rate: "@ 4800" or "at 250"
      const inlineRate = rawName.match(/\s*(?:@|at|\$)\s*(\d+(?:\.\d+)?)\s*$/i);
      if (inlineRate && inlineRate[1]) {
        lineRate = parseFloat(inlineRate[1]);
        rawName = rawName.replace(/\s*(?:@|at|\$)\s*(\d+(?:\.\d+)?)\s*$/i, '').trim();
      }

      // Clean rawName from leftover words
      rawName = rawName
        .replace(/^(please|kindly|also|bill|for)\s+/i, '')
        .replace(/(?:for|to)\s+[A-Za-z0-9\s&]+$/i, '')
        .trim();

      if (rawName.toLowerCase() === customerName.toLowerCase() || rawName.length < 2) {
        continue;
      }

      items.push({
        raw_item_name: rawName,
        quantity: qty > 0 ? qty : 1,
        rate: lineRate,
        unit: undefined
      });
    }

    const latencyMs = Date.now() - startTime;
    const validatedResult = ExtractedInvoiceRequestSchema.parse({
      customer_name: customerName,
      items,
      currency: 'INR',
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
