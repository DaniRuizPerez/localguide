/* eslint-disable */
// One-shot generator: rewrites android/app/src/main/res/mipmap-*/ic_launcher*.webp
// from the Canyon master PNGs. Run once after replacing assets/canyon/*.
//
//   node scripts/regen-android-icons.js
//
// We do this manually (instead of `npx expo prebuild --clean`) because this
// project has heavy native android/ customizations (Google Maps API key in
// AndroidManifest, LiteRT-LM bindings) that prebuild --clean would wipe.

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SRC_LAUNCHER = path.join(ROOT, 'assets', 'canyon', 'canyon-1024.png');
// We deliberately use canyon-1024 (full-bleed design, opaque to the canvas
// edges) as the adaptive *foreground* instead of canyon-android-foreground-432.
// The shipped foreground-432 has the design centered in only the inner 64% of
// its canvas, with the rest transparent — under Pixel's circular launcher mask
// that reveals the solid #E8845C background as a thick ring around a small
// embedded design, making the compass look off-center and the icon look
// "shrunk inside an orange disc". canyon-1024 places the compass at canvas
// center (0.499, 0.499) AND extends the gradient sky + mountains to all four
// edges, so under any launcher mask the design fills the full visible area.
const SRC_FOREGROUND = path.join(ROOT, 'assets', 'canyon', 'canyon-1024.png');

// Android density buckets:
//   ic_launcher / ic_launcher_round: 48dp baseline (mdpi=48, hdpi=72, xhdpi=96,
//   xxhdpi=144, xxxhdpi=192).
//   ic_launcher_foreground (adaptive): 108dp baseline (×1, 1.5, 2, 3, 4 ⇒ 108,
//   162, 216, 324, 432).
const buckets = [
  { dir: 'mipmap-mdpi',    launcher:  48, foreground: 108 },
  { dir: 'mipmap-hdpi',    launcher:  72, foreground: 162 },
  { dir: 'mipmap-xhdpi',   launcher:  96, foreground: 216 },
  { dir: 'mipmap-xxhdpi',  launcher: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

async function run() {
  for (const b of buckets) {
    const outDir = path.join(RES, b.dir);
    if (!fs.existsSync(outDir)) {
      console.warn(`skip: ${outDir} not found`);
      continue;
    }
    const tasks = [
      sharp(SRC_LAUNCHER).resize(b.launcher, b.launcher).webp({ quality: 90 })
        .toFile(path.join(outDir, 'ic_launcher.webp')),
      sharp(SRC_LAUNCHER).resize(b.launcher, b.launcher).webp({ quality: 90 })
        .toFile(path.join(outDir, 'ic_launcher_round.webp')),
      sharp(SRC_FOREGROUND).resize(b.foreground, b.foreground).webp({ quality: 90 })
        .toFile(path.join(outDir, 'ic_launcher_foreground.webp')),
    ];
    const results = await Promise.all(tasks);
    console.log(`${b.dir}: launcher=${results[0].size}B round=${results[1].size}B fg=${results[2].size}B`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
