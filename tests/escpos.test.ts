import { describe, expect, it } from 'vitest';

import { PAPER, encodeRaster, layoutWidth } from '../src/lib/escpos';

/** A `width × height` picture, every pixel [pixel]. */
function picture(width: number, height: number, pixel: [number, number, number, number]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set(pixel, i * 4);
  return rgba;
}

describe('encodeRaster', () => {
  it('starts with a reset and ends with a feed', () => {
    const chunks = encodeRaster({ rgba: picture(8, 2, [255, 255, 255, 255]), width: 8, height: 2, maxDots: 384 });
    expect([...chunks[0]]).toEqual([0x1b, 0x40]);
    expect([...chunks[chunks.length - 1]]).toEqual([0x1b, 0x64, 0x04]);
  });

  it('sends a band as GS v 0 with its size in bytes and rows', () => {
    const [, band] = encodeRaster({ rgba: picture(16, 3, [0, 0, 0, 255]), width: 16, height: 3, maxDots: 384 });
    // 16 dots = 2 bytes a row, 3 rows.
    expect([...band.slice(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0]);
    expect(band).toHaveLength(8 + 2 * 3);
  });

  it('prints black pixels and leaves white and transparent ones as paper', () => {
    const black = encodeRaster({ rgba: picture(8, 1, [0, 0, 0, 255]), width: 8, height: 1, maxDots: 384 })[1];
    const white = encodeRaster({ rgba: picture(8, 1, [255, 255, 255, 255]), width: 8, height: 1, maxDots: 384 })[1];
    const clear = encodeRaster({ rgba: picture(8, 1, [0, 0, 0, 0]), width: 8, height: 1, maxDots: 384 })[1];
    expect(black[8]).toBe(0xff);
    expect(white[8]).toBe(0x00);
    expect(clear[8]).toBe(0x00);
  });

  it('puts the leftmost dot in the high bit', () => {
    const rgba = picture(8, 1, [255, 255, 255, 255]);
    rgba.set([0, 0, 0, 255], 0);
    const [, band] = encodeRaster({ rgba, width: 8, height: 1, maxDots: 384 });
    expect(band[8]).toBe(0x80);
  });

  it('keeps thin dark-grey strokes, which sit a little past half', () => {
    const grey = encodeRaster({ rgba: picture(8, 1, [150, 150, 150, 255]), width: 8, height: 1, maxDots: 384 })[1];
    expect(grey[8]).toBe(0xff);
  });

  it('cuts a picture wider than the paper at the paper', () => {
    const [, band] = encodeRaster({ rgba: picture(24, 1, [0, 0, 0, 255]), width: 24, height: 1, maxDots: 16 });
    expect([...band.slice(4, 6)]).toEqual([2, 0]);
    expect(band).toHaveLength(8 + 2);
  });

  it('splits a tall picture into bands of at most bandRows rows', () => {
    const chunks = encodeRaster({
      rgba: picture(8, 250, [0, 0, 0, 255]),
      width: 8,
      height: 250,
      maxDots: 384,
      bandRows: 96,
    });
    const rows = chunks.slice(1, -1).map((band) => band[6] | (band[7] << 8));
    expect(rows).toEqual([96, 96, 58]);
  });
});

describe('paper', () => {
  it('lays the bill out at a 1.5th of the dots, as the phone app does', () => {
    expect(layoutWidth('mm58')).toBe(256);
    expect(layoutWidth('mm80')).toBe(384);
    expect(PAPER.mm58.dots).toBe(384);
    expect(PAPER.mm80.dots).toBe(576);
  });
});
