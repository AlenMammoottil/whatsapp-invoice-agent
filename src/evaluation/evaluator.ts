import { EVALUATION_DATASET, EvaluationTestCase } from './dataset.js';
import { AgentService } from '../services/agentService.js';
import { ZohoMockService } from '../services/zohoMockService.js';

export interface TestCaseResult {
  testId: string;
  message: string;
  expectedIntent: string;
  actualIntent: string;
  intentCorrect: boolean;
  expectedCustomer?: string;
  actualCustomer?: string;
  customerCorrect: boolean;
  productCorrect: boolean;
  quantityCorrect: boolean;
  rateCorrect: boolean;
  expectedClarification: boolean;
  actualClarification: boolean;
  clarificationCorrect: boolean;
  isConfidentlyIncorrect: boolean;
  latencyMs: number;
  notes: string;
}

export interface EvaluationSummary {
  providerName: string;
  totalCases: number;
  intentAccuracy: number; // %
  customerAccuracy: number; // %
  productAccuracy: number; // %
  quantityAccuracy: number; // %
  rateAccuracy: number; // %
  clarificationAccuracy: number; // %
  confidentlyIncorrectCount: number;
  confidentlyIncorrectRate: number; // %
  avgLatencyMs: number;
  p95LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  results: TestCaseResult[];
}

export class Evaluator {
  /**
   * Runs the evaluation dataset against a specific LLM provider
   */
  static async evaluateProvider(providerName: string): Promise<EvaluationSummary> {
    const zohoMock = new ZohoMockService();
    const agent = new AgentService(zohoMock);
    const results: TestCaseResult[] = [];
    const latencies: number[] = [];

    let correctIntents = 0;
    let customerEligible = 0;
    let correctCustomers = 0;
    let productEligible = 0;
    let correctProducts = 0;
    let quantityEligible = 0;
    let correctQuantities = 0;
    let rateEligible = 0;
    let correctRates = 0;
    let correctClarifications = 0;
    let confidentlyIncorrectCount = 0;

    for (const testCase of EVALUATION_DATASET) {
      const output = await agent.processIncomingMessage({
        messageText: testCase.message,
        messageId: `eval-${testCase.id}-${Date.now()}`,
        groupId: 'eval-group@g.us',
        providerName,
      });

      latencies.push(output.latencyMs);

      // 1. Intent Accuracy
      const intentCorrect = output.intent === testCase.expectedIntent;
      if (intentCorrect) correctIntents++;

      // 2. Clarification Behavior
      const clarificationCorrect = output.clarificationNeeded === testCase.shouldClarify;
      if (clarificationCorrect) correctClarifications++;

      let customerCorrect = true;
      let productCorrect = true;
      let quantityCorrect = true;
      let rateCorrect = true;
      let isConfidentlyIncorrect = false;
      const notesParts: string[] = [];

      // Check invoice fields if it was an invoice request
      if (testCase.expectedIntent === 'INVOICE_REQUEST') {
        // Customer check
        if (testCase.expectedCustomer) {
          customerEligible++;
          const actualCust = output.invoice?.customer_name || '';
          customerCorrect = actualCust.toLowerCase().includes(testCase.expectedCustomer.toLowerCase());
          if (customerCorrect) {
            correctCustomers++;
          } else if (!output.clarificationNeeded) {
            notesParts.push(`Expected customer "${testCase.expectedCustomer}" but got "${actualCust}"`);
          }
        }

        // Product, quantity, rate check
        if (testCase.expectedItems && testCase.expectedItems.length > 0 && !testCase.shouldClarify) {
          productEligible++;
          quantityEligible++;
          rateEligible++;

          const actualLineItems = output.invoice?.line_items || [];

          // Compare items
          let matchedItemCount = 0;
          let matchedQuantityCount = 0;
          let matchedRateCount = 0;

          for (const expItem of testCase.expectedItems) {
            const found = actualLineItems.find((li) =>
              li.name.toLowerCase().includes(expItem.name.toLowerCase()) ||
              expItem.name.toLowerCase().includes(li.name.toLowerCase())
            );

            if (found) {
              matchedItemCount++;
              if (found.quantity === expItem.quantity) {
                matchedQuantityCount++;
              }
              if (expItem.rate === undefined || Math.abs(found.rate - expItem.rate) < 0.01) {
                matchedRateCount++;
              }
            }
          }

          productCorrect = matchedItemCount === testCase.expectedItems.length;
          quantityCorrect = matchedQuantityCount === testCase.expectedItems.length;
          rateCorrect = matchedRateCount === testCase.expectedItems.length;

          if (productCorrect) correctProducts++;
          else notesParts.push('Product line items mismatch');

          if (quantityCorrect) correctQuantities++;
          else notesParts.push('Quantity mismatch');

          if (rateCorrect) correctRates++;
          else notesParts.push('Rate mismatch');
        }

        // Confidently Incorrect check:
        // A model is "confidently incorrect" if it produced a created invoice without clarifying,
        // but got the customer, product, or quantity wrong!
        if (!testCase.shouldClarify && output.invoice) {
          if (!customerCorrect || !productCorrect || !quantityCorrect) {
            isConfidentlyIncorrect = true;
            confidentlyIncorrectCount++;
            notesParts.push('⚠️ CONFIDENTLY INCORRECT: Invoice issued with inaccurate fields');
          }
        } else if (testCase.shouldClarify && !output.clarificationNeeded) {
          // It should have clarified but went ahead and created an invoice
          isConfidentlyIncorrect = true;
          confidentlyIncorrectCount++;
          notesParts.push('⚠️ CONFIDENTLY INCORRECT: Failed to ask clarification for ambiguous/missing data');
        }
      }

      results.push({
        testId: testCase.id,
        message: testCase.message,
        expectedIntent: testCase.expectedIntent,
        actualIntent: output.intent,
        intentCorrect,
        expectedCustomer: testCase.expectedCustomer,
        actualCustomer: output.invoice?.customer_name,
        customerCorrect,
        productCorrect,
        quantityCorrect,
        rateCorrect,
        expectedClarification: testCase.shouldClarify,
        actualClarification: output.clarificationNeeded,
        clarificationCorrect,
        isConfidentlyIncorrect,
        latencyMs: output.latencyMs,
        notes: notesParts.join('; ') || 'OK',
      });
    }

    latencies.sort((a, b) => a - b);
    const totalCases = EVALUATION_DATASET.length;
    const avgLatencyMs = Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length);
    const p95Index = Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1);
    const p95LatencyMs = latencies[p95Index] || 0;
    const minLatencyMs = latencies[0] || 0;
    const maxLatencyMs = latencies[latencies.length - 1] || 0;

    return {
      providerName,
      totalCases,
      intentAccuracy: Math.round((correctIntents / totalCases) * 100),
      customerAccuracy: customerEligible > 0 ? Math.round((correctCustomers / customerEligible) * 100) : 100,
      productAccuracy: productEligible > 0 ? Math.round((correctProducts / productEligible) * 100) : 100,
      quantityAccuracy: quantityEligible > 0 ? Math.round((correctQuantities / quantityEligible) * 100) : 100,
      rateAccuracy: rateEligible > 0 ? Math.round((correctRates / rateEligible) * 100) : 100,
      clarificationAccuracy: Math.round((correctClarifications / totalCases) * 100),
      confidentlyIncorrectCount,
      confidentlyIncorrectRate: Math.round((confidentlyIncorrectCount / totalCases) * 100),
      avgLatencyMs,
      p95LatencyMs,
      minLatencyMs,
      maxLatencyMs,
      results,
    };
  }
}
