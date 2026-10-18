import { LLMFactory } from '../services/llm/llmFactory.js';

async function runLLMTests() {
  console.log('🧪 Starting LLM Service Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  const llm = LLMFactory.getProvider('heuristic');

  // Test 1: Classify Invoice Request
  const invoiceMsg = 'Please bill Acme Corp for 2 hours of web development and 1 cloud hosting';
  const c1 = await llm.classifyIntent(invoiceMsg);
  assert(c1.result.intent === 'INVOICE_REQUEST', `Should classify "${invoiceMsg}" as INVOICE_REQUEST (got ${c1.result.intent})`);
  assert(c1.latencyMs >= 0, `Latency should be non-negative (got ${c1.latencyMs}ms)`);

  // Test 2: Classify Question
  const questionMsg = 'What is our current rate for cloud hosting?';
  const c2 = await llm.classifyIntent(questionMsg);
  assert(c2.result.intent === 'QUESTION', `Should classify "${questionMsg}" as QUESTION (got ${c2.result.intent})`);

  // Test 3: Classify General Chat
  const chatMsg = 'Good morning team! Hope everyone had a nice weekend.';
  const c3 = await llm.classifyIntent(chatMsg);
  assert(c3.result.intent === 'GENERAL_CHAT', `Should classify "${chatMsg}" as GENERAL_CHAT (got ${c3.result.intent})`);

  // Test 4: Extract Customer & Items from message
  const extractMsg = 'Bill TechNova Solutions for 3 chairs @ 250 and 1 cloud hosting';
  const extraction = await llm.extractInvoice(extractMsg);

  assert(
    extraction.result.customer_name.toLowerCase().includes('technova'),
    `Customer name should include "technova" (got "${extraction.result.customer_name}")`
  );
  assert(
    extraction.result.items.length >= 1,
    `Should extract at least 1 line item (got ${extraction.result.items.length})`
  );

  const chairItem = extraction.result.items.find((i) => i.raw_item_name.toLowerCase().includes('chair'));
  assert(
    chairItem !== undefined && chairItem.quantity === 3,
    `Should extract 3 chairs (got ${chairItem?.quantity})`
  );

  // Test 5: Fallback behavior in LLMFactory
  const primary = LLMFactory.getPrimaryProvider();
  assert(primary !== null && typeof primary.name === 'string', `Primary provider should be initialized (got ${primary.name})`);

  console.log(`\n==================================================`);
  console.log(`LLM Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runLLMTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
