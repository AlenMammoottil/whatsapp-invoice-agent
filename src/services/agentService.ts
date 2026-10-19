import crypto from 'crypto';
import { IZohoService } from './zohoInterface.js';
import { ILLMProvider } from './llm/llmInterface.js';
import { LLMFactory } from './llm/llmFactory.js';
import { MatchingService, MatchingResult } from './matchingService.js';
import { storageService, StorageService } from './storageService.js';
import { Invoice, PendingApproval } from '../types/schemas.js';

export interface AgentProcessInput {
  messageText: string;
  senderName?: string;
  senderJid?: string;
  messageId?: string;
  groupId?: string;
  providerName?: string;
  autoApprove?: boolean;
}

export interface AgentProcessOutput {
  intent: 'INVOICE_REQUEST' | 'QUESTION' | 'GENERAL_CHAT';
  replyText: string;
  invoice?: Invoice;
  pdfBuffer?: Buffer;
  pdfFilename?: string;
  clarificationNeeded: boolean;
  duplicateDetected: boolean;
  isPendingApproval?: boolean;
  latencyMs: number;
}

export class AgentService {
  private matchingService: MatchingService;
  private storage: StorageService;

  constructor(private zohoService: IZohoService) {
    this.matchingService = new MatchingService(zohoService);
    this.storage = storageService;
  }

  /**
   * Generates a stable idempotency reference number from message metadata
   */
  private generateReferenceNumber(input: AgentProcessInput): string {
    const raw = `${input.groupId || 'direct'}_${input.messageId || input.messageText.trim().toLowerCase()}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 12);
    return `WA-${hash.toUpperCase()}`;
  }

  /**
   * Checks if a message is an approval or cancellation action
   */
  private parseApprovalCommand(text: string): { action: 'confirm' | 'cancel'; ref?: string } | null {
    const trimmed = text.trim().toLowerCase();
    const confirmMatch = trimmed.match(/^(?:confirm|approve|yes|proceed)\b(?:\s+(wa-[a-f0-9]+))?/i);
    if (confirmMatch) {
      return { action: 'confirm', ref: confirmMatch[1]?.toUpperCase() };
    }

    const cancelMatch = trimmed.match(/^(?:cancel|reject|abort|no)\b(?:\s+(wa-[a-f0-9]+))?/i);
    if (cancelMatch) {
      return { action: 'cancel', ref: cancelMatch[1]?.toUpperCase() };
    }

    return null;
  }

  /**
   * Looks up previous invoice for a customer to find their historic item rate ("rate same as last time")
   */
  private async findPreviousRate(customerId: string, itemId: string): Promise<number | null> {
    try {
      const allCustomers = await this.zohoService.getCustomers();
      const customer = allCustomers.find((c) => c.customer_id === customerId);
      if (!customer) return null;

      // Check persisted invoices
      const invoice = this.storage.getInvoiceByReference(customerId);
      if (invoice) {
        const item = invoice.line_items.find((li) => li.item_id === itemId);
        if (item) return item.rate;
      }
    } catch {
      // Ignore lookup failure
    }
    return null;
  }

  async processIncomingMessage(input: AgentProcessInput): Promise<AgentProcessOutput> {
    const startTime = Date.now();
    const referenceNumber = this.generateReferenceNumber(input);
    const groupId = input.groupId || 'direct';
    const text = input.messageText.trim();

    // -------------------------------------------------------------
    // 0. Handle Approval / Cancellation Commands (Preview-Confirm Flow)
    // -------------------------------------------------------------
    const approvalCmd = this.parseApprovalCommand(text);
    if (approvalCmd) {
      const pending = this.storage.findPendingApprovalForSender(
        groupId,
        input.senderJid,
        approvalCmd.ref
      );

      if (!pending) {
        return {
          intent: 'GENERAL_CHAT',
          replyText: `⚠️ *No Pending Approval Found*\nThere is no active pending invoice request awaiting confirmation for this group or reference. It may have expired (15-min timeout) or already been processed.`,
          clarificationNeeded: false,
          duplicateDetected: false,
          latencyMs: Date.now() - startTime,
        };
      }

      if (approvalCmd.action === 'cancel') {
        this.storage.removePendingApproval(pending.approval_id);
        return {
          intent: 'GENERAL_CHAT',
          replyText: `❌ *Invoice Request Cancelled*\nThe pending invoice for *${pending.summary.customer_name}* (Ref: \`${pending.reference_number}\`) has been cancelled. No invoice was created in Zoho Books.`,
          clarificationNeeded: false,
          duplicateDetected: false,
          latencyMs: Date.now() - startTime,
        };
      }

      if (approvalCmd.action === 'confirm') {
        // Execute the confirmed invoice creation in Zoho Books
        const createdInvoice = await this.zohoService.createInvoice(pending.payload);
        this.storage.saveInvoice(createdInvoice);
        this.storage.removePendingApproval(pending.approval_id);

        const pdf = await this.zohoService.getInvoicePdf(createdInvoice.invoice_id);

        const lineItemDetails = createdInvoice.line_items
          .map(
            (li, idx) =>
              `  ${idx + 1}. *${li.name}* (x${li.quantity}) @ ₹${li.rate.toFixed(2)} = ₹${li.item_total.toFixed(2)}`
          )
          .join('\n');

        const replyText = [
          `✅ *Invoice Confirmed & Created in Zoho Books!*`,
          `📄 *Invoice Number:* ${createdInvoice.invoice_number}`,
          `🏢 *Customer:* ${createdInvoice.customer_name}`,
          `📅 *Date:* ${createdInvoice.date} (Due: ${createdInvoice.due_date})`,
          `🔗 *Reference:* \`${createdInvoice.reference_number}\``,
          ``,
          `*Line Items:*`,
          lineItemDetails,
          ``,
          `*Subtotal:* ₹${createdInvoice.subtotal.toFixed(2)}`,
          `*Total Due:* *₹${createdInvoice.total.toFixed(2)} ${createdInvoice.currency}*`,
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

    // -------------------------------------------------------------
    // 1. Check for Duplicate Invoices (Persistent & Zoho State)
    // -------------------------------------------------------------
    let existingInvoice = this.storage.getInvoiceByReference(referenceNumber);
    if (!existingInvoice) {
      existingInvoice = await this.zohoService.getInvoiceByReference(referenceNumber);
      if (existingInvoice) {
        this.storage.saveInvoice(existingInvoice);
      }
    }

    if (existingInvoice) {
      const pdf = await this.zohoService.getInvoicePdf(existingInvoice.invoice_id);
      return {
        intent: 'INVOICE_REQUEST',
        replyText: `⚠️ *Duplicate Request Prevented*\nAn invoice has already been issued for this request:\n\n*Invoice #:* ${existingInvoice.invoice_number}\n*Customer:* ${existingInvoice.customer_name}\n*Total:* ₹${existingInvoice.total.toFixed(2)} ${existingInvoice.currency}\n*Status:* ${existingInvoice.status.toUpperCase()}`,
        invoice: existingInvoice,
        pdfBuffer: pdf.buffer,
        pdfFilename: pdf.filename,
        clarificationNeeded: false,
        duplicateDetected: true,
        latencyMs: Date.now() - startTime,
      };
    }

    // -------------------------------------------------------------
    // 2. Classify Intent via LLM
    // -------------------------------------------------------------
    const llm: ILLMProvider = input.providerName
      ? LLMFactory.getProvider(input.providerName)
      : LLMFactory.getPrimaryProvider();

    const classification = await llm.classifyIntent(input.messageText);

    // -------------------------------------------------------------
    // 3. Handle QUESTION Intent
    // -------------------------------------------------------------
    if (classification.result.intent === 'QUESTION') {
      try {
        const items = await this.zohoService.getItems();

        if (items.length === 0) {
          return {
            intent: 'QUESTION',
            replyText:
              '💡 *Assistant Answer:*\nI could not find any products or services in the Zoho Books catalog. Please check your catalog configuration.',
            clarificationNeeded: false,
            duplicateDetected: false,
            latencyMs: Date.now() - startTime,
          };
        }

        const itemList = items
          .slice(0, 15)
          .map((item, index) =>
            `${index + 1}. *${item.name}* — ₹${item.rate.toFixed(2)} per ${item.unit}`
          )
          .join('\n');

        return {
          intent: 'QUESTION',
          replyText:
            `💡 *Assistant Answer:*\n📦 *Products and Services from Zoho Books*\n\n${itemList}\n\n` +
            'To request an invoice, send: *Please bill [Customer] for [Item] x [Quantity]*',
          clarificationNeeded: false,
          duplicateDetected: false,
          latencyMs: Date.now() - startTime,
        };
      } catch (error) {
        console.error('Failed to fetch Zoho catalog for question:', error);
        return {
          intent: 'QUESTION',
          replyText:
            '💡 *Assistant Answer:*\nSorry, I could not retrieve the product catalog from Zoho Books right now. Please try again later.',
          clarificationNeeded: false,
          duplicateDetected: false,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // -------------------------------------------------------------
    // 4. Handle GENERAL_CHAT Intent
    // -------------------------------------------------------------
    if (classification.result.intent === 'GENERAL_CHAT') {
      const replyText = `👋 Hello! I am your *WhatsApp Invoice Agent*. Send me an invoice request anytime (for example: *"Please bill Acme for 2 hours of web development"* or *"VK red lenzo alloy 18 inch x 4 @ 5200"*), and I will prepare the invoice!`;
      return {
        intent: 'GENERAL_CHAT',
        replyText,
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // -------------------------------------------------------------
    // 5. Handle INVOICE_REQUEST Intent
    // -------------------------------------------------------------
    const extraction = await llm.extractInvoice(input.messageText);

    // Bonus: Check for "rate same as last time"
    if (text.toLowerCase().includes('same as last time')) {
      for (const item of extraction.result.items) {
        if (!item.rate) {
          const prevRate = await this.findPreviousRate(extraction.result.customer_name, item.raw_item_name);
          if (prevRate !== null) {
            item.rate = prevRate;
          }
        }
      }
    }

    // Match against Zoho Records with variant and price safety
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

    if (!matchResult.resolvedPayload || !matchResult.matchedCustomer || !matchResult.matchedItems) {
      throw new Error('Failed to resolve invoice payload');
    }

    // Determine approval mode:
    // When input.autoApprove is explicitly true or AUTO_APPROVE_INVOICES is 'true', AND no price override is present:
    // create immediately.
    // Otherwise, present a rich preview-and-confirm summary requiring confirmation.
    const isAutoApprove =
      (input.autoApprove === true || process.env['AUTO_APPROVE_INVOICES'] === 'true') &&
      !matchResult.hasPriceOverride;

    if (!isAutoApprove) {
      // Calculate summary totals
      let subtotal = 0;
      const previewItems = matchResult.matchedItems.map((item) => {
        const itemTotal = Math.round(item.rate * item.quantity * 100) / 100;
        subtotal += itemTotal;
        return {
          name: item.catalogItem.name,
          quantity: item.quantity,
          rate: item.rate,
          catalog_rate: item.catalogRate,
          rate_source: item.rateSource,
          item_total: itemTotal,
        };
      });

      const taxTotal = 0;
      const grandTotal = subtotal + taxTotal;
      const now = Date.now();
      const expiresAt = now + 15 * 60 * 1000; // 15-minute expiration window

      const pendingApproval: PendingApproval = {
        approval_id: `appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        reference_number: referenceNumber,
        group_id: groupId,
        sender_jid: input.senderJid || 'unknown',
        sender_name: input.senderName || 'Representative',
        payload: matchResult.resolvedPayload,
        summary: {
          customer_name: matchResult.matchedCustomer.company_name,
          items: previewItems,
          subtotal,
          tax_total: taxTotal,
          total: grandTotal,
          currency: 'INR',
          has_price_override: matchResult.hasPriceOverride,
        },
        created_at: now,
        expires_at: expiresAt,
      };

      this.storage.savePendingApproval(pendingApproval);

      // Build rich preview message
      const itemsList = previewItems
        .map((i, idx) => {
          let line = `  ${idx + 1}. *${i.name}* (x${i.quantity}) @ ₹${i.rate.toFixed(2)} = ₹${i.item_total.toFixed(2)}`;
          if (i.rate_source === 'explicit_override') {
            line += `\n     ⚠️ *Price Override:* ₹${i.rate.toFixed(2)} requested (Catalog: ₹${i.catalog_rate.toFixed(2)})`;
          }
          return line;
        })
        .join('\n');

      const warningNotice = matchResult.hasPriceOverride
        ? `\n⚠️ *ATTENTION: Custom Price Override Detected!*\nThe requested rate differs from the authoritative Zoho catalog rate. Explicit confirmation is required.`
        : `\n✅ *Standard Catalog Pricing Verified.*`;

      const previewReply = [
        `📋 *Invoice Preview & Confirmation Required*`,
        `🏢 *Customer:* ${matchResult.matchedCustomer.company_name}`,
        `🔗 *Reference:* \`${referenceNumber}\``,
        ``,
        `*Line Items:*`,
        itemsList,
        ``,
        `*Subtotal:* ₹${subtotal.toFixed(2)}`,
        `*Total Due:* *₹${grandTotal.toFixed(2)}*`,
        warningNotice,
        ``,
        `👉 Reply *CONFIRM* (or *CONFIRM ${referenceNumber}*) to create invoice in Zoho Books.`,
        `👉 Reply *CANCEL* to discard this draft.`,
        `⏰ *Expires in 15 minutes.*`,
      ].join('\n');

      return {
        intent: 'INVOICE_REQUEST',
        replyText: previewReply,
        clarificationNeeded: false,
        duplicateDetected: false,
        isPendingApproval: true,
        latencyMs: Date.now() - startTime,
      };
    }

    // Direct Creation (Auto-Approved)
    const createdInvoice = await this.zohoService.createInvoice(matchResult.resolvedPayload);
    this.storage.saveInvoice(createdInvoice);
    const pdf = await this.zohoService.getInvoicePdf(createdInvoice.invoice_id);

    // Format rich WhatsApp confirmation message
    const lineItemDetails = createdInvoice.line_items
      .map(
        (li, idx) =>
          `  ${idx + 1}. *${li.name}* (x${li.quantity}) @ ₹${li.rate.toFixed(2)} = ₹${li.item_total.toFixed(2)}`
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
      `*Subtotal:* ₹${createdInvoice.subtotal.toFixed(2)}`,
      `*Total Due:* *₹${createdInvoice.total.toFixed(2)} ${createdInvoice.currency}*`,
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
