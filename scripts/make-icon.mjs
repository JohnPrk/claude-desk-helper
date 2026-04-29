#!/usr/bin/env node
// Build a panda app icon from src/skins/panda/idle.svg.
// Renders a 1024×1024 PNG, places the panda on a soft circular background,
// then defers to `tauri icon` to generate every required Tauri asset.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcSvg = resolve(root, "src/skins/panda/idle.svg");
const outPng = resolve(root, "scripts/.icon-source.png");

const pandaSvg = readFileSync(srcSvg, "utf8");
// Strip the outermost <svg ...> tag and reuse the inner content inside a
// composed background SVG.
const inner = pandaSvg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const composedSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.42" r="0.7">
      <stop offset="0" stop-color="#fff8ef"/>
      <stop offset="1" stop-color="#f3d9b3"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dy="6" result="off"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="232" fill="url(#bg)"/>
  <g filter="url(#shadow)" transform="translate(112 112) scale(3.125)">
    ${inner}
  </g>
</svg>
`;

const composedPath = resolve(root, "scripts/.icon-composed.svg");
mkdirSync(dirname(composedPath), { recursive: true });
writeFileSync(composedPath, composedSvg);

await sharp(Buffer.from(composedSvg))
  .resize(1024, 1024)
  .png()
  .toFile(outPng);

console.log(`generated ${outPng}`);

// Hand off to tauri's icon generator — it produces every required size,
// .icns, .ico, etc., into src-tauri/icons/.
const r = spawnSync("npx", ["--yes", "@tauri-apps/cli@latest", "icon", outPng], {
  stdio: "inherit",
  cwd: root,
});
process.exit(r.status ?? 1);
