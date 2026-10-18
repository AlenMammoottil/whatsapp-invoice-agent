import { whatsappService } from '../services/whatsappService.js';

async function runWhatsAppTests() {
  console.log('🧪 Starting WhatsApp Service Tests...\n');
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

  // Test 1: Check initial status
  const status = whatsappService.getStatus();
  assert(status !== null && typeof status.connected === 'boolean', 'Status object should contain connected boolean');

  // Test 2: Simulate message execution
  const simResult = await whatsappService.simulateMessage({
    messageText: 'Please bill Acme Corp for 1 chair @ 250',
    senderName: 'Test Alice',
    groupId: 'test-group@g.us',
    messageId: 'sim-msg-001',
    providerName: 'heuristic',
  });

  assert(simResult.intent === 'INVOICE_REQUEST', 'Simulated message should have intent INVOICE_REQUEST');
  assert(simResult.invoice !== undefined, 'Simulated message should generate an invoice');
  assert(simResult.invoice?.total === 250, `Invoice total should be 250 (got ${simResult.invoice?.total})`);
  assert(simResult.replyText.includes('Invoice Created Successfully'), 'Reply text should confirm invoice creation');

  console.log(`\n==================================================`);
  console.log(`WhatsApp Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runWhatsAppTests().catch((err) => {
  console.error('Fatal WhatsApp test error:', err);
  process.exit(1);
});
