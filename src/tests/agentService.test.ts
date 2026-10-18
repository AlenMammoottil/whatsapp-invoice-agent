import { AgentService } from '../services/agentService.js';
import { ZohoMockService } from '../services/zohoMockService.js';

async function runAgentTests() {
  console.log('🧪 Starting Agent Service Orchestrator Tests...\n');
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

  const zohoMock = new ZohoMockService();
  const agent = new AgentService(zohoMock);

  // Test 1: Happy Path - Clean invoice creation
  const r1 = await agent.processIncomingMessage({
    messageText: 'Please bill Acme Corp for 2 hours of web development @ 150',
    messageId: 'msg-001',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
  });

  assert(r1.intent === 'INVOICE_REQUEST', 'Intent should be INVOICE_REQUEST');
  assert(r1.invoice !== undefined, 'Invoice should be created');
  assert(r1.invoice?.customer_name === 'Acme Corporation', `Customer should match Acme Corporation (got ${r1.invoice?.customer_name})`);
  assert(r1.invoice?.total === 300, `Total should be 300 (got ${r1.invoice?.total})`);
  assert(r1.pdfBuffer !== undefined && r1.pdfBuffer.length > 0, 'PDF buffer should be attached');
  assert(!r1.clarificationNeeded, 'Clarification should NOT be needed');

  // Test 2: Duplicate Prevention
  const r2 = await agent.processIncomingMessage({
    messageText: 'Please bill Acme Corp for 2 hours of web development @ 150',
    messageId: 'msg-001', // Identical message ID in same group
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
  });

  assert(r2.duplicateDetected, 'Should detect duplicate message');
  assert(r2.replyText.includes('Duplicate Request Prevented'), 'Reply text should notify of duplicate');

  // Test 3: Ambiguity Clarification ("hosting" matches multiple products)
  const r3 = await agent.processIncomingMessage({
    messageText: 'Send an invoice to TechNova for 1 hosting',
    messageId: 'msg-002',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
  });

  assert(r3.clarificationNeeded, 'Should require clarification for ambiguous item');
  assert(r3.replyText.includes('which product or plan'), 'Should ask which product or plan');
  assert(r3.replyText.includes('Cloud Hosting Standard'), 'Options should include Cloud Hosting Standard');
  assert(r3.replyText.includes('Cloud Hosting Premium'), 'Options should include Cloud Hosting Premium');

  // Test 4: Unknown Customer Clarification
  const r4 = await agent.processIncomingMessage({
    messageText: 'Bill Mars Colonization Ltd for 1 chair',
    messageId: 'msg-003',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
  });

  assert(r4.clarificationNeeded, 'Should require clarification for unknown customer');
  assert(r4.replyText.includes("couldn't find a customer named"), 'Should state customer was not found');

  // Test 5: Question Intent (No invoice created)
  const r5 = await agent.processIncomingMessage({
    messageText: 'What is our current rate for cloud hosting?',
    messageId: 'msg-004',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
  });

  assert(r5.intent === 'QUESTION', 'Intent should be QUESTION');
  assert(r5.invoice === undefined, 'No invoice should be created for question');
  assert(r5.replyText.includes('Assistant Answer'), 'Should return assistant answer');

  // Test 6: General Chat Intent (No invoice created)
  const r6 = await agent.processIncomingMessage({
    messageText: 'Good morning everyone!',
    messageId: 'msg-005',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
  });

  assert(r6.intent === 'GENERAL_CHAT', 'Intent should be GENERAL_CHAT');
  assert(r6.invoice === undefined, 'No invoice should be created for chat');

  console.log(`\n==================================================`);
  console.log(`Agent Orchestrator Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAgentTests().catch((err) => {
  console.error('Fatal agent test error:', err);
  process.exit(1);
});
