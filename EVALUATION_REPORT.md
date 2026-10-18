# WhatsApp Invoice Agent - LLM Benchmark Report

Generated at: 2026-10-18T12:01:08.014Z
Total Test Cases: 35 ground-truth annotated WhatsApp messages

## Summary Comparison Table

| Evaluation Metric | Provider 1 (heuristic) | Provider 2 (heuristic-fast) | Delta |
|---|:---:|:---:|:---:|
| **Intent Classification Accuracy** | **89%** | **89%** | +0% |
| **Customer Identification Accuracy** | **70%** | **70%** | +0% |
| **Product Matching Accuracy** | **80%** | **80%** | +0% |
| **Quantity Extraction Accuracy** | **80%** | **80%** | +0% |
| **Rate Extraction Accuracy** | **80%** | **80%** | +0% |
| **Clarification Behavior Accuracy** | **89%** | **89%** | +0% |
| **Confidently Incorrect Count (lower is better)** | **2** (6%) | **2** (6%) | 0 |
| **Average Latency (lower is better)** | **0 ms** | **0 ms** | 0 ms |
| **95th Percentile Latency (P95)** | **1 ms** | **1 ms** | 0 ms |

## Metric Definitions

1. **Intent Classification Accuracy**: Percentage of messages correctly identified as `INVOICE_REQUEST`, `QUESTION`, or `GENERAL_CHAT`.
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
| `case_01` | "Please bill Acme Corp for 2 hours of web deve..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_02` | "Generate invoice for TechNova Solutions: 3 ch..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_03` | "Invoice GreenLeaf Organics for 1 Annual Maint..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_04` | "Bill Apex Logistics for 1 UI/UX Design Packag..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_05` | "Please create an invoice to Starlight Media f..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_06` | "Bill Acme for 1 Cloud Hosting Standard at $50..." | `INVOICE_REQUEST` | Yes | ⚠️ REVIEW |
| `case_07` | "Charge TechNova for 1 Cloud Hosting Premium..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_08` | "Send bill to GreenLeaf for 2 ergonomic chairs..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_09` | "Raise invoice for Apex Log: 1 AMC contract @ ..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_10` | "Please invoice Starlight for 1 design package..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_11` | "Bill Acme Corp for 2 hours of web development..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_12` | "Create invoice for TechNova: 4 chairs and 10 ..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_13` | "Invoice GreenLeaf for 1 AMC support and 1 Clo..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_14` | "Please bill Starlight Media for 1 UI/UX Desig..." | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_15` | "Bill Apex Logistics for 2 chairs @ 250 and 1 ..." | `INVOICE_REQUEST` | No | ✅ PASS |

*(35 total test cases evaluated)*
