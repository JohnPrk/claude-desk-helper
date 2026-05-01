#!/usr/bin/env node
// Tauri's `version` field requires semver (X.Y.Z), so the bundled
// dmg ships as e.g. `토큰 판다_0.81.0_aarch64.dmg`. Our project version
// scheme uses two-decimal-place tags (0.81 = 81 hundredths toward 1.0
// release), so rename the dmg to drop the trailing `.0` patch digit.
// No-op if the patch digit is already non-zero.

import { readdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dmgDir = resolve(here, "..", "src-tauri/target/release/bundle/dmg");

if (!existsSync(dmgDir)) {
  console.log(`[rename-dmg] no dmg dir at ${dmgDir} — skipping`);
  process.exit(0);
}

let renamed = 0;
for (const name of readdirSync(dmgDir)) {
  // Match `<anything>_<digits>.<digits>.0_<arch>.dmg` and drop the `.0`.
  const m = name.match(/^(.+?)_(\d+\.\d+)\.0_([^_]+)\.dmg$/);
  if (!m) continue;
  const [, base, shortVer, arch] = m;
  const target = `${base}_${shortVer}_${arch}.dmg`;
  if (target === name) continue;
  renameSync(join(dmgDir, name), join(dmgDir, target));
  console.log(`[rename-dmg] ${name} → ${target}`);
  renamed += 1;
}

if (renamed === 0) {
  console.log("[rename-dmg] no rename needed");
}
