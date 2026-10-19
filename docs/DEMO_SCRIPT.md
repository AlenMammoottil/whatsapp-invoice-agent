# Demo Script: WhatsApp Invoice Agent (2–4 Minutes)

This script is a step-by-step walkthrough for demonstrating the **WhatsApp Invoice Agent** end-to-end, either via a real WhatsApp group using Baileys or via the built-in browser simulator at `http://localhost:3000/whatsapp`.

---

## Prerequisites Before Recording

1. Make sure your server is running:
   ```powershell
   npm.cmd run dev
   ```
2. Open two browser tabs:
   - **Tab 1:** `http://localhost:3000/whatsapp` (WhatsApp Agent Dashboard & Interactive Simulator)
   - **Tab 2:** WhatsApp Web or phone linked to the bot (if testing live with WhatsApp)

---

## Step-by-Step Demonstration Flow

### Scene 1: Connection & System Health (0:00 - 0:30)
- **Action:** Open `http://localhost:3000/whatsapp` in your browser.
- **Explain:**
  > *"Here is the WhatsApp Invoice Agent dashboard. The agent connects to a WhatsApp sales group using Baileys and integrates directly with Zoho Books API. It operates with dual LLM providers (Google Gemini as primary, Groq Llama as secondary, with an offline rule-based fallback). Both live Zoho Books and high-fidelity mock catalogs are supported."*
- **Visual:** Show the live connection status badge and the API endpoints (`/health`, `/api/zoho/items`, `/api/zoho/customers`).

---

### Scene 2: Standard Invoice Request with Preview & Confirm (0:30 - 1:15)
- **Input Message (Sales Rep):**
  ```text
  VK
  red lenzo alloy 18 inch x 4
  rate 5200
  ```
- **What Happens:**
  1. Intent classified as `INVOICE_REQUEST`.
  2. Sales rep shorthand `"VK"` resolved to **VK Enterprises**.
  3. Informal product `"red lenzo alloy 18 inch"` matched to **Alloy Wheel 18" Lenzo - Red**.
  4. Rate ₹5,200 verified against the Zoho catalog rate.
  5. The agent posts a formatted **Preview Summary** in the group:
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
     ```
- **Action:** Sales rep types:
  ```text
  CONFIRM
  ```
- **Result:**
  The agent creates the invoice in Zoho Books and immediately replies with:
  - Official Invoice Number (`INV-2026-0001` or live Zoho `INV-XXXXXX`).
  - Total amount due.
  - Attached downloadable **Invoice PDF**.
- **Explain:**
  > *"Notice the preview-and-confirm safety workflow: no financial transaction is finalized in accounting software without clear human visibility."*

---

### Scene 3: Ambiguous Variant Clarification — Never Guess Silently (1:15 - 2:00)
- **Input Message (Sales Rep):**
  ```text
  VK red wheel 4
  ```
- **What Happens:**
  The catalog has two red alloy wheel variants:
  - `Alloy Wheel 18" Lenzo - Red` (₹5,200)
  - `Alloy Wheel 17" Lenzo - Red` (₹4,800)
- **Agent Response:**
  ```text
  ❓ Clarification Needed
  For "red wheel", which product, size, or plan should I add to the invoice?

  Options:
  1. Alloy Wheel 18" Lenzo - Red ($5200.00/unit)
  2. Alloy Wheel 17" Lenzo - Red ($4800.00/unit)
  ```
- **Explain:**
  > *"When a rep provides ambiguous specifications like 'red wheel', the agent does NOT guess. A wrong invoice is a service failure. It immediately prompts the sales rep with the exact plausible variants from the catalog."*

---

### Scene 4: Customer Ambiguity (2:00 - 2:30)
- **Input Message (Sales Rep):**
  ```text
  ABC needs three 14 inch tyres
  ```
- **What Happens:**
  In the trading catalog, two distinct customers share the `"ABC"` prefix:
  - `ABC Tyres & Traders`
  - `ABC Wheels trading`
- **Agent Response:**
  ```text
  ❓ Clarification Needed
  I found multiple customers matching "ABC". Which one did you mean?

  Options:
  1. ABC Tyres & Traders
  2. ABC Wheels trading
  ```
- **Explain:**
  > *"Customer matching is deterministic. Even if one company was listed first in the database, the agent detects the ambiguity and requests clarification instead of blindly invoicing the wrong client."*

---

### Scene 5: Price Override Warning (2:30 - 3:00)
- **Input Message (Sales Rep):**
  ```text
  Bill Royal Tyre House for 10 Car Tyre 13-inch at discount rate 2200 each
  ```
- **What Happens:**
  Catalog rate is ₹2,500. The rep requested ₹2,200.
- **Agent Response:**
  ```text
  📋 Invoice Preview & Confirmation Required
  🏢 Customer: Royal Tyre House
  🔗 Reference: WA-26C4E9DA3B07

  Line Items:
    1. Car Tyre 13-inch (x10) @ ₹2,200.00 = ₹22,000.00
       ⚠️ Price Override: ₹2,200.00 requested (Catalog: ₹2,500.00)

  Subtotal: ₹22,000.00
  Total Due: ₹22,000.00

  ⚠️ ATTENTION: Custom Price Override Detected!
  The requested rate differs from the authoritative Zoho catalog rate. Explicit confirmation is required.

  👉 Reply CONFIRM to create invoice in Zoho Books.
  ```
- **Explain:**
  > *"The agent enforces the catalog price as the single source of truth. Reps cannot silently discount products; any override is flagged with a high-visibility warning."*

---

### Scene 6: Catalog Inquiry & Duplicate Protection (3:00 - 3:30)
- **Question Message:**
  ```text
  What items are available in our catalog right now?
  ```
- **Agent Response:**
  Returns the live categorized product catalog with current unit rates and units without creating any invoice.
- **Duplicate Protection Test:**
  Re-send the message from Scene 2 (`VK\nred lenzo alloy 18 inch x 4\nrate 5200`).
- **Agent Response:**
  ```text
  ⚠️ Duplicate Request Prevented
  An invoice has already been issued for this request:
  Invoice #: INV-2026-0001
  Customer: VK Enterprises
  Total: ₹20,800.00
  Status: DRAFT
  ```
  The agent re-attaches the existing PDF without creating a duplicate invoice.

---

### Scene 7: Wrap-up & Evaluation (3:30 - 4:00)
- **Action:** Open `EVALUATION_REPORT.md` or show the benchmark table.
- **Explain:**
  > *"We tested this system across 35 realistic sales rep messages, comparing Gemini and Groq models. Gemini achieved 97% intent accuracy and 86% clarification accuracy, with only a 9% confidently incorrect rate. The architecture guarantees zero silent price overrides, deterministic variant resolution, and complete idempotency across server restarts."*
