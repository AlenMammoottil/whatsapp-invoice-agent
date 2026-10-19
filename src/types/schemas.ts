import { z } from 'zod';

// ==========================================
// 1. Zoho Books Domain Schemas
// ==========================================

export const CustomerSchema = z.object({
  customer_id: z.string(),
  company_name: z.string(),
  contact_name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  aliases: z.array(z.string()).default([]),
});

export type Customer = z.infer<typeof CustomerSchema>;

export const ProductItemSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  rate: z.number().nonnegative(),
  unit: z.string().default('qty'),
  aliases: z.array(z.string()).default([]),
});

export type ProductItem = z.infer<typeof ProductItemSchema>;

// ==========================================
// 2. WhatsApp Message Classification
// ==========================================

export const IntentTypeSchema = z.enum([
  'INVOICE_REQUEST',
  'QUESTION',
  'GENERAL_CHAT'
]);

export type IntentType = z.infer<typeof IntentTypeSchema>;

export const ClassificationResultSchema = z.object({
  intent: IntentTypeSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

// ==========================================
// 3. Extracted Invoice Request from LLM
// ==========================================

export const ExtractedLineItemSchema = z.object({
  raw_item_name: z.string().nullish().transform(v => (v && v.trim() ? v.trim() : 'Unknown Item')),
  // BUG FIX: quantity MUST NOT default to 1 when the LLM returns null/undefined.
  // A null quantity means "not specified" — the agent must ask for clarification.
  // The transform preserves null/undefined so downstream validation can detect the absence.
  quantity: z.number().nullish().transform(v => (v && v > 0 ? v : null)),
  rate: z.number().nonnegative().nullish().transform(v => v ?? undefined), // null from LLM → undefined
  unit: z.string().nullish().transform(v => v ?? undefined),               // null from LLM → undefined
});

export type ExtractedLineItem = z.infer<typeof ExtractedLineItemSchema>;

export const ExtractedInvoiceRequestSchema = z.object({
  customer_name: z.string().nullish().transform(v => (v && v.trim() ? v.trim() : 'Unknown Customer')),
  items: z.array(ExtractedLineItemSchema).nullish().transform(v => v && v.length > 0 ? v : []),
  // BUG FIX: do not default currency to USD — use INR from context; keep null so the
  // app can defer to Zoho organisation currency.
  currency: z.string().nullish().transform(v => v ?? null),
  notes: z.string().nullish().transform(v => v ?? undefined),
  due_date: z.string().nullish().transform(v => v ?? undefined),
});

export type ExtractedInvoiceRequest = z.infer<typeof ExtractedInvoiceRequestSchema>;

// ==========================================
// 4. Clarification Request
// ==========================================

export const ClarificationReasonSchema = z.enum([
  'MISSING_CUSTOMER',
  'AMBIGUOUS_CUSTOMER',
  'MISSING_ITEMS',
  'AMBIGUOUS_ITEM',
  'MISSING_QUANTITY',
  'INVALID_DATA'
]);

export type ClarificationReason = z.infer<typeof ClarificationReasonSchema>;

export const ClarificationRequestSchema = z.object({
  needs_clarification: z.boolean(),
  reason: ClarificationReasonSchema.optional(),
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
  context: z.record(z.string(), z.any()).optional(),
});

export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;

// ==========================================
// 5. Final Invoice Data Structures
// ==========================================

export const RateSourceSchema = z.enum(['catalog', 'explicit_override']);
export type RateSource = z.infer<typeof RateSourceSchema>;

export const InvoiceLineItemSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
  catalog_rate: z.number().nonnegative().optional(),
  rate_source: RateSourceSchema.default('catalog').optional(),
  item_total: z.number().nonnegative(),
});

export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

export const CreateInvoicePayloadSchema = z.object({
  customer_id: z.string(),
  reference_number: z.string(), // idempotency key (e.g. hash of message) to prevent duplicates
  line_items: z.array(
    z.object({
      item_id: z.string(),
      quantity: z.number().positive(),
      rate: z.number().nonnegative().optional(),
      catalog_rate: z.number().nonnegative().optional(),
      rate_source: RateSourceSchema.optional(),
      description: z.string().optional(),
    })
  ).min(1),
  notes: z.string().optional(),
  date: z.string().optional(),
  due_date: z.string().optional(),
  has_price_override: z.boolean().default(false).optional(),
});

export type CreateInvoicePayload = z.infer<typeof CreateInvoicePayloadSchema>;

export const InvoiceSchema = z.object({
  invoice_id: z.string(),
  invoice_number: z.string(),
  reference_number: z.string(),
  customer_id: z.string(),
  customer_name: z.string(),
  date: z.string(),
  due_date: z.string(),
  currency: z.string(),
  line_items: z.array(InvoiceLineItemSchema),
  subtotal: z.number(),
  tax_total: z.number().default(0),
  total: z.number(),
  status: z.enum(['draft', 'sent', 'paid']),
  pdf_url: z.string(),
  created_at: z.string(),
  has_price_override: z.boolean().default(false).optional(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

// ==========================================
// 6. Preview & Approval Workflow
// ==========================================

export const PendingApprovalSchema = z.object({
  approval_id: z.string(),
  reference_number: z.string(),
  group_id: z.string(),
  sender_jid: z.string(),
  sender_name: z.string(),
  payload: CreateInvoicePayloadSchema,
  summary: z.object({
    customer_name: z.string(),
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        rate: z.number(),
        catalog_rate: z.number(),
        rate_source: RateSourceSchema,
        item_total: z.number(),
      })
    ),
    subtotal: z.number(),
    tax_total: z.number(),
    total: z.number(),
    currency: z.string(),
    has_price_override: z.boolean(),
  }),
  created_at: z.number(),
  expires_at: z.number(),
});

export type PendingApproval = z.infer<typeof PendingApprovalSchema>;

// ==========================================
// 7. Pending Clarification State
//    Stores an in-progress invoice request that
//    needs a follow-up answer from the user.
// ==========================================

export type ClarificationKind =
  | 'AMBIGUOUS_ITEM'
  | 'MISSING_ITEM'
  | 'AMBIGUOUS_CUSTOMER'
  | 'MISSING_CUSTOMER'
  | 'MISSING_QUANTITY';

export interface PendingClarification {
  /** Unique ID for this clarification session */
  clarification_id: string;
  /** WhatsApp group (or 'direct') the original message arrived in */
  group_id: string;
  /** JID of the user who sent the original request */
  sender_jid: string;
  /** Stable reference number derived from original message — preserved through all clarification rounds */
  original_reference_number: string;
  /** Type of clarification being asked */
  kind: ClarificationKind;
  /**
   * Ordered list of option strings exactly as shown to the user.
   * Numeric replies (1, 2, 3…) resolve against this list.
   */
  options: string[];
  /**
   * If kind is AMBIGUOUS_ITEM or MISSING_ITEM, index of the item
   * within extracted.items that triggered the clarification.
   */
  item_index?: number;
  /**
   * The full extraction result from the original message.
   * Preserved so that once clarified, processing can resume from here.
   */
  partialExtraction: {
    customer_name: string;
    /** Resolved customer_id if customer was already matched */
    resolved_customer_id?: string;
    items: Array<{
      raw_item_name: string;
      quantity: number | null;
      rate?: number;
      /** Resolved Zoho item_id if this item was already matched */
      resolved_item_id?: string;
      resolved_item_name?: string;
      resolved_rate?: number;
    }>;
    notes?: string;
  };
  /** Epoch ms when this clarification was created */
  created_at: number;
  /** Epoch ms after which the clarification expires (default 10 min) */
  expires_at: number;
}
