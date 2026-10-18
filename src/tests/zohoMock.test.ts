import { ZohoMockService, DuplicateInvoiceError } from '../services/zohoMockService.js';

async function runTests() {
  console.log('🧪 Starting Zoho Mock Service Tests...\n');
  const service = new ZohoMockService();
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

  // Test 1: Get all customers
  const customers = await service.getCustomers();
  assert(customers.length >= 5, 'Should return at least 5 default customers');

  // Test 2: Search customer by alias
  const acmeMatches = await service.findCustomer('acme');
  assert(acmeMatches.length > 0 && acmeMatches[0]?.company_name === 'Acme Corporation', 'Should find Acme Corporation by "acme"');

  // Test 3: Search items - Ambiguity test ("hosting" should return multiple items)
  const hostingItems = await service.findItems('hosting');
  assert(hostingItems.length >= 2, `Searching "hosting" should return 2+ items for ambiguity detection (got ${hostingItems.length})`);

  // Test 4: Create invoice successfully
  const invoice = await service.createInvoice({
    customer_id: 'cust_001',
    reference_number: 'ref-test-001',
    line_items: [
      { item_id: 'item_101', quantity: 2, rate: 150 }, // 300
      { item_id: 'item_102', quantity: 1, rate: 50 },  // 50
    ],
  });
  assert(invoice.total === 350, `Invoice total should be 350 (got ${invoice.total})`);
  assert(invoice.status === 'draft', 'Invoice initial status should be draft');

  // Test 5: Prevent duplicate invoice with identical reference_number
  let caughtDuplicate = false;
  try {
    await service.createInvoice({
      customer_id: 'cust_001',
      reference_number: 'ref-test-001', // same reference number
      line_items: [{ item_id: 'item_101', quantity: 1 }],
    });
  } catch (err) {
    if (err instanceof DuplicateInvoiceError) {
      caughtDuplicate = true;
    }
  }
  assert(caughtDuplicate, 'Should throw DuplicateInvoiceError when using identical reference_number');

  // Test 6: PDF generation
  const pdfData = await service.getInvoicePdf(invoice.invoice_id);
  assert(pdfData.buffer.length > 0, 'PDF buffer should not be empty');
  assert(pdfData.filename.includes('.pdf'), `Filename should have .pdf extension (got ${pdfData.filename})`);

  console.log(`\n==================================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
