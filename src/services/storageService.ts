import fs from 'fs';
import path from 'path';
import { Invoice, PendingApproval, PendingClarification } from '../types/schemas.js';

export interface PersistedState {
  referenceIndex: Record<string, string>;   // reference_number -> invoice_id
  invoices: Record<string, Invoice>;        // invoice_id -> Invoice
  pendingApprovals: Record<string, PendingApproval>; // approval_id -> PendingApproval
  pendingClarifications: Record<string, PendingClarification>; // clarification_id -> PendingClarification
  processedMessageIds: string[];
}

export class StorageService {
  private static instance: StorageService | null = null;
  /** Per-tenant singletons: tenantId -> StorageService */
  private static tenantInstances = new Map<string, StorageService>();
  private filePath: string;
  private state: PersistedState;

  private constructor(filePath?: string) {
    this.filePath = filePath || path.resolve('data', 'agent_state.json');
    this.state = this.loadState();
  }

  /**
   * Returns the default singleton StorageService (backward-compatible, legacy single-tenant).
   */
  static getInstance(): StorageService {
    if (!this.instance) {
      this.instance = new StorageService();
    }
    return this.instance;
  }

  /**
   * Returns a tenant-scoped StorageService (isolated data/agent_state.json per tenant).
   * Instances are cached; calling twice with the same tenantId returns the same instance.
   */
  static createForTenant(tenantId: string): StorageService {
    const cached = this.tenantInstances.get(tenantId);
    if (cached) return cached;

    // Sanitize tenant ID to safe path component (alphanumeric + _ + -)
    const safeId = tenantId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filePath = path.resolve('data', safeId, 'agent_state.json');
    const svc = new StorageService(filePath);
    this.tenantInstances.set(tenantId, svc);
    return svc;
  }

  /**
   * Create a fresh in-memory-only instance for testing — does not touch disk.
   */
  static createForTest(): StorageService {
    const svc = Object.create(StorageService.prototype) as StorageService;
    (svc as any).filePath = ':memory:';
    (svc as any).state = {
      referenceIndex: {},
      invoices: {},
      pendingApprovals: {},
      pendingClarifications: {},
      processedMessageIds: [],
    } as PersistedState;
    return svc;
  }

  /**
   * Clears the per-tenant instance cache. Call only in tests.
   */
  static _resetTenantInstances(): void {
    this.tenantInstances.clear();
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
          pendingClarifications: parsed.pendingClarifications || {},
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
      pendingClarifications: {},
      processedMessageIds: [],
    };
  }

  private saveState(): void {
    if (this.filePath === ':memory:') return; // test instance — skip disk I/O
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

  findPendingApprovalForSender(groupId: string, senderJid?: string, referenceNumber?: string, tenantId?: string): PendingApproval | null {
    this.cleanExpiredApprovals();

    let approvals = Object.values(this.state.pendingApprovals);
    if (tenantId) {
      approvals = approvals.filter((a) => !a.tenant_id || a.tenant_id === tenantId);
    }

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

  // --- Pending Clarification Operations ---

  savePendingClarification(clarification: PendingClarification): void {
    this.state.pendingClarifications[clarification.clarification_id] = clarification;
    this.saveState();
  }

  /**
   * Find the most recent non-expired clarification for a specific sender in a group.
   * Scoped to (group_id, sender_jid) pair and optional tenantId.
   * An unrelated sender or tenant cannot resolve another person's clarification.
   */
  findPendingClarificationForSender(groupId: string, senderJid: string, tenantId?: string): PendingClarification | null {
    this.cleanExpiredClarifications();

    let all = Object.values(this.state.pendingClarifications);
    if (tenantId) {
      all = all.filter((c) => !c.tenant_id || c.tenant_id === tenantId);
    }
    const matches = all
      .filter((c) => c.group_id === groupId && c.sender_jid === senderJid)
      .sort((a, b) => b.created_at - a.created_at);

    return matches.length > 0 ? matches[0]! : null;
  }

  removePendingClarification(clarificationId: string): void {
    if (this.state.pendingClarifications[clarificationId]) {
      delete this.state.pendingClarifications[clarificationId];
      this.saveState();
    }
  }

  private cleanExpiredClarifications(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, c] of Object.entries(this.state.pendingClarifications)) {
      if (now > c.expires_at) {
        delete this.state.pendingClarifications[id];
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
      pendingClarifications: {},
      processedMessageIds: [],
    };
    this.saveState();
  }
}

export const storageService = StorageService.getInstance();
