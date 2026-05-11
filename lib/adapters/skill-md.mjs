/**
 * skill-md adapter (v2 multi-skill).
 *
 * Used by tools that read a folder of skills, each as its own subdirectory:
 *   - Claude Code (~/.claude/skills/paytm/<skill>/)
 *   - Codex      (~/.codex/skills/paytm/<skill>/)
 *   - Cursor     (~/.cursor/skills-cursor/paytm/<skill>/)
 *   - Gemini CLI (~/.gemini/skills/paytm/<skill>/)
 *
 * Layout written:
 *   <install_dir>/
 *   ├── manifest.json                          (copy)
 *   ├── <routing_file>                         (e.g. CLAUDE.md, GEMINI.md - if target.routing_file set)
 *   ├── getting-started/SKILL.md
 *   ├── js-checkout/SKILL.md
 *   ├── js-checkout/references/REFERENCE.md
 *   ├── ... (one folder per skill)
 *   └── shared/
 *       ├── .env.example                       (assets)
 *       └── frontend/*.html                    (assets)
 *   plus optionally /backends/ when --with-backends.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { packagePath } from "../manifest.mjs";
import { renderRoutingManifest } from "./routing.mjs";

function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function copyOne(srcAbs, destAbs, { dryRun }) {
  if (dryRun) {
    console.log(`  [dry-run] copy ${basename(srcAbs)} -> ${destAbs}`);
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

export function install({ manifest, target, dir, withBackends = false, dryRun = false }) {
  let files = 0;

  // 1. Each skill's folder
  for (const skill of manifest.skills || []) {
    const skillSrc = packagePath(skill.path);
    const skillDest = join(dir, skill.name);
    copyTree(skillSrc, skillDest, { dryRun });
    // Approx file count - not exact in dryRun, but representative
    if (!dryRun) {
      const seen = [];
      walkCount(skillDest, seen);
      files += seen.length;
    } else files++;
  }

  // 2. Assets under shared/
  for (const a of manifest.assets || []) {
    const dest = join(dir, "shared", a);
    copyOne(packagePath(a), dest, { dryRun });
    files++;
  }

  // 3. Backends (opt-in)
  if (withBackends) {
    for (const b of manifest.backends || []) {
      const src = packagePath(b.path);
      if (existsSync(src)) {
        copyTree(src, join(dir, "backends", b.id), { dryRun });
        files++;
      }
    }
  }

  // 4. Routing manifest (per-target file like CLAUDE.md)
  if (target.routing_file) {
    const routingPath = join(dir, target.routing_file);
    const routingMd = renderRoutingManifest({ manifest, target });
    if (dryRun) {
      console.log(`  [dry-run] write routing ${routingPath} (${routingMd.length.toLocaleString()} bytes)`);
    } else {
      ensureDir(dirname(routingPath));
      writeFileSync(routingPath, routingMd);
    }
    files++;
  }

  // 5. Manifest copy
  if (!dryRun) {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  files++;

  return { files };
}

function walkCount(dir, acc) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkCount(p, acc);
    else acc.push(p);
  }
}
