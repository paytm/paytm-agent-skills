/**
 * Auto-detect which AI tools are installed on the user's machine, so
 * `paytm-agent-skills install` (no --target) can pick sensible defaults.
 *
 * For each target we check two signals (either is sufficient):
 *   - canonical config dir exists (e.g. ~/.claude, ~/.codex)
 *   - the CLI binary is reachable on PATH (e.g. `codex`, `cursor`, `aider`)
 *
 * Either signal alone is treated as "tool present". This handles users who
 * installed via Homebrew, npm global, custom prefix, or who have launched
 * the tool at least once (creating the dir).
 */

import { existsSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";

// Codex CLI and ChatGPT desktop app share ~/.codex/, so any of these signals
// means the user has SOMETHING that reads skills from there.
const CANDIDATE_PATHS = {
  "claude-code": [join(homedir(), ".claude")],
  "codex": [
    join(homedir(), ".codex"),
    join(homedir(), ".config", "codex"),
    // ChatGPT desktop app (macOS) - app data dir presence implies ~/.codex too
    join(homedir(), "Library", "Application Support", "com.openai.chat"),
    // Windows / Linux ChatGPT desktop builds when they exist
    join(homedir(), "AppData", "Roaming", "OpenAI", "ChatGPT"),
    join(homedir(), ".config", "ChatGPT"),
  ],
  "cursor":     [".cursor", join(homedir(), ".cursor")],
  "continue":   [".continue", join(homedir(), ".continue")],
  "windsurf":   [".windsurf", join(homedir(), ".windsurf"), join(homedir(), ".codeium", "windsurf")],
  "gemini-cli": [join(homedir(), ".gemini")],
  "aider":      [".aider", join(homedir(), ".aider")],
  "opencode":   [join(homedir(), ".opencode")],
};

const CANDIDATE_BINARIES = {
  "claude-code": ["claude"],
  "codex":       ["codex"],
  "cursor":      ["cursor"],
  "continue":    ["continue"],
  "windsurf":    ["windsurf"],
  "gemini-cli":  ["gemini"],
  "aider":       ["aider"],
  "opencode":    ["opencode"],
  "github-copilot-cli": ["gh"],          // gh CLI itself; copilot extension is separate
};

function isOnPath(binName) {
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const exts = platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const d of dirs) {
    for (const ext of exts) {
      const p = join(d, binName + ext);
      try {
        if (existsSync(p) && statSync(p).isFile()) return true;
      } catch { /* permission/dangling - skip */ }
    }
  }
  return false;
}

/** Returns the subset of target ids whose config dir exists OR binary is on PATH. */
export function detectInstalledTools() {
  const found = [];
  for (const id of Object.keys(CANDIDATE_PATHS)) {
    const dirHit = (CANDIDATE_PATHS[id] || []).some((p) => existsSync(p));
    const binHit = (CANDIDATE_BINARIES[id] || []).some((b) => isOnPath(b));
    if (dirHit || binHit) found.push(id);
  }
  return found;
}

/** Default target list when user runs `install` with no flags. */
export function defaultTargets(manifest) {
  const detected = new Set(detectInstalledTools());
  const supported = (manifest.targets || []).filter((t) => t.status === "supported");
  const matches = supported.filter((t) => detected.has(t.id));
  // If nothing detected, fall back to the first supported target with a non-null install_dir.
  if (matches.length) return matches;
  return supported.filter((t) => t.install_dir != null).slice(0, 1);
}
