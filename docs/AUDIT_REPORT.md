# AUDIT REPORT: WhatsApp Invoice Agent

**Date:** 2026-10-19  
**Auditor:** Senior Full-Stack Engineer, AI Agent Architect & QA Reviewer  
**Repository:** `whatsapp-invoice-agent`  
**Target Specification:** Screening Task — WhatsApp Message → Zoho Books Invoice Agent  

---

## 1. Executive Summary

This audit evaluates the existing implementation of `whatsapp-invoice-agent` against all core and bonus requirements from the screening task specification (`whatsapp-invoice-screening-task.pdf`) and engineering guidelines.

The project already possesses a solid architectural foundation:
- Modular TypeScript / ES Module structure with Express API and Baileys WhatsApp integration.
- Live Zoho Books API client with OAuth2 token auto-refresh and an in-memory mock service.
- Dual LLM provider support (Google Gemini + Groq/Llama via OpenAI-compatible endpoints) and heuristic fallback.
- Test suites for mock services, LLM classification, agent orchestration, and WhatsApp event simulation.

However, several critical gaps, architectural vulnerabilities, and domain misalignments were identified:
1. **Matching Logic Vulnerabilities:** Customer and item matching in `MatchingService` selects `customerMatches[0]` or `itemMatches[0]` regardless of whether an exact match exists at an index > 0. Fuzzy substring matches are treated as full matches without confidence scoring, and suggestions are unranked slices rather than relevance-ranked.
2. **Product Variant / Size Disambiguation:** In trading businesses (e.g. tyres / automotive), items share prefixes but differ by critical variants (e.g., `Car Tyre 13-inch` vs `Car Tyre 14-inch`, `Alloy Wheel 18"` vs `17"`). The matching engine does not reliably disambiguate size/spec tokens.
3. **Price Safety & Rate Policy:** The current implementation allows extracted rates from LLMs to directly overwrite the catalog price without safety validation, explicit human approval, or audit tagging.
4. **Approval & Confirmation Workflow:** Invoices are created automatically upon extraction without a preview-and-confirm step. An unreviewed LLM misinterpretation can result in an erroneous invoice created in Zoho Books.
5. **Deduplication Persistence:** Deduplication keys and state are kept strictly in ephemeral memory, meaning server restarts erase duplicate protection and pending approvals.
6. **Master Data & Dataset Realism:** The real Zoho Books account contains automotive/tyre items (`Car Tyre 13-inch`, `SUV Tyre 16-inch`, `Metro Tyres`, etc.), whereas the mock service and evaluation dataset were previously centered on generic tech/office services (`Cloud Hosting`, `Web Dev`).
7. **Evaluation Benchmark Robustness:** The evaluation runner previously encountered Zod schema errors when real LLMs returned `null` for optional strings/numbers and had no exponential backoff for transient 503/429 spikes.

---

## 2. Screening Task Requirements Checklist

| Requirement | Category | Current Status | Audit Finding |
|---|:---:|:---:|---|
| **1. WhatsApp connection using Baileys** | Core | ✅ Working | Implemented in `src/services/whatsappService.ts`. Group-only listening, QR terminal/web UI, simulation endpoint. |
| **2. Zoho Books Master Data (8-10 cust, 15-20 items)** | Core | ⚠️ Partial | Live Zoho Books org configured with 10 tyre customers and 10 tyre items. Mock catalog has only 5 customers and 6 tech items. Needs synchronization so tests work offline and online. |
| **3. Zoho Books API Integration & Token Refresh** | Core | ✅ Working | Implemented in `src/services/zohoRealService.ts`. Regional support, token refresh, invoice creation, PDF fetch. Verified with live Zoho API. |
| **4. LLM Intent Classification & Entity Extraction** | Core | ⚠️ Partial | Implemented for Gemini and Groq. Needs improved prompt hardening, null handling, and quantity clarification logic. |
| **5. Customer & Item Matching (Resolving messy names)** | Core | ❌ Defective | Index 0 bias, size variant confusion, unranked suggestions, loose substring false positives. |
| **6. Ambiguity Handling & Clarification Questions** | Core | ⚠️ Partial | Basic ambiguity check exists for items with identical queries, but fails on variant tokens and customer aliases. |
| **7. Price Safety & Rate Policy** | Core | ❌ Incomplete | Extracts rates from LLM without verification against catalog. Lacks rate override approval policy. |
| **8. Preview-and-Confirm Approval Workflow** | Core | ❌ Missing | Agent creates invoices immediately without human confirmation. Needs preview summary and confirm/cancel flow. |
| **9. Duplicate Protection & Idempotency** | Core | ⚠️ Partial | Hash-based reference key implemented, but strictly in-memory. Lacks persistent state across restarts. |
| **10. Evaluation Framework (≥30 test cases)** | Core | ⚠️ Partial | 35 cases exist, but centered on legacy hosting/consulting items. Needs alignment with tyre domain, comparison of 2 LLMs, and per-field metrics. |
| **11. Compare 2 LLM Providers (Gemini vs Groq)** | Core | ⚠️ Partial | Both providers implemented and credentials verified. Benchmark runner needs retry backoff and comparative reporting. |
| **12. Automated Test Suite** | Core | ⚠️ Partial | 39 passing unit tests, 1 assertion mismatch in `agentService.test.ts`. Needs extensive tests for new matching, pricing, and approval logic. |
| **13. Documentation (Architecture, Eval, Design, Demo)** | Core | ⚠️ Partial | Legacy README exists. Needs `ARCHITECTURE.md`, `EVALUATION.md`, `DESIGN_DECISIONS.md`, and `DEMO_SCRIPT.md`. |
| **Bonus 1: Previous Invoice Rate Lookup ("same as last time")** | Bonus | ❌ Missing | Not yet implemented. |
| **Bonus 2: Edit/Re-issue ("make it 6 pcs")** | Bonus | ❌ Missing | Not yet implemented. |
| **Bonus 3: Minimal Web UI / Log View** | Bonus | ✅ Working | Express dashboard at `/whatsapp` with status, QR code, and simulation console. |

---

## 3. Prioritized Implementation Plan

### Phase 1: Master Data & Catalog Realism
- Update `zohoMockService.ts` to include the realistic tyre & automotive master catalog (10 customers, 10+ items with conflicting sizes, brands, and variants) matching the live Zoho organization.
- Keep aliases comprehensive to support realistic sales representative shorthand (`"VK"`, `"ABC"`, `"Metro"`, `"14 inch"`, `"scooter tyres"`).

### Phase 2: Customer & Item Matching Engine Overhaul
- Rewrite `MatchingService` with a deterministic, multi-tier ranking algorithm:
  1. Exact Normalized Match (Name & Approved Aliases) — prioritize over all others regardless of index.
  2. Specification & Variant Disambiguation (extract and compare size/inch/colour/brand attributes).
  3. Ambiguity Detection (detect when query matches multiple variants e.g. "car tyre" -> 13", 14", 15", 16").
  4. Scored Fuzzy / Shorthand Match with strict confidence threshold.
  5. Relevance-ranked suggestions for unresolvable queries (Levenshtein / token overlap).
- Ensure an omitted customer or item never guesses silently.

### Phase 3: Quantity & Pricing Policy Hardening
- **Quantity Policy:** If quantity is missing or unstated, ask for clarification instead of guessing or silently defaulting to 1 (unless explicitly framed as a singular unit like "an invoice for a car tyre").
- **Pricing Policy:**
  - Retrieve authoritative price from matched Zoho item.
  - If sender does not state a price, use catalog price (`source: "catalog"`).
  - If sender states a price matching catalog, accept (`source: "catalog"`).
  - If sender states a custom price, flag as `PRICE_OVERRIDE` and require explicit confirmation (`source: "explicit_override"`).
  - Add tests proving LLM cannot silently alter catalog rates.

### Phase 4: Preview-and-Confirm Approval Workflow & Persistence
- Add pending approval lifecycle:
  - When invoice is resolved, send formatted Preview Message with: Customer, Items, Quantities, Unit Rates, Tax, Total, and notice of any price override.
  - Require reply: `Confirm <Ref>` or `Cancel <Ref>`.
  - Enforce timeout (default: 15 minutes) and group/sender binding.
- Add lightweight persistent storage (file-backed JSON store in `data/state.json`) for reference index, invoices, and pending approvals so state survives server restarts.

### Phase 5: Evaluation Framework & LLM Benchmark
- Update `src/evaluation/dataset.ts` with 35+ realistic tyre & trading sales rep messages across all categories (clean, shorthand, ambiguous variants, confusable customers, price overrides, questions, chitchat).
- Enhance `runBenchmark.ts` to compare Gemini 3.1 Flash Lite and Groq GPT-OSS-20B across all metrics.
- Record real benchmark results in `EVALUATION_REPORT.md` and `docs/EVALUATION.md`.

### Phase 6: Automated Test Suite & Documentation
- Fix existing assertion mismatch in `agentService.test.ts`.
- Add test suites for:
  - Exact match at index > 0.
  - Variant disambiguation (13-inch vs 14-inch).
  - Ambiguous variant clarification.
  - Price override approval policy.
  - Preview-confirm approval workflow and cancellation.
  - Duplicate message protection with persistence.
- Complete all required documentation:
  - `README.md`
  - `docs/ARCHITECTURE.md`
  - `docs/EVALUATION.md`
  - `docs/DESIGN_DECISIONS.md`
  - `docs/DEMO_SCRIPT.md`
  - `docs/FINAL_VERIFICATION.md`

---
*Status: Audit complete. Proceeding with Phase 1.*
