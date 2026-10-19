import { AgentService } from '../services/agentService.js';
import { ZohoMockService } from '../services/zohoMockService.js';
import { storageService } from '../services/storageService.js';

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

  // Clear storage for clean test run
  storageService.clear();

  const zohoMock = new ZohoMockService();
  const agent = new AgentService(zohoMock);

  // Test 1: Happy Path - Clean invoice creation (Auto-approved mode)
  const r1 = await agent.processIncomingMessage({
    messageText: 'Please bill Acme Corp for 2 hours of web development @ 150',
    messageId: 'msg-001',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
    autoApprove: true,
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
    autoApprove: true,
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
  assert(r3.replyText.includes('which product'), 'Should ask which product or plan');

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

  // Test 7: Preview-and-Confirm Workflow (Default safe mode without autoApprove)
  const r7 = await agent.processIncomingMessage({
    messageText: 'Please bill Royal Tyre House for 4 units of Car Tyre 14-inch',
    messageId: 'msg-007',
    groupId: 'group-tyres@g.us',
    senderJid: 'rep-01@s.whatsapp.net',
    providerName: 'heuristic',
    autoApprove: false,
  });

  assert(r7.isPendingApproval === true, 'Invoice should generate pending preview instead of immediate creation');
  assert(r7.invoice === undefined, 'No invoice should be created before confirmation');
  assert(r7.replyText.includes('Invoice Preview & Confirmation Required'), 'Should show preview banner');
  assert(r7.replyText.includes('Royal Tyre House'), 'Preview should show Royal Tyre House');
  assert(r7.replyText.includes('CONFIRM'), 'Preview should instruct how to confirm');

  // Test 8: Confirmation command executes the pending invoice
  const r8 = await agent.processIncomingMessage({
    messageText: 'CONFIRM',
    messageId: 'msg-008',
    groupId: 'group-tyres@g.us',
    senderJid: 'rep-01@s.whatsapp.net',
    providerName: 'heuristic',
  });

  assert(r8.invoice !== undefined, 'Confirmed invoice should be created in Zoho Books');
  assert(r8.invoice?.customer_name === 'Royal Tyre House', 'Invoice should be for Royal Tyre House');
  assert(r8.pdfBuffer !== undefined && r8.pdfBuffer.length > 0, 'PDF should be generated upon confirmation');

  // Test 9: Cancellation command discards pending approval
  const r9Draft = await agent.processIncomingMessage({
    messageText: 'Please bill National Tyre Centre for 2 units of Truck Tyre',
    messageId: 'msg-009-draft',
    groupId: 'group-tyres@g.us',
    senderJid: 'rep-02@s.whatsapp.net',
    providerName: 'heuristic',
    autoApprove: false,
  });
  assert(r9Draft.isPendingApproval === true, 'Draft should require confirmation');

  const r9Cancel = await agent.processIncomingMessage({
    messageText: 'CANCEL',
    messageId: 'msg-009-cancel',
    groupId: 'group-tyres@g.us',
    senderJid: 'rep-02@s.whatsapp.net',
    providerName: 'heuristic',
  });
  assert(r9Cancel.replyText.includes('Cancelled'), 'Reply should confirm cancellation');
  assert(r9Cancel.invoice === undefined, 'Cancelled draft must not produce invoice');

  // Test 10: Size variant disambiguation (14-inch vs 13-inch tyre)
  const r10 = await agent.processIncomingMessage({
    messageText: 'Bill Metro Tyres for 2 Car Tyre 14-inch',
    messageId: 'msg-010',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
    autoApprove: true,
  });
  assert(r10.invoice !== undefined, '14-inch car tyre should resolve cleanly');
  assert(r10.invoice?.line_items[0].name === 'Car Tyre 14-inch', 'Must correctly match 14-inch variant');

  // Test 11: Price override warning
  const r11 = await agent.processIncomingMessage({
    messageText: 'Please bill Acme Corp for 1 chair @ 199', // Catalog price is 250
    messageId: 'msg-011',
    groupId: 'group-123@g.us',
    providerName: 'heuristic',
    autoApprove: false,
  });
  assert(r11.isPendingApproval === true, 'Price override requires approval even if auto-approve were enabled');
  assert(r11.replyText.includes('Price Override'), 'Preview must flag price override');

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
