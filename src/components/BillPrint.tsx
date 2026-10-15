import { Printer, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { billToEscPos } from '../lib/billImage';
import { PAPER, type PaperWidth } from '../lib/escpos';
import {
  PrintFailure,
  TRANSPORT_LABEL,
  addWifi,
  isCancelled,
  knownPrinters,
  loadSaved,
  pickPrinter,
  removeWifi,
  reopenPrinter,
  saveRemembered,
  sendJob,
  supportedKinds,
  type PrinterLink,
  type SavedPrinter,
  type TransportKind,
} from '../lib/thermalPrinter';
import { useToast } from './Toasts';
import { Button, ErrorNote, IconButton, Input, Loading, Modal, Segmented, cx } from './ui';

const PAPER_KEY = 'scm.printer.paper';

function loadPaper(): PaperWidth {
  try {
    const value = localStorage.getItem(PAPER_KEY);
    if (value === 'mm58' || value === 'mm80') return value;
  } catch {
    // Storage blocked: the narrow roll is the common one.
  }
  return 'mm58';
}

const same = (a: SavedPrinter, b: SavedPrinter) => a.kind === b.kind && a.key === b.key;

const failure = (error: unknown) =>
  error instanceof PrintFailure ? error.message : `මුද්‍රණය අසාර්ථකයි: ${error instanceof Error ? error.message : String(error)}`;

/**
 * The print button of a bill's modal. It opens the print popup — paper, and
 * which printer — and the bill goes straight to that printer from there, with
 * no browser print dialog, as in the phone app. [container] holds the bill
 * (its `.print-sheet`). In a browser that cannot reach a printer (Firefox,
 * Safari) the button opens the browser's own print dialog instead.
 */
export function PrintBillButton({ container, disabled }: { container: RefObject<HTMLElement | null>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const getSheet = useCallback(() => container.current?.querySelector<HTMLElement>('.print-sheet') ?? null, [container]);

  return (
    <>
      <Button
        icon={<Printer className="size-4" />}
        disabled={disabled}
        onClick={() => (supportedKinds().length === 0 ? window.print() : setOpen(true))}
      >
        මුද්‍රණය කරන්න
      </Button>
      {open && <PrintDialog getSheet={getSheet} onClose={() => setOpen(false)} />}
    </>
  );
}

function PrintDialog({ getSheet, onClose }: { getSheet: () => HTMLElement | null; onClose: () => void }) {
  const toast = useToast();
  const kinds = supportedKinds();
  const [paper, setPaperState] = useState<PaperWidth>(loadPaper);
  const [printers, setPrinters] = useState<SavedPrinter[] | null>(null);
  const [selected, setSelected] = useState<SavedPrinter | null>(null);
  const [busy, setBusy] = useState<'adding' | 'printing' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The network printer being typed in: its address, and the name it is shown under.
  const [wifiForm, setWifiForm] = useState<{ name: string; address: string } | null>(null);

  const load = useCallback(async () => {
    setPrinters(null);
    const last = loadSaved();
    const known = await knownPrinters();
    // The one used last stays listed even when the browser has forgotten it:
    // printing then asks for it again.
    const list = last && !known.some((p) => same(p, last)) ? [last, ...known] : known;
    setPrinters(list);
    setSelected((now) => now ?? list.find((p) => last && same(p, last)) ?? (list.length === 1 ? list[0] : null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes this popup only — not the bill under it, which would also hear it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setPaper = (next: PaperWidth) => {
    setPaperState(next);
    try {
      localStorage.setItem(PAPER_KEY, next);
    } catch {
      // Remembering is a convenience.
    }
  };

  /** Saves the network printer typed in, and selects it. */
  const saveWifi = () => {
    if (!wifiForm) return;
    setProblem(null);
    try {
      const saved = addWifi(wifiForm.name, wifiForm.address);
      setPrinters((list) => [...(list ?? []).filter((p) => !same(p, saved)), saved]);
      setSelected(saved);
      setWifiForm(null);
    } catch (error) {
      setProblem(failure(error));
    }
  };

  const forgetWifi = (printer: SavedPrinter) => {
    removeWifi(printer);
    setPrinters((list) => (list ?? []).filter((p) => !same(p, printer)));
    setSelected((now) => (now && same(now, printer) ? null : now));
  };

  /** Opens the browser's picker for a printer it has not let this page use yet. */
  const add = async (kind: Exclude<TransportKind, 'wifi'>) => {
    setBusy('adding');
    setProblem(null);
    try {
      // Opened once here, so a printer the browser cannot reach says so now.
      const { link, saved } = await pickPrinter(kind);
      await link.close().catch(() => {});
      setPrinters((list) => [...(list ?? []).filter((p) => !same(p, saved)), saved]);
      setSelected(saved);
    } catch (error) {
      if (!isCancelled(error)) setProblem(failure(error));
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    const sheet = getSheet();
    if (!selected || !sheet || busy) return;
    setBusy('printing');
    setProblem(null);
    let link: PrinterLink | null = null;
    try {
      let used = selected;
      link = await reopenPrinter(selected);
      if (!link) {
        // The browser no longer lets this page at it: ask again. (A network
        // printer is never refused, so it is not here.)
        if (selected.kind === 'wifi') throw new PrintFailure('ප්‍රින්ටරය සොයා ගත නොහැකි විය.');
        const picked = await pickPrinter(selected.kind);
        link = picked.link;
        used = picked.saved;
      }
      await sendJob(link, await billToEscPos(sheet, paper));
      saveRemembered(used);
      toast.success('බිල්පත මුද්‍රණය කළා.');
      onClose();
    } catch (error) {
      if (!isCancelled(error)) setProblem(failure(error));
    } finally {
      await link?.close().catch(() => {});
      setBusy(null);
    }
  };

  // Two printers the browser names alike are told apart by number.
  const label = (printer: SavedPrinter) => {
    const alike = (printers ?? []).filter((p) => p.name === printer.name);
    return alike.length > 1 ? `${printer.name} ${alike.indexOf(printer) + 1}` : printer.name;
  };

  return createPortal(
    <Modal
      open
      size="sm"
      title="බිල්පත මුද්‍රණය"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            වසන්න
          </Button>
          <Button
            icon={<Printer className="size-4" />}
            busy={busy === 'printing'}
            disabled={!selected || busy === 'adding'}
            onClick={() => void print()}
          >
            {busy === 'printing' ? 'මුද්‍රණය වෙමින්...' : 'මුද්‍රණය කරන්න'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[13px]">
        <Segmented
          value={paper}
          disabled={busy !== null}
          onChange={setPaper}
          options={(Object.keys(PAPER) as PaperWidth[]).map((value) => ({ value, label: `කඩදාසි ${PAPER[value].label}` }))}
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="font-semibold text-white/80">ප්‍රින්ටරය තෝරන්න</p>
            <IconButton label="නැවත සොයන්න" onClick={() => void load()}>
              <RefreshCw className="size-4" />
            </IconButton>
          </div>
          {printers === null ? (
            <Loading />
          ) : printers.length === 0 ? (
            <p className="rounded-control bg-white/[0.05] px-3 py-3 text-white/70">
              ප්‍රින්ටරයක් තවම එකතු කර නැත. පහත බොත්තමකින් ප්‍රින්ටරය එකතු කරන්න.
            </p>
          ) : (
            <div role="radiogroup" className="space-y-1.5">
              {printers.map((printer) => {
                const active = selected !== null && same(printer, selected);
                return (
                  <div
                    key={`${printer.kind}|${printer.key}`}
                    className={cx(
                      'flex items-center rounded-control ring-1 transition',
                      active ? 'bg-white/15 ring-amber-hi' : 'bg-white/[0.05] ring-hairline hover:bg-white/10',
                    )}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={busy !== null}
                      onClick={() => setSelected(printer)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <Printer className="size-5 shrink-0 text-white/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{label(printer)}</span>
                        <span className="block truncate text-[11.5px] text-white/55">
                          {TRANSPORT_LABEL[printer.kind]}
                          {printer.kind === 'wifi' && ` · ${printer.key}`}
                        </span>
                      </span>
                    </button>
                    {printer.kind === 'wifi' && (
                      <IconButton label="ඉවත් කරන්න" className="mr-1" onClick={() => forgetWifi(printer)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 font-semibold text-white/80">අලුත් ප්‍රින්ටරයක් එකතු කරන්න</p>
          <div className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <Button
                key={kind}
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => (kind === 'wifi' ? setWifiForm((form) => form ?? { name: '', address: '' }) : void add(kind))}
              >
                {TRANSPORT_LABEL[kind]}
              </Button>
            ))}
          </div>
          {wifiForm && (
            <div className="mt-3 space-y-2 rounded-control bg-white/[0.05] p-3">
              <Input
                autoFocus
                inputMode="decimal"
                placeholder="IP ලිපිනය — උදා: 192.168.1.50"
                value={wifiForm.address}
                onChange={(event) => setWifiForm({ ...wifiForm, address: event.target.value })}
                onKeyDown={(event) => event.key === 'Enter' && saveWifi()}
              />
              <Input
                placeholder="නම (විකල්ප) — උදා: කවුන්ටරය"
                value={wifiForm.name}
                onChange={(event) => setWifiForm({ ...wifiForm, name: event.target.value })}
                onKeyDown={(event) => event.key === 'Enter' && saveWifi()}
              />
              <p className="text-[11.5px] text-white/55">
                Port එක නොදුන්නොත් 9100 භාවිතා වේ. WiFi මුද්‍රණයට මෙම PC එකේ SCM print bridge ධාවනය වී තිබිය යුතුය
                (<span className="font-mono">npm run print-bridge</span>).
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setWifiForm(null)}>
                  අවලංගු
                </Button>
                <Button size="sm" disabled={!wifiForm.address.trim()} onClick={saveWifi}>
                  එකතු කරන්න
                </Button>
              </div>
            </div>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => window.print()}
            className="mt-3 text-left text-[12px] text-white/55 underline underline-offset-2 hover:text-white"
          >
            Windows හි ස්ථාපිත ප්‍රින්ටරයකට — බ්‍රවුසරයේ මුද්‍රණ කවුළුවෙන්
          </button>
        </div>

        {problem && <ErrorNote>{problem}</ErrorNote>}
      </div>
    </Modal>,
    document.body,
  );
}
