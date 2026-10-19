/**
 * Regression tests for LLM provider transient failure fallback:
 * 1. Gemini transient error (HTTP 503) -> Fallback to Groq/Secondary succeeds
 * 2. Gemini transient error (HTTP 429) -> Fallback to Groq/Secondary succeeds
 * 3. Gemini network timeout -> Fallback to Groq/Secondary succeeds
 * 4. Both primary and secondary fail -> Graceful failure handling in AgentService
 * 5. Permanent error (e.g. 400 Bad Request) -> Does not retry indefinitely
 * 6. FallbackProvider extraction fallback when Gemini 503s on extraction
 *
 * All external API calls are strictly mocked. Zero live network calls made.
 */

import { ILLMProvider, ClassificationResponse, ExtractionResponse } from '../services/llm/llmInterface.js';
import { FallbackProvider, isTransientLLMError } from '../services/llm/fallbackProvider.js';
import { AgentService } from '../services/agentService.js';
import { ZohoMockService } from '../services/zohoMockService.js';
import { StorageService } from '../services/storageService.js';

async function runFallbackTests() {
  console.log('🧪 Starting LLM Fallback & Resilience Tests...\n');
  let passed = 0;
  let failed = 0;
  const failedTests: string[] = [];

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}${details ? ` — ${details}` : ''}`);
      failed++;
      failedTests.push(testName);
    }
  }

  // Helper mock provider
  function createMockProvider(opts: {
    name: string;
    model?: string;
    classifyError?: Error;
    extractError?: Error;
    classificationIntent?: 'INVOICE_REQUEST' | 'QUESTION' | 'GENERAL_CHAT';
    extractedCustomer?: string;
    extractedItems?: Array<{ raw_item_name: string; quantity: number | null; rate?: number }>;
  }): ILLMProvider {
    return {
      name: opts.name,
      model: opts.model || 'mock-model-v1',
      async classifyIntent(message: string): Promise<ClassificationResponse> {
        if (opts.classifyError) {
          throw opts.classifyError;
        }
        return {
          result: {
            intent: opts.classificationIntent || 'INVOICE_REQUEST',
            confidence: 0.95,
            reasoning: `Mocked classification by ${opts.name}`,
          },
          latencyMs: 15,
          model: opts.model || 'mock-model-v1',
          provider: opts.name,
        };
      },
      async extractInvoice(message: string): Promise<ExtractionResponse> {
        if (opts.extractError) {
          throw opts.extractError;
        }
        return {
          result: {
            customer_name: opts.extractedCustomer || 'Metro Tyres',
            items: (opts.extractedItems as any) || [
              { raw_item_name: 'Car Tyre 14-inch', quantity: 2, rate: undefined, unit: undefined },
            ],
            currency: 'INR',
            notes: undefined,
            due_date: undefined,
          },
          latencyMs: 20,
          model: opts.model || 'mock-model-v1',
          provider: opts.name,
        };
      },
    };
  }

  // -------------------------------------------------------------------------
  // Test 1: Transient Error Detection Helper
  // -------------------------------------------------------------------------
  {
    assert(isTransientLLMError(new Error('Gemini API error (503): Model high demand')), 'T01: 503 is recognized as transient');
    assert(isTransientLLMError(new Error('OpenAI API error (429): Rate limit exceeded')), 'T01: 429 is recognized as transient');
    assert(isTransientLLMError(new Error('Request timed out after 15000ms')), 'T01: timeout is recognized as transient');
    assert(isTransientLLMError(new Error('fetch failed: ECONNRESET')), 'T01: network error is recognized as transient');
    assert(!isTransientLLMError(new Error('Invalid API key provided')), 'T01: 401/invalid key is not transient');
    assert(!isTransientLLMError(new Error('JSON parse error: unexpected token')), 'T01: parse error is not transient');
  }

  // -------------------------------------------------------------------------
  // Test 2: Gemini 503 -> Automatic Fallback to Groq (Classification)
  // -------------------------------------------------------------------------
  {
    const gemini503Error = new Error('Gemini API error (503): This model is currently experiencing high demand.');
    (gemini503Error as any).status = 503;

    const mockGemini = createMockProvider({
      name: 'gemini',
      classifyError: gemini503Error,
    });

    const mockGroq = createMockProvider({
      name: 'groq',
      model: 'openai/gpt-oss-20b',
      classificationIntent: 'INVOICE_REQUEST',
    });

    const fallbackProvider = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    const res = await fallbackProvider.classifyIntent('Bill Metro Tyres for 2 Car Tyre 14-inch');
    assert(res.result.intent === 'INVOICE_REQUEST', 'T02: Fallback correctly returns classification result from secondary');
    assert(res.provider.includes('groq'), 'T02: Response indicates secondary provider was used');
    assert(res.provider.includes('fallback from gemini'), 'T02: Provider string notes fallback event');
  }

  // -------------------------------------------------------------------------
  // Test 3: Gemini 503 -> Automatic Fallback to Groq (Extraction)
  // -------------------------------------------------------------------------
  {
    const gemini503Error = new Error('Gemini API error (503): This model is currently experiencing high demand.');
    (gemini503Error as any).status = 503;

    const mockGemini = createMockProvider({
      name: 'gemini',
      extractError: gemini503Error,
    });

    const mockGroq = createMockProvider({
      name: 'groq',
      model: 'openai/gpt-oss-20b',
      extractedCustomer: 'Royal Tyre House',
      extractedItems: [{ raw_item_name: 'Truck Tyre', quantity: 4 }],
    });

    const fallbackProvider = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    const res = await fallbackProvider.extractInvoice('Bill Royal Tyre House for 4 Truck Tyres');
    assert(res.result.customer_name === 'Royal Tyre House', 'T03: Extracted customer resolved by secondary');
    assert(res.result.items[0]?.quantity === 4, 'T03: Extracted quantity resolved by secondary');
    assert(res.provider.includes('groq'), 'T03: Provider name marks secondary');
  }

  // -------------------------------------------------------------------------
  // Test 4: Gemini 429 Rate Limit -> Automatic Fallback to Groq
  // -------------------------------------------------------------------------
  {
    const gemini429Error = new Error('Gemini API error (429): Resource has been exhausted (rate limit).');
    (gemini429Error as any).status = 429;

    const mockGemini = createMockProvider({
      name: 'gemini',
      classifyError: gemini429Error,
    });

    const mockGroq = createMockProvider({
      name: 'groq',
      classificationIntent: 'QUESTION',
    });

    const fallback = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    const res = await fallback.classifyIntent('How much does Car Tyre 13-inch cost?');
    assert(res.result.intent === 'QUESTION', 'T04: 429 rate limit triggers fallback to secondary successfully');
  }

  // -------------------------------------------------------------------------
  // Test 5: Gemini Timeout -> Automatic Fallback to Groq
  // -------------------------------------------------------------------------
  {
    const timeoutError = new Error('Gemini request failed: Request timed out after 15000ms');

    const mockGemini = createMockProvider({
      name: 'gemini',
      classifyError: timeoutError,
    });

    const mockGroq = createMockProvider({
      name: 'groq',
      classificationIntent: 'GENERAL_CHAT',
    });

    const fallback = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    const res = await fallback.classifyIntent('Hello team');
    assert(res.result.intent === 'GENERAL_CHAT', 'T05: Network timeout triggers fallback to secondary successfully');
  }

  // -------------------------------------------------------------------------
  // Test 6: Permanent Error (e.g. 400 Bad Request) does NOT fail over
  // -------------------------------------------------------------------------
  {
    const permError = new Error('Gemini API error (400): Invalid argument: API key format invalid');
    (permError as any).status = 400;

    let groqCalled = false;
    const mockGemini = createMockProvider({
      name: 'gemini',
      classifyError: permError,
    });

    const mockGroq: ILLMProvider = {
      name: 'groq',
      model: 'groq-model',
      async classifyIntent() {
        groqCalled = true;
        throw new Error('Should not be called for permanent errors');
      },
      async extractInvoice() {
        groqCalled = true;
        throw new Error('Should not be called for permanent errors');
      },
    };

    const fallback = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    let caught = false;
    try {
      await fallback.classifyIntent('Bill Metro Tyres');
    } catch (err: any) {
      caught = true;
      assert(err.message.includes('400'), 'T06: Permanent error is thrown directly');
    }
    assert(caught, 'T06: Permanent error threw');
    assert(!groqCalled, 'T06: Secondary provider was NOT called for permanent non-transient error');
  }

  // -------------------------------------------------------------------------
  // Test 7: Both Providers Fail -> Error clearly reports both failures
  // -------------------------------------------------------------------------
  {
    const gemini503 = new Error('Gemini API error (503): High demand');
    (gemini503 as any).status = 503;

    const groq503 = new Error('Groq API error (503): Service unavailable');
    (groq503 as any).status = 503;

    const mockGemini = createMockProvider({ name: 'gemini', classifyError: gemini503 });
    const mockGroq = createMockProvider({ name: 'groq', classifyError: groq503 });

    const fallback = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    let caught = false;
    try {
      await fallback.classifyIntent('Bill Metro Tyres');
    } catch (err: any) {
      caught = true;
      assert(err.message.includes('All LLM providers failed'), 'T07: Error message notes both providers failed');
      assert(err.message.includes('gemini'), 'T07: Primary provider named in error');
      assert(err.message.includes('groq'), 'T07: Secondary provider named in error');
    }
    assert(caught, 'T07: Both failing throws clear compound error');
  }

  // -------------------------------------------------------------------------
  // Test 8: End-to-End AgentService with Gemini 503 -> Groq Fallback Success
  // -------------------------------------------------------------------------
  {
    const gemini503 = new Error('Gemini API error (503): Model high demand');
    (gemini503 as any).status = 503;

    const mockGemini = createMockProvider({
      name: 'gemini',
      classifyError: gemini503,
      extractError: gemini503,
    });

    const mockGroq = createMockProvider({
      name: 'groq',
      model: 'openai/gpt-oss-20b',
      classificationIntent: 'INVOICE_REQUEST',
      extractedCustomer: 'Metro Tyres',
      extractedItems: [{ raw_item_name: 'Car Tyre 14-inch', quantity: 2 }],
    });

    const fallbackLLM = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    const storage = StorageService.createForTest();
    const zoho = new ZohoMockService();
    const agent = new AgentService(zoho, storage, fallbackLLM);

    const output = await agent.processIncomingMessage({
      messageText: 'Bill Metro Tyres for 2 Car Tyre 14-inch',
      messageId: 'e2e-fb-001',
      groupId: 'test-group@g.us',
      senderJid: 'user1@s.whatsapp.net',
      autoApprove: false,
    });

    assert(output.intent === 'INVOICE_REQUEST', 'T08: Agent classified intent via fallback provider');
    assert(output.isPendingApproval === true, 'T08: Preview generated successfully despite Gemini 503');
    assert(output.replyText.includes('Metro Tyres'), 'T08: Customer correctly resolved in preview');
    assert(output.replyText.includes('CONFIRM'), 'T08: Confirmation instructions present');
  }

  // -------------------------------------------------------------------------
  // Test 9: End-to-End AgentService when BOTH Providers Fail
  //         Should reply with friendly temporary error notice without crashing
  // -------------------------------------------------------------------------
  {
    const gemini503 = new Error('Gemini API error (503): High demand');
    (gemini503 as any).status = 503;
    const groq503 = new Error('Groq API error (503): Service unavailable');
    (groq503 as any).status = 503;

    const mockGemini = createMockProvider({ name: 'gemini', classifyError: gemini503 });
    const mockGroq = createMockProvider({ name: 'groq', classifyError: groq503 });

    const brokenLLM = new FallbackProvider({
      primary: mockGemini,
      secondary: mockGroq,
    });

    const storage = StorageService.createForTest();
    const zoho = new ZohoMockService();
    const agent = new AgentService(zoho, storage, brokenLLM);

    const output = await agent.processIncomingMessage({
      messageText: 'Bill Metro Tyres for 2 Car Tyre 14-inch',
      messageId: 'e2e-both-fail-001',
      groupId: 'test-group@g.us',
      senderJid: 'user2@s.whatsapp.net',
    });

    assert(
      output.replyText.includes('Temporarily Unavailable') || output.replyText.includes('high demand'),
      'T09: Agent sends graceful temporary-error reply when both providers fail',
      `Got: ${output.replyText.substring(0, 100)}`
    );
    assert(output.invoice === undefined, 'T09: No invoice created when providers fail');
    assert(!output.clarificationNeeded, 'T09: Clarification not triggered on system error');
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n==================================================`);
  console.log(`LLM Fallback Test Results: ${passed} Passed, ${failed} Failed`);
  if (failedTests.length > 0) {
    console.log(`Failed tests:\n${failedTests.map((t) => `  - ${t}`).join('\n')}`);
  }
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runFallbackTests().catch((err) => {
  console.error('Fatal error in fallback tests:', err);
  process.exit(1);
});
