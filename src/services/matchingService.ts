import { IZohoService } from './zohoInterface.js';
import {
  Customer,
  ProductItem,
  ExtractedInvoiceRequest,
  ClarificationRequest,
  CreateInvoicePayload
} from '../types/schemas.js';

export interface ResolvedLineItem {
  catalogItem: ProductItem;
  quantity: number;
  rate: number;
  rawName: string;
}

export interface MatchingResult {
  needsClarification: boolean;
  clarification?: ClarificationRequest;
  resolvedPayload?: CreateInvoicePayload;
  matchedCustomer?: Customer;
  matchedItems?: ResolvedLineItem[];
}

export class MatchingService {
  constructor(private zohoService: IZohoService) {}

  /**
   * Matches extracted customer and items against Zoho records.
   * If any information is missing or ambiguous, produces a polite clarification question.
   */
  async matchAndValidate(
    extracted: ExtractedInvoiceRequest,
    referenceNumber: string
  ): Promise<MatchingResult> {
    // -------------------------------------------------------------
    // 1. Customer Matching
    // -------------------------------------------------------------
    const customerQuery = extracted.customer_name?.trim();
    if (!customerQuery || customerQuery.toLowerCase() === 'unknown customer') {
      return {
        needsClarification: true,
        clarification: {
          needs_clarification: true,
          reason: 'MISSING_CUSTOMER',
          question: 'Which customer should I bill? Please provide the client or company name.',
        },
      };
    }

    const customerMatches = await this.zohoService.findCustomer(customerQuery);

    if (customerMatches.length === 0) {
      // Suggest existing customers if any
      const allCustomers = await this.zohoService.getCustomers();
      const options = allCustomers.slice(0, 4).map((c) => c.company_name);

      return {
        needsClarification: true,
        clarification: {
          needs_clarification: true,
          reason: 'MISSING_CUSTOMER',
          question: `I couldn't find a customer named "${customerQuery}" in Zoho Books. Did you mean one of these existing clients?`,
          options,
          context: { queriedCustomer: customerQuery },
        },
      };
    }

    if (customerMatches.length > 1) {
      // Check if one is an exact match
      const exactMatch = customerMatches.find(
        (c) =>
          c.company_name.toLowerCase() === customerQuery.toLowerCase() ||
          c.aliases.some((a) => a.toLowerCase() === customerQuery.toLowerCase())
      );

      if (!exactMatch) {
        const options = customerMatches.map((c) => c.company_name);
        return {
          needsClarification: true,
          clarification: {
            needs_clarification: true,
            reason: 'AMBIGUOUS_CUSTOMER',
            question: `I found multiple customers matching "${customerQuery}". Which one did you mean?`,
            options,
            context: { queriedCustomer: customerQuery },
          },
        };
      }
    }

    const matchedCustomer = customerMatches[0]!;

    // -------------------------------------------------------------
    // 2. Line Items Matching
    // -------------------------------------------------------------
    if (!extracted.items || extracted.items.length === 0) {
      return {
        needsClarification: true,
        clarification: {
          needs_clarification: true,
          reason: 'MISSING_ITEMS',
          question: `What products or services should I invoice for ${matchedCustomer.company_name}?`,
        },
      };
    }

    const resolvedItems: ResolvedLineItem[] = [];

    for (const line of extracted.items) {
      const rawName = line.raw_item_name.trim();

      // Check quantity
      if (!line.quantity || line.quantity <= 0) {
        return {
          needsClarification: true,
          clarification: {
            needs_clarification: true,
            reason: 'MISSING_QUANTITY',
            question: `How many units of "${rawName}" should I invoice for ${matchedCustomer.company_name}?`,
            context: { item: rawName },
          },
        };
      }

      const itemMatches = await this.zohoService.findItems(rawName);

      if (itemMatches.length === 0) {
        const allItems = await this.zohoService.getItems();
        const options = allItems.slice(0, 4).map((i) => `${i.name} ($${i.rate})`);

        return {
          needsClarification: true,
          clarification: {
            needs_clarification: true,
            reason: 'MISSING_ITEMS',
            question: `I couldn't find "${rawName}" in the Zoho product catalog. Did you mean one of these?`,
            options,
            context: { queriedItem: rawName },
          },
        };
      }

      // Ambiguity Check: Multiple matching items
      if (itemMatches.length > 1) {
        // Only consider resolved if there is a single unique exact name match
        const exactNameMatches = itemMatches.filter(
          (i) => i.name.toLowerCase() === rawName.toLowerCase()
        );

        if (exactNameMatches.length !== 1) {
          const options = itemMatches.map((i) => `${i.name} ($${i.rate.toFixed(2)}/${i.unit})`);
          return {
            needsClarification: true,
            clarification: {
              needs_clarification: true,
              reason: 'AMBIGUOUS_ITEM',
              question: `For "${rawName}", which product or plan should I add to the invoice?`,
              options,
              context: { queriedItem: rawName, options },
            },
          };
        }
      }

      const catalogItem = itemMatches[0]!;
      // Use specified rate or catalog default rate
      const effectiveRate = line.rate !== undefined && line.rate !== null ? line.rate : catalogItem.rate;

      resolvedItems.push({
        catalogItem,
        quantity: line.quantity,
        rate: effectiveRate,
        rawName,
      });
    }

    // -------------------------------------------------------------
    // 3. Assemble Validated CreateInvoicePayload
    // -------------------------------------------------------------
    const resolvedPayload: CreateInvoicePayload = {
      customer_id: matchedCustomer.customer_id,
      reference_number: referenceNumber,
      line_items: resolvedItems.map((r) => ({
        item_id: r.catalogItem.item_id,
        quantity: r.quantity,
        rate: r.rate,
        description: r.catalogItem.description,
      })),
      notes: extracted.notes,
    };

    return {
      needsClarification: false,
      resolvedPayload,
      matchedCustomer,
      matchedItems: resolvedItems,
    };
  }
}
