# Design Decisions & Operational Recommendations

**Project:** WhatsApp Invoice Agent (WhatsApp Message → Zoho Books)  
**Date:** 2026-10-19  
**Author:** AI Agent Architect & Full-Stack Systems Engineer  

---

## 1. Autonomous Operations vs. Human Approval

### Current Implementation Behavior
- **Autonomous Operations:**
  - Ingestion and deduplication of WhatsApp group messages via idempotency hashing.
  - Intent classification (`INVOICE_REQUEST`, `QUESTION`, `GENERAL_CHAT`).
  - Answering catalog inquiries and pricing questions from Zoho Books.
  - Entity extraction (customer, product descriptions, quantities, stated rates, notes).
  - Deterministic customer and catalog matching with size/spec disambiguation.
  - Generation and dispatch of polite clarification questions when information is missing or ambiguous.
  - Creation of standard invoices **ONLY** when `AUTO_APPROVE_INVOICES=true` in `.env` AND no price override is present.
- **Human Approval Required:**
  - **Standard Safe Mode (Default):** All invoice creations present a 15-minute Preview Summary to the WhatsApp group requiring an explicit reply: `CONFIRM` or `CONFIRM <Ref>`.
  - **Price Overrides:** Any invoice request where the sales rep's requested unit price differs from the Zoho catalog price (`hasPriceOverride: true`) **always** requires explicit confirmation, displaying an explicit warning notice of the price delta.
  - **Cancellation:** The sender or authorized sales rep can reply `CANCEL` to abort any pending draft.

### Long-Term Production Recommendation
In production enterprise deployment:
1. **Low-Risk Standard Orders (< ₹25,000 / $500):** Allow fully autonomous invoice creation if the customer is an established client, the item is an exact catalog match, and the price equals the catalog rate.
2. **High-Risk Orders (New Clients, High Value > ₹50,000, or Custom Discounts):** Enforce the WhatsApp preview-and-confirm workflow or route an approval notification to the accounting manager before finalizing in Zoho Books.

---

## 2. Learning Representative-Specific Shorthand Over Time

### The Problem
Every sales representative has distinct texting habits:
- Rep A writes: `"VK red lenzo alloy 18 inch x 4 @ 5200"`.
- Rep B writes: `"Sharma motors - 17\" Lenzo wheel black, 2 pcs @ 4800"`.
- Rep C writes: `"raise inv for Gupta Auto, 8 nos 18 alloy red lenzo, rate same as last time"`.
Over time, sales reps invent new nicknames for parties and items.

### How the Agent Learns (Proposed Architecture)
1. **Implicit Candidate Capture:**
   When a sales rep asks for `"ABC"` and the agent asks:
   `"I found multiple customers matching 'ABC': 1. ABC Tyres & Traders 2. ABC Wheels trading. Which one did you mean?"`
   When the rep responds: `"1"` or `"ABC Tyres"`, the agent logs the candidate mapping: `("ABC", sender: "rep-01@s.whatsapp.net") -> "ABC Tyres & Traders"`.
2. **Confidence Threshold & Frequency Counter:**
   Mappings are stored in a staging collection (`data/learned_aliases_staging.json`). If Rep A confirms `"VK"` -> `"VK Enterprises"` 3 consecutive times with zero corrections, the mapping graduates to candidate status.
3. **Representative Scoping vs. Organization Scoping:**
   - **Representative-Scoped Aliases:** Some shorthand is rep-specific (e.g. Rep A's brother-in-law is `"Gupta"`, while Rep B uses `"Gupta"` for Gupta Auto). Rep-scoped aliases only apply to messages from that sender's JID.
   - **Organization-Scoped Aliases:** Aliases confirmed by multiple reps or an administrator apply globally.

---

## 3. How Learned Aliases Should Be Reviewed and Stored

### Storage Model
Aliases are stored in a versioned JSON store or dedicated Zoho Custom Module with audit metadata:
```json
{
  "alias": "vk",
  "target_type": "customer",
  "target_id": "cust_tyre_011",
  "canonical_name": "VK Enterprises",
  "scope": "organization",
  "confidence_score": 0.98,
  "usage_count": 14,
  "last_used_at": "2026-10-19T14:30:00Z",
  "status": "approved", // "staging" | "approved" | "rejected"
  "approved_by": "accounting_admin@company.com"
}
```

### Review Workflow
- **Weekly Digest:** Every Friday, the accounting firm receives a short WhatsApp digest:
  `"New aliases learned this week: 'Gupta Auto' -> Gupta Auto Spares (used 5x). Approve all? Reply APPROVE ALIASES."`
- **Dashboard Review:** The `/whatsapp` web console provides a simple table where the accountant can toggle aliases or delete invalid mappings with one click.
- **Safety Invariant:** An unapproved alias in "staging" state never silently overrides a catalog name without confirmation.

---

## 4. Handling Ambiguous Customer or Item Matches

### Policy: Never Guess Silently
When a sales rep's message is ambiguous, **a wrong invoice is far worse than a clarification question.** An incorrect invoice creates accounting mess, customer disputes, and tax correction filings.

### Current Implementation
1. **Sister Variant Disambiguation:**
   - Catalog contains: `Car Tyre 13-inch`, `Car Tyre 14-inch`, `Car Tyre 15-inch`, `Car Tyre 16-inch`.
   - Message: `"Please send an invoice to Royal Tyre House for 4 car tyres"`.
   - **Action:** Agent detects that 4 size variants exist and the rep omitted size. It replies:
     `"For 'car tyres', which product, size, or plan should I add to the invoice? Options: 1. Car Tyre 13-inch 2. Car Tyre 14-inch 3. Car Tyre 15-inch 4. Car Tyre 16-inch"`.
2. **Exact Specification Match:**
   - Message: `"4 units of Car Tyre 14-inch"` or `"three 14 inch tyres"`.
   - **Action:** Extracts size `14"` and binds exclusively to `Car Tyre 14-inch`.
3. **Customer Ambiguity:**
   - Message: `"Invoice ABC for 4 tyres"`.
   - **Action:** `"ABC"` matches both `ABC Tyres & Traders` and `ABC Wheels trading`. The agent asks:
     `"I found multiple customers matching 'ABC'. Which one did you mean?"`.

---

## 5. Handling Price Changes & Overrides

### Price Safety Policy
1. **Catalog as Source of Truth:** Unit rates are pulled from Zoho Books item records. The LLM cannot invent or adjust rates.
2. **Missing Rate in Message:** Defaults to the Zoho catalog rate (`rateSource: "catalog"`).
3. **Explicit Override in Message:**
   - Example: Catalog rate is ₹5,200. Rep writes: `"VK red lenzo alloy 18 inch x 4 @ 5000 special deal"`.
   - **Action:** The system sets `rateSource = "explicit_override"`, calculates subtotal with ₹5,000, but flags `hasPriceOverride = true`.
   - **Enforcement:** Disables automatic creation and mandates explicit approval with an attention warning:
     `"⚠️ ATTENTION: Custom Price Override Detected! Requested rate ₹5,000 differs from catalog ₹5,200."`
4. **"Rate Same As Last Time" (Bonus Feature):**
   - When the sales rep includes `"rate same as last time"`, the agent queries `storageService` and Zoho for the customer's most recent invoice containing that item, extracts the historic rate, and applies it.

---

## 6. Failure Recovery & Provider Unavailability

### Zoho Books API Outages or Token Expiry
- **Token Auto-Refresh:** `ZohoRealService` automatically refreshes the OAuth2 access token 60 seconds before expiration using the stored refresh token.
- **Zoho Down / Rate Limited:**
  - The agent catches Zoho API network failures and notifies the group:
    `"⚠️ Zoho Books is currently unavailable. Your invoice request for [Customer] has been queued and will be processed automatically as soon as Zoho reconnects."`
  - The request payload is saved in `storageService` with status `queued_for_retry`.
  - Invoices are **never** recreated if PDF download fails after invoice creation succeeds.

### LLM Provider Outages & Rate Limits
- **Dual-Provider Architecture:** Primary is Google Gemini (`gemini-3.1-flash-lite`); Secondary is Groq (`openai/gpt-oss-20b`); Offline baseline is rule-based `HeuristicProvider`.
- **Exponential Backoff:** If Gemini or Groq returns `429 Too Many Requests` or `503 Service Unavailable`, the provider automatically pauses and retries up to 4–5 times with exponential backoff (retrying after 3s, 6s, 12s, or the delay suggested in the provider's HTTP header).
- **Graceful Fallback:** If the primary LLM provider fails all retries, the orchestrator seamlessly routes the extraction to the secondary provider or heuristic baseline without dropping the sales rep's message.

---

## 7. Questions to Clarify with the Client Before Production Deployment

Before moving this prototype into production with a live client accounting firm:

1. **GST & Tax Rules:**
   - Does the business issue intra-state (CGST + SGST) or inter-state (IGST) invoices based on customer place of supply?
   - Should tax rates be pulled automatically from Zoho tax profiles or calculated statically?
2. **Invoice Numbering & Series:**
   - Does Zoho Books auto-generate sequential invoice numbers (`INV-000123`), or does the client require custom prefix series per branch or sales rep?
3. **Draft vs. Approved Status in Zoho Books:**
   - Should confirmed invoices be created as `draft` (for accountant review before posting to the ledger) or `sent` (finalized immediately)?
   - *Recommendation:* Create as `draft` for the first 30 days to build trust with the accounting firm.
4. **WhatsApp Phone Numbers & Banning Risk:**
   - Baileys uses the unofficial WhatsApp Web protocol, which carries account suspension risk if message volumes are high or flagged.
   - Does the client plan to migrate to the official **WhatsApp Business Cloud API** (Meta Cloud API / Twilio) for enterprise reliability?
5. **Group Authorization & Permissions:**
   - Which WhatsApp phone numbers in the group are authorized to confirm invoices?
   - Can any sales rep confirm their own invoice, or must the group accountant/manager approve?
6. **Payment Terms & Due Dates:**
   - What are the standard credit terms (e.g. Net 15, Net 30, Due on Receipt) for each client category?
