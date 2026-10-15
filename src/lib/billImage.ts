import { toCanvas } from 'html-to-image';

import { PAPER, PRINT_SCALE, encodeRaster, layoutWidth, type PaperWidth } from './escpos';

/**
 * Takes a picture of the bill [sheet] as it would be laid out on [paper] and
 * turns it into ESC/POS. A picture rather than text, because a printer has no
 * Sinhala font. The bill on screen is left alone: a copy is laid out off
 * screen at the paper's width, the way the phone app draws it.
 */
export async function billToEscPos(sheet: HTMLElement, paper: PaperWidth): Promise<Uint8Array[]> {
  const width = layoutWidth(paper);
  const copy = sheet.cloneNode(true) as HTMLElement;
  Object.assign(copy.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${width}px`,
    maxWidth: 'none',
    margin: '0',
    boxShadow: 'none',
    borderRadius: '0',
  });
  document.body.appendChild(copy);
  try {
    // The bill's Sinhala is in a system font: let the browser have it ready.
    await document.fonts.ready;
    // The picture copies the bill's styles, off-screen position included, which
    // would put the bill outside it: the picture's own root sits at its corner.
    const canvas = await toCanvas(copy, {
      pixelRatio: PRINT_SCALE,
      backgroundColor: '#ffffff',
      style: { position: 'static', left: '0', top: '0', margin: '0' },
    });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('බිල්පත සකස් කළ නොහැකි විය.');
    const { data, width: pixels, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    return encodeRaster({ rgba: data, width: pixels, height, maxDots: PAPER[paper].dots });
  } finally {
    copy.remove();
  }
}
