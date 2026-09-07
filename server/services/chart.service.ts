/* Draws the revenue projection as a PNG bar chart, with no dependencies. */

import { deflateSync } from 'node:zlib';

/* ------------------------------------------------------------- the canvas --- */

interface Canvas { w: number; h: number; px: Uint8Array }

const canvas = (w: number, h: number, bg: [number, number, number]): Canvas => {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255;
  }
  return { w, h, px };
};

function fillRect(
  c: Canvas, x: number, y: number, w: number, h: number, rgb: [number, number, number],
) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(c.w, Math.round(x + w));
  const y1 = Math.min(c.h, Math.round(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      const i = (yy * c.w + xx) * 4;
      c.px[i] = rgb[0]; c.px[i + 1] = rgb[1]; c.px[i + 2] = rgb[2]; c.px[i + 3] = 255;
    }
  }
}

/* ---------------------------------------------------------------- the font --- */

const FONT: Record<string, number[]> = {
  '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
  '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
  '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  A: [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  B: [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  C: [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  D: [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
  E: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  F: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  G: [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
  H: [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  I: [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  M: [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  P: [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  Q: [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
  R: [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  S: [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
  T: [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
  X: [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
  $: [0x04, 0x0F, 0x14, 0x0E, 0x05, 0x1E, 0x04],
  ',': [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x08],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C],
  '-': [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

const textWidth = (s: string, scale: number) => s.length * (GLYPH_W + 1) * scale;

function drawText(
  c: Canvas, s: string, x: number, y: number, scale: number, rgb: [number, number, number],
) {
  let cx = x;
  for (const raw of s.toUpperCase()) {
    const glyph = FONT[raw] ?? FONT[' ']!;
    for (let row = 0; row < GLYPH_H; row += 1) {
      const bits = glyph[row] ?? 0;
      for (let col = 0; col < GLYPH_W; col += 1) {
        if (bits & (1 << (GLYPH_W - 1 - col)))
          fillRect(c, cx + col * scale, y + row * scale, scale, scale, rgb);
      }
    }
    cx += (GLYPH_W + 1) * scale;
  }
}

function drawTextVertical(
  c: Canvas, s: string, x: number, y: number, scale: number, rgb: [number, number, number],
) {
  let cy = y;
  for (const raw of s.toUpperCase()) {
    const glyph = FONT[raw] ?? FONT[' ']!;
    for (let row = 0; row < GLYPH_H; row += 1) {
      const bits = glyph[row] ?? 0;
      for (let col = 0; col < GLYPH_W; col += 1) {
        if (bits & (1 << (GLYPH_W - 1 - col)))
          fillRect(c, x + row * scale, cy + (GLYPH_W - 1 - col) * scale, scale, scale, rgb);
      }
    }
    cy -= (GLYPH_W + 1) * scale;
  }
}

/* ------------------------------------------------------------ PNG encoding --- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF]! ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(c: Canvas): Buffer {
  const raw = Buffer.alloc(c.h * (1 + c.w * 4));
  for (let y = 0; y < c.h; y += 1) {
    const rowStart = y * (1 + c.w * 4);
    raw[rowStart] = 0;
    Buffer.from(c.px.buffer, y * c.w * 4, c.w * 4).copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;    
  ihdr[9] = 6;    
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- the chart --- */

const NAVY: [number, number, number] = [0x15, 0x4F, 0x6B];
const CYAN: [number, number, number] = [0x13, 0xA8, 0xE2];
const INK: [number, number, number] = [0x1B, 0x2A, 0x30];
const MUTED: [number, number, number] = [0x6B, 0x7A, 0x80];
const GRID: [number, number, number] = [0xDC, 0xE3, 0xE6];
const PAPER: [number, number, number] = [0xFF, 0xFF, 0xFF];

export interface ChartPoint { month: number; value: number }

export interface ChartImage {
  png: Buffer;
  widthPt: number;
  heightPt: number;
}

function niceCeiling(max: number, ticks: number): number {
  if (max <= 0) return ticks;
  const rough = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= rough) ?? 10;
  return step * mag * ticks;
}

const compact = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (Math.abs(n) >= 1_000) return `${Number((n / 1_000).toFixed(1))}K`;
  return String(Math.round(n));
};

export function renderProjectionChart(
  points: ChartPoint[], title: string, valueAxisTitle: string,
): ChartImage | null {
  if (!points.length) return null;

  const S = 2;
  const W = 900 * S;
  const H = 460 * S;
  const c = canvas(W, H, PAPER);

  const padL = 96 * S;
  const padR = 28 * S;
  const padT = 58 * S;
  const padB = 76 * S;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const TICKS = 4;
  const peak = Math.max(...points.map((p) => p.value), 0);
  const top = niceCeiling(peak, TICKS);

  drawText(c, title, padL, 18 * S, 2 * S, INK);

  for (let i = 0; i <= TICKS; i += 1) {
    const v = (top / TICKS) * i;
    const y = padT + plotH - (plotH * i) / TICKS;
    fillRect(c, padL, y, plotW, Math.max(1, S / 2), i === 0 ? MUTED : GRID);
    const label = `$${compact(v)}`;
    drawText(c, label, padL - 12 * S - textWidth(label, S), y - (GLYPH_H * S) / 2, S, MUTED);
  }

  const slot = plotW / points.length;
  const barW = slot * 0.62;
  for (const [i, p] of points.entries()) {
    const h = top > 0 ? (p.value / top) * plotH : 0;
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padT + plotH - h;
    fillRect(c, x, y, barW, h, NAVY);
    if (h > 3 * S) fillRect(c, x, y, barW, 3 * S, CYAN);

    const label = String(p.month);
    drawText(c, label, x + barW / 2 - textWidth(label, S) / 2, padT + plotH + 12 * S, S, MUTED);
  }

  const xTitle = 'MONTH';
  drawText(c, xTitle, padL + plotW / 2 - textWidth(xTitle, S) / 2, padT + plotH + 38 * S, S, INK);
  drawTextVertical(c, valueAxisTitle, 22 * S,
    padT + plotH / 2 + textWidth(valueAxisTitle, S) / 2, S, INK);

  return { png: encodePng(c), widthPt: W / S, heightPt: H / S };
}
