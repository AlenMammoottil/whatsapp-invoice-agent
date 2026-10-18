import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { AgentService, AgentProcessInput, AgentProcessOutput } from './agentService.js';
import { zohoMockService } from './zohoMockService.js';

export class WhatsAppService {
  private sock: WASocket | null = null;
  private agentService: AgentService;
  private qrCodeString: string | null = null;
  private qrDataUrl: string | null = null;
  private isConnected = false;
  private authFolder = './baileys_auth';

  constructor() {
    this.agentService = new AgentService(zohoMockService);
  }

  /**
   * Initializes the Baileys WhatsApp client and event listeners
   */
  async start(): Promise<void> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), // Suppress verbose Baileys network trace
        printQRInTerminal: false, // We'll print a clean customized QR
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

          // Check if message is from a WhatsApp Group (@g.us)
          const isGroup = remoteJid.endsWith('@g.us');
          if (!isGroup) continue;

          // Target group check
          const configuredGroupId = process.env['WHATSAPP_GROUP_ID'];
          if (configuredGroupId && remoteJid !== configuredGroupId) {
            console.log(`[WhatsApp] Ignored message from unconfigured group: ${remoteJid}`);
            continue;
          }

          if (!configuredGroupId) {
            console.log(`[WhatsApp] Received group message from JID: ${remoteJid}`);
            console.log(`👉 To bind the bot specifically to this group, add to your .env:\nWHATSAPP_GROUP_ID=${remoteJid}\n`);
          }

          // Extract text content from message
          const messageText =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            '';

          if (!messageText.trim()) continue;

          const senderName = msg.pushName || 'WhatsApp User';
          console.log(`\n📩 [WhatsApp] Incoming message in ${remoteJid} from ${senderName}: "${messageText}"`);

          try {
            // Process message through Agent Brain
            const result = await this.agentService.processIncomingMessage({
              messageText,
              senderName,
              senderJid: msg.key.participant || remoteJid,
              messageId: msg.key.id || undefined,
              groupId: remoteJid,
            });

            // 1. Send the text response
            await this.sock?.sendMessage(remoteJid, { text: result.replyText });
            console.log(`📤 [WhatsApp] Sent reply to ${remoteJid}`);

            // 2. If an invoice PDF was generated, send the PDF document
            if (result.pdfBuffer && result.pdfFilename) {
              await this.sock?.sendMessage(remoteJid, {
                document: result.pdfBuffer,
                mimetype: 'application/pdf',
                fileName: result.pdfFilename,
                caption: `Invoice PDF for ${result.invoice?.customer_name || 'Customer'}`,
              });
              console.log(`📎 [WhatsApp] Sent invoice PDF (${result.pdfFilename}) to ${remoteJid}`);
            }
          } catch (err: any) {
            console.error('[WhatsApp] Error processing message:', err);
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
   * Allows simulated testing of WhatsApp messages via HTTP
   */
  async simulateMessage(input: AgentProcessInput): Promise<AgentProcessOutput> {
    return this.agentService.processIncomingMessage(input);
  }

  /**
   * Returns current WhatsApp connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      hasQrCode: Boolean(this.qrCodeString),
      qrDataUrl: this.qrDataUrl,
      configuredGroupId: process.env['WHATSAPP_GROUP_ID'] || null,
    };
  }
}

export const whatsappService = new WhatsAppService();
