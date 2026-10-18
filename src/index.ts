import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import zohoRoutes from './routes/zohoRoutes.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Enable JSON request body parsing
app.use(express.json());

// Mount Zoho Books API routes
app.use('/api/zoho', zohoRoutes);

// Root welcome endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'WhatsApp Invoice Agent',
    description: 'AI-powered invoice assistant for WhatsApp and Zoho Books',
    status: 'running',
    endpoints: {
      health: '/health',
      zoho_customers: '/api/zoho/customers',
      zoho_items: '/api/zoho/items',
      zoho_invoices: '/api/zoho/invoices',
    }
  });
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'whatsapp-invoice-agent',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// Start the Express HTTP server
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 WhatsApp Invoice Agent server started!`);
  console.log(`📡 Local URL: http://localhost:${PORT}`);
  console.log(`🩺 Health check: http://localhost:${PORT}/health`);
  console.log(`==================================================\n`);
});

export default app;
