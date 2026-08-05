import { createServer, type Server } from 'node:http';
import QRCode from 'qrcode';

/**
 * A tiny, self-contained HTTP server serving one static, Helix-branded page: the
 * relay's own bootstrap multiaddr as both selectable text and a QR code, plus a
 * helix://bootstrap deep link for whoever opens the page on the same device they
 * want to configure. Exists because asking someone to hand-type or copy-paste a raw
 * multiaddr (app/src/screens/BootstrapServerScreen.tsx) is real friction for a
 * non-technical user - this is the thing an operator actually links from a README/
 * Discord/etc, and it stays correct automatically since it's generated from the
 * relay's live identity rather than a screenshot someone has to remember to update.
 *
 * Deliberately a plain node:http server, not routed through the libp2p node's own
 * WebSocket listener - @libp2p/websockets owns that port for the ws upgrade handshake
 * and isn't meant to also serve arbitrary HTTP content, and mixing concerns there
 * would risk destabilizing the actual relay function for a cosmetic feature. A
 * separate port also means an operator can point a *different* reverse-proxy host/
 * path at just this page without touching the WSS proxy config.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

/** helix://bootstrap?addr=<url-encoded-multiaddr> - see app/src/backend/deepLink.ts's
 *  doc comment for the exact shape this must match on the app side. */
export function buildBootstrapDeepLink(addr: string): string {
  return `helix://bootstrap?addr=${encodeURIComponent(addr)}`;
}

async function renderPage(addr: string): Promise<string> {
  const qrSvg = await QRCode.toString(addr, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' });
  const deepLink = buildBootstrapDeepLink(addr);
  const safeAddr = escapeHtml(addr);
  const safeDeepLink = escapeHtml(deepLink);

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helix Relay</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0b0b0c;
    color: #f3f4f6;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 24px;
  }
  main {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    text-align: center;
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    margin: 0;
  }
  p { color: #8e919a; font-size: 0.9rem; line-height: 1.5; margin: 0; }
  .qr {
    background: #ffffff;
    border-radius: 16px;
    padding: 16px;
    width: 220px;
    height: 220px;
  }
  .qr svg { width: 100%; height: 100%; display: block; }
  .addr-box {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid #24262b;
    background: #16171b;
    border-radius: 16px;
    padding: 16px;
  }
  code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    font-size: 0.8rem;
    word-break: break-all;
    color: #f3f4f6;
  }
  button, a.button {
    appearance: none;
    border: none;
    border-radius: 12px;
    padding: 10px 16px;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }
  .primary { background: #5e50f9; color: #ffffff; }
  .secondary { background: transparent; color: #f3f4f6; border: 1px solid #24262b; }
</style>
</head>
<body>
<main>
  <h1>HELIX RELAY</h1>
  <p>Scan this code in Helix's Settings &rarr; Bootstrap Server, or open the link below on this device.</p>
  <div class="qr">${qrSvg}</div>
  <div class="addr-box">
    <code id="addr">${safeAddr}</code>
    <button class="secondary" onclick="navigator.clipboard.writeText(document.getElementById('addr').textContent)">Copy address</button>
  </div>
  <a class="button primary" href="${safeDeepLink}">Open in Helix</a>
</main>
</body>
</html>`;
}

/**
 * Starts the page server. `addr` is a snapshot of the relay's own bootstrap
 * multiaddr at startup - stable for the process lifetime since the relay's PeerId
 * and announce address never change without a restart (see relay.ts's own identity
 * persistence comment).
 */
export function startRelayPageServer(port: number, addr: string): Server {
  const pageReady = renderPage(addr);
  const server = createServer((_req, res) => {
    pageReady
      .then((html) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      })
      .catch((err: unknown) => {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('failed to render page');
        console.warn('[helix-relay] failed to render web page', err);
      });
  });
  server.listen(port);
  return server;
}
