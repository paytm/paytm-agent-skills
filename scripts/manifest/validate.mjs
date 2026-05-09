#!/usr/bin/env node
/**
 * Validate manifest.json against manifest.schema.json and check internal consistency:
 *  - all referenced files exist
 *  - SKILL.md frontmatter triggers match manifest.triggers
 *  - version follows semver
 *
 * Zero runtime deps (no ajv) - we keep validation hand-rolled and small to stay
 * dependency-free for the NPX installer.
 *
 * Usage: node scripts/manifest/validate.mjs
 * Exits non-zero on any failure. Use in CI.
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
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    fail(`Cannot read ${p}: ${e.message}`);
    return null;
  }
}

const manifestPath = join(ROOT, "manifest.json");
const schemaPath = join(ROOT, "manifest.schema.json");

const manifest = loadJSON(manifestPath);
const schema = loadJSON(schemaPath);
if (!manifest || !schema) process.exit(1);

// ---- 1. Required fields per schema ----
for (const req of schema.required) {
  if (manifest[req] === undefined) fail(`Missing required field: ${req}`);
}

// ---- 2. Semver ----
if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) {
  fail(`version "${manifest.version}" is not valid semver`);
}

// ---- 3. Entry exists ----
if (manifest.entry && !existsSync(join(ROOT, manifest.entry))) {
  fail(`entry file does not exist: ${manifest.entry}`);
}

// ---- 4. References exist ----
for (const ref of manifest.references || []) {
  if (!existsSync(join(ROOT, ref.path))) fail(`reference missing: ${ref.path}`);
  if (!["eager", "lazy"].includes(ref.load)) fail(`reference ${ref.path} has invalid load: ${ref.load}`);
}

// ---- 5. Assets exist ----
for (const a of manifest.assets || []) {
  if (!existsSync(join(ROOT, a))) fail(`asset missing: ${a}`);
}

// ---- 6. Backends exist ----
for (const b of manifest.backends || []) {
  if (!existsSync(join(ROOT, b.path))) fail(`backend dir missing: ${b.path}`);
}

// ---- 7. Targets sanity ----
const seenTargetIds = new Set();
for (const t of manifest.targets || []) {
  if (seenTargetIds.has(t.id)) fail(`duplicate target id: ${t.id}`);
  seenTargetIds.add(t.id);
  if (!["supported", "planned", "experimental", "deprecated"].includes(t.status)) {
    fail(`target ${t.id} has invalid status: ${t.status}`);
  }
}

// ---- 8. SKILL.md frontmatter triggers must match manifest.triggers ----
//      (we want a single source of truth - manifest is canonical, but the SKILL.md
//      frontmatter is what Claude reads at runtime, so they MUST agree.)
try {
  const skill = readFileSync(join(ROOT, manifest.entry), "utf8");
  const fm = skill.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const block = fm[1];
    const missing = [];
    for (const trig of manifest.triggers || []) {
      // Match the trigger as a quoted token in the description. We don't parse
      // YAML strictly; we just want to ensure each trigger token appears in
      // the frontmatter so both sources reference the same vocabulary.
      if (!block.includes(`"${trig}"`) && !block.includes(`'${trig}'`) && !block.includes(trig)) {
        missing.push(trig);
      }
    }
    if (missing.length) {
      warn(
        `SKILL.md frontmatter does not mention these manifest triggers: ${missing.join(", ")}\n` +
        `   Update SKILL.md frontmatter or remove these from manifest.triggers.`
      );
    }
  } else {
    warn("SKILL.md has no YAML frontmatter - cannot cross-check triggers.");
  }
} catch (e) {
  warn(`Could not read SKILL.md for trigger cross-check: ${e.message}`);
}

// ---- 9. Telemetry sanity ----
if (manifest.telemetry) {
  const t = manifest.telemetry;
  if (t.default === "opt-out" && !t.endpoint) {
    fail("telemetry.default is 'opt-out' but no endpoint configured");
  }
}

// ---- 10. At least one supported target ----
const supported = (manifest.targets || []).filter((t) => t.status === "supported");
if (supported.length === 0) {
  fail("manifest must declare at least one target with status: supported");
}

// ---- Report ----
if (warnings.length) {
  console.error("\n⚠  Warnings:");
  warnings.forEach((w) => console.error("   - " + w));
}
if (errors.length) {
  console.error("\n✗ Manifest validation failed:");
  errors.forEach((e) => console.error("   - " + e));
  process.exit(1);
}
console.log(
  `✓ manifest.json valid  (skill: ${manifest.name}@${manifest.version}, ` +
  `${(manifest.references || []).length} references, ` +
  `${supported.length} supported / ${(manifest.targets || []).length} total targets)`
);
