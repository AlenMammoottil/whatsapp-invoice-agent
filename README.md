# WhatsApp Invoice Agent (WhatsApp Message → Zoho Books)

An enterprise-grade, AI-powered conversational agent built with **TypeScript**, **Node.js**, **Express**, and **Baileys (WhatsApp Web API)**. It receives informal, messy invoice requests from sales representatives in a shared WhatsApp group, extracts structured order parameters using dual LLMs (**Google Gemini** & **Groq Llama/GPT-OSS**), matches entities against **Zoho Books**, deterministically disambiguates product variants (such as tyre sizes and models), asks polite clarifying questions when information is ambiguous, enforces an authoritative catalog pricing policy, prevents duplicate billing across server restarts, and returns rich invoice summaries with official PDF attachments directly to the WhatsApp group.

---

## 📑 Table of Contents

- [Screening Task Overview & Domain](#-screening-task-overview--domain)
- [Key Features](#-key-features)
- [Architecture & Workflow](#-architecture--workflow)
- [Technology Stack](#-technology-stack)
- [Project Structure](#-project-structure)
- [Prerequisites & Installation (Windows / PowerShell)](#-prerequisites--installation-windows--powershell)
- [Configuration & Environment Variables](#-configuration--environment-variables)
- [Running the Application](#-running-the-application)
- [Safe Invoice Creation Workflow (Preview & Confirm)](#-safe-invoice-creation-workflow-preview--confirm)
- [Price Safety & Override Policy](#-price-safety--override-policy)
- [Customer & Product Variant Disambiguation](#-customer--product-variant-disambiguation)
- [Automated Test Suite (57 Tests)](#-automated-test-suite-57-tests)
- [Evaluation Benchmark (Gemini vs. Groq on 35 Ground-Truth Cases)](#-evaluation-benchmark-gemini-vs-groq-on-35-ground-truth-cases)
- [Zoho Books Integration (Live OAuth2 vs. Mock Mode)](#-zoho-books-integration-live-oauth2-vs-mock-mode)
- [WhatsApp Phone Linking via Baileys](#-whatsapp-phone-linking-via-baileys)
- [Documentation Index](#-documentation-index)
- [Known Limitations & Security Warnings](#-known-limitations--security-warnings)

---

## 🏢 Screening Task Overview & Domain

Many small and mid-size trading businesses never touch their accounting software. Their sales representatives post informal invoice requests in a WhatsApp group shared with their accounting firm:
- Reps write differently: one puts color first, another size first; one writes `"18 inch"`, another `"18"`.
- Customer names are abbreviated (e.g. `"VK"` for *VK Enterprises*, `"Gupta Auto"` for *Gupta Auto Spares*).
- Products have subtle variants (e.g. `Car Tyre 13-inch`, `Car Tyre 14-inch`, `Car Tyre 15-inch`, `Alloy Wheel 18" Lenzo - Red`).
- Volume is roughly 5–10 requests per day per client.

This agent automates the loop end-to-end: **reads the WhatsApp message, understands it, matches records in Zoho Books, generates an invoice, and replies with the PDF in WhatsApp.**

---

## 🚀 Key Features

1. **WhatsApp Group Ingestion (Baileys):** Listens on WebSocket events, restricted strictly to authorized business groups (`WHATSAPP_GROUP_ID`).
2. **Intent Classification:** Classifies incoming messages into `INVOICE_REQUEST`, `QUESTION`, or `GENERAL_CHAT`.
3. **Structured Entity Extraction:** Extracts customer names, line items, quantities, and explicitly stated rates from natural language.
4. **Deterministic Customer Matching:** Resolves shorthand (`"VK"`, `"ABC"`, `"Metro"`) to Zoho Books contacts. Prioritizes exact matches regardless of database list order and catches multi-candidate ambiguity.
5. **Specification & Variant Disambiguation:** Distinguishes similar items (e.g., `13"`, `14"`, `15"`, `16"` tyres). Never guesses variants silently.
6. **Authoritative Pricing Policy:** Uses the Zoho catalog price as the single source of truth. Rep-requested rate overrides require explicit human approval and trigger high-visibility warnings.
7. **Preview-and-Confirm Workflow:** Presents a 15-minute draft preview before creating invoices in Zoho Books (`CONFIRM` / `CANCEL`).
8. **Persistent Deduplication:** Generates SHA-256 idempotency reference keys (`WA-<HASH>`) stored in `data/agent_state.json` so server restarts never produce duplicate invoices.
9. **Dual Zoho Books Architecture:**
   - **Live Zoho API v3 Mode:** Automated OAuth2 access token refresh using client credentials and refresh token.
   - **Mock Catalog Mode:** Complete in-memory simulation matching the automotive trading catalog.
10. **Dual LLM Provider Evaluation:** Automated benchmark runner testing **Google Gemini** vs. **Groq** across 35 realistic test cases with per-field accuracy and latency metrics.

---

## 📐 Architecture & Workflow

```
[ WhatsApp Group Chat ]
          │ (Baileys Event Listener)
          ▼
[ Deduplication & Idempotency Check ] ──(Duplicate Found)──> [ Resend Existing PDF ]
          │
          ▼ (New Request)
[ Approval Interceptor (CONFIRM / CANCEL) ]
          │
          ▼ (Standard Message)
[ Dual LLM Intent Classification (Gemini / Groq) ]
   ├── QUESTION      ──> [ Query Zoho Catalog & Reply with Price List ]
   ├── GENERAL_CHAT  ──> [ Conversational Reply ]
   └── INVOICE_REQUEST
          │
          ▼
[ LLM Entity Extraction ]
          │
          ▼
[ Deterministic Matching Engine ]
   ├── Customer Resolution (Exact Name / Alias / Ambiguity Check)
   ├── Product Variant Disambiguation (Size / Color / Specification)
   └── Pricing Policy Enforcement (Catalog rate vs. Price Override)
          │
   ┌──────┴────────────────────────────────────┐
   ▼                                           ▼
[ Ambiguous / Missing? ]               [ Clean Match Found ]
   │                                           │
   ▼                                           ▼
[ Polite Clarification Prompt ]        [ Safe Preview & Confirm Workflow ]
(e.g., "Which wheel? 18\" or 17\"?")           ├── If AUTO_APPROVE: Create Invoice in Zoho Books
                                               └── If Standard: Send 15-min Preview Draft
                                                                (Reply CONFIRM to create in Zoho)
```

For comprehensive details on how the LLM and deterministic code divide responsibilities, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 💻 Technology Stack

- **Runtime:** Node.js (v20+ or v24 LTS), ES Modules (`"type": "module"`)
- **Language:** TypeScript 5.8
- **Web Framework:** Express 4.21
- **WhatsApp Integration:** `@whiskeysockets/baileys` v7 (WebSocket client)
- **Validation:** Zod 3.24 (runtime schema enforcement)
- **LLM Integrations:** Google Gemini (`gemini-3.1-flash-lite`), Groq (`openai/gpt-oss-20b`) via OpenAI SDK / native fetch
- **Accounting API:** Zoho Books API v3 (Contacts, Items, Invoices, PDF endpoints)
- **QR Code Generation:** `qrcode` (terminal & browser rendering)
- **Persistence:** Disk-backed JSON state store (`data/agent_state.json`)

---

## 📁 Project Structure

```text
whatsapp-invoice-agent/
├── data/
│   └── agent_state.json        # Persistent deduplication index & pending approvals
├── docs/
│   ├── ARCHITECTURE.md         # Full architecture, data flow & LLM division of responsibility
│   ├── AUDIT_REPORT.md         # Initial audit findings, checklist & gap analysis
│   ├── DEMO_SCRIPT.md          # 2–4 minute video recording demonstration script
│   ├── DESIGN_DECISIONS.md     # In-depth answers to the 8 core screening design questions
│   ├── EVALUATION.md           # LLM benchmark methodology & comparative results table
│   └── FINAL_VERIFICATION.md   # Final QA report with actual commands and test logs
├── src/
│   ├── evaluation/
│   │   ├── dataset.ts          # 35 ground-truth annotated cases across 7 categories
│   │   ├── evaluator.ts        # Per-field accuracy, precision/recall, latency runner
│   │   └── runBenchmark.ts     # CLI benchmark runner comparing Gemini vs. Groq
│   ├── routes/
│   │   ├── llmRoutes.ts        # /api/llm (classify, extract, evaluation report)
│   │   ├── whatsappRoutes.ts   # /whatsapp (Dashboard, simulator, connection status)
│   │   └── zohoRoutes.ts       # /api/zoho (mode, customers, items, invoices, pdf)
│   ├── services/
│   │   ├── llm/
│   │   │   ├── geminiProvider.ts    # Google Gemini client with 429/503 exponential backoff
│   │   │   ├── heuristicProvider.ts # Offline rule-based baseline parser
│   │   │   ├── llmFactory.ts        # Dynamic provider instantiation
│   │   │   ├── llmInterface.ts      # ILLMProvider interface contract
│   │   │   ├── openaiProvider.ts    # Groq / OpenAI client with TPM backoff
│   │   │   └── prompts.ts           # System prompts for intent & entity extraction
│   │   ├── agentService.ts          # Central orchestrator: deduplication, approvals, invoices
│   │   ├── matchingService.ts       # Deterministic customer/item matching & variant logic
│   │   ├── storageService.ts        # File-backed persistence for deduplication & approvals
│   │   ├── whatsappService.ts       # Baileys WebSocket lifecycle, QR handling, PDF dispatch
│   │   ├── zohoFactory.ts           # Dual-mode selector (Live API vs. Mock Service)
│   │   ├── zohoInterface.ts         # IZohoService interface contract
│   │   ├── zohoMockService.ts       # In-memory mock trading catalog (13 cust, 19 items)
│   │   └── zohoRealService.ts       # Live Zoho Books v3 OAuth2 client with auto-refresh
│   ├── tests/
│   │   ├── agentService.test.ts     # 32 orchestrator tests (approvals, duplicates, variants)
│   │   ├── llmService.test.ts       # 8 LLM classification & extraction tests
│   │   ├── runAll.ts                # Master test suite runner
│   │   ├── whatsappService.test.ts  # 9 WhatsApp simulation tests
│   │   └── zohoMock.test.ts         # 8 mock catalog & invoice tests
│   ├── types/
│   │   └── schemas.ts               # Zod schemas for Customers, Items, Invoices, Approvals
│   └── index.ts                     # Express entry point & route mounting
├── tests/
│   └── fixtures/
│       └── evaluation-cases.json    # Exported 35-case ground truth fixture
├── .env.example                     # Safe environment template
├── EVALUATION_REPORT.md             # Benchmark summary comparing Gemini vs. Groq
├── package.json
└── tsconfig.json
```

---

## 🛠 Prerequisites & Installation (Windows / PowerShell)

### Prerequisites
- **Node.js:** v20.x or v24.x LTS ([nodejs.org](https://nodejs.org))
- **npm:** v10.x or v11.x
- **Git**
- **Windows PowerShell**

### 1. Clone & Install
```powershell
git clone https://github.com/AlenMammoottil/whatsapp-invoice-agent.git
cd whatsapp-invoice-agent
npm.cmd install
```

### 2. Configure Environment Variables
Copy the `.env.example` template:
```powershell
Copy-Item .env.example .env
```
Open `.env` and fill in your keys (see next section).

---

## ⚙️ Configuration & Environment Variables

| Variable | Required | Default | Description |
|---|:---:|:---:|---|
| `PORT` | Optional | `3000` | HTTP port for the Express application. |
| `PRIMARY_LLM_PROVIDER` | Optional | `gemini` | Primary model provider (`gemini`, `groq`, `heuristic`). |
| `SECONDARY_LLM_PROVIDER` | Optional | `groq` | Secondary comparison provider (`groq`, `heuristic`). |
| `GEMINI_API_KEY` | Optional | - | Google AI Studio API key. |
| `GEMINI_MODEL` | Optional | `gemini-3.1-flash-lite` | Model name on Google AI Studio. |
| `GROQ_API_KEY` | Optional | - | Free API key from [console.groq.com](https://console.groq.com). |
| `OPENAI_BASE_URL` | Optional | `https://api.groq.com/openai/v1` | Point to Groq or OpenAI base URL. |
| `OPENAI_MODEL` | Optional | `openai/gpt-oss-20b` | Groq model identifier. |
| `AUTO_APPROVE_INVOICES` | Optional | `false` | When `false`, requires `CONFIRM` reply. When `true`, creates immediately if no price override. |
| `ZOHO_CLIENT_ID` | Optional | - | Zoho Developer Console client ID. |
| `ZOHO_CLIENT_SECRET` | Optional | - | Zoho Developer Console client secret. |
| `ZOHO_REFRESH_TOKEN` | Optional | - | Zoho OAuth2 refresh token. |
| `ZOHO_ORGANIZATION_ID` | Optional | - | Zoho Books organization ID. |
| `ZOHO_BASE_URL` | Optional | `https://www.zohoapis.in/books/v3` | Regional API endpoint (`.in` for India, `.com` for US). |
| `START_WHATSAPP` | Optional | `false` | Set to `true` to initialize live Baileys WhatsApp connection. |
| `WHATSAPP_GROUP_ID` | Optional | - | Restrict the bot exclusively to this group JID (`<id>@g.us`). |

> [!NOTE]
> The app works completely **out-of-the-box in Mock Mode with zero API keys required**, falling back gracefully to the heuristic parser and in-memory trading catalog.

---

## 🏃 Running the Application

### 1. Build the TypeScript Project
```powershell
npm.cmd run build
```

### 2. Start Development Server
```powershell
npm.cmd run dev
```
The server will start at `http://localhost:3000`.

### 3. Open the Interactive Dashboard
Navigate to `http://localhost:3000/whatsapp` in your browser. From here you can:
- View the real-time WhatsApp connection status.
- Scan the Baileys QR code.
- Simulate incoming WhatsApp messages with instant feedback.

---

## 🛡️ Safe Invoice Creation Workflow (Preview & Confirm)

In small and mid-size trading companies, an erroneous invoice can disrupt customer relationships and trigger tax adjustment filings. This agent implements a **Human-in-the-Loop Preview & Confirmation Workflow**:

1. **Sales Rep Message:**
   ```text
   VK
   red lenzo alloy 18 inch x 4
   rate 5200
   ```
2. **Agent Preview Draft (Expires in 15 Minutes):**
   ```text
   📋 Invoice Preview & Confirmation Required
   🏢 Customer: VK Enterprises
   🔗 Reference: WA-B4958A91E130

   Line Items:
     1. Alloy Wheel 18" Lenzo - Red (x4) @ ₹5,200.00 = ₹20,800.00
   Subtotal: ₹20,800.00
   Total Due: ₹20,800.00
   ✅ Standard Catalog Pricing Verified.

   👉 Reply CONFIRM to create invoice in Zoho Books.
   👉 Reply CANCEL to discard this draft.
   ```
3. **Confirmation Action:**
   - Any reply matching `CONFIRM` or `CONFIRM WA-B4958A91E130` creates the invoice in Zoho Books and delivers the PDF.
   - Any reply matching `CANCEL` aborts the draft.

---

## 💰 Price Safety & Override Policy

1. **Authoritative Source of Truth:** Unit prices are derived from matched Zoho Books items. The LLM cannot invent or hallucinate rates.
2. **Missing Rate in Message:** Defaults automatically to the Zoho catalog rate (`rateSource: "catalog"`).
3. **Price Override Detection:**
   - If the rep specifies a custom rate that differs from the catalog (e.g. ₹2,200 instead of ₹2,500), the system flags `hasPriceOverride: true`.
   - Automatic invoice creation is blocked. The draft preview displays a high-visibility warning:
     `"⚠️ ATTENTION: Custom Price Override Detected! Requested rate ₹2,200 differs from catalog ₹2,500."`
4. **"Rate Same As Last Time" (Bonus Feature):**
   - If the sales rep writes `"rate same as last time"`, the agent searches historical invoices for that customer in Zoho Books / storage and applies their previous contracted rate.

---

## 🔍 Customer & Product Variant Disambiguation

Automotive trading catalogs contain products that differ only by subtle specifications:
- `Car Tyre 13-inch` (₹2,500)
- `Car Tyre 14-inch` (₹3,000)
- `Car Tyre 15-inch` (₹3,500)
- `Car Tyre 16-inch` (₹4,000)

### Matching Rules:
1. **Size Extraction:** If the message says `"ABC needs three 14 inch tyres"`, the size `14` is extracted and bound strictly to `Car Tyre 14-inch`.
2. **Ambiguity Clarification:** If the message says `"VK red wheel 4"` or `"Invoice Royal for 4 car tyres"` with no size mentioned:
   - The agent detects sister variants in the catalog.
   - **Never guesses!** It prompts:
     `"Which wheel? Alloy Wheel 18\" Lenzo - Red ($5200.00/unit) or Alloy Wheel 17\" Lenzo - Red ($4800.00/unit)?"`
3. **Customer Ambiguity:** `"ABC"` matches both `ABC Tyres & Traders` and `ABC Wheels trading`. The agent asks which client was intended.

---

## 🧪 Automated Test Suite (57 Tests)

Run all unit and integration test suites:
```powershell
npm.cmd test
```

### Test Breakdown
- **Zoho Mock Service Tests (8/8 PASS):** Customer lookups, item search, line total arithmetic, duplicate prevention, PDF generation.
- **LLM Service Tests (8/8 PASS):** Classification of invoice requests, questions, general chat, entity extraction, latency.
- **Agent Orchestrator Tests (32/32 PASS):**
  - Clean invoice creation.
  - Duplicate detection.
  - Ambiguous item & customer clarification prompts.
  - Preview & approval flow (`CONFIRM` creating invoice, `CANCEL` aborting).
  - Price override warnings.
  - Tyre variant size disambiguation (13" vs. 14").
- **WhatsApp Service Tests (9/9 PASS):** Status query, message simulation, preview simulation, confirmation dispatch.

**Total: 57 Passed, 0 Failed.**

---

## 📊 Evaluation Benchmark (Gemini vs. Groq on 35 Ground-Truth Cases)

Run the automated evaluation benchmark:
```powershell
npm.cmd run evaluate
```

The benchmark runs 35 ground-truth annotated sales rep messages across 7 categories (standard, messy shorthand, ambiguous variants, missing info, price overrides, catalog questions, general chat).

### Comparative Results Table (Real Provider Calls)

| Evaluation Metric | Provider 1 (Google Gemini 3.1 Flash Lite) | Provider 2 (Groq GPT-OSS-20B) | Delta |
|---|:---:|:---:|:---:|
| **Intent Classification Accuracy** | **100%** | **83%** | +17% |
| **Customer Identification Accuracy** | **73%** | **53%** | +20% |
| **Product Matching Accuracy** | **73%** | **53%** | +20% |
| **Quantity Extraction Accuracy** | **73%** | **53%** | +20% |
| **Rate Extraction Accuracy** | **73%** | **53%** | +20% |
| **Clarification Accuracy** | **89%** | **89%** | +0% |
| **Clarification Precision** | **85%** | **91%** | -6% |
| **Clarification Recall** | **85%** | **77%** | +8% |
| **Confidently Incorrect Count (lower is better)** | **2 (6%)** | **3 (9%)** | -1 |
| **Average Latency (lower is better)** | **6,430 ms** | **5,740 ms** | +690 ms |
| **95th Percentile Latency (P95)** | **18,570 ms** | **10,917 ms** | +7,653 ms |

Full methodology, confusion breakdown, and test-case listings are available in [docs/EVALUATION.md](docs/EVALUATION.md).

---

## 📚 Documentation Index

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Comprehensive architectural diagram, data flow, LLM vs. deterministic division of responsibility, and persistence design.
- [docs/DESIGN_DECISIONS.md](docs/DESIGN_DECISIONS.md) — Detailed answers to the 8 core screening design questions (autonomy vs. approval, learning shorthand over time, alias storage/review, ambiguity handling, price changes, outage recovery, and client deployment questions).
- [docs/EVALUATION.md](docs/EVALUATION.md) — Evaluation benchmark report, ground-truth methodology, metric formulas, and Gemini vs. Groq comparison.
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — 2–4 minute video recording demonstration script covering 7 distinct operational scenes.
- [docs/AUDIT_REPORT.md](docs/AUDIT_REPORT.md) — Complete initial audit findings, requirement checklist, and implementation plan.
- [docs/FINAL_VERIFICATION.md](docs/FINAL_VERIFICATION.md) — Final QA verification report with actual command outputs and test logs.

---

## ⚠️ Known Limitations & Security Warnings

1. **Unofficial WhatsApp Integration:** Baileys operates over the WhatsApp Web WebSocket protocol. Meta may flag or suspend numbers engaging in bulk or automated messaging. For production, migrate to the official **WhatsApp Business Cloud API**.
2. **Test Numbers:** Always use a dedicated spare SIM card or virtual test number for Baileys development.
3. **Never Commit Secrets:** `.env` and `baileys_auth/` are strictly excluded in `.gitignore`. Never commit API keys or session files to GitHub.
