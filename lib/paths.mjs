/**
 * Path utilities + per-target install dir resolution.
 *
 * Manifest stores POSIX paths with `~` for home (e.g. `~/.claude/skills/paytm-integration`).
 * This module expands them to OS-native absolute paths.
 *
 * Override env vars (per target id, uppercased + dashes -> underscores):
 *   PAYTM_SKILLS_INSTALL_DIR_CLAUDE_CODE=/custom/path
 *   PAYTM_SKILLS_INSTALL_DIR_CURSOR=/custom/path
 * ...etc. Useful for tests and unusual setups.
 */

import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";

/** Expand `~` and `~/` to the user's home dir. */
export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

/** Resolve a target's install dir to an absolute path, or null if the target has no install dir. */
export function resolveInstallDir(target, { cwd = process.cwd() } = {}) {
  const overrideKey = `PAYTM_SKILLS_INSTALL_DIR_${target.id.toUpperCase().replace(/-/g, "_")}`;
  const override = process.env[overrideKey];
  if (override) return resolve(override);

  if (target.install_dir == null) return null;

  const expanded = expandHome(target.install_dir);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}
