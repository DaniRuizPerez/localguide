/**
 * render-canyon.mjs
 *
 * Generates app icon assets from the "canyon" LogoC design (Variation C from
 * the Local Guide Chat Redesign mock at ~/.claude/tmp-design/local-guide/).
 *
 * LogoC: concentric topo-contour rings + center dot + N/S ticks.
 *
 * Design deviation: the original LogoC uses phosphor lime #C9F56D as the
 * accent colour. This render uses the app's existing peach #E8845C instead,
 * for brand cohesion (lime would clash with the rest of the UI). Background
 * is the app's soft cream #F8F5F0.
 *
 * Usage:
 *   node tools/icons/render-canyon.mjs
 *
 * Outputs (from repo root):
 *   assets/icon.png          — 1024×1024, full-bleed (cream bg + rings)
 *   assets/adaptive-icon.png — 1024×1024, transparent bg (Android masks it)
 *   assets/favicon.png       — 48×48, downscaled from icon.png
 *
 *   android/app/src/main/res/mipmap-{m,h,x,xx,xxx}hdpi/
 *     ic_launcher.webp           — legacy square (48dp × density)
 *     ic_launcher_round.webp     — legacy round  (48dp × density)
 *     ic_launcher_foreground.webp — adaptive foreground (108dp × density)
 *
 *   Expo's prebuild does NOT re-derive these mipmap WEBPs from assets/icon.png
 *   automatically once they exist (they were generated at first prebuild and
 *   then frozen). We rewrite them here so the launcher icon stays in sync
 *   with the asset PNGs.
 *
 * Requires: sharp (npm install --save-dev sharp)
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const assetsDir = path.join(repoRoot, 'assets');

// ---------------------------------------------------------------------------
// SVG source — LogoC translated to 1024×1024 canvas (viewBox 0 0 32 32)
// Peach #E8845C strokes, cream #F8F5F0 background.
// ---------------------------------------------------------------------------

const SVG_WITH_BG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32">
  <!-- Soft cream background -->
  <rect width="32" height="32" fill="#F8F5F0"/>
  <!-- Topo-contour rings (outermost → innermost, increasing opacity) -->
  <circle cx="16" cy="16" r="14" fill="none" stroke="#E8845C" stroke-width="1" opacity="0.35"/>
  <circle cx="16" cy="16" r="10" fill="none" stroke="#E8845C" stroke-width="1" opacity="0.55"/>
  <circle cx="16" cy="16" r="6"  fill="none" stroke="#E8845C" stroke-width="1" opacity="0.8"/>
  <!-- Center dot (summit marker) -->
  <circle cx="16" cy="16" r="2.5" fill="#E8845C"/>
  <!-- N tick (top) -->
  <line x1="16" y1="2"  x2="16" y2="6"  stroke="#E8845C" stroke-width="1.5"/>
  <!-- S tick (bottom) -->
  <line x1="16" y1="26" x2="16" y2="30" stroke="#E8845C" stroke-width="1.5"/>
</svg>`;

const SVG_TRANSPARENT_BG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32">
  <!-- No background rect — Android adaptive icon is masked by the launcher -->
  <!-- Topo-contour rings -->
  <circle cx="16" cy="16" r="14" fill="none" stroke="#E8845C" stroke-width="1" opacity="0.35"/>
  <circle cx="16" cy="16" r="10" fill="none" stroke="#E8845C" stroke-width="1" opacity="0.55"/>
  <circle cx="16" cy="16" r="6"  fill="none" stroke="#E8845C" stroke-width="1" opacity="0.8"/>
  <!-- Center dot -->
  <circle cx="16" cy="16" r="2.5" fill="#E8845C"/>
  <!-- N tick -->
  <line x1="16" y1="2"  x2="16" y2="6"  stroke="#E8845C" stroke-width="1.5"/>
  <!-- S tick -->
  <line x1="16" y1="26" x2="16" y2="30" stroke="#E8845C" stroke-width="1.5"/>
</svg>`;

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

async function renderPng(svgString, outputPath, width, height) {
  const buffer = Buffer.from(svgString);
  await sharp(buffer)
    .resize(width, height)
    .png()
    .toFile(outputPath);
  const stat = fs.statSync(outputPath);
  console.log(`  ✓ ${path.relative(repoRoot, outputPath)} (${width}×${height}, ${stat.size} bytes)`);
}

async function renderWebp(svgString, outputPath, size) {
  const buffer = Buffer.from(svgString);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(buffer)
    .resize(size, size)
    .webp({ quality: 90 })
    .toFile(outputPath);
  const stat = fs.statSync(outputPath);
  console.log(`  ✓ ${path.relative(repoRoot, outputPath)} (${size}×${size}, ${stat.size} bytes)`);
}

// SVG with a circular mask carved out — used for the legacy round launcher
// icon (mdpi/hdpi/etc. ic_launcher_round.webp). Adaptive launchers do their
// own circular mask on the foreground; legacy ones don't, so we bake the
// circle into the PNG directly.
const SVG_ROUND = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32">
  <defs>
    <clipPath id="circle"><circle cx="16" cy="16" r="16"/></clipPath>
  </defs>
  <g clip-path="url(#circle)">
    <rect width="32" height="32" fill="#F8F5F0"/>
    <circle cx="16" cy="16" r="14" fill="none" stroke="#E8845C" stroke-width="1" opacity="0.35"/>
    <circle cx="16" cy="16" r="10" fill="none" stroke="#E8845C" stroke-width="1" opacity="0.55"/>
    <circle cx="16" cy="16" r="6"  fill="none" stroke="#E8845C" stroke-width="1" opacity="0.8"/>
    <circle cx="16" cy="16" r="2.5" fill="#E8845C"/>
    <line x1="16" y1="2"  x2="16" y2="6"  stroke="#E8845C" stroke-width="1.5"/>
    <line x1="16" y1="26" x2="16" y2="30" stroke="#E8845C" stroke-width="1.5"/>
  </g>
</svg>`;

// Foreground for the adaptive icon must occupy only the inner 66×66dp of a
// 108×108dp safe-zone — the launcher zooms/crops the rest. Scale up the
// glyph from the 32-unit viewBox so the rings fill the safe-zone (≈ 66/108 of
// the canvas → ~60% scale around centre).
const SVG_ADAPTIVE_FOREGROUND = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 108 108">
  <g transform="translate(54 54) scale(2.0625) translate(-16 -16)">
    <circle cx="16" cy="16" r="14" fill="none" stroke="#E8845C" stroke-width="0.75" opacity="0.35"/>
    <circle cx="16" cy="16" r="10" fill="none" stroke="#E8845C" stroke-width="0.75" opacity="0.55"/>
    <circle cx="16" cy="16" r="6"  fill="none" stroke="#E8845C" stroke-width="0.75" opacity="0.8"/>
    <circle cx="16" cy="16" r="2.5" fill="#E8845C"/>
    <line x1="16" y1="2"  x2="16" y2="6"  stroke="#E8845C" stroke-width="1.2"/>
    <line x1="16" y1="26" x2="16" y2="30" stroke="#E8845C" stroke-width="1.2"/>
  </g>
</svg>`;

// Density buckets for native Android mipmaps. Base sizes:
//   ic_launcher (legacy square):   48dp
//   ic_launcher_round (legacy):    48dp
//   ic_launcher_foreground (adaptive): 108dp
const DENSITIES = [
  { name: 'mdpi',    scale: 1   },
  { name: 'hdpi',    scale: 1.5 },
  { name: 'xhdpi',   scale: 2   },
  { name: 'xxhdpi',  scale: 3   },
  { name: 'xxxhdpi', scale: 4   },
];

async function renderMipmaps() {
  const resDir = path.join(repoRoot, 'android', 'app', 'src', 'main', 'res');
  for (const { name, scale } of DENSITIES) {
    const dir = path.join(resDir, `mipmap-${name}`);
    const sq = Math.round(48 * scale);
    const fg = Math.round(108 * scale);
    await renderWebp(SVG_WITH_BG,             path.join(dir, 'ic_launcher.webp'),            sq);
    await renderWebp(SVG_ROUND,               path.join(dir, 'ic_launcher_round.webp'),      sq);
    await renderWebp(SVG_ADAPTIVE_FOREGROUND, path.join(dir, 'ic_launcher_foreground.webp'), fg);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Rendering canyon (LogoC) icon assets …');
  console.log('  Palette: peach #E8845C on cream #F8F5F0');
  console.log('  (Deviation from design: original uses lime #C9F56D — changed to match app peach)\n');

  await renderPng(SVG_WITH_BG,          path.join(assetsDir, 'icon.png'),          1024, 1024);
  await renderPng(SVG_TRANSPARENT_BG,   path.join(assetsDir, 'adaptive-icon.png'), 1024, 1024);
  // Favicon: downscale the full-bleed version (cream bg looks correct in browser tab)
  await renderPng(SVG_WITH_BG,          path.join(assetsDir, 'favicon.png'),       48,   48);

  console.log('\nWriting native Android launcher mipmaps …');
  await renderMipmaps();

  console.log('\nDone. Re-run this script any time to regenerate every icon asset from the inline SVG source.');
}

main().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
