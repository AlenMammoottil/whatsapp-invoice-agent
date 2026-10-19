import crypto from 'crypto';
import { IZohoService } from './zohoInterface.js';
import { ILLMProvider } from './llm/llmInterface.js';
import { LLMFactory } from './llm/llmFactory.js';
import { MatchingService, MatchingResult } from './matchingService.js';
import { StorageService, storageService } from './storageService.js';
import { Invoice, PendingApproval, PendingClarification } from '../types/schemas.js';

export interface AgentProcessInput {
  messageText: string;
  senderName?: string;
  senderJid?: string;
  messageId?: string;
  groupId?: string;
  providerName?: string;
  autoApprove?: boolean;
  /** If true, use the injected StorageService instead of the singleton (for tests) */
  _storage?: StorageService;
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

// ---------------------------------------------------------------------------
// Helper: format currency amounts using the Zoho-configured currency symbol.
// The project targets INR. If currency is ever different, swap the symbol.
// ---------------------------------------------------------------------------
function formatAmount(amount: number, currency: string | null | undefined): string {
  const symbol = (currency || 'INR').toUpperCase() === 'USD' ? '$' : '₹';
  return `${symbol}${amount.toFixed(2)}`;
}

export class AgentService {
  private matchingService: MatchingService;
  private storage: StorageService;

  constructor(private zohoService: IZohoService, storage?: StorageService) {
    this.matchingService = new MatchingService(zohoService);
    this.storage = storage || storageService;
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

  /**
   * Parse a clarification reply: numeric option selection or natural-text match.
   * Returns the zero-based option index, or -1 if nothing matched.
   */
  private parseClarificationReply(
    replyText: string,
    options: string[]
  ): number {
    const trimmed = replyText.trim();

    // 1. Numeric reply: "2" selects option index 1
    const numMatch = trimmed.match(/^(\d+)$/);
    if (numMatch) {
      const n = parseInt(numMatch[1]!, 10);
      if (n >= 1 && n <= options.length) return n - 1;
    }

    // 2. Exact match against option string (case-insensitive)
    const lowerReply = trimmed.toLowerCase();
    const exactIdx = options.findIndex((o) => o.toLowerCase() === lowerReply);
    if (exactIdx !== -1) return exactIdx;

    // 3. Prefix / contains match: "Metro Wheels" matches "Metro Wheels (₹...)"
    const containsIdx = options.findIndex((o) => o.toLowerCase().startsWith(lowerReply) || o.toLowerCase().includes(lowerReply));
    if (containsIdx !== -1) return containsIdx;

    // 4. The reply itself might be just the product/customer name without price
    //    e.g. "Car Tyre 13-inch" when option is "Car Tyre 13-inch (₹2500.00/qty)"
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      // Strip parenthetical part
      const baseName = opt.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
      if (baseName === lowerReply || baseName.startsWith(lowerReply)) {
        return i;
      }
    }

    return -1; // No match found
  }

  /**
   * Core method: handle a clarification reply by resuming the original invoice request.
   * Returns the AgentProcessOutput if the clarification was handled, or null if the
   * message was not a valid clarification response.
   */
  private async handleClarificationReply(
    input: AgentProcessInput,
    pending: PendingClarification,
    startTime: number
  ): Promise<AgentProcessOutput | null> {
    const text = input.messageText.trim();
    const groupId = input.groupId || 'direct';
    const senderJid = input.senderJid || '';

    // Check if user wants to cancel
    if (/^(cancel|abort|nevermind|stop|cancel that)$/i.test(text)) {
      this.storage.removePendingClarification(pending.clarification_id);
      return {
        intent: 'GENERAL_CHAT',
        replyText: `❌ *Request Cancelled*\nYour invoice request has been discarded. Send a new message to start again.`,
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }

    const selectedIdx = this.parseClarificationReply(text, pending.options);

    if (selectedIdx === -1) {
      // Could not match the reply to any option
      let optionList = pending.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
      return {
        intent: 'INVOICE_REQUEST',
        replyText: [
          `❓ *I didn't understand that reply.*`,
          `Please choose one of the following options by number or name:\n`,
          optionList,
          `\nOr reply *CANCEL* to discard this request.`,
        ].join('\n'),
        clarificationNeeded: true,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // Remove the clarification — we have an answer
    this.storage.removePendingClarification(pending.clarification_id);

    // ---- Apply the selected option to partialExtraction ----
    const extraction = pending.partialExtraction;
    const selectedOption = pending.options[selectedIdx]!;

    switch (pending.kind) {
      case 'AMBIGUOUS_CUSTOMER':
      case 'MISSING_CUSTOMER': {
        // Strip price/parenthetical suffix to get clean name
        const resolvedName = selectedOption.replace(/\s*\(.*\)\s*$/, '').trim();
        extraction.customer_name = resolvedName;
        break;
      }

      case 'AMBIGUOUS_ITEM':
      case 'MISSING_ITEM': {
        const itemIdx = pending.item_index ?? 0;
        const item = extraction.items[itemIdx];
        if (item) {
          // Extract clean item name (strip price suffix like "(₹2500.00/qty)")
          const resolvedName = selectedOption.replace(/\s*\(.*\)\s*$/, '').trim();
          item.raw_item_name = resolvedName;
        }
        break;
      }

      case 'MISSING_QUANTITY': {
        // User replied with a quantity — try to parse it
        const qtyMatch = text.match(/(\d+(?:\.\d+)?)/);
        const qty = qtyMatch ? parseFloat(qtyMatch[1]!) : null;
        if (!qty || qty <= 0) {
          // Still couldn't parse quantity — re-ask
          const itemName = extraction.items[pending.item_index ?? 0]?.raw_item_name || 'item';
          return {
            intent: 'INVOICE_REQUEST',
            replyText: `❓ *Quantity needed*\nHow many units of "${itemName}" should I invoice?\nPlease reply with just a number (e.g. "2" or "5").`,
            clarificationNeeded: true,
            duplicateDetected: false,
            latencyMs: Date.now() - startTime,
          };
        }
        const itemIdx = pending.item_index ?? 0;
        const item = extraction.items[itemIdx];
        if (item) {
          item.quantity = qty;
        }
        break;
      }
    }

    // Now re-run matchAndValidate with the resolved extraction.
    // Convert partialExtraction back to ExtractedInvoiceRequest shape.
    const rehydratedExtraction = {
      customer_name: extraction.customer_name,
      items: extraction.items.map((it) => ({
        raw_item_name: it.raw_item_name,
        quantity: it.quantity,
        rate: it.rate ?? undefined,
        unit: undefined,
      })),
      currency: null,
      notes: extraction.notes ?? undefined,
      due_date: undefined,
    };

    const matchResult: MatchingResult = await this.matchingService.matchAndValidate(
      rehydratedExtraction,
      pending.original_reference_number
    );

    if (matchResult.needsClarification && matchResult.clarification) {
      // Another clarification round is needed — store new pending state
      const reason = matchResult.clarification.reason;
      const kind: PendingClarification['kind'] =
        reason === 'AMBIGUOUS_ITEM' ? 'AMBIGUOUS_ITEM' :
        reason === 'MISSING_ITEMS' ? 'MISSING_ITEM' :
        reason === 'AMBIGUOUS_CUSTOMER' ? 'AMBIGUOUS_CUSTOMER' :
        reason === 'MISSING_CUSTOMER' ? 'MISSING_CUSTOMER' :
        reason === 'MISSING_QUANTITY' ? 'MISSING_QUANTITY' : 'MISSING_ITEM';

      const newClarification: PendingClarification = {
        clarification_id: `clar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        group_id: groupId,
        sender_jid: senderJid,
        original_reference_number: pending.original_reference_number,
        kind,
        options: matchResult.clarification.options || [],
        item_index: pending.item_index, // carry forward
        partialExtraction: {
          customer_name: extraction.customer_name,
          resolved_customer_id: extraction.resolved_customer_id,
          items: extraction.items,
          notes: extraction.notes,
        },
        created_at: Date.now(),
        expires_at: Date.now() + 10 * 60 * 1000,
      };
      this.storage.savePendingClarification(newClarification);

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
      return {
        intent: 'INVOICE_REQUEST',
        replyText: `⚠️ *Unable to resolve invoice*\nSomething went wrong while processing your request. Please try again with a new message.`,
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // Build invoice preview (same logic as main flow)
    return this.buildPreviewResponse(input, matchResult, pending.original_reference_number, startTime);
  }

  /**
   * Handle a QUESTION message. Detects product price questions and returns
   * the specific catalog price instead of dumping the full product list.
   */
  private async handleQuestion(input: AgentProcessInput, startTime: number): Promise<AgentProcessOutput> {
    const text = input.messageText.trim();

    // Detect price questions: "how much does X cost?", "what is the price of X?", "price of X?"
    const priceQuestion = text.match(
      /(?:how\s+much\s+(?:does|is|for|do)\s+|price\s+of\s+|cost\s+of\s+|rate\s+(?:for|of)\s+|what\s+(?:is|are)\s+(?:the\s+)?(?:price|rate|cost)\s+(?:of\s+|for\s+)?)(.{3,})/i
    );

    if (priceQuestion && priceQuestion[1]) {
      const productQuery = priceQuestion[1].replace(/[?.]$/, '').trim();
      return this.handleProductPriceQuestion(productQuery, text, startTime);
    }

    // Generic product list question — but still try to match a product name first
    const genericProductPattern = text.match(/\b(?:price|cost|rate)\b/i);
    if (genericProductPattern) {
      // Try to find the product name after removing common question words
      const cleaned = text
        .replace(/(?:how\s+much|what\s+is|what\s+are|can\s+you\s+tell\s+me|please\s+tell\s+me)[^a-z0-9]*(?:the\s+)?/gi, '')
        .replace(/(?:price|cost|rate|of|for|is|the|each|a|an)\s*/gi, ' ')
        .replace(/[?.,!]/g, '')
        .trim();

      if (cleaned.length > 2) {
        return this.handleProductPriceQuestion(cleaned, text, startTime);
      }
    }

    // Full product catalog listing
    try {
      const items = await this.zohoService.getItems();

      if (items.length === 0) {
        return {
          intent: 'QUESTION',
          replyText: '💡 *Assistant Answer:*\nI could not find any products or services in the Zoho Books catalog. Please check your catalog configuration.',
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
        replyText: '💡 *Assistant Answer:*\nSorry, I could not retrieve the product catalog from Zoho Books right now. Please try again later.',
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Handle a specific product price question.
   * Uses the matching service to find the exact product from Zoho catalog.
   */
  private async handleProductPriceQuestion(productQuery: string, originalText: string, startTime: number): Promise<AgentProcessOutput> {
    try {
      const itemResult = await this.matchingService.matchItem(productQuery, 'catalog');

      if (itemResult.matchedItem) {
        const item = itemResult.matchedItem;
        return {
          intent: 'QUESTION',
          replyText: [
            `💡 *Product Price Information*`,
            `📦 *${item.name}*`,
            `💰 *Price:* ₹${item.rate.toFixed(2)} per ${item.unit}`,
            item.description ? `📝 *Description:* ${item.description}` : '',
            ``,
            `_Price sourced directly from Zoho Books catalog._`,
          ].filter(Boolean).join('\n'),
          clarificationNeeded: false,
          duplicateDetected: false,
          latencyMs: Date.now() - startTime,
        };
      }

      if (itemResult.clarification) {
        // Multiple matches — ask which one
        let replyText = `💡 *Multiple products match "${productQuery}"*\n\nWhich product are you asking about?\n`;
        if (itemResult.clarification.options && itemResult.clarification.options.length > 0) {
          itemResult.clarification.options.forEach((opt, idx) => {
            replyText += `\n${idx + 1}. ${opt}`;
          });
        }
        return {
          intent: 'QUESTION',
          replyText,
          clarificationNeeded: true,
          duplicateDetected: false,
          latencyMs: Date.now() - startTime,
        };
      }

      // No match — return catalog list
      const items = await this.zohoService.getItems();
      const itemList = items
        .slice(0, 10)
        .map((it, idx) => `${idx + 1}. *${it.name}* — ₹${it.rate.toFixed(2)}/${it.unit}`)
        .join('\n');

      return {
        intent: 'QUESTION',
        replyText: `💡 I couldn't find "${productQuery}" in the catalog.\n\n*Available products:*\n${itemList}`,
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      console.error('[AgentService] Price question lookup failed:', err);
      return {
        intent: 'QUESTION',
        replyText: '⚠️ Sorry, I could not look up the product price right now. Please try again.',
        clarificationNeeded: false,
        duplicateDetected: false,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Builds the invoice preview-and-confirm response and persists the pending approval.
   */
  private buildPreviewResponse(
    input: AgentProcessInput,
    matchResult: MatchingResult,
    referenceNumber: string,
    startTime: number
  ): AgentProcessOutput {
    const groupId = input.groupId || 'direct';

    if (!matchResult.matchedCustomer || !matchResult.matchedItems || !matchResult.resolvedPayload) {
      throw new Error('buildPreviewResponse called with incomplete matchResult');
    }

    const isAutoApprove =
      (input.autoApprove === true || process.env['AUTO_APPROVE_INVOICES'] === 'true') &&
      !matchResult.hasPriceOverride;

    if (isAutoApprove) {
      // Return a sentinel value — caller must handle the actual creation
      return { _autoApprove: true } as any;
    }

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
    const expiresAt = now + 15 * 60 * 1000;

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

  async processIncomingMessage(input: AgentProcessInput): Promise<AgentProcessOutput> {
    const startTime = Date.now();
    const referenceNumber = this.generateReferenceNumber(input);
    const groupId = input.groupId || 'direct';
    const senderJid = input.senderJid || '';
    const text = input.messageText.trim();

    // Use caller-injected storage (for isolated tests) or singleton
    if (input._storage) {
      (this as any).storage = input._storage;
    }

    // -------------------------------------------------------------
    // 0a. Handle Approval / Cancellation Commands (Preview-Confirm Flow)
    //     Must be checked FIRST — before any clarification state.
    // -------------------------------------------------------------
    const approvalCmd = this.parseApprovalCommand(text);
    if (approvalCmd) {
      const pending = this.storage.findPendingApprovalForSender(
        groupId,
        senderJid,
        approvalCmd.ref
      );

      if (!pending) {
        // If no pending approval, check if there is an active pending clarification to cancel
        if (approvalCmd.action === 'cancel' && senderJid) {
          const clar = this.storage.findPendingClarificationForSender(groupId, senderJid);
          if (clar) {
            this.storage.removePendingClarification(clar.clarification_id);
            return {
              intent: 'GENERAL_CHAT',
              replyText: `❌ *Request Cancelled*\nYour invoice request has been discarded. Send a new message to start again.`,
              clarificationNeeded: false,
              duplicateDetected: false,
              latencyMs: Date.now() - startTime,
            };
          }
        }

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
        // Also remove any pending clarification tied to this sender
        const clar = this.storage.findPendingClarificationForSender(groupId, senderJid);
        if (clar) this.storage.removePendingClarification(clar.clarification_id);

        return {
          intent: 'GENERAL_CHAT',
          replyText: `❌ *Invoice Request Cancelled*\nThe pending invoice for *${pending.summary.customer_name}* (Ref: \`${pending.reference_number}\`) has been cancelled. No invoice was created in Zoho Books.`,
          clarificationNeeded: false,
          duplicateDetected: false,
          latencyMs: Date.now() - startTime,
        };
      }

      if (approvalCmd.action === 'confirm') {
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
    // 0b. Check for Pending Clarification Reply
    //     If this sender has an outstanding clarification in this group,
    //     attempt to handle the current message as an answer to it.
    //     This must happen BEFORE intent classification so a reply like
    //     "2" or "Metro Wheels" is never re-classified as a new request.
    // -------------------------------------------------------------
    if (senderJid) {
      const pendingClar = this.storage.findPendingClarificationForSender(groupId, senderJid);
      if (pendingClar) {
        // MISSING_QUANTITY clarification: the user's reply IS the quantity, not an option selection
        if (pendingClar.kind === 'MISSING_QUANTITY') {
          const result = await this.handleClarificationReply(input, pendingClar, startTime);
          if (result) return result;
        } else {
          // For all other kinds: check if the reply looks like a clarification answer
          // (numeric, a known option name, or cancel). If it matches, handle it.
          // If it does NOT match, fall through to normal processing — the user may
          // have sent a genuinely new message while a stale clarification sits pending.
          const result = await this.handleClarificationReply(input, pendingClar, startTime);
          if (result) return result;
        }
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
      let pdfData: { buffer: Buffer; filename: string } | undefined;
      try {
        pdfData = await this.zohoService.getInvoicePdf(existingInvoice.invoice_id);
      } catch { /* PDF retrieval failure is non-fatal for duplicate detection */ }

      return {
        intent: 'INVOICE_REQUEST',
        replyText: `⚠️ *Duplicate Request Prevented*\nAn invoice has already been issued for this request:\n\n*Invoice #:* ${existingInvoice.invoice_number}\n*Customer:* ${existingInvoice.customer_name}\n*Total:* ₹${existingInvoice.total.toFixed(2)} ${existingInvoice.currency}\n*Status:* ${existingInvoice.status.toUpperCase()}`,
        invoice: existingInvoice,
        pdfBuffer: pdfData?.buffer,
        pdfFilename: pdfData?.filename,
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
      return this.handleQuestion(input, startTime);
    }

    // -------------------------------------------------------------
    // 4. Handle GENERAL_CHAT Intent — concise greeting
    // -------------------------------------------------------------
    if (classification.result.intent === 'GENERAL_CHAT') {
      const lc = text.toLowerCase();
      let replyText: string;

      if (/^(hi|hello|hey|good\s+morning|good\s+afternoon|good\s+evening|howdy|greetings)\b/i.test(lc)) {
        replyText = `👋 Hi! I'm the Invoice Agent.\nSend an invoice request like:\n*"Bill Metro Tyres for 2 Car Tyre 14-inch"*`;
      } else {
        replyText = `👋 I'm the Invoice Agent. To create an invoice, describe the customer and items (e.g. *"Bill Metro Tyres for 2 Car Tyre 14-inch"*).`;
      }

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

    // If clarification needed — persist the clarification state so the next
    // reply from this sender can resume the request
    if (matchResult.needsClarification && matchResult.clarification) {
      if (senderJid) {
        const reason = matchResult.clarification.reason;
        const kind: PendingClarification['kind'] =
          reason === 'AMBIGUOUS_ITEM' ? 'AMBIGUOUS_ITEM' :
          reason === 'MISSING_ITEMS' ? 'MISSING_ITEM' :
          reason === 'AMBIGUOUS_CUSTOMER' ? 'AMBIGUOUS_CUSTOMER' :
          reason === 'MISSING_CUSTOMER' ? 'MISSING_CUSTOMER' :
          reason === 'MISSING_QUANTITY' ? 'MISSING_QUANTITY' : 'MISSING_ITEM';

        // Determine which item triggered the clarification (if any)
        let itemIndex: number | undefined;
        if (kind === 'AMBIGUOUS_ITEM' || kind === 'MISSING_ITEM' || kind === 'MISSING_QUANTITY') {
          itemIndex = 0; // matchAndValidate processes items sequentially — first failure is index 0
        }

        const pendingClar: PendingClarification = {
          clarification_id: `clar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          group_id: groupId,
          sender_jid: senderJid,
          original_reference_number: referenceNumber,
          kind,
          options: matchResult.clarification.options || [],
          item_index: itemIndex,
          partialExtraction: {
            customer_name: extraction.result.customer_name,
            items: extraction.result.items.map((it) => ({
              raw_item_name: it.raw_item_name,
              quantity: it.quantity,
              rate: it.rate,
            })),
            notes: extraction.result.notes,
          },
          created_at: Date.now(),
          expires_at: Date.now() + 10 * 60 * 1000,
        };
        this.storage.savePendingClarification(pendingClar);
      }

      let replyText = `❓ *Clarification Needed*\n${matchResult.clarification.question}\n`;
      if (matchResult.clarification.options && matchResult.clarification.options.length > 0) {
        replyText += '\n*Options:*';
        matchResult.clarification.options.forEach((opt, idx) => {
          replyText += `\n${idx + 1}. ${opt}`;
        });
        replyText += `\n\n_Reply with a number (1–${matchResult.clarification.options.length}) or the name. Reply *CANCEL* to discard._`;
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

    // Determine if auto-approve applies
    const isAutoApprove =
      (input.autoApprove === true || process.env['AUTO_APPROVE_INVOICES'] === 'true') &&
      !matchResult.hasPriceOverride;

    if (!isAutoApprove) {
      return this.buildPreviewResponse(input, matchResult, referenceNumber, startTime);
    }

    // Direct Creation (Auto-Approved)
    const createdInvoice = await this.zohoService.createInvoice(matchResult.resolvedPayload);
    this.storage.saveInvoice(createdInvoice);

    let pdf: { buffer: Buffer; filename: string } | undefined;
    try {
      pdf = await this.zohoService.getInvoicePdf(createdInvoice.invoice_id);
    } catch (err) {
      console.error('[AgentService] PDF retrieval failed:', err);
    }

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
      pdfBuffer: pdf?.buffer,
      pdfFilename: pdf?.filename,
      clarificationNeeded: false,
      duplicateDetected: false,
      latencyMs: Date.now() - startTime,
    };
  }
}
