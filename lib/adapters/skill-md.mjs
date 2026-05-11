/**
 * skill-md adapter: multi-file copy.
 *
 * Used by AI tools that read a folder of markdown (entry + references + assets):
 *   - Claude Code (~/.claude/skills/<name>/)
 *   - Codex      (~/.codex/skills/<name>/)
 *   - Cursor     (~/.cursor/skills-cursor/<name>/)
 *   - Gemini CLI (~/.gemini/skills/<name>/)
 *
 * Copies entry + references + assets preserving the repo's relative layout,
 * plus a copy of manifest.json so the tool can introspect what's installed.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { packagePath } from "../manifest.mjs";

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function copyOne(srcAbs, destAbs, { dryRun }) {
  if (dryRun) {
    console.log(`  [dry-run] copy ${srcAbs.split("/").pop()} -> ${destAbs}`);
    return;
  }
  ensureDir(dirname(destAbs));
  copyFileSync(srcAbs, destAbs);
}

function copyTree(srcDirAbs, destDirAbs, { dryRun }) {
  for (const name of readdirSync(srcDirAbs)) {
    const s = join(srcDirAbs, name);
    const d = join(destDirAbs, name);
    if (statSync(s).isDirectory()) copyTree(s, d, { dryRun });
    else copyOne(s, d, { dryRun });
  }
}

export function install({ manifest, dir, withBackends = false, dryRun = false }) {
  let files = 0;

  copyOne(packagePath(manifest.entry), join(dir, manifest.entry), { dryRun });
  files++;

  for (const ref of manifest.references || []) {
    copyOne(packagePath(ref.path), join(dir, ref.path), { dryRun });
    files++;
  }

  for (const a of manifest.assets || []) {
    copyOne(packagePath(a), join(dir, a), { dryRun });
    files++;
  }

  if (!dryRun) {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  files++;

  if (withBackends) {
    for (const b of manifest.backends || []) {
      const src = packagePath(b.path);
      if (existsSync(src)) {
        copyTree(src, join(dir, b.path), { dryRun });
        files++;
      }
    }
  }

  return { files };
}
