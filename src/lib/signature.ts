/**
 * A signature is kept as an SVG path — `M12 34L13 35L14 37M80 40L81 41` — in
 * a fixed 600 × 200 space, one `M` per stroke. A string rather than an image
 * so it is small, and so the admin panel and the phone, which draw it
 * differently, read the same thing. firestore.rules checks the same shape.
 */
export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;

/** The most characters a signature may take; the rules refuse more. */
export const SIGNATURE_MAX_LENGTH = 20000;

export type Point = readonly [number, number];

const SHAPE = /^M\d{1,3} \d{1,3}(?:L\d{1,3} \d{1,3})*(?:M\d{1,3} \d{1,3}(?:L\d{1,3} \d{1,3})*)*$/;

/** A path in the shape the rules accept, with something actually drawn. */
export function isSignature(path: string): boolean {
  return path.length <= SIGNATURE_MAX_LENGTH && SHAPE.test(path);
}

/** Strokes in the 600 × 200 space to a path. A tap is a one-point stroke and still shows as a dot. */
export function signaturePath(strokes: readonly (readonly Point[])[]): string {
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));
  return strokes
    .filter((stroke) => stroke.length > 0)
    .map((stroke) => {
      const points = stroke.map(([x, y]) => `${clamp(x, SIGNATURE_WIDTH)} ${clamp(y, SIGNATURE_HEIGHT)}`);
      // A lone point is drawn twice: a line needs two ends to leave a mark.
      if (points.length === 1) points.push(points[0]);
      return `M${points.join('L')}`;
    })
    .join('');
}
