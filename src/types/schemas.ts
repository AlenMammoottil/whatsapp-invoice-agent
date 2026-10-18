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
  raw_item_name: z.string().min(1, 'Product description is required'),
  quantity: z.number().positive().default(1),
  rate: z.number().nonnegative().optional(), // optional if customer didn't specify rate, to be pulled from Zoho
  unit: z.string().optional(),
});

export type ExtractedLineItem = z.infer<typeof ExtractedLineItemSchema>;

export const ExtractedInvoiceRequestSchema = z.object({
  customer_name: z.string().min(1, 'Customer name is required'),
  items: z.array(ExtractedLineItemSchema).min(1, 'At least one line item is required'),
  currency: z.string().default('USD'),
  notes: z.string().optional(),
  due_date: z.string().optional(),
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

export const InvoiceLineItemSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
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
      description: z.string().optional(),
    })
  ).min(1),
  notes: z.string().optional(),
  date: z.string().optional(),
  due_date: z.string().optional(),
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
});

export type Invoice = z.infer<typeof InvoiceSchema>;
