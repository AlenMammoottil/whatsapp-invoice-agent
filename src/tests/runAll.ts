import { execSync } from 'child_process';

console.log('🚀 Running all test suites...\n');

try {
  console.log('--- 1. Zoho Mock Service Tests ---');
  execSync('npx.cmd tsx src/tests/zohoMock.test.ts', { stdio: 'inherit' });

  console.log('--- 2. LLM Service Tests ---');
  execSync('npx.cmd tsx src/tests/llmService.test.ts', { stdio: 'inherit' });

  console.log('--- 3. Agent Orchestrator Tests ---');
  execSync('npx.cmd tsx src/tests/agentService.test.ts', { stdio: 'inherit' });

  console.log('--- 4. WhatsApp Service Tests ---');
  execSync('npx.cmd tsx src/tests/whatsappService.test.ts', { stdio: 'inherit' });

  console.log('--- 5. Bug-Fix Regression Tests ---');
  execSync('npx.cmd tsx src/tests/bugfixRegression.test.ts', { stdio: 'inherit' });

  console.log('--- 6. LLM Fallback & Resilience Tests ---');
  execSync('npx.cmd tsx src/tests/llmFallback.test.ts', { stdio: 'inherit' });

  console.log('--- 7. Multi-Tenancy Tests ---');
  execSync('npx.cmd tsx src/tests/multiTenancy.test.ts', { stdio: 'inherit' });

  console.log('🎉 ALL TEST SUITES PASSED SUCCESSFULLY!\n');
} catch (error) {
  console.error('\n❌ One or more test suites failed.');
  process.exit(1);
}
