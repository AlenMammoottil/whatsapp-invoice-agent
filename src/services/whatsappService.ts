import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { AgentService, AgentProcessInput, AgentProcessOutput } from './agentService.js';
import { ZohoFactory } from './zohoFactory.js';
import { resolveTenantContextByGroup } from './tenantRegistry.js';
import { getAllTenants } from '../config/tenantConfig.js';

export class WhatsAppService {
  private sock: WASocket | null = null;
  /** Legacy single-tenant fallback agent (used by simulateMessage when no tenantId specified) */
  private legacyAgentService: AgentService;
  private qrCodeString: string | null = null;
  private qrDataUrl: string | null = null;
  private isConnected = false;
  private authFolder = './baileys_auth';

  constructor() {
    this.legacyAgentService = new AgentService(ZohoFactory.getService());
  }

  /**
   * Initializes the Baileys WhatsApp client and event listeners.
   */
  async start(): Promise<void> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), // Suppress verbose Baileys network trace
        printQRInTerminal: false, // We print a clean customized QR below
      });

      // Handle credentials update
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates (QR code generation, connection open/close)
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCodeString = qr;
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr);
            const terminalQR = await QRCode.toString(qr, { type: 'terminal', small: true });
            console.log('\n📲 --- WHATSAPP QR CODE ---');
            console.log(terminalQR);
            console.log('Or view & scan the QR in your browser at: http://localhost:3000/whatsapp\n');
          } catch (err) {
            console.error('Failed to generate QR code string:', err);
          }
        }

        if (connection === 'close') {
          this.isConnected = false;
          const shouldReconnect =
            (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsApp] Connection closed. Reason: ${lastDisconnect?.error?.message}. Reconnecting: ${shouldReconnect}`);

          if (shouldReconnect) {
            setTimeout(() => this.start(), 3000);
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          this.qrCodeString = null;
          this.qrDataUrl = null;
          console.log('\n✅ [WhatsApp] Connected successfully to WhatsApp!\n');
        }
      });

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          // Ignore messages sent by ourselves
          if (msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid;
          if (!remoteJid) continue;

          // Only process group messages
          const isGroup = remoteJid.endsWith('@g.us');
          if (!isGroup) continue;

          // ── Tenant Resolution ────────────────────────────────────────────────
          // Resolve the tenant deterministically from the group JID.
          // Messages from unauthorized or unmapped groups are silently dropped.
          const tenantCtx = resolveTenantContextByGroup(remoteJid);

          if (!tenantCtx) {
            const tenantCount = getAllTenants().length;
            if (tenantCount === 0) {
              // No tenants configured at all — hint for new installations
              console.log(`[WhatsApp] Received group message from JID: ${remoteJid}`);
              console.log(`👉 Add this group to tenants.json (or set WHATSAPP_GROUP_ID + ZOHO credentials in .env) to enable the bot.`);
            } else {
              console.log(`[WhatsApp] Ignored message from unauthorized group: ${remoteJid}`);
            }
            continue;
          }

          // Extract text content from message
          const messageText =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            '';

          if (!messageText.trim()) continue;

          const senderName = msg.pushName || 'WhatsApp User';
          console.log(`\n📩 [WhatsApp][${tenantCtx.tenant.tenantId}] Incoming in ${remoteJid} from ${senderName}: "${messageText}"`);

          try {
            // Process message through this tenant's Agent
            const result = await tenantCtx.agentService.processIncomingMessage({
              messageText,
              senderName,
              senderJid: msg.key.participant || remoteJid,
              messageId: msg.key.id || undefined,
              groupId: remoteJid,
              tenantId: tenantCtx.tenant.tenantId,
            });

            // 1. Send the text response
            await this.sock?.sendMessage(remoteJid, { text: result.replyText });
            console.log(`📤 [WhatsApp][${tenantCtx.tenant.tenantId}] Sent reply to ${remoteJid}`);

            // 2. If an invoice PDF was generated, send the PDF document
            if (result.pdfBuffer && result.pdfFilename) {
              await this.sock?.sendMessage(remoteJid, {
                document: result.pdfBuffer,
                mimetype: 'application/pdf',
                fileName: result.pdfFilename,
                caption: `Invoice PDF for ${result.invoice?.customer_name || 'Customer'}`,
              });
              console.log(`📎 [WhatsApp][${tenantCtx.tenant.tenantId}] Sent invoice PDF (${result.pdfFilename}) to ${remoteJid}`);
            }
          } catch (err: any) {
            console.error(`[WhatsApp][${tenantCtx.tenant.tenantId}] Error processing message:`, err);
            await this.sock?.sendMessage(remoteJid, {
              text: `⚠️ *Error Processing Request:*\n${err.message || 'An unexpected error occurred while processing your request.'}`,
            });
          }
        }
      });
    } catch (error) {
      console.error('[WhatsApp] Failed to initialize Baileys socket:', error);
    }
  }

  /**
   * Allows simulated testing of WhatsApp messages via HTTP.
   * If a tenantId is provided (or derivable from groupId), uses the tenant's agent.
   * Falls back to the legacy single-tenant agent for backward compatibility.
   */
  async simulateMessage(input: AgentProcessInput): Promise<AgentProcessOutput> {
    // Attempt tenant resolution from groupId if tenantId not explicitly given
    if (!input.tenantId && input.groupId && input.groupId.endsWith('@g.us')) {
      const tenantCtx = resolveTenantContextByGroup(input.groupId);
      if (tenantCtx) {
        return tenantCtx.agentService.processIncomingMessage({
          ...input,
          tenantId: tenantCtx.tenant.tenantId,
        });
      }
    }

    // Explicit tenantId provided — look it up
    if (input.tenantId) {
      const { getTenantById } = await import('../config/tenantConfig.js');
      const { getTenantContext } = await import('./tenantRegistry.js');
      const tenant = getTenantById(input.tenantId);
      if (tenant) {
        const ctx = getTenantContext(tenant);
        return ctx.agentService.processIncomingMessage(input);
      }
    }

    // Legacy fallback: use the default single-tenant agent
    return this.legacyAgentService.processIncomingMessage(input);
  }

  /**
   * Returns current WhatsApp connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      hasQrCode: Boolean(this.qrCodeString),
      qrDataUrl: this.qrDataUrl,
      tenantCount: getAllTenants().length,
      configuredGroupId: process.env['WHATSAPP_GROUP_ID'] || null,
    };
  }
}

export const whatsappService = new WhatsAppService();
