/**
 * Talks to a receipt printer straight from the browser, so a bill prints with
 * no print dialog — the way the phone app prints. Three ways in:
 *
 *  - `usb`    WebUSB: a printer on a USB cable (it needs the WinUSB driver on
 *             Windows — the printer's own driver keeps the browser out).
 *  - `serial` Web Serial: a Bluetooth printer paired in Windows, which shows
 *             up as a COM port, or a USB printer that is a COM port.
 *  - `ble`    Web Bluetooth: a Bluetooth Low Energy printer.
 *
 * A browser cannot open a network socket, so a WiFi printer is not reachable
 * from here.
 */

export type TransportKind = 'usb' | 'serial' | 'ble';

/** The printer a person picked last, so a repeat print is one click. */
export interface SavedPrinter {
  kind: TransportKind;
  name: string;
  /** Tells the printer apart from the others the browser has been allowed to use. */
  key: string;
}

/** A way to send bytes to the printer, open until [close]d. */
export interface PrinterLink {
  name: string;
  /** Sends one piece of the print job and returns once the printer has taken it. */
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Why a bill did not print, in words the operator can act on. */
export class PrintFailure extends Error {}

export const TRANSPORT_LABEL: Record<TransportKind, string> = {
  usb: 'USB',
  serial: 'Bluetooth',
  ble: 'Bluetooth LE',
};

const STORAGE_KEY = 'scm.printer.device';

/** The ways this browser can reach a printer — none in Firefox or Safari. */
export function supportedKinds(): TransportKind[] {
  if (typeof navigator === 'undefined') return [];
  const kinds: TransportKind[] = [];
  if ('usb' in navigator) kinds.push('usb');
  if ('serial' in navigator) kinds.push('serial');
  if ('bluetooth' in navigator) kinds.push('ble');
  return kinds;
}

export function loadSaved(): SavedPrinter | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const { kind, name, key } = value as Partial<SavedPrinter>;
      if ((kind === 'usb' || kind === 'serial' || kind === 'ble') && typeof name === 'string' && typeof key === 'string') {
        return { kind, name, key };
      }
    }
  } catch {
    // Storage blocked or unreadable: the printer is simply asked for again.
  }
  return null;
}

export function saveRemembered(printer: SavedPrinter | null): void {
  try {
    if (printer) localStorage.setItem(STORAGE_KEY, JSON.stringify(printer));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Remembering is a convenience; the bill has already printed.
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The person closing the browser's device picker without choosing — not an error worth showing. */
export function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'AbortError');
}

/** Opens the browser's device picker for [kind] — needs a click to have just happened. */
export async function pickPrinter(kind: TransportKind): Promise<{ link: PrinterLink; saved: SavedPrinter }> {
  if (kind === 'usb') return openUsb(await navigator.usb.requestDevice({ filters: [] }));
  if (kind === 'serial') return openSerial(await navigator.serial.requestPort());
  return openBle(
    await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES }),
  );
}

/** Opens [saved] again without asking, when the browser still has permission for it; else null. */
export async function reopenPrinter(saved: SavedPrinter): Promise<PrinterLink | null> {
  try {
    if (saved.kind === 'usb') {
      const device = (await navigator.usb.getDevices()).find((d) => usbKey(d) === saved.key);
      return device ? (await openUsb(device)).link : null;
    }
    if (saved.kind === 'serial') {
      const port = (await navigator.serial.getPorts()).find((p) => serialKey(p) === saved.key);
      return port ? (await openSerial(port)).link : null;
    }
    // Web Bluetooth only remembers a device where `getDevices` exists.
    const devices = (await navigator.bluetooth.getDevices?.()) ?? [];
    const device = devices.find((d) => d.id === saved.key);
    return device ? (await openBle(device)).link : null;
  } catch (error) {
    // The printer's own refusal is worth showing; anything else — unplugged,
    // switched off — is a reason to ask for it again.
    if (error instanceof PrintFailure) throw error;
    return null;
  }
}

/**
 * The printers the browser already lets this page use — ones picked before —
 * without opening any of them. A browser only names a device the person has
 * chosen in its own picker, so a printer never used here is added with
 * [pickPrinter].
 */
export async function knownPrinters(): Promise<SavedPrinter[]> {
  const found: SavedPrinter[] = [];
  const collect = async (list: () => Promise<SavedPrinter[]>) => {
    try {
      found.push(...(await list()));
    } catch {
      // The browser blocked the lookup: those printers are simply not listed.
    }
  };
  if ('usb' in navigator) {
    await collect(async () =>
      (await navigator.usb.getDevices()).map((d) => ({ kind: 'usb', name: usbName(d), key: usbKey(d) })),
    );
  }
  if ('serial' in navigator) {
    await collect(async () =>
      (await navigator.serial.getPorts()).map((p) => ({ kind: 'serial', name: serialName(p), key: serialKey(p) })),
    );
  }
  if ('bluetooth' in navigator) {
    await collect(async () =>
      ((await navigator.bluetooth.getDevices?.()) ?? []).map((d) => ({
        kind: 'ble',
        name: d.name || 'Bluetooth ප්‍රින්ටරය',
        key: d.id,
      })),
    );
  }
  return found;
}

// ---- USB --------------------------------------------------------------------

const usbKey = (d: USBDevice) => `${d.vendorId}:${d.productId}:${d.serialNumber ?? ''}`;

const usbName = (d: USBDevice) => d.productName || `USB ${d.vendorId.toString(16)}:${d.productId.toString(16)}`;

async function openUsb(device: USBDevice): Promise<{ link: PrinterLink; saved: SavedPrinter }> {
  const name = usbName(device);
  try {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    // The printer's data pipe: an interface with a bulk OUT endpoint, a
    // printer-class one (7) first.
    const candidates = (device.configuration?.interfaces ?? []).flatMap((iface) =>
      iface.alternates
        .filter((alt) => alt.endpoints.some((e) => e.direction === 'out' && e.type === 'bulk'))
        .map((alt) => ({ iface, alt })),
    );
    const found = candidates.find((c) => c.alt.interfaceClass === 7) ?? candidates[0];
    const endpoint = found?.alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
    if (!found || !endpoint) throw new PrintFailure(`${name} වෙත දත්ත යැවිය හැකි USB පෝට් එකක් නැත.`);

    await device.claimInterface(found.iface.interfaceNumber);
    if (found.alt.alternateSetting !== 0) {
      await device.selectAlternateInterface(found.iface.interfaceNumber, found.alt.alternateSetting);
    }

    return {
      saved: { kind: 'usb', name, key: usbKey(device) },
      link: {
        name,
        async write(chunk) {
          const sent = await device.transferOut(endpoint.endpointNumber, chunk as BufferSource);
          if (sent.status !== 'ok') throw new PrintFailure('ප්‍රින්ටරයට දත්ත යැවීම අසාර්ථකයි.');
        },
        async close() {
          await device.close().catch(() => {});
        },
      },
    };
  } catch (error) {
    await device.close().catch(() => {});
    if (error instanceof PrintFailure) throw error;
    if (error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'NetworkError')) {
      throw new PrintFailure(
        `${name} විවෘත කළ නොහැකි විය. Windows හි ප්‍රින්ටරයේ ඩ්‍රයිවරය බ්‍රවුසරයට ඉඩ නොදේ — ` +
          'Zadig මගින් එම USB ප්‍රින්ටරයට WinUSB ඩ්‍රයිවරය දමන්න, නැතහොත් Bluetooth භාවිතා කරන්න.',
      );
    }
    throw error;
  }
}

// ---- Bluetooth (serial) -----------------------------------------------------

function serialKey(port: SerialPort): string {
  const info: SerialPortInfo & { bluetoothServiceClassId?: unknown } = port.getInfo();
  return JSON.stringify([info.usbVendorId ?? null, info.usbProductId ?? null, info.bluetoothServiceClassId ?? null]);
}

function serialName(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId !== undefined) {
    return `USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)} (COM)`;
  }
  return 'Bluetooth ප්‍රින්ටරය';
}

async function openSerial(port: SerialPort): Promise<{ link: PrinterLink; saved: SavedPrinter }> {
  const name = serialName(port);
  try {
    // The baud rate means nothing over Bluetooth; a USB COM printer usually wants this one.
    await port.open({ baudRate: 115200 });
  } catch (error) {
    // Already open from an earlier print that did not close it: use it as it is.
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
      throw new PrintFailure(`${name} සමඟ සම්බන්ධ විය නොහැකි විය. ප්‍රින්ටරය ඔන් කර, ළඟින් තබා නැවත උත්සාහ කරන්න.`);
    }
  }
  const writer = port.writable?.getWriter();
  if (!writer) {
    await port.close().catch(() => {});
    throw new PrintFailure(`${name} වෙත දත්ත යැවිය නොහැක.`);
  }
  return {
    saved: { kind: 'serial', name, key: serialKey(port) },
    link: {
      name,
      write: (chunk) => writer.write(chunk),
      async close() {
        await writer.close().catch(() => {});
        await port.close().catch(() => {});
      },
    },
  };
}

// ---- Bluetooth LE -----------------------------------------------------------

// The services receipt printers commonly put their write characteristic in;
// Web Bluetooth only lets a page use the ones it names up front.
const BLE_SERVICES: BluetoothServiceUUID[] = [
  0xff00,
  0xff12,
  0xffe0,
  0xfee7,
  0xae30,
  0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

async function openBle(device: BluetoothDevice): Promise<{ link: PrinterLink; saved: SavedPrinter }> {
  const name = device.name || 'Bluetooth ප්‍රින්ටරය';
  const server = await device.gatt?.connect().catch(() => undefined);
  if (!server) {
    throw new PrintFailure(`${name} සමඟ සම්බන්ධ විය නොහැකි විය. ප්‍රින්ටරය ඔන් කර, ළඟින් තබා නැවත උත්සාහ කරන්න.`);
  }

  let target: BluetoothRemoteGATTCharacteristic | undefined;
  for (const service of await server.getPrimaryServices().catch(() => [])) {
    const characteristics = await service.getCharacteristics().catch(() => []);
    target = characteristics.find((c) => c.properties.writeWithoutResponse) ?? characteristics.find((c) => c.properties.write);
    if (target) break;
  }
  if (!target) {
    server.disconnect();
    throw new PrintFailure(`${name} වෙත දත්ත යැවිය හැකි Bluetooth සේවාවක් හමු නොවීය.`);
  }
  const characteristic = target;

  return {
    saved: { kind: 'ble', name, key: device.id },
    link: {
      name,
      async write(chunk) {
        // A BLE write is small, and the printer's buffer smaller still.
        for (let at = 0; at < chunk.length; at += 100) {
          const piece = chunk.slice(at, at + 100);
          if (characteristic.properties.writeWithoutResponse) await characteristic.writeValueWithoutResponse(piece);
          else await characteristic.writeValueWithResponse(piece);
          await sleep(15);
        }
      },
      async close() {
        server.disconnect();
      },
    },
  };
}

/** Sends a whole print job: each band in pieces a printer's buffer can hold, with a breath between. */
export async function sendJob(link: PrinterLink, chunks: Uint8Array[]): Promise<void> {
  for (const chunk of chunks) {
    for (let at = 0; at < chunk.length; at += 4096) await link.write(chunk.subarray(at, at + 4096));
    await sleep(40);
  }
}
