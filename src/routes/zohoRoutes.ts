import { Router, Request, Response } from 'express';
import { zohoMockService, DuplicateInvoiceError, CustomerNotFoundError, ItemNotFoundError } from '../services/zohoMockService.js';
import { CreateInvoicePayloadSchema } from '../types/schemas.js';

const router = Router();

// 1. List or search customers
router.get('/customers', async (req: Request, res: Response) => {
  try {
    const query = req.query['q'] as string | undefined;
    const customers = query
      ? await zohoMockService.findCustomer(query)
      : await zohoMockService.getCustomers();
    res.json({ count: customers.length, customers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. List or search items
router.get('/items', async (req: Request, res: Response) => {
  try {
    const query = req.query['q'] as string | undefined;
    const items = query
      ? await zohoMockService.findItems(query)
      : await zohoMockService.getItems();
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

    const invoice = await zohoMockService.createInvoice(parseResult.data);
    res.status(201).json({ message: 'Invoice created successfully', invoice });
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
    const invoice = await zohoMockService.getInvoice(req.params['id'] as string);
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
    const invoiceId = req.params['id'] as string;
    const { buffer, filename } = await zohoMockService.getInvoicePdf(invoiceId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

export default router;
