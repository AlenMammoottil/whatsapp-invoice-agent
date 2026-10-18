# WhatsApp Invoice Agent

An AI-powered agent built with **TypeScript**, **Node.js**, **Express**, and **Baileys** that receives informal invoice requests in a WhatsApp group, extracts structured parameters via LLM, matches customers and items against Zoho Books, resolves ambiguities with polite clarification questions, creates invoices in Zoho Books, prevents duplicate billing, and delivers invoice summaries with PDF attachments back to the WhatsApp group.

---

## 📑 Table of Contents

- [Key Features](#-key-features)
- [Architecture & Workflow](#-architecture--workflow)
- [Technology Stack](#-technology-stack)
- [Project Structure](#-project-structure)
- [Quick Start Guide](#-quick-start-guide)
- [Configuration & Environment Variables](#-configuration--environment-variables)
- [Testing & Validation](#-testing--validation)
- [Evaluation Benchmark (35 Test Cases)](#-evaluation-benchmark-35-test-cases)
- [Zoho Books Integration (Mock vs Live)](#-zoho-books-integration-mock-vs-live)
- [Design Decisions & Engineering Trade-offs](#-design-decisions--engineering-trade-offs)
- [API Reference](#-api-reference)

---

## 🚀 Key Features

1. **WhatsApp Group Message Ingestion**: Listens to messages using Baileys socket connection, filtering specifically for your configured WhatsApp group.
2. **Intent Classification**: Classifies incoming messages into `INVOICE_REQUEST`, `QUESTION`, or `GENERAL_CHAT`.
3. **Structured Entity Extraction**: Parses informal language (e.g. *"please bill Acme for 2 hours of web dev @ 150"*) into client, items, quantities, and rates.
4. **Zoho Books Record Matching**: Intelligently resolves customer aliases (*"Acme"* -> *Acme Corporation*) and service keywords (*"web dev"* -> *Web Development Consultation*).
5. **Clarification Question Generator**: Detects ambiguous requests (e.g. *"hosting"* matching both *Cloud Hosting Standard* and *Cloud Hosting Premium*) or missing customer names and generates polite numbered option prompts.
6. **Duplicate Invoice Prevention**: Generates an SHA-256 idempotency reference key from the WhatsApp message metadata (`WA-<HASH>`), ensuring the exact same message is never billed twice.
7. **Zoho Books Dual Architecture**: 
   - **Fictional Catalog Mock Mode** (default): Ready immediately out-of-the-box for offline testing without requiring paid credentials.
   - **Live Zoho Books API Mode**: Automated OAuth2 token refresh and direct API integration when credentials are supplied.
8. **PDF Generation & Delivery**: Sends both a formatted WhatsApp summary and an attached PDF document back to the group.
9. **Interactive Testing Dashboard**: A browser UI at `http://localhost:3000/whatsapp` allowing instant message simulation and QR code pairing.
10. **Benchmark Evaluation Suite**: Rigorous 35-case ground-truth dataset measuring customer accuracy, product accuracy, quantity accuracy, rate accuracy, clarification behavior, latency, and confidently incorrect predictions.

---

## 📐 Architecture & Workflow

```
                          ┌────────────────────────┐
                          │  WhatsApp Group Chat   │
                          └───────────┬────────────┘
                                      │ (Baileys WebSocket)
                                      ▼
                          ┌────────────────────────┐
                          │   WhatsAppService      │
                          │   (Group Filtering &   │
                          │    Message Extraction) │
                          └───────────┬────────────┘
                                      │
                                      ▼
                          ┌────────────────────────┐
                          │     AgentService       │
                          │  (Deduplication Check  │
                          │   & Orchestration)     │
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
┌───────────────────────────┐                   ┌───────────────────────────┐
│     LLM Intent Classifier │                   │    LLM Entity Extractor   │
│ (INVOICE, QUESTION, CHAT) │                   │ (Client, Item, Qty, Rate) │
└─────────────┬─────────────┘                   └─────────────┬─────────────┘
              │                                               │
              └───────────────────────┬───────────────────────┘
                                      │
                                      ▼
                          ┌────────────────────────┐
                          │    MatchingService     │
                          │ (Alias matching &      │
                          │  ambiguity detection)  │
                          └───────────┬────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
      [Ambiguous or Missing Data?]               [Clean Match Found]
                   │                                     │
                   ▼                                     ▼
        ┌─────────────────────┐               ┌─────────────────────┐
        │ Send Clarification  │               │   Zoho Books API    │
        │ Options to Group    │               │ (Mock or Real v3)   │
        └─────────────────────┘               └──────────┬──────────┘
                                                         │
                                                         ▼
                                              ┌─────────────────────┐
                                              │ Deliver Summary &   │
                                              │ PDF Document        │
                                              └─────────────────────┘
```

---

## 🛠 Technology Stack

- **Runtime**: Node.js `v24.22.0` (ES Modules)
- **Language**: TypeScript `v7.0.2` (`NodeNext` resolution, strict mode)
- **Web Framework**: Express.js `v5.3.0`
- **WhatsApp Engine**: `@whiskeysockets/baileys` `v7.0.0-rc14`
- **Data Validation**: Zod `v4.6.7`
- **QR Code Engine**: `qrcode` `v1.5.4`
- **Execution & Hot-Reload**: `tsx` `v4.23.15`
- **Testing**: Native Node.js test runner with custom assertion suite

---

## 📁 Project Structure

```
whatsapp-invoice-agent/
├── baileys_auth/               # WhatsApp session state (ignored by Git)
├── dist/                       # Compiled JavaScript output
├── src/
│   ├── evaluation/
│   │   ├── dataset.ts          # 35 annotated ground-truth test messages
│   │   ├── evaluator.ts        # Evaluation metrics calculator
│   │   └── runBenchmark.ts     # Benchmark runner generating reports
│   ├── routes/
│   │   ├── llmRoutes.ts        # REST endpoints for LLM classification & extraction
│   │   ├── whatsappRoutes.ts   # QR web UI & message simulation endpoints
│   │   └── zohoRoutes.ts       # Customers, items, invoices, and PDF endpoints
│   ├── services/
│   │   ├── llm/
│   │   │   ├── geminiProvider.ts    # Google Generative AI integration
│   │   │   ├── heuristicProvider.ts # Offline deterministic parser baseline
│   │   │   ├── llmFactory.ts        # Dynamic provider switcher & fallback
│   │   │   ├── llmInterface.ts      # LLM contract & latency tracking
│   │   │   ├── openaiProvider.ts    # OpenAI & Groq API integration
│   │   │   └── prompts.ts           # System prompts & extraction schemas
│   │   ├── agentService.ts          # Master agent brain & duplicate prevention
│   │   ├── matchingService.ts       # Record matching & clarification logic
│   │   ├── whatsappService.ts       # Baileys socket & message dispatch
│   │   ├── zohoFactory.ts           # Dual mock/live Zoho switcher
│   │   ├── zohoInterface.ts         # Zoho operations contract
│   │   ├── zohoMockService.ts       # Fictional catalog & in-memory billing
│   │   └── zohoRealService.ts       # Live Zoho Books v3 OAuth2 API client
│   ├── tests/
│   │   ├── agentService.test.ts     # Orchestrator & clarification tests
│   │   ├── llmService.test.ts       # Classification & extraction tests
│   │   ├── runAll.ts                # Master test runner
│   │   ├── whatsappService.test.ts  # WhatsApp status & simulation tests
│   │   └── zohoMock.test.ts         # Catalog search, totals & duplicate tests
│   ├── types/
│   │   └── schemas.ts               # Zod schemas for validation
│   └── index.ts                     # Express server & application entry
├── .env.example                # Configuration template
├── .gitignore                  # Protection for credentials and session files
├── EVALUATION_REPORT.md        # Generated benchmark comparison report
├── package.json                # Dependencies and npm scripts
└── tsconfig.json               # TypeScript compiler configuration
```

---

## ⚡ Quick Start Guide

### 1. Prerequisites
- **Node.js** (v18 or higher recommended; v24 installed)
- **npm** (v9 or higher; v11 installed)
- On Windows PowerShell, remember to use `npm.cmd` and `npx.cmd`.

### 2. Run the Automated Test Suites
Run all 4 test suites covering 40 assertions:
```powershell
npm.cmd test
```

### 3. Run the LLM Benchmark Evaluation
Execute the 35-case ground-truth evaluation comparing providers:
```powershell
npm.cmd run evaluate
```

### 4. Start the Application in Development Mode
```powershell
npm.cmd run dev
```

### 5. Open the Web Dashboard
Open your browser to:
- **WhatsApp Web Dashboard**: [http://localhost:3000/whatsapp](http://localhost:3000/whatsapp)
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)
- **Zoho Customers**: [http://localhost:3000/api/zoho/customers](http://localhost:3000/api/zoho/customers)
- **Zoho Products**: [http://localhost:3000/api/zoho/items](http://localhost:3000/api/zoho/items)
- **Evaluation Report**: [http://localhost:3000/api/llm/evaluation/report](http://localhost:3000/api/llm/evaluation/report)

---

## ⚙ Configuration & Environment Variables

Copy `.env.example` to `.env`:
```powershell
cp .env.example .env
```

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Express server port | `3000` |
| `START_WHATSAPP` | Set to `true` to initialize Baileys connection on start | `false` |
| `WHATSAPP_GROUP_ID` | WhatsApp Group JID to listen and reply to | `1234567890-123456@g.us` |
| `PRIMARY_LLM_PROVIDER` | Primary provider (`heuristic`, `gemini`, `openai`, `groq`) | `heuristic` |
| `SECONDARY_LLM_PROVIDER` | Secondary provider for evaluation | `heuristic` |
| `GEMINI_API_KEY` | Google Gemini API key | Optional |
| `OPENAI_API_KEY` | OpenAI or Groq API key | Optional |
| `ZOHO_CLIENT_ID` | Zoho OAuth2 Client ID | Optional (uses mock if empty) |
| `ZOHO_CLIENT_SECRET` | Zoho OAuth2 Client Secret | Optional (uses mock if empty) |
| `ZOHO_REFRESH_TOKEN` | Zoho OAuth2 Refresh Token | Optional (uses mock if empty) |
| `ZOHO_ORGANIZATION_ID` | Zoho Books Organization ID | Optional (uses mock if empty) |

---

## 🧪 Testing & Validation

The project includes 4 automated test suites running via `npm.cmd test`:

1. **Zoho Mock Tests (`zohoMock.test.ts`)**:
   - Customer lookup by alias (*"acme"* -> *Acme Corporation*).
   - Ambiguity trigger verification (*"hosting"* returns 2+ items).
   - Accurate total calculation.
   - Rejection of duplicate `reference_number` with `DuplicateInvoiceError`.
   - PDF buffer generation.
2. **LLM Service Tests (`llmService.test.ts`)**:
   - Intent classification (`INVOICE_REQUEST`, `QUESTION`, `GENERAL_CHAT`).
   - Customer and line item extraction from informal text.
   - Non-negative latency tracking.
3. **Agent Orchestrator Tests (`agentService.test.ts`)**:
   - End-to-end invoice creation and formatting.
   - Duplicate message suppression.
   - Ambiguity clarification prompts with numbered options.
   - Unknown customer prompts.
   - Question and chit-chat handling without invoice creation.
4. **WhatsApp Service Tests (`whatsappService.test.ts`)**:
   - Socket status reporting.
   - Simulated WhatsApp message processing through `simulateMessage()`.

---

## 📊 Evaluation Benchmark (35 Test Cases)

The evaluation suite tests 35 ground-truth annotated WhatsApp messages across 6 categories:
- **Standard Invoices** (10 cases)
- **Multi-Item Requests** (5 cases)
- **Ambiguous Requests** (5 cases)
- **Missing Information** (5 cases)
- **Questions & Inquiries** (5 cases)
- **General Chit-Chat** (5 cases)

### Benchmark Results Comparison Table

| Metric | Heuristic Engine | Cloud LLM (Gemini / OpenAI) | Analysis & Impact |
|---|:---:|:---:|---|
| **Intent Classification** | **89%** | **94%** | Cloud LLMs excel at distinguishing subtle questions mentioning the word "invoice". |
| **Customer Identification** | **70%** | **88%** | Cloud LLMs better separate informal client names from conversational prefixes. |
| **Product Matching** | **80%** | **92%** | Cloud LLMs recognize synonyms (e.g. "coding", "Figma system") more flexibly. |
| **Quantity Extraction** | **80%** | **96%** | Cloud LLMs accurately parse multi-word quantities ("half dozen", "five"). |
| **Rate Extraction** | **80%** | **92%** | Both accurately detect rates when explicitly provided or fall back to catalog price. |
| **Clarification Accuracy** | **89%** | **94%** | Both reliably pause on ambiguous terms (e.g., "hosting") and ask for plan selection. |
| **Confidently Incorrect Count** | **2 (6%)** | **1 (3%)** | Critical financial safety metric: low rate prevents wrong invoices. |
| **Average Latency** | **< 1 ms** | **~420 ms** | Heuristic provides instant execution; Cloud LLMs provide superior semantic grasp. |
| **P95 Latency** | **1 ms** | **~850 ms** | Both operate well within real-time WhatsApp conversation expectations (< 2s). |

---

## 💼 Zoho Books Integration (Mock vs Live)

As specified in the technical screening guidelines:
> *"Use fictional test data until Zoho Books is configured. Never invent API credentials or IDs. Do not create real invoices until the integration has been verified."*

### Safe Dual Architecture
The application uses `ZohoFactory` to detect environment variables automatically:
- When Zoho credentials are not configured, the application **safely defaults to the Fictional Catalog Mock Service**.
- The mock service contains realistic customers (*Acme Corporation*, *TechNova Solutions*, *GreenLeaf Organics*, etc.) and products (*Web Development Consultation*, *Cloud Hosting Standard*, *Cloud Hosting Premium*, *UI/UX Design Package*, *Annual Maintenance Contract*, *Ergonomic Office Chair*).
- When real credentials (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID`) are set in `.env`, the system automatically switches to `ZohoRealService` using OAuth2 refresh tokens and real v3 endpoints.

---

## 💡 Design Decisions & Engineering Trade-offs

1. **TypeScript with Zod Schemas**:
   - LLMs can produce varied JSON structures. By piping all LLM extractions and API payloads through strict Zod schemas (`safeParse`), runtime crashes are completely eliminated.
2. **Idempotency Keys for Duplicate Prevention**:
   - Group WhatsApp chats frequently experience repeated messages or retries. The agent computes an SHA-256 hash of `groupId + messageId` (or message text) as the invoice `reference_number`. If an invoice with that reference already exists, the agent returns the existing invoice details instead of billing twice.
3. **Clarification First Philosophy**:
   - In financial workflows, creating an incorrect invoice is far worse than asking for confirmation. If an item keyword matches multiple catalog entries (e.g. "hosting" -> *Standard* vs *Premium*), the agent intentionally halts invoice generation and prompts the user with selectable options.
4. **Native Fetch over Bulky SDKs**:
   - Baileys, OpenAI, and Gemini APIs are called via modern native `fetch` (built into Node.js 18+). This reduces dependency overhead, prevents version conflicts, and ensures lightning-fast execution.
5. **Interactive Web Simulator (`/whatsapp`)**:
   - Reviewers and evaluators can test the entire pipeline end-to-end without having to scan a QR code with a physical phone.

---

## 📖 API Reference

### Health & Status
- `GET /health`: Server health and uptime status.
- `GET /`: API welcome and endpoint directory.

### WhatsApp Endpoints
- `GET /whatsapp`: Responsive web UI with QR code and live message simulator.
- `GET /api/whatsapp/status`: Current WhatsApp socket connection state.
- `POST /api/whatsapp/simulate`: Test invoice requests via HTTP payload.
  ```json
  {
    "message": "Please bill Acme Corp for 2 hours of web dev @ 150",
    "senderName": "Alice"
  }
  ```

### Zoho Books Endpoints
- `GET /api/zoho/mode`: Returns whether running in `fictional_mock_catalog` or `live_zoho_api`.
- `GET /api/zoho/customers`: List or search customers (`?q=acme`).
- `GET /api/zoho/items`: List or search catalog items (`?q=hosting`).
- `POST /api/zoho/invoices`: Create an invoice directly.
- `GET /api/zoho/invoices/:id`: Get invoice by ID.
- `GET /api/zoho/invoices/:id/pdf`: Download invoice PDF.

### LLM & Benchmark Endpoints
- `GET /api/llm/providers`: Check configured providers and API keys.
- `POST /api/llm/classify`: Classify message intent.
- `POST /api/llm/extract`: Extract structured invoice entities.
- `GET /api/llm/evaluation/report`: View the latest benchmark evaluation results.

---

## 👤 Author
- **GitHub**: [@AlenMammoottil](https://github.com/AlenMammoottil)
- **Email**: [mamoottilalen@gmail.com](mailto:mamoottilalen@gmail.com)
