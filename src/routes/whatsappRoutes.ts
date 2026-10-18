import { Router, Request, Response } from 'express';
import { whatsappService } from '../services/whatsappService.js';

const router = Router();

// 1. Connection status JSON
router.get('/api/whatsapp/status', (_req: Request, res: Response) => {
  res.json(whatsappService.getStatus());
});

// 2. Simulated WhatsApp message endpoint
router.post('/api/whatsapp/simulate', async (req: Request, res: Response) => {
  try {
    const { message, senderName, groupId, provider } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'A string "message" field is required' });
      return;
    }

    const output = await whatsappService.simulateMessage({
      messageText: message,
      senderName: senderName || 'Simulation User',
      groupId: groupId || 'test-group@g.us',
      providerName: provider,
    });

    res.json({
      intent: output.intent,
      replyText: output.replyText,
      clarificationNeeded: output.clarificationNeeded,
      duplicateDetected: output.duplicateDetected,
      invoice: output.invoice || null,
      pdfUrl: output.invoice ? output.invoice.pdf_url : null,
      latencyMs: output.latencyMs,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Web UI for QR code scanning & testing
router.get('/whatsapp', (_req: Request, res: Response) => {
  const status = whatsappService.getStatus();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WhatsApp Invoice Agent - Connection</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 2rem; display: flex; flex-direction: column; align-items: center; }
    .card { background: #1e293b; border-radius: 12px; padding: 2rem; max-width: 580px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; font-size: 1.6rem; display: flex; align-items: center; gap: 8px; }
    .status-badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .connected { background: #065f46; color: #34d399; }
    .waiting { background: #78350f; color: #fbbf24; }
    .qr-container { display: flex; flex-direction: column; align-items: center; padding: 1.5rem; background: #0f172a; border-radius: 8px; border: 1px dashed #475569; margin-bottom: 1.5rem; }
    .qr-img { width: 260px; height: 260px; border-radius: 8px; background: white; padding: 12px; }
    .box { background: #0f172a; border-radius: 8px; padding: 1rem; margin-top: 1rem; border: 1px solid #334155; }
    input, textarea, button { width: 100%; box-sizing: border-box; margin-top: 0.5rem; padding: 0.75rem; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: white; font-size: 0.95rem; }
    button { background: #2563eb; color: white; border: none; font-weight: 600; cursor: pointer; margin-top: 1rem; transition: background 0.2s; }
    button:hover { background: #1d4ed8; }
    pre { background: #0f172a; padding: 1rem; border-radius: 6px; overflow-x: auto; color: #a5f3fc; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📱 WhatsApp Invoice Agent</h1>
    <div>
      Status: 
      <span class="status-badge ${status.connected ? 'connected' : 'waiting'}">
        ${status.connected ? '● CONNECTED' : '● WAITING FOR SCAN'}
      </span>
    </div>

    ${
      !status.connected && status.qrDataUrl
        ? `
      <div class="qr-container">
        <p style="margin-top:0; color:#94a3b8;">Open WhatsApp on your phone &gt; Linked Devices &gt; Link a Device, and scan below:</p>
        <img class="qr-img" src="${status.qrDataUrl}" alt="WhatsApp QR Code" />
        <p style="font-size:0.8rem; color:#64748b; margin-bottom:0;">Auto-refreshes every 20 seconds</p>
      </div>
      <script>setTimeout(() => window.location.reload(), 20000);</script>
      `
        : ''
    }

    ${
      status.connected
        ? `
      <div style="background: #064e3b; padding: 1rem; border-radius: 8px; border: 1px solid #059669; margin-bottom: 1.5rem;">
        🎉 WhatsApp is connected! Incoming messages in your group will be processed automatically.
      </div>
      `
        : ''
    }

    <div class="box">
      <h3 style="margin-top:0; color:#e2e8f0;">⚡ Instant Simulator</h3>
      <p style="color:#94a3b8; font-size:0.85rem; margin-top:0;">Test how the AI agent processes WhatsApp messages directly without scanning a QR code:</p>
      <form id="simForm">
        <textarea id="msgInput" rows="3" placeholder="e.g. Please bill Acme Corp for 2 hours of web development @ 150">Please bill Acme Corp for 2 hours of web dev @ 150</textarea>
        <button type="submit">Send Simulated Message</button>
      </form>
      <div id="simResult" style="display:none; margin-top:1rem;">
        <h4 style="color:#38bdf8; margin-bottom:4px;">Agent Reply:</h4>
        <pre id="simReply"></pre>
      </div>
    </div>
  </div>

  <script>
    document.getElementById('simForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('msgInput').value;
      const resDiv = document.getElementById('simResult');
      const repPre = document.getElementById('simReply');
      repPre.textContent = 'Processing request...';
      resDiv.style.display = 'block';

      try {
        const res = await fetch('/api/whatsapp/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        repPre.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        repPre.textContent = 'Error: ' + err.message;
      }
    });
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
