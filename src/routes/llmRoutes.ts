import { Router, Request, Response } from 'express';
import { LLMFactory } from '../services/llm/llmFactory.js';

const router = Router();

// 1. List available LLM providers and configuration status
router.get('/providers', (_req: Request, res: Response) => {
  res.json({
    primary: LLMFactory.getPrimaryProvider().name,
    secondary: LLMFactory.getSecondaryProvider().name,
    status: {
      gemini_configured: Boolean(process.env['GEMINI_API_KEY']),
      openai_configured: Boolean(process.env['OPENAI_API_KEY'] || process.env['GROQ_API_KEY']),
      heuristic_configured: true,
    },
  });
});

// 2. Classify message intent (INVOICE_REQUEST, QUESTION, GENERAL_CHAT)
router.post('/classify', async (req: Request, res: Response) => {
  try {
    const { message, provider } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'A string "message" field is required in the request body' });
      return;
    }

    const llm = provider ? LLMFactory.getProvider(provider) : LLMFactory.getPrimaryProvider();
    const classification = await llm.classifyIntent(message);

    res.json(classification);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Extract invoice details from informal message
router.post('/extract', async (req: Request, res: Response) => {
  try {
    const { message, provider } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'A string "message" field is required in the request body' });
      return;
    }

    const llm = provider ? LLMFactory.getProvider(provider) : LLMFactory.getPrimaryProvider();
    const extraction = await llm.extractInvoice(message);

    res.json(extraction);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Get evaluation benchmark summary
router.get('/evaluation/report', async (_req: Request, res: Response) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const reportPath = path.resolve('evaluation_results.json');
    if (fs.existsSync(reportPath)) {
      const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      res.json(data);
      return;
    }
    // If not yet run on disk, run evaluator
    const { Evaluator } = await import('../evaluation/evaluator.js');
    const summary = await Evaluator.evaluateProvider(LLMFactory.getPrimaryProvider().name);
    res.json({ summary1: summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
