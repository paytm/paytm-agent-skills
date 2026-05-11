/**
 * Core install / uninstall logic.
 *
 * Dispatches to the right adapter based on target.format. Adapters know how
 * to render the skill into the target tool's expected file layout (multi-file
 * dir vs single bundled markdown vs project-files manual).
 *
 * Idempotency: re-running install over an existing dir is safe; files are
 * overwritten. Use --force to also wipe extra files in the target dir.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolveInstallDir } from "./paths.mjs";
import { getAdapter } from "./adapters/index.mjs";

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/**
 * Install the skill payload for one target.
 * Returns { installed, dir, files, skipped }.
 */
export function installTarget(manifest, target, { force = false, dryRun = false, withBackends = false } = {}) {
  const dir = resolveInstallDir(target);

  if (target.format === "project-files" || dir == null) {
    return {
      installed: false,
      dir: dir,
      files: 0,
      skipped: target.notes
        ? `${target.name} - ${target.notes}`
        : `${target.name} requires manual upload (no install dir).`,
    };
  }

  if (target.status === "planned") {
    return {
      installed: false,
      dir,
      files: 0,
      skipped: `${target.name} is marked status: planned in manifest - adapter not yet wired up`,
    };
  }

  const adapter = getAdapter(target.format);
  if (!adapter) {
    return {
      installed: false,
      dir,
      files: 0,
      skipped: `${target.name} - no adapter registered for format "${target.format}"`,
    };
  }

  if (existsSync(dir) && force && !dryRun) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!dryRun) ensureDir(dir);

  const result = adapter.install({ manifest, dir, withBackends, dryRun });

  return { installed: true, dir, files: result.files, skipped: null };
}

/** Remove a previously installed target. */
export function uninstallTarget(target, { dryRun = false } = {}) {
  const dir = resolveInstallDir(target);
  if (dir == null) return { removed: false, dir: null, reason: "no install dir for this target" };
  if (!existsSync(dir)) return { removed: false, dir, reason: "not installed" };
  if (dryRun) return { removed: false, dir, reason: "[dry-run]" };
  rmSync(dir, { recursive: true, force: true });
  return { removed: true, dir, reason: null };
}
