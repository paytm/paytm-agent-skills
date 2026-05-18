#!/usr/bin/env node
/**
 * Validate manifest.json (v2 multi-skill) and check internal consistency:
 *  - all skill paths + entries exist
 *  - all references inside skills exist
 *  - routing_preamble exists if specified
 *  - SKILL.md frontmatter triggers per skill align with manifest skills[].triggers
 *
 * Zero runtime deps. Use in CI.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function loadJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { fail(`Cannot read ${p}: ${e.message}`); return null; }
}

const manifest = loadJSON(join(ROOT, "manifest.json"));
const schema   = loadJSON(join(ROOT, "manifest.schema.json"));
if (!manifest || !schema) process.exit(1);

// 1. Required fields
for (const req of schema.required) {
  if (manifest[req] === undefined) fail(`Missing required field: ${req}`);
}

// 2. Semver
if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) {
  fail(`version "${manifest.version}" is not valid semver`);
}

// 3. routing_preamble exists
if (manifest.routing_preamble && !existsSync(join(ROOT, manifest.routing_preamble))) {
  fail(`routing_preamble missing: ${manifest.routing_preamble}`);
}

// 4. Skills - paths, entries, references all exist
const seenSkillNames = new Set();
for (const s of manifest.skills || []) {
  if (seenSkillNames.has(s.name)) fail(`duplicate skill name: ${s.name}`);
  seenSkillNames.add(s.name);
  if (!existsSync(join(ROOT, s.path))) {
    fail(`skill path missing: ${s.path}`);
    continue;
  }
  const entryAbs = join(ROOT, s.path, s.entry);
  if (!existsSync(entryAbs)) fail(`skill entry missing: ${s.path}/${s.entry}`);

  for (const ref of s.references || []) {
    if (!existsSync(join(ROOT, ref.path))) fail(`reference missing: ${ref.path}`);
    if (!["eager", "lazy"].includes(ref.load)) fail(`reference ${ref.path} invalid load: ${ref.load}`);
  }

  // 4b. Cross-check SKILL.md frontmatter triggers against manifest.skills[].triggers.
  //
  // Only checks "technical" triggers (no whitespace) - these are the tokens Claude
  // and routing manifests pattern-match against. Natural-language phrases like
  // "share payment link" or "modal not opening" are manifest-side metadata for
  // installers / registries / fuzzy-discovery and don't need to appear in the
  // skill loader's frontmatter.
  const isTechnical = (t) => !/\s/.test(t);
  try {
    const skillMd = readFileSync(entryAbs, "utf8");
    const fm = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fm) {
      const block = fm[1];
      for (const trig of (s.triggers || []).filter(isTechnical)) {
        if (!block.includes(`"${trig}"`) && !block.includes(`'${trig}'`) && !block.includes(trig)) {
          warn(`${s.name}: technical trigger "${trig}" not in SKILL.md frontmatter`);
        }
      }
    } else {
      warn(`${s.name}: SKILL.md has no YAML frontmatter`);
    }
  } catch (e) {
    warn(`${s.name}: could not read SKILL.md (${e.message})`);
  }
}

// 5. Assets
for (const a of manifest.assets || []) {
  if (!existsSync(join(ROOT, a))) fail(`asset missing: ${a}`);
}

// 6. Backends
for (const b of manifest.backends || []) {
  if (!existsSync(join(ROOT, b.path))) fail(`backend dir missing: ${b.path}`);
}

// 7. Targets
const seenTargetIds = new Set();
for (const t of manifest.targets || []) {
  if (seenTargetIds.has(t.id)) fail(`duplicate target id: ${t.id}`);
  seenTargetIds.add(t.id);
  if (!["supported", "planned", "experimental", "deprecated"].includes(t.status)) {
    fail(`target ${t.id} invalid status: ${t.status}`);
  }
}

// 8. Telemetry sanity
if (manifest.telemetry?.default === "opt-out" && !manifest.telemetry.endpoint) {
  fail("telemetry.default is 'opt-out' but no endpoint configured");
}

// 9. ≥1 supported target
const supported = (manifest.targets || []).filter((t) => t.status === "supported");
if (!supported.length) fail("manifest must declare at least one supported target");

// Report
if (warnings.length) {
  console.error("\nWarnings:");
  warnings.forEach((w) => console.error("   - " + w));
}
if (errors.length) {
  console.error("\nManifest validation failed:");
  errors.forEach((e) => console.error("   - " + e));
  process.exit(1);
}
console.log(
  `OK manifest v${manifest.manifest_version}  bundle=${manifest.name}@${manifest.version}  ` +
  `${(manifest.skills || []).length} skills, ` +
  `${supported.length}/${(manifest.targets || []).length} targets supported`
);
