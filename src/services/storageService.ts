import fs from 'fs';
import path from 'path';
import { Invoice, PendingApproval } from '../types/schemas.js';

export interface PersistedState {
  referenceIndex: Record<string, string>; // reference_number -> invoice_id
  invoices: Record<string, Invoice>;       // invoice_id -> Invoice
  pendingApprovals: Record<string, PendingApproval>; // approval_id -> PendingApproval
  processedMessageIds: string[];
}

export class StorageService {
  private static instance: StorageService | null = null;
  private filePath: string;
  private state: PersistedState;

  private constructor(filePath?: string) {
    this.filePath = filePath || path.resolve('data', 'agent_state.json');
    this.state = this.loadState();
  }

  static getInstance(): StorageService {
    if (!this.instance) {
      this.instance = new StorageService();
    }
    return this.instance;
  }

  private loadState(): PersistedState {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          referenceIndex: parsed.referenceIndex || {},
          invoices: parsed.invoices || {},
          pendingApprovals: parsed.pendingApprovals || {},
          processedMessageIds: parsed.processedMessageIds || [],
        };
      }
    } catch (err) {
      console.warn('[Storage] Could not load persisted state, initializing clean state:', err);
    }

    return {
      referenceIndex: {},
      invoices: {},
      pendingApprovals: {},
      processedMessageIds: [],
    };
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Storage] Failed to save state to disk:', err);
    }
  }

  // --- Reference & Invoice Operations ---

  getInvoiceIdByReference(referenceNumber: string): string | null {
    return this.state.referenceIndex[referenceNumber] || null;
  }

  getInvoice(invoiceId: string): Invoice | null {
    return this.state.invoices[invoiceId] || null;
  }

  getInvoiceByReference(referenceNumber: string): Invoice | null {
    const id = this.getInvoiceIdByReference(referenceNumber);
    if (!id) return null;
    return this.getInvoice(id);
  }

  saveInvoice(invoice: Invoice): void {
    this.state.invoices[invoice.invoice_id] = invoice;
    this.state.referenceIndex[invoice.reference_number] = invoice.invoice_id;
    this.saveState();
  }

  // --- In-Flight Message Idempotency ---

  isMessageProcessed(messageId: string): boolean {
    return this.state.processedMessageIds.includes(messageId);
  }

  markMessageProcessed(messageId: string): void {
    if (!this.state.processedMessageIds.includes(messageId)) {
      this.state.processedMessageIds.push(messageId);
      // Keep last 1000 message IDs to prevent unbounded growth
      if (this.state.processedMessageIds.length > 1000) {
        this.state.processedMessageIds.shift();
      }
      this.saveState();
    }
  }

  // --- Pending Approvals Operations ---

  savePendingApproval(approval: PendingApproval): void {
    this.state.pendingApprovals[approval.approval_id] = approval;
    this.saveState();
  }

  getPendingApproval(approvalId: string): PendingApproval | null {
    const approval = this.state.pendingApprovals[approvalId];
    if (!approval) return null;

    // Check expiration
    if (Date.now() > approval.expires_at) {
      delete this.state.pendingApprovals[approvalId];
      this.saveState();
      return null;
    }

    return approval;
  }

  findPendingApprovalForSender(groupId: string, senderJid?: string, referenceNumber?: string): PendingApproval | null {
    this.cleanExpiredApprovals();

    const approvals = Object.values(this.state.pendingApprovals);

    // If explicit reference given, match it first
    if (referenceNumber) {
      const match = approvals.find(
        (a) => a.reference_number.toLowerCase() === referenceNumber.toLowerCase() && a.group_id === groupId
      );
      if (match) return match;
    }

    // Match by sender and group
    if (senderJid) {
      const senderApprovals = approvals
        .filter((a) => a.group_id === groupId && a.sender_jid === senderJid)
        .sort((a, b) => b.created_at - a.created_at);

      if (senderApprovals.length > 0) return senderApprovals[0];
    }

    // Fall back to most recent approval in the group
    const groupApprovals = approvals
      .filter((a) => a.group_id === groupId)
      .sort((a, b) => b.created_at - a.created_at);

    return groupApprovals.length > 0 ? groupApprovals[0] : null;
  }

  removePendingApproval(approvalId: string): void {
    if (this.state.pendingApprovals[approvalId]) {
      delete this.state.pendingApprovals[approvalId];
      this.saveState();
    }
  }

  private cleanExpiredApprovals(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, a] of Object.entries(this.state.pendingApprovals)) {
      if (now > a.expires_at) {
        delete this.state.pendingApprovals[id];
        changed = true;
      }
    }
    if (changed) {
      this.saveState();
    }
  }

  /**
   * Resets all storage (useful for isolated unit tests)
   */
  clear(): void {
    this.state = {
      referenceIndex: {},
      invoices: {},
      pendingApprovals: {},
      processedMessageIds: [],
    };
    this.saveState();
  }
}

export const storageService = StorageService.getInstance();
