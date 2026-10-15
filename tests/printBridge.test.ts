import { once } from 'node:events';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createBridge, isLocalNetworkHost } from '../scripts/print-bridge.mjs';

const ORIGIN = 'https://scm-thrimaa.web.app';

describe('isLocalNetworkHost', () => {
  it('takes private addresses and local names', () => {
    for (const host of ['192.168.1.50', '10.0.0.7', '172.16.4.2', '172.31.255.1', '127.0.0.1', '169.254.1.1', 'printer', 'printer.local']) {
      expect(isLocalNetworkHost(host), host).toBe(true);
    }
  });

  it('refuses anything that could be on the internet', () => {
    for (const host of ['8.8.8.8', '172.32.0.1', '192.169.1.1', '300.1.1.1', 'example.com', 'a.b.local.evil.com', '', '1.2.3']) {
      expect(isLocalNetworkHost(host), host).toBe(false);
    }
  });
});

describe('the print bridge', () => {
  const open: { close(): unknown }[] = [];
  afterEach(() => {
    for (const server of open.splice(0)) server.close();
  });

  async function start() {
    const bridge = createBridge({ allowedOrigins: [ORIGIN] });
    bridge.listen(0, '127.0.0.1');
    await once(bridge, 'listening');
    open.push(bridge);
    return `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
  }

  /** A printer that keeps what it is sent, until the sender hangs up. */
  async function fakePrinter() {
    const received: Buffer[] = [];
    const printer = net.createServer((client) => {
      client.on('data', (part) => received.push(part));
    });
    printer.listen(0, '127.0.0.1');
    await once(printer, 'listening');
    open.push(printer);
    return { port: (printer.address() as AddressInfo).port, received };
  }

  it('answers a ping from the panel, and asks the browser to allow it', async () => {
    const url = await start();
    const response = await fetch(`${url}/ping`, { headers: { Origin: ORIGIN } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, name: 'scm-print-bridge' });
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);

    const preflight = await fetch(`${url}/print`, { method: 'OPTIONS', headers: { Origin: ORIGIN } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('passes the job on to the printer as the bytes', async () => {
    const url = await start();
    const printer = await fakePrinter();
    const job = Uint8Array.of(0x1b, 0x40, 1, 2, 3);

    const response = await fetch(`${url}/print?host=127.0.0.1&port=${printer.port}`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/octet-stream' },
      body: job,
    });

    expect(response.status).toBe(204);
    expect([...Buffer.concat(printer.received)]).toEqual([...job]);
  });

  it('takes jobs only from the panel', async () => {
    const url = await start();
    const printer = await fakePrinter();

    const response = await fetch(`${url}/print?host=127.0.0.1&port=${printer.port}`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: Uint8Array.of(1),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(Buffer.concat(printer.received)).toHaveLength(0);
  });

  it('will not reach out to an address outside the local network', async () => {
    const url = await start();
    const response = await fetch(`${url}/print?host=8.8.8.8&port=9100`, {
      method: 'POST',
      headers: { Origin: ORIGIN },
      body: Uint8Array.of(1),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'host-not-local' });
  });

  it('says so when the printer cannot be reached', async () => {
    const url = await start();
    // A port nothing listens on: bound once to find a free one, then freed.
    const spare = net.createServer();
    spare.listen(0, '127.0.0.1');
    await once(spare, 'listening');
    const { port } = spare.address() as AddressInfo;
    spare.close();
    await once(spare, 'close');

    const response = await fetch(`${url}/print?host=127.0.0.1&port=${port}`, {
      method: 'POST',
      headers: { Origin: ORIGIN },
      body: Uint8Array.of(1),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'unreachable' });
  });
});
