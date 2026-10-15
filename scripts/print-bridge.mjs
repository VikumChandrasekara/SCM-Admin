// Lets the admin panel print to a WiFi receipt printer.
//
// A web page cannot open a plain network connection to a printer, so the panel
// hands the print job to this small program running on the same PC, and this
// sends it on to the printer's address (port 9100, the usual raw-print port).
// USB and Bluetooth printers need none of this — the browser reaches those
// itself.
//
//   npm run print-bridge
//
// It listens on this PC only (127.0.0.1:9101) and takes jobs only from the
// panel's own address, only for printers on the local network. No packages
// are needed beyond Node.

import { once } from 'node:events';
import { createServer } from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 9101;

/** Where the panel is served from — the only pages allowed to print through this. */
export const DEFAULT_ORIGINS = [
  'https://scm-thrimaa.web.app',
  'https://scm-thrimaa.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
];

const MAX_JOB_BYTES = 2 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 6000;
// The printer's buffer is small: a piece at a time, with a breath between.
const PIECE_BYTES = 4096;
const PIECE_PAUSE_MS = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether [host] is somewhere on the local network: a private IPv4 address, or
 * a plain / `.local` name. A public address is refused, so this can never be
 * used to reach out to the internet.
 */
export function isLocalNetworkHost(host) {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return false;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.local)?$/i.test(host);
}

/** Sends [job] to the printer at [host]:[port] and resolves once it has been handed over. */
export async function sendToPrinter(host, port, job) {
  const socket = net.connect({ host, port });
  socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('timeout')));
  try {
    await once(socket, 'connect');
    socket.setTimeout(0);
    for (let at = 0; at < job.length; at += PIECE_BYTES) {
      if (!socket.write(job.subarray(at, at + PIECE_BYTES))) await once(socket, 'drain');
      await sleep(PIECE_PAUSE_MS);
    }
    // Closing at once can cut the last band short on a slow printer.
    await sleep(200);
    await new Promise((resolve) => socket.end(resolve));
  } finally {
    socket.destroy();
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (part) => {
      size += part.length;
      if (size > MAX_JOB_BYTES) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      parts.push(part);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/** The bridge as an HTTP server, not yet listening. */
export function createBridge({ allowedOrigins = DEFAULT_ORIGINS } = {}) {
  const allowed = new Set(allowedOrigins);

  return createServer(async (req, res) => {
    const reply = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

    // Only this PC's own name: a page cannot point its own domain at 127.0.0.1
    // and get round the origin check that way.
    const named = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(named)) return reply(403, { error: 'host' });

    const origin = req.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) return reply(403, { error: 'origin' });
    const cors = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          // A page on the internet reaching a program on this PC asks first.
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        }
      : {};

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') return reply(204, undefined, cors);
    if (req.method === 'GET' && url.pathname === '/ping') return reply(200, { ok: true, name: 'scm-print-bridge' }, cors);
    if (req.method !== 'POST' || url.pathname !== '/print') return reply(404, { error: 'not-found' }, cors);

    const host = url.searchParams.get('host') ?? '';
    const port = Number(url.searchParams.get('port') ?? '9100');
    if (!isLocalNetworkHost(host)) return reply(400, { error: 'host-not-local' }, cors);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return reply(400, { error: 'bad-port' }, cors);

    try {
      const job = await readBody(req);
      if (job.length === 0) return reply(400, { error: 'empty' }, cors);
      await sendToPrinter(host, port, job);
      return reply(204, undefined, cors);
    } catch (error) {
      if (error.status === 413) return reply(413, { error: 'too-large' }, cors);
      const code = error.message === 'timeout' ? 'timeout' : 'unreachable';
      return reply(502, { error: code, detail: String(error.message) }, cors);
    }
  });
}

// Run directly: `node scripts/print-bridge.mjs`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SCM_BRIDGE_PORT ?? DEFAULT_PORT);
  const origins = process.env.SCM_BRIDGE_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? DEFAULT_ORIGINS;
  createBridge({ allowedOrigins: origins })
    .on('error', (error) => {
      console.error(
        error.code === 'EADDRINUSE'
          ? `Port ${port} is already in use — the print bridge is probably running already.`
          : error.message,
      );
      process.exit(1);
    })
    .listen(port, '127.0.0.1', () => {
      console.log(`SCM print bridge ready on http://127.0.0.1:${port} — leave this window open while printing to a WiFi printer.`);
    });
}
