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

  // Test 2: Simulate message execution (autoApprove enabled)
  const simResult = await whatsappService.simulateMessage({
    messageText: 'Please bill Acme Corp for 1 chair @ 250',
    senderName: 'Test Alice',
    groupId: 'test-group@g.us',
    messageId: 'sim-msg-001',
    providerName: 'heuristic',
    autoApprove: true,
  });

  assert(simResult.intent === 'INVOICE_REQUEST', 'Simulated message should have intent INVOICE_REQUEST');
  assert(simResult.invoice !== undefined, 'Simulated message should generate an invoice');
  assert(simResult.invoice?.total === 250, `Invoice total should be 250 (got ${simResult.invoice?.total})`);
  assert(simResult.replyText.includes('Invoice Created Successfully'), 'Reply text should confirm invoice creation');

  // Test 3: Simulate message execution with preview & approval flow
  const previewResult = await whatsappService.simulateMessage({
    messageText: 'Bill Metro Tyres for 2 Car Tyre 14-inch',
    senderName: 'Sales Rep Vikram',
    groupId: 'test-group-approval@g.us',
    senderJid: 'vikram@s.whatsapp.net',
    messageId: 'sim-msg-002',
    providerName: 'heuristic',
    autoApprove: false,
  });

  assert(previewResult.isPendingApproval === true, 'Preview should require approval');
  assert(previewResult.replyText.includes('Confirmation Required'), 'Should instruct confirmation');

  // Test 4: Confirm preview
  const confirmResult = await whatsappService.simulateMessage({
    messageText: 'CONFIRM',
    senderName: 'Sales Rep Vikram',
    groupId: 'test-group-approval@g.us',
    senderJid: 'vikram@s.whatsapp.net',
    messageId: 'sim-msg-003',
    providerName: 'heuristic',
  });

  assert(confirmResult.invoice !== undefined, 'Confirmation should create invoice');
  assert(confirmResult.invoice?.customer_name === 'Metro Tyres', 'Customer should match Metro Tyres');

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
