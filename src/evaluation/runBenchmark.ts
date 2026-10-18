import fs from 'fs';
import path from 'path';
import { Evaluator, EvaluationSummary } from './evaluator.js';

async function runBenchmark() {
  console.log('\n===============================================================');
  console.log('📊 WHATSAPP INVOICE AGENT - LLM EVALUATION BENCHMARK');
  console.log('Comparing 2 Evaluation Providers across 35 Test Messages');
  console.log('===============================================================\n');

  // Determine provider 1 and provider 2
  const hasGeminiKey = Boolean(process.env['GEMINI_API_KEY']);
  const hasOpenAIKey = Boolean(process.env['OPENAI_API_KEY'] || process.env['GROQ_API_KEY']);

  const provider1Name = hasGeminiKey ? 'gemini' : 'heuristic';
  const provider2Name = hasOpenAIKey ? 'openai' : 'heuristic-fast';

  console.log(`🔍 Running Provider 1: [${provider1Name}] on 35 test cases...`);
  const summary1 = await Evaluator.evaluateProvider(provider1Name);
  console.log(`✅ Provider 1 [${provider1Name}] completed in avg ${summary1.avgLatencyMs}ms\n`);

  console.log(`🔍 Running Provider 2: [${provider2Name}] on 35 test cases...`);
  const summary2 = await Evaluator.evaluateProvider(provider2Name);
  console.log(`✅ Provider 2 [${provider2Name}] completed in avg ${summary2.avgLatencyMs}ms\n`);

  // Render Markdown Table
  const table = [
    '| Evaluation Metric | Provider 1 (' + summary1.providerName + ') | Provider 2 (' + summary2.providerName + ') | Delta |',
    '|---|:---:|:---:|:---:|',
    `| **Intent Classification Accuracy** | **${summary1.intentAccuracy}%** | **${summary2.intentAccuracy}%** | ${summary1.intentAccuracy - summary2.intentAccuracy >= 0 ? '+' : ''}${summary1.intentAccuracy - summary2.intentAccuracy}% |`,
    `| **Customer Identification Accuracy** | **${summary1.customerAccuracy}%** | **${summary2.customerAccuracy}%** | ${summary1.customerAccuracy - summary2.customerAccuracy >= 0 ? '+' : ''}${summary1.customerAccuracy - summary2.customerAccuracy}% |`,
    `| **Product Matching Accuracy** | **${summary1.productAccuracy}%** | **${summary2.productAccuracy}%** | ${summary1.productAccuracy - summary2.productAccuracy >= 0 ? '+' : ''}${summary1.productAccuracy - summary2.productAccuracy}% |`,
    `| **Quantity Extraction Accuracy** | **${summary1.quantityAccuracy}%** | **${summary2.quantityAccuracy}%** | ${summary1.quantityAccuracy - summary2.quantityAccuracy >= 0 ? '+' : ''}${summary1.quantityAccuracy - summary2.quantityAccuracy}% |`,
    `| **Rate Extraction Accuracy** | **${summary1.rateAccuracy}%** | **${summary2.rateAccuracy}%** | ${summary1.rateAccuracy - summary2.rateAccuracy >= 0 ? '+' : ''}${summary1.rateAccuracy - summary2.rateAccuracy}% |`,
    `| **Clarification Behavior Accuracy** | **${summary1.clarificationAccuracy}%** | **${summary2.clarificationAccuracy}%** | ${summary1.clarificationAccuracy - summary2.clarificationAccuracy >= 0 ? '+' : ''}${summary1.clarificationAccuracy - summary2.clarificationAccuracy}% |`,
    `| **Confidently Incorrect Count (lower is better)** | **${summary1.confidentlyIncorrectCount}** (${summary1.confidentlyIncorrectRate}%) | **${summary2.confidentlyIncorrectCount}** (${summary2.confidentlyIncorrectRate}%) | ${summary1.confidentlyIncorrectCount - summary2.confidentlyIncorrectCount} |`,
    `| **Average Latency (lower is better)** | **${summary1.avgLatencyMs} ms** | **${summary2.avgLatencyMs} ms** | ${summary1.avgLatencyMs - summary2.avgLatencyMs} ms |`,
    `| **95th Percentile Latency (P95)** | **${summary1.p95LatencyMs} ms** | **${summary2.p95LatencyMs} ms** | ${summary1.p95LatencyMs - summary2.p95LatencyMs} ms |`,
  ].join('\n');

  console.log(table);
  console.log('\n===============================================================\n');

  // Build full report markdown
  const reportMarkdown = `# WhatsApp Invoice Agent - LLM Benchmark Report

Generated at: ${new Date().toISOString()}
Total Test Cases: 35 ground-truth annotated WhatsApp messages

## Summary Comparison Table

${table}

## Metric Definitions

1. **Intent Classification Accuracy**: Percentage of messages correctly identified as \`INVOICE_REQUEST\`, \`QUESTION\`, or \`GENERAL_CHAT\`.
2. **Customer Identification Accuracy**: Accuracy in resolving informal or abbreviated company names to Zoho Books contacts.
3. **Product Matching Accuracy**: Accuracy in mapping informal product descriptions (e.g. "web dev", "chair") to catalog items.
4. **Quantity Extraction Accuracy**: Precision in extracting numeric quantities and defaulting to 1 when appropriate.
5. **Rate Extraction Accuracy**: Accuracy in extracting unit prices or falling back to Zoho catalog standard prices.
6. **Clarification Behavior**: Correctly asking clarification questions on ambiguous items (e.g. "hosting" -> standard vs premium) or missing critical data.
7. **Confidently Incorrect Predictions**: Cases where the agent created an invoice with incorrect fields or failed to clarify when information was ambiguous (financial risk metric).
8. **Latency**: End-to-end turnaround time in milliseconds.

## Breakdown by Category

| Category | Cases Count | Primary Focus |
|---|:---:|---|
| **Standard Invoices** | 10 | Clean single-item billing with and without explicit rates |
| **Multi-Item Requests** | 5 | Complex requests combining hardware, software, and services |
| **Ambiguity Handling** | 5 | Overlapping catalog items (e.g., standard vs premium hosting) |
| **Missing Information** | 5 | Missing customer, missing items, or unknown customers |
| **Questions / Inquiries** | 5 | Rate inquiries and operational questions |
| **General Chit-Chat** | 5 | Pleasantries, acknowledgments, and conversational messages |

## Test Case Breakdown (Sample)

| Case ID | Message Snippet | Expected Intent | Provider 1 Clarified? | Status |
|---|---|:---:|:---:|:---:|
${summary1.results.slice(0, 15).map(r => `| \`${r.testId}\` | "${r.message.slice(0, 45)}..." | \`${r.expectedIntent}\` | ${r.actualClarification ? 'Yes' : 'No'} | ${r.intentCorrect && r.clarificationCorrect ? '✅ PASS' : '⚠️ REVIEW'} |`).join('\n')}

*(35 total test cases evaluated)*
`;

  // Write files
  fs.writeFileSync(path.resolve('EVALUATION_REPORT.md'), reportMarkdown, 'utf-8');
  fs.writeFileSync(path.resolve('evaluation_results.json'), JSON.stringify({ summary1, summary2 }, null, 2), 'utf-8');

  console.log('📁 Saved benchmark reports to:');
  console.log('   - EVALUATION_REPORT.md');
  console.log('   - evaluation_results.json\n');
}

runBenchmark().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
