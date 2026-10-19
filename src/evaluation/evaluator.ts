import { EVALUATION_DATASET, EvaluationTestCase } from './dataset.js';
import { AgentService } from '../services/agentService.js';
import { ZohoMockService } from '../services/zohoMockService.js';
import { storageService } from '../services/storageService.js';

export interface TestCaseResult {
  testId: string;
  message: string;
  salesRep: string;
  expectedIntent: string;
  actualIntent: string;
  intentCorrect: boolean;
  expectedCustomer: string | null;
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
  clarificationPrecision: number; // %
  clarificationRecall: number; // %
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
    storageService.clear();
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
    let trueClarifications = 0;
    let predictedClarifications = 0;
    let correctlyPredictedClarifications = 0;
    let confidentlyIncorrectCount = 0;

    for (const testCase of EVALUATION_DATASET) {
      let output;
      try {
        output = await agent.processIncomingMessage({
          messageText: testCase.message,
          messageId: `eval-${testCase.id}-${Date.now()}`,
          groupId: 'eval-group@g.us',
          providerName,
          autoApprove: true, // Auto-approve so fields can be scored if valid
        });
      } catch (err: any) {
        console.warn(`[Eval] Provider ${providerName} threw error on ${testCase.id}:`, err.message);
        output = {
          intent: 'GENERAL_CHAT' as const,
          replyText: `Error: ${err.message}`,
          clarificationNeeded: false,
          duplicateDetected: false,
          latencyMs: 1000,
        };
      }

      latencies.push(output.latencyMs);

      // 1. Intent Accuracy
      const intentCorrect = output.intent === testCase.expectedIntent;
      if (intentCorrect) correctIntents++;

      // 2. Clarification Behavior
      const clarificationCorrect = output.clarificationNeeded === testCase.shouldClarify;
      if (clarificationCorrect) correctClarifications++;

      if (testCase.shouldClarify) trueClarifications++;
      if (output.clarificationNeeded) predictedClarifications++;
      if (testCase.shouldClarify && output.clarificationNeeded) correctlyPredictedClarifications++;

      let customerCorrect = true;
      let productCorrect = true;
      let quantityCorrect = true;
      let rateCorrect = true;
      let isConfidentlyIncorrect = false;
      const notesParts: string[] = [];

      // Check invoice fields if it was an invoice request
      if (testCase.expectedIntent === 'INVOICE_REQUEST') {
        // Customer check (when customer should be resolved)
        if (testCase.expectedCustomer && !testCase.shouldClarify) {
          customerEligible++;
          const actualCust = output.invoice?.customer_name || '';
          customerCorrect = actualCust.toLowerCase().includes(testCase.expectedCustomer.toLowerCase());
          if (customerCorrect) {
            correctCustomers++;
          } else {
            notesParts.push(`Expected customer "${testCase.expectedCustomer}" but got "${actualCust}"`);
          }
        }

        // Product, quantity, rate check
        if (testCase.expectedItems && testCase.expectedItems.length > 0 && !testCase.shouldClarify) {
          productEligible++;
          quantityEligible++;
          rateEligible++;

          const actualLineItems = output.invoice?.line_items || [];

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
          // It should have clarified but went ahead and created an invoice or missed ambiguity
          isConfidentlyIncorrect = true;
          confidentlyIncorrectCount++;
          notesParts.push('⚠️ CONFIDENTLY INCORRECT: Failed to ask clarification for ambiguous/missing data');
        }
      }

      results.push({
        testId: testCase.id,
        message: testCase.message,
        salesRep: testCase.salesRep,
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

    const clarificationPrecision = predictedClarifications > 0
      ? Math.round((correctlyPredictedClarifications / predictedClarifications) * 100)
      : 100;
    const clarificationRecall = trueClarifications > 0
      ? Math.round((correctlyPredictedClarifications / trueClarifications) * 100)
      : 100;

    return {
      providerName,
      totalCases,
      intentAccuracy: Math.round((correctIntents / totalCases) * 100),
      customerAccuracy: customerEligible > 0 ? Math.round((correctCustomers / customerEligible) * 100) : 100,
      productAccuracy: productEligible > 0 ? Math.round((correctProducts / productEligible) * 100) : 100,
      quantityAccuracy: quantityEligible > 0 ? Math.round((correctQuantities / quantityEligible) * 100) : 100,
      rateAccuracy: rateEligible > 0 ? Math.round((correctRates / rateEligible) * 100) : 100,
      clarificationAccuracy: Math.round((correctClarifications / totalCases) * 100),
      clarificationPrecision,
      clarificationRecall,
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
