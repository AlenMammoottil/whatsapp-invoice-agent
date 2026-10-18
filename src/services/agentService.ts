import crypto from 'crypto';
import { IZohoService } from './zohoInterface.js';
import { ILLMProvider } from './llm/llmInterface.js';
import { LLMFactory } from './llm/llmFactory.js';
import { MatchingService, MatchingResult } from './matchingService.js';
import { Invoice } from '../types/schemas.js';

export interface AgentProcessInput {
  messageText: string;
  senderName?: string;
  senderJid?: string;
  messageId?: string;
  groupId?: string;
  providerName?: string;
}

export interface AgentProcessOutput {
  intent: 'INVOICE_REQUEST' | 'QUESTION' | 'GENERAL_CHAT';
  replyText: string;
  invoice?: Invoice;
  pdfBuffer?: Buffer;
  pdfFilename?: string;
  clarificationNeeded: boolean;
  duplicateDetected: boolean;
  latencyMs: number;
}

export class AgentService {
  private matchingService: MatchingService;

  constructor(private zohoService: IZohoService) {
    this.matchingService = new MatchingService(zohoService);
  }

  /**
   * Generates a stable idempotency reference number from message metadata
   */
  private generateReferenceNumber(input: AgentProcessInput): string {
    const raw = `${input.groupId || 'direct'}_${input.messageId || input.messageText.trim().toLowerCase()}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 12);
    return `WA-${hash.toUpperCase()}`;
  }

  async processIncomingMessage(input: AgentProcessInput): Promise<AgentProcessOutput> {
    const startTime = Date.now();
    const referenceNumber = this.generateReferenceNumber(input);
    const llm: ILLMProvider = input.providerName
      ? LLMFactory.getProvider(input.providerName)
      : LLMFactory.getPrimaryProvider();

    // 1. Check if an invoice has already been issued for this message reference
    const existingInvoice = await this.zohoService.getInvoiceByReference(referenceNumber);
    if (existingInvoice) {
      const pdf = await this.zohoService.getInvoicePdf(existingInvoice.invoice_id);
      return {
        intent: 'INVOICE_REQUEST',
        replyText: `⚠️ *Duplicate Request Prevented*\nAn invoice has already been issued for this request:\n\n*Invoice #:* ${existingInvoice.invoice_number}\n*Customer:* ${existingInvoice.customer_name}\n*Total:* $${existingInvoice.total.toFixed(2)} ${existingInvoice.currency}\n*Status:* ${existingInvoice.status.toUpperCase()}`,
        invoice: existingInvoice,
        pdfBuffer: pdf.buffer,
        pdfFilename: pdf.filename,
        clarificationNeeded: false,
        duplicateDetected: true,
        latencyMs: Date.now() - startTime,
      };
    }

    // 2. Classify intent
    const classification = await llm.classifyIntent(input.messageText);

    // 3. Handle QUESTION intent
    if (classification.result.intent === 'QUESTION') {
      const replyText = `💬 *Assistant Answer:*\nI detected a question regarding invoicing or services. Our standard rates are:\n• Web Development: $150/hr\n• Cloud Hosting Standard: $50/mo\n• Cloud Hosting Premium: $120/mo\n• UI/UX Design: $800/pkg\n• AMC Support: $1200/yr\n\nTo generate an invoice, simply say: *"Please bill [Client] for [Item] x [Quantity]"*`;
      return {
        intent: 'QUESTION',
        replyText,
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // 4. Handle GENERAL_CHAT intent
    if (classification.result.intent === 'GENERAL_CHAT') {
      const replyText = `👋 Hello! I am your *WhatsApp Invoice Agent*. Send me an invoice request anytime (for example: *"Please bill Acme for 2 hours of web development"*), and I'll create and deliver the invoice directly here!`;
      return {
        intent: 'GENERAL_CHAT',
        replyText,
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // 5. Handle INVOICE_REQUEST intent
    const extraction = await llm.extractInvoice(input.messageText);

    // Match against Zoho Records
    const matchResult: MatchingResult = await this.matchingService.matchAndValidate(
      extraction.result,
      referenceNumber
    );

    // If clarification needed
    if (matchResult.needsClarification && matchResult.clarification) {
      let replyText = `❓ *Clarification Needed*\n${matchResult.clarification.question}\n`;
      if (matchResult.clarification.options && matchResult.clarification.options.length > 0) {
        replyText += '\n*Options:*';
        matchResult.clarification.options.forEach((opt, idx) => {
          replyText += `\n${idx + 1}. ${opt}`;
        });
      }

      return {
        intent: 'INVOICE_REQUEST',
        replyText,
        clarificationNeeded: true,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // Create the invoice in Zoho Books
    if (!matchResult.resolvedPayload) {
      throw new Error('Failed to resolve invoice payload');
    }

    const createdInvoice = await this.zohoService.createInvoice(matchResult.resolvedPayload);
    const pdf = await this.zohoService.getInvoicePdf(createdInvoice.invoice_id);

    // Format rich WhatsApp confirmation message
    const lineItemDetails = createdInvoice.line_items
      .map(
        (li, idx) =>
          `  ${idx + 1}. *${li.name}* (x${li.quantity}) @ $${li.rate.toFixed(2)} = $${li.item_total.toFixed(2)}`
      )
      .join('\n');

    const replyText = [
      `✅ *Invoice Created Successfully!*`,
      `📄 *Invoice Number:* ${createdInvoice.invoice_number}`,
      `🏢 *Customer:* ${createdInvoice.customer_name}`,
      `📅 *Date:* ${createdInvoice.date} (Due: ${createdInvoice.due_date})`,
      `🔗 *Reference:* \`${createdInvoice.reference_number}\``,
      ``,
      `*Line Items:*`,
      lineItemDetails,
      ``,
      `*Subtotal:* $${createdInvoice.subtotal.toFixed(2)}`,
      `*Total Due:* *$${createdInvoice.total.toFixed(2)} ${createdInvoice.currency}*`,
      ``,
      `📎 The invoice PDF is attached below for download and record-keeping.`,
    ].join('\n');

    return {
      intent: 'INVOICE_REQUEST',
      replyText,
      invoice: createdInvoice,
      pdfBuffer: pdf.buffer,
      pdfFilename: pdf.filename,
      clarificationNeeded: false,
      duplicateDetected: false,
      latencyMs: Date.now() - startTime,
    };
  }
}
