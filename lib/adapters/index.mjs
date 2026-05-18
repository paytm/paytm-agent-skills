/**
 * Adapter registry. Maps manifest target.format -> install function.
 * Each adapter is a thin module that knows the target tool's expected layout.
 */

import * as skillMd from "./skill-md.mjs";
import * as bundledMd from "./bundled-md.mjs";

const REGISTRY = {
  "skill-md":   skillMd,
  "bundled-md": bundledMd,
  // "project-files" is a no-op marker for tools that require manual upload
  // (Claude.ai Projects, Antigravity). The CLI handles those by skipping
  // with a clear message - no adapter dispatch.
};

export function getAdapter(format) {
  return REGISTRY[format] || null;
}

export const ADAPTER_FORMATS = Object.keys(REGISTRY);
