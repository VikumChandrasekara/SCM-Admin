import { Eraser } from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';

import {
  SIGNATURE_HEIGHT,
  SIGNATURE_MAX_LENGTH,
  SIGNATURE_WIDTH,
  signaturePath,
  type Point,
} from '../lib/signature';
import { Button } from './ui';

/** A signature, as its path. */
export function SignatureView({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
      className={className}
      role="img"
      aria-label="අත්සන"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Somewhere to sign with a finger, a stylus or the mouse. Reports the path
 * whenever it changes — an empty string once cleared.
 */
export function SignaturePad({ onChange }: { onChange: (path: string) => void }) {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const drawing = useRef(false);

  function update(next: Point[][]) {
    const path = signaturePath(next);
    // Past the limit the last mark is dropped rather than a signature the rules would refuse.
    if (path.length > SIGNATURE_MAX_LENGTH) return;
    setStrokes(next);
    onChange(path);
  }

  function pointOf(event: PointerEvent<SVGSVGElement>): Point {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - box.left) / box.width) * SIGNATURE_WIDTH,
      ((event.clientY - box.top) / box.height) * SIGNATURE_HEIGHT,
    ];
  }

  function start(event: PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    update([...strokes, [pointOf(event)]]);
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!drawing.current || strokes.length === 0) return;
    const point = pointOf(event);
    const last = strokes[strokes.length - 1];
    const [x, y] = last[last.length - 1];
    // Points a pixel or two apart add length and no shape.
    if (Math.abs(point[0] - x) < 2 && Math.abs(point[1] - y) < 2) return;
    update([...strokes.slice(0, -1), [...last, point]]);
  }

  function stop() {
    drawing.current = false;
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
        className="aspect-[3/1] w-full cursor-crosshair touch-none rounded-control bg-white text-slate-900 ring-1 ring-hairline"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        role="img"
        aria-label="මෙහි අත්සන් කරන්න"
      >
        <path
          d={signaturePath(strokes)}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-white/60">{strokes.length === 0 ? 'ඉහත කොටුවේ අත්සන් කරන්න' : ' '}</p>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          icon={<Eraser className="size-3.5" />}
          disabled={strokes.length === 0}
          onClick={() => update([])}
        >
          මකන්න
        </Button>
      </div>
    </div>
  );
}
