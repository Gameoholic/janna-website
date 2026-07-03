/**
 * Generates the three app icons (Видео / Файлы / Напоминания) as PNGs:
 * regular + maskable, 192 and 512 px. Pure JS (pngjs) so it runs anywhere.
 * Re-run with: npm run gen:icons
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', 'web', 'public', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- geometry helpers (unit square coordinates) ----

function inRoundRect(x, y, rx, ry, rw, rh, radius) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const cx = Math.max(rx + radius, Math.min(rx + rw - radius, x));
  const cy = Math.max(ry + radius, Math.min(ry + rh - radius, y));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inPoly(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- glyphs ----

function glyphVideo(x, y) {
  return inPoly(x, y, [
    [0.37, 0.3],
    [0.37, 0.7],
    [0.76, 0.5],
  ]);
}

function glyphFiles(x, y) {
  return (
    inRoundRect(x, y, 0.2, 0.28, 0.28, 0.16, 0.05) ||
    inRoundRect(x, y, 0.2, 0.36, 0.6, 0.37, 0.06)
  );
}

function glyphReminders(x, y) {
  return (
    inCircle(x, y, 0.5, 0.27, 0.04) ||
    inCircle(x, y, 0.5, 0.45, 0.16) ||
    inPoly(x, y, [
      [0.345, 0.45],
      [0.655, 0.45],
      [0.715, 0.66],
      [0.285, 0.66],
    ]) ||
    inRoundRect(x, y, 0.25, 0.655, 0.5, 0.055, 0.027) ||
    inCircle(x, y, 0.5, 0.775, 0.052)
  );
}

// ---- rendering ----

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function render(size, bgHex, glyph, maskable) {
  const png = new PNG({ width: size, height: size });
  const [br, bg2, bb] = hexToRgb(bgHex);
  const SS = 3; // supersampling
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let glyphHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const inBg = maskable ? true : inRoundRect(x, y, 0, 0, 1, 1, 0.18);
          if (!inBg) continue;
          bgHits++;
          // Maskable icons keep the glyph inside the 72% safe zone.
          const scale = maskable ? 0.72 : 1;
          const gx = 0.5 + (x - 0.5) / scale;
          const gy = 0.5 + (y - 0.5) / scale;
          if (gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1 && glyph(gx, gy)) glyphHits++;
        }
      }
      const total = SS * SS;
      const idx = (py * size + px) * 4;
      const bgFrac = bgHits / total;
      const whiteFrac = bgFrac > 0 ? glyphHits / bgHits : 0;
      png.data[idx] = bgFrac > 0 ? Math.round(br + (255 - br) * whiteFrac) : 0;
      png.data[idx + 1] = bgFrac > 0 ? Math.round(bg2 + (255 - bg2) * whiteFrac) : 0;
      png.data[idx + 2] = bgFrac > 0 ? Math.round(bb + (255 - bb) * whiteFrac) : 0;
      png.data[idx + 3] = Math.round(255 * bgFrac);
    }
  }
  return PNG.sync.write(png);
}

const APPS = [
  { key: 'video', color: '#2B5FD9', glyph: glyphVideo },
  { key: 'files', color: '#B85C1E', glyph: glyphFiles },
  { key: 'rem', color: '#C6373C', glyph: glyphReminders },
];

for (const app of APPS) {
  for (const size of [192, 512]) {
    fs.writeFileSync(path.join(OUT_DIR, `${app.key}-${size}.png`), render(size, app.color, app.glyph, false));
    fs.writeFileSync(path.join(OUT_DIR, `${app.key}-mask-${size}.png`), render(size, app.color, app.glyph, true));
  }
  console.log(`icons written for ${app.key}`);
}
