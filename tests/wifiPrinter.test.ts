import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BRIDGE_URL,
  PrintFailure,
  addWifi,
  parseWifiAddress,
  removeWifi,
  reopenPrinter,
  savedWifi,
  sendJob,
} from '../src/lib/thermalPrinter';

/** What the browser's `localStorage` is, kept in memory. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseWifiAddress', () => {
  it('is a host with an optional port, 9100 when left out', () => {
    expect(parseWifiAddress('192.168.1.50')).toEqual({ host: '192.168.1.50', port: 9100 });
    expect(parseWifiAddress(' 192.168.1.50:9101 ')).toEqual({ host: '192.168.1.50', port: 9101 });
    expect(parseWifiAddress('printer.local')).toEqual({ host: 'printer.local', port: 9100 });
  });

  it('is null for anything else', () => {
    for (const bad of ['', '  ', 'a b', '192.168.1.50:', '192.168.1.50:0', '192.168.1.50:70000', '192.168.1.50:abc', ':9100', '-x.local', 'http://x']) {
      expect(parseWifiAddress(bad), bad).toBeNull();
    }
  });
});

describe('saved network printers', () => {
  it('are kept by address, renamed when added again, and can be removed', () => {
    const counter = addWifi('Counter', '192.168.1.50');
    expect(counter).toEqual({ kind: 'wifi', name: 'Counter', key: '192.168.1.50:9100' });
    addWifi('', '192.168.1.51:9101');
    expect(savedWifi().map((p) => p.name)).toEqual(['Counter', 'WiFi ප්‍රින්ටරය']);

    addWifi('Front', '192.168.1.50:9100');
    expect(savedWifi().map((p) => p.name)).toEqual(['WiFi ප්‍රින්ටරය', 'Front']);

    removeWifi(savedWifi()[0]);
    expect(savedWifi().map((p) => p.key)).toEqual(['192.168.1.50:9100']);
  });

  it('refuse an address that is not one', () => {
    expect(() => addWifi('Counter', 'not an address')).toThrow(PrintFailure);
    expect(savedWifi()).toEqual([]);
  });
});

describe('a network printer link', () => {
  const printer = { kind: 'wifi' as const, name: 'Counter', key: '192.168.1.50:9100' };

  it('hands the whole job to the print bridge in one request', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);

    const link = await reopenPrinter(printer);
    await sendJob(link!, [Uint8Array.of(0x1b, 0x40), Uint8Array.of(1, 2, 3)]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BRIDGE_URL}/print?host=192.168.1.50&port=9100`);
    expect(init.method).toBe('POST');
    expect([...(init.body as Uint8Array)]).toEqual([0x1b, 0x40, 1, 2, 3]);
  });

  it('says the bridge must be running when it cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    const link = await reopenPrinter(printer);
    await expect(sendJob(link!, [Uint8Array.of(1)])).rejects.toThrow(/print bridge/);
  });

  it('says the printer cannot be reached when the bridge could not reach it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unreachable' }), { status: 502 })));

    const link = await reopenPrinter(printer);
    await expect(sendJob(link!, [Uint8Array.of(1)])).rejects.toThrow(/Counter/);
  });
});
