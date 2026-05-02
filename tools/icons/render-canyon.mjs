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

  console.log('\nDone. Re-run this script any time to regenerate all three from the inline SVG source.');
}

main().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
