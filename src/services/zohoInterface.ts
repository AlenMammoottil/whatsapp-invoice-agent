import {
  Customer,
  ProductItem,
  CreateInvoicePayload,
  Invoice
} from '../types/schemas.js';

export interface IZohoService {
  /**
   * Retrieves all available customers from Zoho Books
   */
  getCustomers(): Promise<Customer[]>;

  /**
   * Searches customers by name, company name, alias, or email
   */
  findCustomer(query: string): Promise<Customer[]>;

  /**
   * Retrieves all product/service catalog items from Zoho Books
   */
  getItems(): Promise<ProductItem[]>;

  /**
   * Searches catalog items by name, description, or alias
   */
  findItems(query: string): Promise<ProductItem[]>;

  /**
   * Creates an invoice in Zoho Books, with duplicate check on reference_number
   */
  createInvoice(payload: CreateInvoicePayload): Promise<Invoice>;

  /**
   * Retrieves a specific invoice by its ID
   */
  getInvoice(invoiceId: string): Promise<Invoice | null>;

  /**
   * Retrieves an invoice by reference_number (useful for duplicate check)
   */
  getInvoiceByReference(referenceNumber: string): Promise<Invoice | null>;

  /**
   * Generates or fetches the invoice PDF buffer
   */
  getInvoicePdf(invoiceId: string): Promise<{ buffer: Buffer; filename: string }>;
}
