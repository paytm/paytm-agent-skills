/**
 * Paytm-themed interactive UI for the CLI.
 * Zero deps - uses node:readline + ANSI colors only.
 */

import readline from "node:readline";
import { confirm as kbConfirm, multiSelect as kbMultiSelect } from "./prompts.mjs";

const isTTY = process.stdout.isTTY && process.stdin.isTTY;

const paytmBlue   = (s) => (isTTY ? `\x1b[38;2;0;186;242m${s}\x1b[0m` : s);
const paytmNavy   = (s) => (isTTY ? `\x1b[38;2;0;41;112m${s}\x1b[0m` : s);
const bold        = (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim         = (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const green       = (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const yellow      = (s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s);
const red         = (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);

export const colors = { paytmBlue, paytmNavy, bold, dim, green, yellow, red };

export function isInteractive() { return isTTY; }

function padVisible(s, width) {
  const visibleLen = s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const pad = Math.max(0, width - visibleLen);
  return s + " ".repeat(pad);
}

/**
 * Branded banner. Used by interactive UI AND every subcommand for
 * consistent Paytm framing.
 *
 * Visual: block-letter "PAYTM" ASCII art in Paytm blue, with a soft
 * navy underline, tagline, version, and namespace-scope reassurance line.
 * `mode` becomes the tagline (e.g. "Agent Skills installer", "list targets").
 */
export function printBanner(version, mode = "Agent Skills installer") {
  // 6-row block-letter ASCII art for "PAYTM".
  const art = [
    "██████╗   █████╗  ██╗   ██╗ ████████╗ ███╗   ███╗",
    "██╔══██╗ ██╔══██╗ ╚██╗ ██╔╝ ╚══██╔══╝ ████╗ ████║",
    "██████╔╝ ███████║  ╚████╔╝     ██║    ██╔████╔██║",
    "██╔═══╝  ██╔══██║   ╚██╔╝      ██║    ██║╚██╔╝██║",
    "██║      ██║  ██║    ██║       ██║    ██║ ╚═╝ ██║",
    "╚═╝      ╚═╝  ╚═╝    ╚═╝       ╚═╝    ╚═╝     ╚═╝",
  ];

  console.log("");
  for (const line of art) {
    console.log("   " + paytmBlue(line));
  }
  // Underline + tagline
  console.log("   " + paytmNavy("─".repeat(50)));
  console.log("   " + bold("Paytm Payments") + dim("  ·  ") + mode + dim(`  ·  v${version}`));
  console.log("   " + dim("paytm/ namespace only · does not touch other skills"));
  console.log("");
}

/**
 * Show a one-line upgrade notice if the GitHub manifest version is newer
 * than the bundled one. Silent on network failure. Throttled to one check
 * per 6 hours per machine via a tiny on-disk cache.
 */
export async function printUpgradeNoticeIfAny(currentVersion) {
  try {
    const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
    const { tmpdir, homedir } = await import("node:os");
    const { join } = await import("node:path");

    const cacheDir  = join(homedir(), ".paytm-agent-skills");
    const cacheFile = join(cacheDir, "version-check.json");
    const TTL_MS = 6 * 60 * 60 * 1000; // 6h

    let cached = null;
    if (existsSync(cacheFile)) {
      try { cached = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { /* corrupt - ignore */ }
    }

    let latest = cached?.latest;
    let stale  = !cached || (Date.now() - (cached.checkedAt || 0)) > TTL_MS;

    if (stale) {
      const url = "https://raw.githubusercontent.com/paytm/paytm-integration-skills/main/manifest.json";
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        const remote = await r.json();
        latest = remote?.version;
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cacheFile, JSON.stringify({ latest, checkedAt: Date.now() }, null, 2));
      }
    }

    if (latest && semverGt(latest, currentVersion)) {
      console.log("  " + bold(paytmBlue("🆕 New version available:")) + ` paytm@${latest} ` + dim(`(you have ${currentVersion})`));
      console.log("  " + dim("Upgrade: npx paytm-agent-skills install --force"));
      console.log("");
    }
  } catch { /* silent - never break install on a failed version check */ }
}

function semverGt(a, b) {
  const pa = a.split(/[.\-+]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.\-+]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

function ask(rl, q) { return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim()))); }

async function confirm(rl, label, defaultYes = true) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const a = await ask(rl, `  ${label} ${dim(hint)} `);
  if (!a) return defaultYes;
  return /^y(es)?$/i.test(a);
}

async function multiPick(rl, items, prompt) {
  console.log("");
  items.forEach((it, i) => {
    console.log(`    ${dim(String(i + 1).padStart(2))}. ${it.label}`);
  });
  console.log("");
  const a = await ask(rl, `  ${prompt} ${dim("(comma-separated numbers, blank = all):")} `);
  if (!a) return items.map((i) => i.id);

  const picked = new Set();
  for (const tok of a.split(/[,\s]+/)) {
    const n = parseInt(tok, 10);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) picked.add(items[n - 1].id);
  }
  return [...picked];
}

/**
 * Step-progress printer. Returns an updater function the install loop calls
 * for each target. Mimics openclaw-style "[i/n] task ... ✓ done" output.
 */
export function makeStepReporter(totalSteps) {
  let i = 0;
  return {
    start(label) {
      i++;
      const prefix = dim(`[${i}/${totalSteps}]`);
      process.stdout.write(`  ${prefix} ${label} ${dim("...")} `);
    },
    done(suffix = "") {
      console.log(green("✓") + (suffix ? " " + dim(suffix) : ""));
    },
    skip(reason = "") {
      console.log(yellow("skipped") + (reason ? " " + dim(reason) : ""));
    },
    fail(reason = "") {
      console.log(red("✗ failed") + (reason ? " " + dim(reason) : ""));
    },
  };
}

/**
 * Drive the interactive install flow.
 * #5 (Mohit): hide getting-started from the skill picker (it's part of the bundle
 *             but not a user-facing flow choice).
 * #6 (Mohit): backends default ON, show the language list instead of asking y/n.
 *
 * Returns { targets, skills, withBackends, force, cancelled }.
 */
export async function runInteractiveInstall({ manifest, detected }) {
  const supported = (manifest.targets || []).filter((t) => t.status === "supported");
  const installable = supported.filter((t) => t.format !== "project-files");
  const detectedInstallable = installable.filter((t) => detected.has(t.id));

  // ---- detection summary ----
  console.log(bold("  AI tools detected on this machine:"));
  console.log("");
  if (detectedInstallable.length === 0) {
    console.log("    " + yellow("(none auto-detected)"));
  } else {
    for (const t of detectedInstallable) {
      console.log(`    ${green("✓")} ${t.name} ${dim("→ " + (t.install_dir || ""))}`);
    }
  }
  const undetected = installable.filter((t) => !detected.has(t.id));
  if (undetected.length > 0) {
    console.log("");
    console.log("  " + dim("Not detected (can still be installed manually):"));
    for (const t of undetected) console.log(`    ${dim("·")} ${dim(t.name)}`);
  }
  console.log("");

  try {
    // ---- target multi-select ----
    const pickedTargetIds = await kbMultiSelect(
      "Pick AI tools to install Paytm Skill into:",
      installable.map((t) => ({
        value: t.id,
        label: t.name + (detected.has(t.id) ? dim("  (detected)") : dim("  (not detected)")),
      })),
      {
        // pre-check the detected ones; if none detected, pre-check all installable
        defaults: detectedInstallable.length
          ? detectedInstallable.map((t) => t.id)
          : installable.map((t) => t.id),
        minSelected: 1,
      }
    );

    if (pickedTargetIds.length === 0) {
      console.log("");
      console.log(yellow("  Nothing selected. Aborted."));
      return { cancelled: true };
    }

    // ---- skill multi-select (getting-started is auto-included, not shown) ----
    const userFacingSkills = (manifest.skills || []).filter((s) => s.name !== "getting-started");
    const pickedSkillsRaw = await kbMultiSelect(
      "Pick Paytm skills to install:",
      userFacingSkills.map((s) => ({
        value: s.name,
        label: s.name + dim("  — " + (s.description || "").slice(0, 60)),
      })),
      {
        defaults: userFacingSkills.map((s) => s.name), // all checked by default
        minSelected: 1,
      }
    );
    if (pickedSkillsRaw.length === 0) {
      console.log("");
      console.log(yellow("  No skills selected. Aborted."));
      return { cancelled: true };
    }
    // Always silently include getting-started (the routing entry).
    const pickedSkills =
      pickedSkillsRaw.length === userFacingSkills.length
        ? [] // "install all"
        : [...new Set(["getting-started", ...pickedSkillsRaw])];

    // Reference backends are ALWAYS included — no prompt.
    const langs = [...new Set((manifest.backends || []).map((b) => b.language))].join(", ");
    console.log("");
    console.log("  " + dim(`Reference backends included: ${langs || "(none)"}`));
    const withBackends = true;

    // ---- force ----
    const force = await kbConfirm("Force-overwrite any existing Paytm agent skills install?", { defaultYes: true });

    // ---- summary ----
    console.log("");
    console.log(bold("  Summary"));
    console.log("");
    console.log(`    Tools:    ${pickedTargetIds.join(", ")}`);
    console.log(`    Skills:   ${pickedSkills.length ? pickedSkills.join(", ") : dim("(all)")}`);
    console.log(`    Backends: ${withBackends ? "included" : "skipped"}`);
    console.log(`    Force:    ${force ? "yes" : "no"}`);
    console.log("");

    const go = await kbConfirm("Proceed?", { defaultYes: true });
    if (!go) return { cancelled: true };

    return { targets: pickedTargetIds, skills: pickedSkills, withBackends, force, cancelled: false };
  } catch (e) {
    if (e.message === "cancelled") return { cancelled: true };
    throw e;
  }
}
