# WhatsApp Invoice Agent - LLM Benchmark Report

Generated at: 2026-10-19T11:09:25.237Z  
Dataset: 35 ground-truth annotated WhatsApp messages (Automotive / Trading Domain)

## 1. Summary Comparison Table

| Evaluation Metric | Provider 1 (gemini) | Provider 2 (groq) | Delta |
|---|:---:|:---:|:---:|
| **Intent Classification Accuracy** | **100%** | **83%** | +17% |
| **Customer Identification Accuracy** | **73%** | **53%** | +20% |
| **Product Matching Accuracy** | **73%** | **53%** | +20% |
| **Quantity Extraction Accuracy** | **73%** | **53%** | +20% |
| **Rate Extraction Accuracy** | **73%** | **53%** | +20% |
| **Clarification Accuracy** | **89%** | **89%** | +0% |
| **Clarification Precision** | **85%** | **91%** | -6% |
| **Clarification Recall** | **85%** | **77%** | +8% |
| **Confidently Incorrect Count (lower is better)** | **2** (6%) | **3** (9%) | -1 |
| **Average Latency (lower is better)** | **6430 ms** | **5740 ms** | 690 ms |
| **95th Percentile Latency (P95)** | **18570 ms** | **10917 ms** | 7653 ms |

## 2. Metric Definitions & Denominators

1. **Intent Classification Accuracy**: Percentage of messages correctly identified as `INVOICE_REQUEST`, `QUESTION`, or `GENERAL_CHAT` (Denominator: 35 total messages).
2. **Customer Identification Accuracy**: Accuracy in resolving company name or sales rep shorthand to the correct Zoho contact (Denominator: eligible invoice requests).
3. **Product Matching Accuracy**: Accuracy in mapping informal product descriptions (sizes, variants, shorthand) to the exact catalog item without confusing sizes (Denominator: eligible invoice requests).
4. **Quantity Extraction Accuracy**: Precision in extracting numeric quantities and defaulting correctly (Denominator: eligible invoice requests).
5. **Rate Extraction Accuracy**: Accuracy in extracting unit rates or applying catalog pricing / handling price overrides (Denominator: eligible invoice requests).
6. **Clarification Behavior**: Correctly asking clarification questions on ambiguous items (e.g. "car tyre" without size -> 13", 14", 15", 16") or confusable customers (e.g. "ABC" -> Tyres vs Wheels) or missing critical data.
7. **Confidently Incorrect Predictions**: Cases where the agent created an invoice with incorrect fields or failed to clarify when information was ambiguous (critical financial risk metric).
8. **Latency**: End-to-end turnaround time in milliseconds (Average & 95th percentile).

## 3. Dataset Breakdown by Category

| Category | Cases Count | Primary Focus |
|---|:---:|---|
| **Standard Invoices** | 6 | Clean single & multi-item billing with and without explicit rates |
| **Messy Sales Rep Shorthand** | 8 | Real-world phrasing, dash separators, abbreviations ("VK", "Gupta Auto", "pcs", "nos") |
| **Ambiguity Handling** | 6 | Overlapping items (car tyre without size, red wheel 4, ABC customer ambiguity) |
| **Missing Information** | 5 | Missing customer, missing items, or unknown customers |
| **Price Overrides** | 3 | Explicit custom rate requests requiring price policy approval |
| **Questions / Inquiries** | 4 | Catalog and pricing queries without invoice intent |
| **General Chit-Chat** | 3 | Greetings, acknowledgments, and operational messages |

## 4. Test Case Breakdown Sample (Top 20 Cases)

| Case ID | Message Snippet | Sales Rep | Expected Intent | Provider 1 Clarified? | Status |
|---|---|---|:---:|:---:|:---:|
| `case_01` | "Please bill Royal Tyre House for 4 units..." | Vikram (Delhi Zone) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_02` | "Invoice National Tyre Centre for 2 Truck..." | Sunil (North Zone) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_03` | "Create invoice for City Motors & Tyres: ..." | Pooja (West Zone) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_04` | "Please bill Metro Tyres for 10 Scooter T..." | Manoj (Central Hub) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_05` | "Bill Acme Corp for 2 hours of web develo..." | Alice (Direct Sales) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_06` | "Generate invoice for TechNova Solutions:..." | Bob (Enterprise) | `INVOICE_REQUEST` | Yes | ⚠️ REVIEW |
| `case_07` | "VK red lenzo alloy 18 inch x 4 rate 5200..." | Rajesh (Field Agent 1) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_08` | "Sharma motors - 17" Lenzo wheel black, 2..." | Anil (Field Agent 2) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_09` | "ABC needs three 14 inch tyres..." | Sunil (Quick Messenger) | `INVOICE_REQUEST` | No | ⚠️ REVIEW |
| `case_10` | "Prepare bill for Metro, five scooter tyr..." | Ramesh (Field Rep) | `INVOICE_REQUEST` | No | ⚠️ REVIEW |
| `case_11` | "Need 2 truck tyres for Royal Tyre House..." | Karan (Commercial) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_12` | "raise inv for Gupta Auto 8 nos 18 alloy ..." | Deepak (Key Accounts) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_13` | "Make an invoice for 2 Car Tyre 13-inch f..." | Vikram (Delhi Zone) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_14` | "National Auto - 4 pcs 17 inch bike tyre..." | Anil (Field Agent 2) | `INVOICE_REQUEST` | No | ✅ PASS |
| `case_15` | "VK red wheel 4..." | Rajesh (Field Agent 1) | `INVOICE_REQUEST` | Yes | ✅ PASS |
| `case_16` | "Invoice ABC for 4 tyres..." | Sunil (Quick Messenger) | `INVOICE_REQUEST` | Yes | ✅ PASS |
| `case_17` | "Please send an invoice to Royal Tyre Hou..." | Vikram (Delhi Zone) | `INVOICE_REQUEST` | Yes | ✅ PASS |
| `case_18` | "Bill City Motors for 2 SUV tyres..." | Pooja (West Zone) | `INVOICE_REQUEST` | Yes | ✅ PASS |
| `case_19` | "Charge TechNova for 1 hosting..." | Bob (Enterprise) | `INVOICE_REQUEST` | Yes | ✅ PASS |
| `case_20` | "Bill National for 2 bike tyres..." | Anil (Field Agent 2) | `INVOICE_REQUEST` | Yes | ✅ PASS |

*(35 total test cases evaluated)*
