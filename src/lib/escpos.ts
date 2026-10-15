/**
 * The paper a receipt printer takes. A thermal head prints a fixed number of
 * dots across, so the width of the paper decides how wide the bill is drawn.
 * Same as the phone app's `PaperWidth`.
 */
export const PAPER = {
  mm58: { label: '58mm', dots: 384 },
  mm80: { label: '80mm', dots: 576 },
} as const;

export type PaperWidth = keyof typeof PAPER;

/** The bill is laid out at `dots / SCALE` CSS pixels, then scaled up to `dots`: the screen's text sizes at the density of a till receipt. */
export const PRINT_SCALE = 1.5;

/** The width, in CSS pixels, the bill is laid out at for [paper]. */
export function layoutWidth(paper: PaperWidth): number {
  return PAPER[paper].dots / PRINT_SCALE;
}

/**
 * ESC/POS for a picture: a reset, the picture in bands of rows (`GS v 0`), and
 * a few blank lines so the bill clears the tear bar.
 *
 * [rgba] is the picture as `width × height` RGBA pixels. Transparent pixels
 * count as paper. A pixel prints black when it is darker than [threshold]
 * (0–255) — a little above half, so thin strokes of the Sinhala text do not
 * drop out.
 */
export function encodeRaster({
  rgba,
  width,
  height,
  maxDots,
  threshold = 165,
  bandRows = 96,
}: {
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  maxDots: number;
  threshold?: number;
  bandRows?: number;
}): Uint8Array[] {
  const dots = Math.min(width, maxDots);
  const rowBytes = Math.ceil(dots / 8);
  const chunks: Uint8Array[] = [Uint8Array.of(0x1b, 0x40)]; // ESC @ — reset

  for (let top = 0; top < height; top += bandRows) {
    const rows = Math.min(bandRows, height - top);
    const out = new Uint8Array(8 + rows * rowBytes);
    // GS v 0, normal density, then the band's size.
    out.set([0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8]);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < dots; x++) {
        const i = ((top + y) * width + x) * 4;
        const alpha = rgba[i + 3];
        const luma = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
        // Over white paper.
        const shade = (luma * alpha) / 255 + (255 * (255 - alpha)) / 255;
        if (shade < threshold) out[8 + y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    chunks.push(out);
  }

  chunks.push(Uint8Array.of(0x1b, 0x64, 0x04)); // ESC d 4 — feed
  return chunks;
}
