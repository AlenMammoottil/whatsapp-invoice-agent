import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import zohoRoutes from './routes/zohoRoutes.js';
import llmRoutes from './routes/llmRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import { whatsappService } from './services/whatsappService.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Enable JSON request body parsing
app.use(express.json());

// Mount API routes
app.use('/api/zoho', zohoRoutes);
app.use('/api/llm', llmRoutes);
app.use(whatsappRoutes);

// Root welcome endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'WhatsApp Invoice Agent',
    description: 'AI-powered invoice assistant for WhatsApp and Zoho Books',
    status: 'running',
    endpoints: {
      health: '/health',
      whatsapp_dashboard: '/whatsapp',
      whatsapp_status: '/api/whatsapp/status',
      whatsapp_simulate: 'POST /api/whatsapp/simulate',
      zoho_customers: '/api/zoho/customers',
      zoho_items: '/api/zoho/items',
      zoho_invoices: '/api/zoho/invoices',
      llm_providers: '/api/llm/providers',
      llm_classify: 'POST /api/llm/classify',
      llm_extract: 'POST /api/llm/extract',
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
  console.log(`📱 WhatsApp Dashboard: http://localhost:${PORT}/whatsapp`);
  console.log(`==================================================\n`);

  if (process.env['START_WHATSAPP'] === 'true') {
    console.log('[WhatsApp] Initializing WhatsApp connection...');
    whatsappService.start();
  } else {
    console.log('[WhatsApp] Tip: Visit http://localhost:' + PORT + '/whatsapp to test the instant simulator or set START_WHATSAPP=true in .env to link your phone.');
  }
});

export default app;
