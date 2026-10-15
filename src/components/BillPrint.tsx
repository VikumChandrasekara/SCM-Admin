import { Printer } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { billToEscPos } from '../lib/billImage';
import { PAPER, type PaperWidth } from '../lib/escpos';
import {
  PrintFailure,
  TRANSPORT_LABEL,
  isCancelled,
  loadSaved,
  pickPrinter,
  reopenPrinter,
  saveRemembered,
  sendJob,
  supportedKinds,
  type PrinterLink,
  type SavedPrinter,
  type TransportKind,
} from '../lib/thermalPrinter';
import { useToast } from './Toasts';
import { Button, ErrorNote, Segmented } from './ui';

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

/**
 * Prints a bill straight to the receipt printer — no print dialog, as in the
 * phone app. [getSheet] gives the bill's element when it is time to print.
 * In a browser that cannot reach a printer (Firefox, Safari) the print button
 * falls back to the browser's own print dialog.
 */
export function useBillPrint(getSheet: () => HTMLElement | null) {
  const toast = useToast();
  const [paper, setPaperState] = useState<PaperWidth>(loadPaper);
  const [saved, setSaved] = useState<SavedPrinter | null>(loadSaved);
  const [printing, setPrinting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const kinds = supportedKinds();

  const setPaper = useCallback((next: PaperWidth) => {
    setPaperState(next);
    try {
      localStorage.setItem(PAPER_KEY, next);
    } catch {
      // Remembering is a convenience.
    }
  }, []);

  /** Prints the bill; [choose] opens the browser's picker for that kind of printer first. */
  const print = useCallback(
    async (choose?: TransportKind) => {
      if (kinds.length === 0) {
        window.print();
        return;
      }
      if (busy.current) return;
      const sheet = getSheet();
      const kind = choose ?? saved?.kind;
      if (!sheet) return;
      if (!kind) {
        setProblem('ප්‍රින්ටරය තවම තෝරා නැත — පහත බොත්තමකින් ප්‍රින්ටරය තෝරන්න.');
        return;
      }

      busy.current = true;
      setPrinting(true);
      setProblem(null);
      let link: PrinterLink | null = null;
      try {
        // The one used last, when the browser still lets us at it; else ask.
        if (!choose && saved) link = await reopenPrinter(saved);
        if (!link) {
          const picked = await pickPrinter(kind);
          link = picked.link;
          saveRemembered(picked.saved);
          setSaved(picked.saved);
        }
        await sendJob(link, await billToEscPos(sheet, paper));
        toast.success('බිල්පත මුද්‍රණය කළා.');
      } catch (error) {
        if (!isCancelled(error)) {
          setProblem(error instanceof PrintFailure ? error.message : `මුද්‍රණය අසාර්ථකයි: ${String(error)}`);
        }
      } finally {
        await link?.close().catch(() => {});
        busy.current = false;
        setPrinting(false);
      }
    },
    [kinds.length, getSheet, saved, paper, toast],
  );

  return { kinds, paper, setPaper, saved, printing, problem, print };
}

export type BillPrint = ReturnType<typeof useBillPrint>;

/** The modal's print button: one click and the bill is on paper. */
export function PrintButton({ printer, disabled }: { printer: BillPrint; disabled?: boolean }) {
  return (
    <Button
      icon={<Printer className="size-4" />}
      busy={printer.printing}
      disabled={disabled}
      onClick={() => void printer.print()}
    >
      {printer.printing ? 'මුද්‍රණය වෙමින්...' : 'මුද්‍රණය කරන්න'}
    </Button>
  );
}

/** Which printer and which paper — below the bill, out of the way once chosen. */
export function PrinterSettings({ printer }: { printer: BillPrint }) {
  const { kinds, paper, setPaper, saved, printing, problem, print } = printer;

  return (
    <div className="mt-4 space-y-3 text-[13px]">
      <Segmented
        value={paper}
        disabled={printing}
        onChange={setPaper}
        options={(Object.keys(PAPER) as PaperWidth[]).map((value) => ({ value, label: `කඩදාසි ${PAPER[value].label}` }))}
      />

      {kinds.length === 0 ? (
        <p className="text-white/70">
          මෙම බ්‍රවුසරයෙන් ප්‍රින්ටරයට කෙලින්ම යැවිය නොහැක — Chrome, Edge හෝ Brave භාවිතා කරන්න. දැනට බ්‍රවුසරයේ මුද්‍රණ කවුළුව
          විවෘත වේ.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-white/70">
            ප්‍රින්ටරය:{' '}
            <span className="font-semibold text-white">
              {saved ? `${saved.name} (${TRANSPORT_LABEL[saved.kind]})` : 'තවම තෝරා නැත'}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <Button key={kind} variant="secondary" size="sm" disabled={printing} onClick={() => void print(kind)}>
                {saved?.kind === kind
                  ? `වෙනත් ${TRANSPORT_LABEL[kind]} ප්‍රින්ටරයක්`
                  : `${TRANSPORT_LABEL[kind]} ප්‍රින්ටරයක් තෝරා මුද්‍රණය කරන්න`}
              </Button>
            ))}
          </div>
          <button
            type="button"
            disabled={printing}
            onClick={() => window.print()}
            className="text-[12px] text-white/55 underline underline-offset-2 hover:text-white"
          >
            WiFi හෝ Windows හි ස්ථාපිත ප්‍රින්ටරයකට — බ්‍රවුසරයේ මුද්‍රණ කවුළුවෙන්
          </button>
        </div>
      )}

      {problem && <ErrorNote>{problem}</ErrorNote>}
    </div>
  );
}
