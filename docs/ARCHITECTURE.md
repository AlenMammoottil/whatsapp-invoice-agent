# Architecture & Data Flow: WhatsApp Invoice Agent

## 1. System Overview

The **WhatsApp Invoice Agent** automates the end-to-end workflow between informal sales team WhatsApp messages and official Zoho Books accounting invoices. It eliminates manual data entry while preventing financial errors through deterministic catalog validation, specification disambiguation, and a human-in-the-loop preview/approval workflow.

```
+-------------------------------------------------------------------------------------------------------+
|                                        WhatsApp Group (@g.us)                                         |
+-------------------------------------------------------------------------------------------------------+
                                                     |
                                                     v (Baileys Event Listener)
+-------------------------------------------------------------------------------------------------------+
|                                    WhatsApp Ingestion & Idempotency                                   |
| - Filter for authorized WhatsApp groups (WHATSAPP_GROUP_ID)                                           |
| - Ignore self messages (fromMe) and non-group chats                                                   |
| - Compute SHA-256 Idempotency Key: WA-<HASH(groupId + messageId)>                                    |
| - Check persistent storage / Zoho Books for existing invoice                                          |
+-------------------------------------------------------------------------------------------------------+
                                                     |
                                                     v
+-------------------------------------------------------------------------------------------------------+
|                                         Approval Action Filter                                        |
| - Check for commands: CONFIRM <Ref> or CANCEL <Ref>                                                   |
| - If CONFIRM: Load pending payload -> Execute Zoho creation -> Dispatch PDF                           |
| - If CANCEL: Discard pending approval draft -> Reply with cancellation notice                          |
+-------------------------------------------------------------------------------------------------------+
                                                     | (Regular message)
                                                     v
+-------------------------------------------------------------------------------------------------------+
|                                     LLM Pipeline (Gemini / Groq)                                      |
| 1. Intent Classification: INVOICE_REQUEST | QUESTION | GENERAL_CHAT                                   |
| 2. Entity Extraction: Raw customer string, line items array, quantity, stated rate, notes             |
+-------------------------------------------------------------------------------------------------------+
                                                     |
                                                     v
+-------------------------------------------------------------------------------------------------------+
|                                Deterministic Matching & Pricing Engine                                |
| 1. Customer Disambiguation:                                                                           |
|    - Exact name / alias match prioritized over list order                                             |
|    - Multi-match ambiguity detection (e.g. "ABC" -> ABC Tyres vs ABC Wheels)                          |
| 2. Product & Variant Disambiguation:                                                                  |
|    - Specification / size extraction (13", 14", 15", 16", 17", 18", color, model)                     |
|    - Prevent silent confusion of sister variants                                                      |
| 3. Authoritative Pricing Policy:                                                                      |
|    - Matched Zoho item rate is authoritative source of truth                                          |
|    - Unstated rate -> Catalog price (source: catalog)                                                 |
|    - Custom rate -> Price Override flag (source: explicit_override)                                   |
+-------------------------------------------------------------------------------------------------------+
                                                     |
                          +--------------------------+--------------------------+
                          |                                                     |
                          v (Needs Clarification)                               v (Resolved)
+---------------------------------------------------+ +-------------------------------------------------+
|               Clarification Dispatch              | |                 Decision Gate                   |
| Ask short, polite question with relevant options: | | - If AUTO_APPROVE & no price override:          |
| "Which wheel? Lenzo Alloy 18\" or 17\" Red?"       | |     Create invoice immediately                  |
| Do NOT guess! Do NOT fabricate catalog items!     | | - Otherwise (Standard Safe Mode):               |
+---------------------------------------------------+ |     Generate 15-min Pending Approval Preview    |
                                                      +-------------------------------------------------+
                                                                                |
                                                                                v
                                                      +-------------------------------------------------+
                                                      |              Zoho Books Integration             |
                                                      | - Real Mode: OAuth2 token refresh -> API v3     |
                                                      | - Mock Mode: In-memory simulation               |
                                                      | - Fetch official PDF / document buffer          |
                                                      | - Persist reference index & invoice ID          |
                                                      +-------------------------------------------------+
                                                                                |
                                                                                v
                                                      +-------------------------------------------------+
                                                      |                WhatsApp Response                |
                                                      | - Send rich formatted summary to group          |
                                                      | - Send invoice PDF document with filename       |
                                                      +-------------------------------------------------+
```

---

## 2. Division of Responsibility: LLM vs. Deterministic Code

A core design principle of this agent is: **Use the LLM to interpret messy language; never use the LLM as the final authority for database identity or financial calculation.**

| Responsibility | Handled By | Rationale |
|---|:---:|---|
| **Informal Slang & Shorthand Parsing** | **LLM** | Natural language models excel at interpreting unstructured text (e.g. `"VK red lenzo alloy 18 inch x 4 @ 5200"`, `"three 14 inch tyres"`, `"8 nos"`). |
| **Intent Classification** | **LLM** | Distinguishes billing requests from questions (`"What is the price of..."`) and general chit-chat (`"Good morning team!"`). |
| **Customer Identity Resolution** | **Deterministic** | Compares raw strings against verified Zoho Books contact records and approved aliases. Prevents hallucinating nonexistent companies. |
| **Product & Variant Matching** | **Deterministic** | Extracts size/spec tokens (`13"`, `14"`, `16"`, `red`, `black`) and enforces exact variant selection. Rejects ambiguous sister variants. |
| **Catalog Price Verification** | **Deterministic** | Retrieves the authoritative rate from the matched Zoho record. An LLM cannot silently alter unit rates. |
| **Price Override Flagging** | **Deterministic** | Detects when a sales rep requests a rate differing from the catalog and forces an approval checkpoint. |
| **Calculation of Totals & Tax** | **Deterministic** | Arithmetic (`quantity * rate`, subtotal, tax, grand total) is computed strictly in code using integer cents. |
| **Deduplication & Idempotency** | **Deterministic** | SHA-256 hash derived from group ID and message ID. Checks local persistence and Zoho reference index. |
| **Approval Lifecycle** | **Deterministic** | Generates pending approvals with 15-minute expiration windows, bound to the group and sender. |

---

## 3. Data Flow & Lifecycles

### 3.1. Ingestion & Pre-flight
1. **Baileys Event Listener:** Receives incoming messages on `messages.upsert`.
2. **Filtering:** Checks if `remoteJid` ends with `@g.us` (WhatsApp Group). If `WHATSAPP_GROUP_ID` is configured in `.env`, ignores messages from other groups. Ignores bot's own outbound messages (`fromMe: true`).
3. **Idempotency Check:** Computes `WA-<HASH(groupId + messageId)>`. If an invoice with this reference already exists in `storageService` or Zoho Books, re-sends the existing invoice and PDF, preventing duplicate creation.

### 3.2. Approval Command Interception
Before invoking LLMs, the incoming message is checked against approval keywords:
- `CONFIRM` / `CONFIRM <Ref>`: Retrieves the active `PendingApproval` from `storageService`, validates timeout (15 min), and executes invoice creation in Zoho Books.
- `CANCEL` / `CANCEL <Ref>`: Aborts the draft and deletes the pending approval.

### 3.3. Intent Classification & Extraction
If not an approval command:
1. `classifyIntent`: Uses configured LLM (Gemini or Groq) to classify as `INVOICE_REQUEST`, `QUESTION`, or `GENERAL_CHAT`.
2. For `QUESTION`: Fetches Zoho Books catalog and formats a rich product & pricing list.
3. For `GENERAL_CHAT`: Replies with greeting and instructions.
4. For `INVOICE_REQUEST`: Executes `extractInvoice` with strict JSON schema parsing and resilient null transforms.

### 3.4. Deterministic Matching & Validation
`MatchingService.matchAndValidate` performs 3-stage validation:
1. **Customer Matching:**
   - Exact normalized company name or approved alias match (prioritized over search order).
   - If ambiguous (e.g. `"ABC"` matching both `ABC Tyres & Traders` and `ABC Wheels trading`), returns `AMBIGUOUS_CUSTOMER` clarification.
   - If unresolvable, computes token/Levenshtein similarity across all customers and suggests top 4 relevant candidates.
2. **Item & Variant Matching:**
   - Specification extraction (`extractSizeSpec`, `extractColorSpec`).
   - If user asks for `"Car tyre"` without size, detects sister variants (`13"`, `14"`, `15"`, `16"`) and returns `AMBIGUOUS_ITEM` clarification question: `"Which size? Car Tyre 13-inch, Car Tyre 14-inch, Car Tyre 15-inch, or Car Tyre 16-inch?"`.
   - If user specifies size (e.g. `"14 inch tyres"`), binds exclusively to `Car Tyre 14-inch`.
   - Never invents catalog items. Unmatched queries yield relevance-ranked suggestions.
3. **Pricing Policy:**
   - Rate defaults to catalog item rate.
   - If custom rate provided and differs from catalog, flags `hasPriceOverride = true`.
4. **Quantity Check:**
   - If quantity <= 0 or missing, asks for clarification (`MISSING_QUANTITY`).

### 3.5. Creation vs. Preview Gate
- If `AUTO_APPROVE_INVOICES === 'true'` AND `hasPriceOverride === false`: Immediately invokes `zohoService.createInvoice()`, fetches official PDF, and replies.
- Otherwise (Standard Production Mode): Saves `PendingApproval` to `data/agent_state.json` and sends formatted Preview Message to the WhatsApp group showing customer, items, quantities, rates, subtotal, total, and price policy status.

---

## 4. Persistence Architecture

Persistent state is managed by `StorageService` (`src/services/storageService.ts`) with disk-backed storage in `data/agent_state.json`:

```typescript
export interface PersistedState {
  referenceIndex: Record<string, string>;            // reference_number -> invoice_id
  invoices: Record<string, Invoice>;                  // invoice_id -> Invoice object
  pendingApprovals: Record<string, PendingApproval>;  // approval_id -> PendingApproval
  processedMessageIds: string[];                      // In-flight concurrency & deduplication
}
```

**Benefits:**
- **Zero Duplicate Risk:** Even if the server restarts between a sales rep's message and a WhatsApp network retry, the reference index prevents duplicate invoice creation.
- **Durable Approvals:** Pending invoice drafts survive server restarts within their 15-minute expiration window.

---

## 5. Security & Secret Protection

- **Environment Configuration:** All API credentials (`ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`) are loaded via `dotenv` from `.env`.
- **Git Protection:** `.gitignore` excludes `.env`, `baileys_auth/`, `dist/`, and local runtime data.
- **Zero Log Leakage:** Diagnostic logs report only HTTP status codes and boolean configuration indicators (`organizationIdConfigured: true`), never printing tokens or keys.
