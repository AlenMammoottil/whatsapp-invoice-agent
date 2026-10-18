import { IZohoService } from './zohoInterface.js';
import {
  Customer,
  ProductItem,
  CreateInvoicePayload,
  Invoice,
  InvoiceLineItem
} from '../types/schemas.js';
import { DuplicateInvoiceError, CustomerNotFoundError, ItemNotFoundError } from './zohoMockService.js';

export interface ZohoAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  organizationId: string;
  baseUrl?: string;
  accountsUrl?: string;
}

export class ZohoRealService implements IZohoService {
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private organizationId: string;
  private baseUrl: string;
  private accountsUrl: string;

  private cachedAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config?: Partial<ZohoAuthConfig>) {
    this.clientId = config?.clientId || process.env['ZOHO_CLIENT_ID'] || '';
    this.clientSecret = config?.clientSecret || process.env['ZOHO_CLIENT_SECRET'] || '';
    this.refreshToken = config?.refreshToken || process.env['ZOHO_REFRESH_TOKEN'] || '';
    this.organizationId = config?.organizationId || process.env['ZOHO_ORGANIZATION_ID'] || '';
    this.baseUrl = config?.baseUrl || process.env['ZOHO_BASE_URL'] || 'https://www.zohoapis.com/books/v3';
    this.accountsUrl = config?.accountsUrl || process.env['ZOHO_ACCOUNTS_URL'] || 'https://accounts.zoho.com';
  }

  /**
   * Refreshes or returns the active OAuth2 access token
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if valid for at least another 60 seconds
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.cachedAccessToken;
    }

    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new Error(
        'Zoho Books OAuth2 credentials missing. Please set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in .env'
      );
    }

    const tokenUrl = `${this.accountsUrl}/oauth/v2/token?refresh_token=${encodeURIComponent(
      this.refreshToken
    )}&client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(
      this.clientSecret
    )}&grant_type=refresh_token`;

    const res = await fetch(tokenUrl, { method: 'POST' });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to refresh Zoho access token (${res.status}): ${errorText}`);
    }

    const data: any = await res.json();
    if (data.error) {
      throw new Error(`Zoho OAuth error: ${data.error}`);
    }

    this.cachedAccessToken = data.access_token;
    // expires_in is in seconds
    const expiresInMs = (data.expires_in || 3600) * 1000;
    this.tokenExpiresAt = Date.now() + expiresInMs;

    return this.cachedAccessToken!;
  }

  /**
   * Internal helper to make authorized Zoho API requests
   */
  private async requestZoho<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${endpoint}${separator}organization_id=${encodeURIComponent(this.organizationId)}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json;charset=UTF-8',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Detect duplicate reference number error
      if (errorText.toLowerCase().includes('already exists') || errorText.toLowerCase().includes('duplicate')) {
        throw new Error(`Duplicate entry in Zoho Books: ${errorText}`);
      }
      throw new Error(`Zoho API error [${response.status}] on ${endpoint}: ${errorText}`);
    }

    return (await response.json()) as T;
  }

  async getCustomers(): Promise<Customer[]> {
    const data = await this.requestZoho<{ contacts: any[] }>('/contacts?contact_type=customer');
    return (data.contacts || []).map((c) => ({
      customer_id: c.contact_id,
      company_name: c.company_name || c.contact_name,
      contact_name: c.contact_name,
      email: c.email,
      phone: c.phone,
      aliases: [c.company_name, c.contact_name].filter(Boolean),
    }));
  }

  async findCustomer(query: string): Promise<Customer[]> {
    const q = query.trim().toLowerCase();
    const data = await this.requestZoho<{ contacts: any[] }>(
      `/contacts?contact_type=customer&search_text=${encodeURIComponent(q)}`
    );

    return (data.contacts || []).map((c) => ({
      customer_id: c.contact_id,
      company_name: c.company_name || c.contact_name,
      contact_name: c.contact_name,
      email: c.email,
      phone: c.phone,
      aliases: [c.company_name, c.contact_name].filter(Boolean),
    }));
  }

  async getItems(): Promise<ProductItem[]> {
    const data = await this.requestZoho<{ items: any[] }>('/items');
    return (data.items || []).map((i) => ({
      item_id: i.item_id,
      name: i.name,
      description: i.description || '',
      rate: i.rate || 0,
      unit: i.unit || 'unit',
      aliases: [i.name],
    }));
  }

  async findItems(query: string): Promise<ProductItem[]> {
    const q = query.trim();
    const data = await this.requestZoho<{ items: any[] }>(
      `/items?search_text=${encodeURIComponent(q)}`
    );

    return (data.items || []).map((i) => ({
      item_id: i.item_id,
      name: i.name,
      description: i.description || '',
      rate: i.rate || 0,
      unit: i.unit || 'unit',
      aliases: [i.name],
    }));
  }

  async getInvoiceByReference(referenceNumber: string): Promise<Invoice | null> {
    try {
      const data = await this.requestZoho<{ invoices: any[] }>(
        `/invoices?reference_number=${encodeURIComponent(referenceNumber)}`
      );
      if (data.invoices && data.invoices.length > 0) {
        return this.getInvoice(data.invoices[0].invoice_id);
      }
      return null;
    } catch {
      return null;
    }
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    try {
      const data = await this.requestZoho<{ invoice: any }>(`/invoices/${invoiceId}`);
      const inv = data.invoice;
      if (!inv) return null;

      const lineItems: InvoiceLineItem[] = (inv.line_items || []).map((li: any) => ({
        item_id: li.item_id,
        name: li.name,
        description: li.description || '',
        quantity: li.quantity,
        rate: li.rate,
        item_total: li.item_total,
      }));

      return {
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        reference_number: inv.reference_number || '',
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
        date: inv.date,
        due_date: inv.due_date,
        currency: inv.currency_code || 'USD',
        line_items: lineItems,
        subtotal: inv.sub_total || 0,
        tax_total: inv.tax_total || 0,
        total: inv.total || 0,
        status: inv.status || 'draft',
        pdf_url: `/api/zoho/invoices/${inv.invoice_id}/pdf`,
        created_at: inv.created_time || new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async createInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
    // 1. Check for duplicate reference
    const existing = await this.getInvoiceByReference(payload.reference_number);
    if (existing) {
      throw new DuplicateInvoiceError(payload.reference_number, existing.invoice_id);
    }

    // 2. Format Zoho invoice payload
    const zohoBody = {
      customer_id: payload.customer_id,
      reference_number: payload.reference_number,
      date: payload.date || new Date().toISOString().split('T')[0],
      due_date: payload.due_date,
      line_items: payload.line_items.map((li) => ({
        item_id: li.item_id,
        quantity: li.quantity,
        rate: li.rate,
        description: li.description,
      })),
      notes: payload.notes,
    };

    const res = await this.requestZoho<{ invoice: any }>('/invoices', {
      method: 'POST',
      body: JSON.stringify(zohoBody),
    });

    return this.getInvoice(res.invoice.invoice_id) as Promise<Invoice>;
  }

  async getInvoicePdf(invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/invoices/${invoiceId}?accept=pdf&organization_id=${encodeURIComponent(
      this.organizationId
    )}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download Zoho invoice PDF (${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return { buffer, filename: `Invoice_${invoiceId}.pdf` };
  }
}
