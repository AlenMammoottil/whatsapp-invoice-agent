import { IZohoService } from './zohoInterface.js';
import {
  Customer,
  ProductItem,
  ExtractedInvoiceRequest,
  ClarificationRequest,
  CreateInvoicePayload,
  RateSource
} from '../types/schemas.js';

export interface ResolvedLineItem {
  catalogItem: ProductItem;
  quantity: number;
  rate: number;
  catalogRate: number;
  rateSource: RateSource;
  rawName: string;
}

export interface MatchingResult {
  needsClarification: boolean;
  clarification?: ClarificationRequest;
  resolvedPayload?: CreateInvoicePayload;
  matchedCustomer?: Customer;
  matchedItems?: ResolvedLineItem[];
  hasPriceOverride: boolean;
}

/**
 * Normalizes text for comparison: lowercases, converts quotes/dashes, trims whitespace
 */
export function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/["”″]/g, ' inch ')
    .replace(/[-_]/g, ' ')
    .replace(/[&]/g, ' and ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculates string similarity score between 0 and 1
 */
export function similarityScore(str1: string, str2: string): number {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // Token overlap score
  const tokens1 = new Set(s1.split(' ').filter(Boolean));
  const tokens2 = new Set(s2.split(' ').filter(Boolean));
  let intersection = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) intersection++;
  }
  const tokenScore = (2 * intersection) / (tokens1.size + tokens2.size);

  // Levenshtein ratio
  const maxLen = Math.max(s1.length, s2.length);
  const dist = levenshteinDistance(s1, s2);
  const editScore = Math.max(0, 1 - dist / maxLen);

  return tokenScore * 0.6 + editScore * 0.4;
}

/**
 * Extracts size attribute in inches (e.g. 13, 14, 15, 16, 17, 18, 10)
 */
export function extractSizeSpec(text: string): string | null {
  const norm = normalizeText(text);
  const match = norm.match(/\b(10|12|13|14|15|16|17|18|19|20)\s*(?:inch|in)?\b/);
  return match ? match[1] : null;
}

/**
 * Extracts color attribute if present (e.g. red, black, silver)
 */
export function extractColorSpec(text: string): string | null {
  const norm = normalizeText(text);
  const colors = ['red', 'black', 'silver', 'white', 'matte black'];
  for (const color of colors) {
    if (norm.includes(color)) return color;
  }
  return null;
}

export class MatchingService {
  constructor(private zohoService: IZohoService) {}

  /**
   * Matches extracted customer against Zoho database records with strict disambiguation
   */
  async matchCustomer(customerQuery: string): Promise<{
    matchedCustomer?: Customer;
    clarification?: ClarificationRequest;
  }> {
    const rawQuery = customerQuery?.trim();
    if (!rawQuery || rawQuery.toLowerCase() === 'unknown customer' || rawQuery.toLowerCase() === 'customer') {
      return {
        clarification: {
          needs_clarification: true,
          reason: 'MISSING_CUSTOMER',
          question: 'Which customer should I bill? Please provide the client or company name.',
        },
      };
    }

    const normQuery = normalizeText(rawQuery);
    const allCustomers = await this.zohoService.getCustomers();

    // 1. Check for exact name or exact alias match across all records
    const exactMatches: Customer[] = [];
    for (const c of allCustomers) {
      const normCompany = normalizeText(c.company_name);
      const isExactCompany = normCompany === normQuery;
      const isExactAlias = c.aliases.some((a) => normalizeText(a) === normQuery);

      if (isExactCompany || isExactAlias) {
        exactMatches.push(c);
      }
    }

    // Single exact match found — select it regardless of original index or database order
    if (exactMatches.length === 1) {
      return { matchedCustomer: exactMatches[0] };
    }

    // Multiple customers share the exact alias or query (e.g. "ABC" matches "ABC Tyres & Traders" and "ABC Wheels trading")
    if (exactMatches.length > 1) {
      const options = exactMatches.map((c) => c.company_name);
      return {
        clarification: {
          needs_clarification: true,
          reason: 'AMBIGUOUS_CUSTOMER',
          question: `I found multiple customers matching "${rawQuery}". Which one did you mean?`,
          options,
          context: { queriedCustomer: rawQuery, options },
        },
      };
    }

    // 2. High-confidence token / prefix search
    const candidates = await this.zohoService.findCustomer(rawQuery);

    if (candidates.length === 1) {
      // Check confidence of the single candidate
      const cand = candidates[0];
      const score = Math.max(
        similarityScore(rawQuery, cand.company_name),
        ...cand.aliases.map((a) => similarityScore(rawQuery, a))
      );

      if (score >= 0.5) {
        return { matchedCustomer: cand };
      }
    }

    if (candidates.length > 1) {
      // Check if one candidate has an exact alias or exact word match
      const exactInCandidates = candidates.filter(
        (c) =>
          normalizeText(c.company_name) === normQuery ||
          c.aliases.some((a) => normalizeText(a) === normQuery)
      );

      if (exactInCandidates.length === 1) {
        return { matchedCustomer: exactInCandidates[0] };
      }

      // Ambiguous customer match
      const options = candidates.map((c) => c.company_name);
      return {
        clarification: {
          needs_clarification: true,
          reason: 'AMBIGUOUS_CUSTOMER',
          question: `I found multiple customers matching "${rawQuery}". Which one did you mean?`,
          options,
          context: { queriedCustomer: rawQuery, options },
        },
      };
    }

    // 3. Unmatched customer — rank all customers by relevance score instead of arbitrary slice(0, 4)
    const ranked = allCustomers
      .map((c) => {
        const score = Math.max(
          similarityScore(rawQuery, c.company_name),
          ...c.aliases.map((a) => similarityScore(rawQuery, a))
        );
        return { customer: c, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((r) => r.customer.company_name);

    return {
      clarification: {
        needs_clarification: true,
        reason: 'MISSING_CUSTOMER',
        question: `I couldn't find a customer named "${rawQuery}" in Zoho Books. Did you mean one of these existing clients?`,
        options: ranked,
        context: { queriedCustomer: rawQuery, options: ranked },
      },
    };
  }

  /**
   * Matches an individual product/service request against Zoho catalog with size/variant disambiguation
   */
  async matchItem(
    rawItemName: string,
    customerName: string
  ): Promise<{
    matchedItem?: ProductItem;
    clarification?: ClarificationRequest;
  }> {
    const rawName = rawItemName?.trim();
    if (!rawName) {
      return {
        clarification: {
          needs_clarification: true,
          reason: 'MISSING_ITEMS',
          question: `What products or services should I invoice for ${customerName}?`,
        },
      };
    }

    const normQuery = normalizeText(rawName);
    const querySize = extractSizeSpec(rawName);
    const queryColor = extractColorSpec(rawName);
    const allItems = await this.zohoService.getItems();

    // 1. Exact Name or Exact Alias Match across all catalog items
    const exactMatches: ProductItem[] = [];
    for (const item of allItems) {
      const normItemName = normalizeText(item.name);
      const isExactName = normItemName === normQuery;
      const isExactAlias = item.aliases.some((a) => normalizeText(a) === normQuery);

      if (isExactName || isExactAlias) {
        exactMatches.push(item);
      }
    }

    if (exactMatches.length === 1) {
      return { matchedItem: exactMatches[0] };
    }

    if (exactMatches.length > 1) {
      // Check if size or color breaks the tie
      if (querySize || queryColor) {
        const filtered = exactMatches.filter((item) => {
          const itemSize = extractSizeSpec(item.name);
          const itemColor = extractColorSpec(item.name);
          const sizeMatch = !querySize || itemSize === querySize;
          const colorMatch = !queryColor || itemColor === queryColor;
          return sizeMatch && colorMatch;
        });

        if (filtered.length === 1) {
          return { matchedItem: filtered[0] };
        }
      }

      const options = exactMatches.map((i) => `${i.name} (₹${i.rate.toFixed(2)}/${i.unit})`);
      return {
        clarification: {
          needs_clarification: true,
          reason: 'AMBIGUOUS_ITEM',
          question: `For "${rawName}", which product or plan should I add to the invoice?`,
          options,
          context: { queriedItem: rawName, options },
        },
      };
    }

    // 2. Variant / Size Disambiguation
    // Search candidates from Zoho catalog
    const candidates = await this.zohoService.findItems(rawName);

    // If query specifies a size (e.g. "14 inch tyres" or "14 inch car tyre"), filter candidates to match that size
    if (querySize) {
      const sizeMatches = (candidates.length > 0 ? candidates : allItems).filter((item) => {
        const itemSize = extractSizeSpec(item.name);
        return itemSize === querySize;
      });

      // If we also have color or category (e.g. "car", "bike", "suv", "lenzo"), narrow down
      let refined = sizeMatches;
      if (normQuery.includes('car')) refined = refined.filter((i) => normalizeText(i.name).includes('car'));
      if (normQuery.includes('bike')) refined = refined.filter((i) => normalizeText(i.name).includes('bike'));
      if (normQuery.includes('suv')) refined = refined.filter((i) => normalizeText(i.name).includes('suv'));
      if (normQuery.includes('lenzo') || normQuery.includes('alloy')) {
        refined = refined.filter((i) => normalizeText(i.name).includes('lenzo') || normalizeText(i.name).includes('alloy'));
      }
      if (queryColor) {
        refined = refined.filter((i) => extractColorSpec(i.name) === queryColor);
      }

      if (refined.length === 1) {
        return { matchedItem: refined[0] };
      }

      if (refined.length > 1) {
        const options = refined.map((i) => `${i.name} (₹${i.rate.toFixed(2)}/${i.unit})`);
        return {
          clarification: {
            needs_clarification: true,
            reason: 'AMBIGUOUS_ITEM',
            question: `For "${rawName}", which variant did you mean?`,
            options,
            context: { queriedItem: rawName, options },
          },
        };
      }
    }

    // 3. Ambiguity Check: Query is generic (e.g. "car tyre", "hosting", "red wheel", "scooter")
    // When multiple distinct variants or plans exist and sender omitted the distinguishing attribute
    if (candidates.length > 1) {
      // Check if one candidate is an exact match (even if not at index 0)
      const exactCandidate = candidates.find(
        (c) =>
          normalizeText(c.name) === normQuery ||
          c.aliases.some((a) => normalizeText(a) === normQuery)
      );

      if (exactCandidate) {
        return { matchedItem: exactCandidate };
      }

      // Check if candidates differ by size or tier
      const options = candidates.map((i) => `${i.name} (₹${i.rate.toFixed(2)}/${i.unit})`);
      return {
        clarification: {
          needs_clarification: true,
          reason: 'AMBIGUOUS_ITEM',
          question: `For "${rawName}", which product, size, or plan should I add to the invoice?`,
          options,
          context: { queriedItem: rawName, options },
        },
      };
    }

    if (candidates.length === 1) {
      const cand = candidates[0];
      const candSize = extractSizeSpec(cand.name);

      // Safety check: If catalog item has a specific size (e.g. Car Tyre 13-inch) but query only said "car tyre",
      // check if other sister items exist in the catalog with different sizes!
      if (candSize && !querySize) {
        const sisterVariants = allItems.filter(
          (i) =>
            i.item_id !== cand.item_id &&
            similarityScore(cand.name.replace(/\d+\s*(?:inch|")/gi, ''), i.name.replace(/\d+\s*(?:inch|")/gi, '')) > 0.7
        );

        if (sisterVariants.length > 0) {
          const allVariants = [cand, ...sisterVariants];
          const options = allVariants.map((i) => `${i.name} (₹${i.rate.toFixed(2)}/${i.unit})`);
          return {
            clarification: {
              needs_clarification: true,
              reason: 'AMBIGUOUS_ITEM',
              question: `Which size or variant for "${rawName}"?`,
              options,
              context: { queriedItem: rawName, options },
            },
          };
        }
      }

      // Verify minimum confidence
      const score = Math.max(
        similarityScore(rawName, cand.name),
        ...cand.aliases.map((a) => similarityScore(rawName, a))
      );

      if (score >= 0.45) {
        return { matchedItem: cand };
      }
    }

    // 4. Unmatched item — rank all catalog items by relevance score
    const ranked = allItems
      .map((item) => {
        const score = Math.max(
          similarityScore(rawName, item.name),
          ...item.aliases.map((a) => similarityScore(rawName, a))
        );
        return { item, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((r) => `${r.item.name} (₹${r.item.rate.toFixed(2)})`);

    return {
      clarification: {
        needs_clarification: true,
        reason: 'MISSING_ITEMS',
        question: `I couldn't find "${rawName}" in the Zoho product catalog. Did you mean one of these?`,
        options: ranked,
        context: { queriedItem: rawName, options: ranked },
      },
    };
  }

  /**
   * Matches extracted customer and items against Zoho records.
   * Enforces price safety, variant disambiguation, and quantity validation.
   */
  async matchAndValidate(
    extracted: ExtractedInvoiceRequest,
    referenceNumber: string
  ): Promise<MatchingResult> {
    // -------------------------------------------------------------
    // 1. Customer Matching
    // -------------------------------------------------------------
    const customerRes = await this.matchCustomer(extracted.customer_name);
    if (customerRes.clarification || !customerRes.matchedCustomer) {
      return {
        needsClarification: true,
        clarification: customerRes.clarification,
        hasPriceOverride: false,
      };
    }
    const matchedCustomer = customerRes.matchedCustomer;

    // -------------------------------------------------------------
    // 2. Line Items Matching & Validation
    // -------------------------------------------------------------
    if (!extracted.items || extracted.items.length === 0) {
      return {
        needsClarification: true,
        clarification: {
          needs_clarification: true,
          reason: 'MISSING_ITEMS',
          question: `What products or services should I invoice for ${matchedCustomer.company_name}?`,
        },
        hasPriceOverride: false,
      };
    }

    const resolvedItems: ResolvedLineItem[] = [];
    let hasPriceOverride = false;

    for (const line of extracted.items) {
      const rawName = line.raw_item_name?.trim();

      // Check quantity: Must be explicitly provided (not null/undefined).
      // The schema transform returns null when the LLM did not specify a quantity.
      // We must never silently default to 1 — ask the user instead.
      if (line.quantity === null || line.quantity === undefined || (line.quantity as number) <= 0) {
        return {
          needsClarification: true,
          clarification: {
            needs_clarification: true,
            reason: 'MISSING_QUANTITY',
            question: `How many units of "${rawName || 'item'}" should I invoice for ${matchedCustomer.company_name}?\nPlease reply with a number (e.g. "2" or "5 units").`,
            context: { item: rawName },
          },
          hasPriceOverride: false,
        };
      }

      const itemRes = await this.matchItem(rawName, matchedCustomer.company_name);
      if (itemRes.clarification || !itemRes.matchedItem) {
        return {
          needsClarification: true,
          clarification: itemRes.clarification,
          hasPriceOverride: false,
        };
      }

      const catalogItem = itemRes.matchedItem;

      // Price Safety Policy:
      // Authoritative rate is the catalog price.
      // If the sender explicitly specified a rate, check whether it matches the catalog price.
      let effectiveRate = catalogItem.rate;
      let rateSource: RateSource = 'catalog';

      if (line.rate !== undefined && line.rate !== null) {
        if (Math.abs(line.rate - catalogItem.rate) < 0.01) {
          effectiveRate = catalogItem.rate;
          rateSource = 'catalog';
        } else {
          // Explicit override requested by sender
          effectiveRate = line.rate;
          rateSource = 'explicit_override';
          hasPriceOverride = true;
        }
      }

      resolvedItems.push({
        catalogItem,
        quantity: line.quantity,
        rate: effectiveRate,
        catalogRate: catalogItem.rate,
        rateSource,
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
        catalog_rate: r.catalogRate,
        rate_source: r.rateSource,
        description: r.catalogItem.description,
      })),
      notes: extracted.notes,
      has_price_override: hasPriceOverride,
    };

    return {
      needsClarification: false,
      resolvedPayload,
      matchedCustomer,
      matchedItems: resolvedItems,
      hasPriceOverride,
    };
  }
}
