import { IZohoService } from './zohoInterface.js';
import {
  Customer,
  ProductItem,
  CreateInvoicePayload,
  Invoice,
  InvoiceLineItem
} from '../types/schemas.js';

export class DuplicateInvoiceError extends Error {
  constructor(public referenceNumber: string, public existingInvoiceId: string) {
    super(`Duplicate invoice detected for reference: ${referenceNumber}. Existing invoice ID: ${existingInvoiceId}`);
    this.name = 'DuplicateInvoiceError';
  }
}

export class CustomerNotFoundError extends Error {
  constructor(public customerId: string) {
    super(`Customer not found with ID: ${customerId}`);
    this.name = 'CustomerNotFoundError';
  }
}

export class ItemNotFoundError extends Error {
  constructor(public itemId: string) {
    super(`Item not found with ID: ${itemId}`);
    this.name = 'ItemNotFoundError';
  }
}

export class ZohoMockService implements IZohoService {
  private customers: Customer[] = [
    {
      customer_id: 'cust_001',
      company_name: 'Acme Corporation',
      contact_name: 'Alice Smith',
      email: 'alice@acme.com',
      phone: '+1-555-0101',
      aliases: ['acme', 'acme corp', 'acme corporation', 'alice smith'],
    },
    {
      customer_id: 'cust_002',
      company_name: 'TechNova Solutions',
      contact_name: 'Bob Johnson',
      email: 'bob@technova.io',
      phone: '+1-555-0102',
      aliases: ['technova', 'tech nova', 'technova solutions', 'bob johnson'],
    },
    {
      customer_id: 'cust_003',
      company_name: 'GreenLeaf Organics',
      contact_name: 'Charlie Brown',
      email: 'charlie@greenleaf.org',
      phone: '+1-555-0103',
      aliases: ['greenleaf', 'green leaf', 'greenleaf organics', 'charlie brown'],
    },
    {
      customer_id: 'cust_004',
      company_name: 'Apex Logistics',
      contact_name: 'Diana Prince',
      email: 'diana@apexlog.com',
      phone: '+1-555-0104',
      aliases: ['apex', 'apex logistics', 'apex log', 'diana prince'],
    },
    {
      customer_id: 'cust_005',
      company_name: 'Starlight Media',
      contact_name: 'Evan Wright',
      email: 'evan@starlight.co',
      phone: '+1-555-0105',
      aliases: ['starlight', 'starlight media', 'evan wright'],
    },
  ];

  private items: ProductItem[] = [
    {
      item_id: 'item_101',
      name: 'Web Development Consultation',
      description: 'Custom web development and consulting services per hour',
      rate: 150.0,
      unit: 'hour',
      aliases: ['web dev', 'web development', 'consulting', 'website development', 'coding'],
    },
    {
      item_id: 'item_102',
      name: 'Cloud Hosting Standard',
      description: 'Managed shared cloud hosting - 2 vCPU, 4GB RAM',
      rate: 50.0,
      unit: 'month',
      aliases: ['hosting', 'cloud hosting', 'standard hosting', 'cloud host', 'shared hosting'],
    },
    {
      item_id: 'item_103',
      name: 'Cloud Hosting Premium',
      description: 'High-performance dedicated cloud hosting - 8 vCPU, 32GB RAM',
      rate: 120.0,
      unit: 'month',
      aliases: ['hosting', 'cloud hosting', 'premium hosting', 'dedicated hosting', 'cloud host premium'],
    },
    {
      item_id: 'item_104',
      name: 'UI/UX Design Package',
      description: 'End-to-end Figma UI/UX design prototype & design system',
      rate: 800.0,
      unit: 'package',
      aliases: ['ui design', 'ux design', 'design package', 'figma design', 'wireframing', 'design'],
    },
    {
      item_id: 'item_105',
      name: 'Annual Maintenance Contract',
      description: 'Comprehensive 1-year software maintenance, security updates, and SLA support',
      rate: 1200.0,
      unit: 'year',
      aliases: ['amc', 'maintenance', 'annual maintenance', 'support contract', 'annual support'],
    },
    {
      item_id: 'item_106',
      name: 'Ergonomic Office Chair',
      description: 'Adjustable mesh ergonomic task chair with lumbar support',
      rate: 250.0,
      unit: 'chair',
      aliases: ['chair', 'office chair', 'ergonomic chair', 'task chair'],
    },
  ];

  // In-memory invoice storage
  private invoices: Map<string, Invoice> = new Map();
  private referenceIndex: Map<string, string> = new Map(); // reference_number -> invoice_id
  private invoiceCounter = 1;

  async getCustomers(): Promise<Customer[]> {
    return [...this.customers];
  }

  async findCustomer(query: string): Promise<Customer[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return this.customers.filter((c) => {
      const matchCompany = c.company_name.toLowerCase().includes(q);
      const matchContact = c.contact_name.toLowerCase().includes(q);
      const matchEmail = c.email?.toLowerCase().includes(q);
      const matchAlias = c.aliases.some((alias) => alias.toLowerCase().includes(q) || q.includes(alias.toLowerCase()));
      return matchCompany || matchContact || matchEmail || matchAlias;
    });
  }

  async getItems(): Promise<ProductItem[]> {
    return [...this.items];
  }

  async findItems(query: string): Promise<ProductItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return this.items.filter((item) => {
      const matchName = item.name.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchAlias = item.aliases.some((alias) => alias.toLowerCase().includes(q) || q.includes(alias.toLowerCase()));
      return matchName || matchDesc || matchAlias;
    });
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    return this.invoices.get(invoiceId) || null;
  }

  async getInvoiceByReference(referenceNumber: string): Promise<Invoice | null> {
    const invoiceId = this.referenceIndex.get(referenceNumber);
    if (!invoiceId) return null;
    return this.invoices.get(invoiceId) || null;
  }

  async createInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
    // 1. Duplicate invoice prevention
    if (this.referenceIndex.has(payload.reference_number)) {
      const existingId = this.referenceIndex.get(payload.reference_number)!;
      throw new DuplicateInvoiceError(payload.reference_number, existingId);
    }

    // 2. Customer validation
    const customer = this.customers.find((c) => c.customer_id === payload.customer_id);
    if (!customer) {
      throw new CustomerNotFoundError(payload.customer_id);
    }

    // 3. Resolve line items and calculate totals
    const lineItems: InvoiceLineItem[] = [];
    let subtotal = 0;

    for (const itemPayload of payload.line_items) {
      const catalogItem = this.items.find((i) => i.item_id === itemPayload.item_id);
      if (!catalogItem) {
        throw new ItemNotFoundError(itemPayload.item_id);
      }

      // Use specified rate or fall back to catalog price
      const rate = itemPayload.rate !== undefined && itemPayload.rate !== null ? itemPayload.rate : catalogItem.rate;
      const quantity = itemPayload.quantity;
      const item_total = Math.round(rate * quantity * 100) / 100;

      lineItems.push({
        item_id: catalogItem.item_id,
        name: catalogItem.name,
        description: itemPayload.description || catalogItem.description,
        quantity,
        rate,
        item_total,
      });

      subtotal += item_total;
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const taxTotal = 0; // standard tax can be added here
    const total = subtotal + taxTotal;

    const padNumber = String(this.invoiceCounter++).padStart(4, '0');
    const invoiceId = `inv_mock_${padNumber}`;
    const invoiceNumber = `INV-2026-${padNumber}`;
    const now = new Date();
    const dueDate = new Date();
    dueDate.setDate(now.getDate() + 15); // default 15 days net

    const invoice: Invoice = {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      reference_number: payload.reference_number,
      customer_id: customer.customer_id,
      customer_name: customer.company_name,
      date: payload.date || now.toISOString().split('T')[0]!,
      due_date: payload.due_date || dueDate.toISOString().split('T')[0]!,
      currency: 'USD',
      line_items: lineItems,
      subtotal,
      tax_total: taxTotal,
      total,
      status: 'draft',
      pdf_url: `/api/zoho/invoices/${invoiceId}/pdf`,
      created_at: now.toISOString(),
    };

    // Store in-memory
    this.invoices.set(invoiceId, invoice);
    this.referenceIndex.set(payload.reference_number, invoiceId);

    return invoice;
  }

  async getInvoicePdf(invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Generate a clean mock representation explicitly labeled as simulated test data
    const textContent = [
      '====================================================',
      '        SIMULATED MOCK INVOICE (FICTIONAL)          ',
      ' NOTE: This is a simulated test invoice for testing.',
      ' It is NOT a real Zoho Books invoice or real PDF.   ',
      '====================================================',
      `Invoice Number : ${invoice.invoice_number}`,
      `Date           : ${invoice.date}`,
      `Due Date       : ${invoice.due_date}`,
      `Reference      : ${invoice.reference_number}`,
      `Customer       : ${invoice.customer_name}`,
      `Status         : ${invoice.status.toUpperCase()} (SIMULATED)`,
      '----------------------------------------------------',
      'Items:',
      ...invoice.line_items.map(
        (item, idx) =>
          ` ${idx + 1}. ${item.name} x ${item.quantity} @ $${item.rate.toFixed(2)} = $${item.item_total.toFixed(2)}`
      ),
      '----------------------------------------------------',
      `Subtotal       : $${invoice.subtotal.toFixed(2)}`,
      `Tax            : $${invoice.tax_total.toFixed(2)}`,
      `TOTAL AMOUNT   : $${invoice.total.toFixed(2)} ${invoice.currency}`,
      '====================================================',
      'Fictional Test Data - No real transaction occurred',
      '====================================================',
    ].join('\n');

    const buffer = Buffer.from(textContent, 'utf-8');
    const filename = `${invoice.invoice_number}-mock.txt`;
    return { buffer, filename };
  }
}

// Export singleton instance for the app
export const zohoMockService = new ZohoMockService();
