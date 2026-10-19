import { Router, Request, Response } from 'express';
import { ZohoFactory } from '../services/zohoFactory.js';
import { DuplicateInvoiceError, CustomerNotFoundError, ItemNotFoundError } from '../services/zohoMockService.js';
import { CreateInvoicePayloadSchema } from '../types/schemas.js';

const router = Router();

// 0. Check current active Zoho mode (live vs mock)
router.get('/mode', (_req: Request, res: Response) => {
  const isLive = ZohoFactory.isLiveConfigured();
  res.json({
    mode: isLive ? 'live_zoho_api' : 'fictional_mock_catalog',
    isLiveConfigured: isLive,
    message: isLive
      ? 'Connected to live Zoho Books API'
      : 'Operating safely in mock catalog mode (no real credentials needed)',
  });
});

// 1. List or search customers
router.get('/customers', async (req: Request, res: Response) => {
  try {
    const service = ZohoFactory.getService();
    const query = req.query['q'] as string | undefined;
    const customers = query
      ? await service.findCustomer(query)
      : await service.getCustomers();
    res.json({ count: customers.length, customers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. List or search items
router.get('/items', async (req: Request, res: Response) => {
  try {
    const service = ZohoFactory.getService();
    const query = req.query['q'] as string | undefined;
    const items = query
      ? await service.findItems(query)
      : await service.getItems();
    res.json({ count: items.length, items });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Create invoice with duplicate prevention
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const parseResult = CreateInvoicePayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid invoice payload',
        details: parseResult.error.issues,
      });
      return;
    }

    const service = ZohoFactory.getService();
const isLive = ZohoFactory.isLiveConfigured();

// Dry run: validate the request without creating an invoice.
if (req.query['dryRun'] === 'true') {
  const payload = parseResult.data;

  res.status(200).json({
    message: 'Dry run successful. No invoice was created.',
    isDryRun: true,
    isMock: !isLive,
    invoiceRequest: {
      customer_id: payload.customer_id,
      reference_number: payload.reference_number,
      date: payload.date,
      due_date: payload.due_date,
      line_items: payload.line_items,
      notes: payload.notes,
    },
  });
  return;
}

const invoice = await service.createInvoice(parseResult.data);
    res.status(201).json({
      message: isLive ? 'Invoice created in Zoho Books' : 'Mock invoice created successfully (fictional test data)',
      isMock: !isLive,
      invoice,
    });
  } catch (error: any) {
    if (error instanceof DuplicateInvoiceError) {
      res.status(409).json({
        error: 'Duplicate invoice',
        message: error.message,
        referenceNumber: error.referenceNumber,
        existingInvoiceId: error.existingInvoiceId,
      });
      return;
    }
    if (error instanceof CustomerNotFoundError || error instanceof ItemNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 4. Get invoice by ID
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const service = ZohoFactory.getService();
    const invoice = await service.getInvoice(req.params['id'] as string);
    if (!invoice) {
      res.status(404).json({ error: `Invoice ${req.params['id']} not found` });
      return;
    }
    res.json({ invoice });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Download or view invoice PDF
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    const service = ZohoFactory.getService();
    const isLive = ZohoFactory.isLiveConfigured();
    const invoiceId = req.params['id'] as string;
    const { buffer, filename } = await service.getInvoicePdf(invoiceId);

    res.setHeader('Content-Type', isLive ? 'application/pdf' : 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    if (!isLive) {
      res.setHeader('X-Mock-Notice', 'Simulated mock invoice; not a real Zoho Books invoice or real PDF');
    }
    res.send(buffer);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

export default router;
