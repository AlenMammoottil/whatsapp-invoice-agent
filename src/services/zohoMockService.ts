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
    // Real Zoho Books Tyre Org Customers
    {
      customer_id: 'cust_tyre_001',
      company_name: 'ABC Tyres & Traders',
      contact_name: 'Rajesh Kumar',
      email: 'rajesh@abctyres.com',
      phone: '+91-9876543210',
      aliases: ['abc tyres', 'abc trading', 'abc tyres & traders', 'abc'],
    },
    {
      customer_id: 'cust_tyre_002',
      company_name: 'ABC Wheels trading',
      contact_name: 'Amit Shah',
      email: 'amit@abcwheels.com',
      phone: '+91-9876543211',
      aliases: ['abc wheels', 'abc wheels trading'],
    },
    {
      customer_id: 'cust_tyre_003',
      company_name: 'City Motors & Tyres',
      contact_name: 'Suresh Patil',
      email: 'suresh@citymotors.com',
      phone: '+91-9876543212',
      aliases: ['city motors', 'city motors & tyres', 'city'],
    },
    {
      customer_id: 'cust_tyre_004',
      company_name: 'City Wheels & Accessories',
      contact_name: 'Vikas Verma',
      email: 'vikas@citywheels.com',
      phone: '+91-9876543213',
      aliases: ['city wheels', 'city accessories'],
    },
    {
      customer_id: 'cust_tyre_005',
      company_name: 'Metro Tyres',
      contact_name: 'Manoj Tiwari',
      email: 'manoj@metrotyres.com',
      phone: '+91-9876543214',
      aliases: ['metro tyres', 'metro', 'metro auto'],
    },
    {
      customer_id: 'cust_tyre_006',
      company_name: 'Metro Wheels',
      contact_name: 'Deepak Chopra',
      email: 'deepak@metrowheels.com',
      phone: '+91-9876543215',
      aliases: ['metro wheels'],
    },
    {
      customer_id: 'cust_tyre_007',
      company_name: 'National Auto Spares',
      contact_name: 'Anil Gupta',
      email: 'anil@nationalauto.com',
      phone: '+91-9876543216',
      aliases: ['national auto', 'national auto spares', 'national'],
    },
    {
      customer_id: 'cust_tyre_008',
      company_name: 'National Tyre Centre',
      contact_name: 'Karan Malhotra',
      email: 'karan@nationaltyre.com',
      phone: '+91-9876543217',
      aliases: ['national tyre', 'national tyre centre', 'national tyres'],
    },
    {
      customer_id: 'cust_tyre_009',
      company_name: 'Royal Tyre House',
      contact_name: 'Harpreet Singh',
      email: 'harpreet@royaltyre.com',
      phone: '+91-9876543218',
      aliases: ['royal tyre', 'royal tyre house', 'royal tyres', 'royal'],
    },
    {
      customer_id: 'cust_tyre_010',
      company_name: 'Royal Wheel House',
      contact_name: 'Jaspreet Singh',
      email: 'jaspreet@royalwheel.com',
      phone: '+91-9876543219',
      aliases: ['royal wheel', 'royal wheel house', 'royal wheels'],
    },
    // Screening Task PDF Specific Customers
    {
      customer_id: 'cust_tyre_011',
      company_name: 'VK Enterprises',
      contact_name: 'Vijay Kumar',
      email: 'vk@vkenterprises.com',
      phone: '+91-9876543220',
      aliases: ['vk', 'vk enterprises', 'vk ent'],
    },
    {
      customer_id: 'cust_tyre_012',
      company_name: 'Sharma Motors',
      contact_name: 'Ramesh Sharma',
      email: 'ramesh@sharmamotors.com',
      phone: '+91-9876543221',
      aliases: ['sharma motors', 'sharma'],
    },
    {
      customer_id: 'cust_tyre_013',
      company_name: 'Gupta Auto Spares',
      contact_name: 'Sunil Gupta',
      email: 'sunil@guptaauto.com',
      phone: '+91-9876543222',
      aliases: ['gupta auto', 'gupta auto spares', 'gupta'],
    },
    // Backward-compatible mock customers for legacy test suites
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
    // Real Zoho Books Tyre Org Items (with variant sizes & specs)
    {
      item_id: 'item_tyre_101',
      name: 'Car Tyre 13-inch',
      description: 'Radial tubeless tyre 155/80 R13 for small hatchbacks',
      rate: 2500.0,
      unit: 'unit',
      aliases: ['13 inch car tyre', 'car tyre 13', '13" car tyre', '13 inch tyre', '13" tyre', '13 inch', '13 tyre'],
    },
    {
      item_id: 'item_tyre_102',
      name: 'Car Tyre 14-inch',
      description: 'Radial tubeless tyre 175/65 R14 for premium hatchbacks & sedans',
      rate: 3000.0,
      unit: 'unit',
      aliases: ['14 inch car tyre', 'car tyre 14', '14" car tyre', '14 inch tyre', '14" tyre', '14 inch', '14 tyre'],
    },
    {
      item_id: 'item_tyre_103',
      name: 'Car Tyre 15-inch',
      description: 'High-performance tyre 185/65 R15 for sedans',
      rate: 3500.0,
      unit: 'unit',
      aliases: ['15 inch car tyre', 'car tyre 15', '15" car tyre', '15 inch tyre', '15" tyre', '15 inch', '15 tyre'],
    },
    {
      item_id: 'item_tyre_104',
      name: 'Car Tyre 16-inch',
      description: 'All-season radial tyre 205/55 R16 for luxury sedans',
      rate: 4000.0,
      unit: 'unit',
      aliases: ['16 inch car tyre', 'car tyre 16', '16" car tyre', '16 inch tyre', '16" tyre', '16 inch', '16 tyre'],
    },
    {
      item_id: 'item_tyre_105',
      name: 'Bike Tyre 17-inch',
      description: 'Motorcycle rear tubeless tyre 100/90-17',
      rate: 1200.0,
      unit: 'unit',
      aliases: ['17 inch bike tyre', 'bike tyre 17', '17" bike tyre', '17 bike tyre'],
    },
    {
      item_id: 'item_tyre_106',
      name: 'Bike Tyre 18-inch',
      description: 'Motorcycle front tubeless tyre 90/90-18',
      rate: 1500.0,
      unit: 'unit',
      aliases: ['18 inch bike tyre', 'bike tyre 18', '18" bike tyre', '18 bike tyre'],
    },
    {
      item_id: 'item_tyre_107',
      name: 'Scooter Tyre',
      description: 'City scooter tubeless tyre 90/100-10 53J',
      rate: 900.0,
      unit: 'unit',
      aliases: ['scooter tyre', 'scooter tyres', 'scooter tire', 'scooter tires', 'scooter', '10 inch scooter tyre'],
    },
    {
      item_id: 'item_tyre_108',
      name: 'SUV Tyre 16-inch',
      description: 'All-terrain SUV tyre 215/65 R16',
      rate: 5000.0,
      unit: 'unit',
      aliases: ['16 inch suv tyre', 'suv tyre 16', '16" suv tyre', '16 suv tyre'],
    },
    {
      item_id: 'item_tyre_109',
      name: 'SUV Tyre 17-inch',
      description: 'All-terrain SUV tyre 235/65 R17',
      rate: 6000.0,
      unit: 'unit',
      aliases: ['17 inch suv tyre', 'suv tyre 17', '17" suv tyre', '17 suv tyre'],
    },
    {
      item_id: 'item_tyre_110',
      name: 'Truck Tyre',
      description: 'Commercial radial truck tyre 10.00 R20 16PR',
      rate: 8000.0,
      unit: 'unit',
      aliases: ['truck tyre', 'truck tyres', 'truck tire', 'truck tires', 'heavy duty truck tyre'],
    },
    // Screening Task PDF Specific Wheel Items
    {
      item_id: 'item_tyre_111',
      name: 'Alloy Wheel 18" Lenzo - Red',
      description: 'Lenzo lightweight performance 18-inch alloy wheel in racing red',
      rate: 5200.0,
      unit: 'unit',
      aliases: ['red lenzo alloy 18 inch', '18 alloy red lenzo', 'red lenzo alloy 18', '18 inch lenzo red', '18" lenzo wheel red'],
    },
    {
      item_id: 'item_tyre_112',
      name: 'Alloy Wheel 17" Lenzo - Red',
      description: 'Lenzo lightweight performance 17-inch alloy wheel in racing red',
      rate: 4800.0,
      unit: 'unit',
      aliases: ['red lenzo alloy 17 inch', '17 alloy red lenzo', 'red lenzo alloy 17', '17 inch lenzo red', '17" lenzo wheel red'],
    },
    {
      item_id: 'item_tyre_113',
      name: 'Alloy Wheel 17" Lenzo - Black',
      description: 'Lenzo matte black 17-inch alloy wheel',
      rate: 4800.0,
      unit: 'unit',
      aliases: ['17" lenzo wheel black', '17 inch lenzo wheel black', 'black lenzo 17', '17 lenzo alloy black'],
    },
    // Legacy mock items for backward compatibility
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
      aliases: ['hosting standard', 'standard hosting', 'cloud host standard', 'shared hosting'],
    },
    {
      item_id: 'item_103',
      name: 'Cloud Hosting Premium',
      description: 'High-performance dedicated cloud hosting - 8 vCPU, 32GB RAM',
      rate: 120.0,
      unit: 'month',
      aliases: ['hosting premium', 'premium hosting', 'dedicated hosting', 'cloud host premium'],
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
        catalog_rate: catalogItem.rate,
        rate_source: itemPayload.rate_source || (itemPayload.rate && itemPayload.rate !== catalogItem.rate ? 'explicit_override' : 'catalog'),
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
      has_price_override: payload.has_price_override || false,
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
