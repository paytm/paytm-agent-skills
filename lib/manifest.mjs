/**
 * Manifest loader. Reads manifest.json from the package root.
 * Resolution order:
 *   1. PAYTM_SKILLS_MANIFEST env var (absolute path) - test override
 *   2. <package-root>/manifest.json (next to package.json)
 *
 * The package root is computed from this file's location, not from process.cwd(),
 * so the CLI works regardless of where the user invoked it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(HERE, "..");

export function loadManifest() {
  const path = process.env.PAYTM_SKILLS_MANIFEST || resolve(PACKAGE_ROOT, "manifest.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Failed to load manifest from ${path}: ${e.message}`);
  }
}

/** Resolve a path inside the package (e.g. "references/foo.md" -> absolute path). */
export function packagePath(relPath) {
  return resolve(PACKAGE_ROOT, relPath);
}
