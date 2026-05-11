/**
 * Paytm-themed interactive UI for the CLI.
 * Zero deps - uses node:readline + ANSI colors only.
 *
 * Brand: Paytm blue (#002970). Approximate with ANSI bright/blue + bold.
 */

import readline from "node:readline";

const isTTY = process.stdout.isTTY && process.stdin.isTTY;

// Paytm-ish palette using 24-bit ANSI where available, fallback to standard blue.
const paytmBlue   = (s) => (isTTY ? `\x1b[38;2;0;186;242m${s}\x1b[0m` : s);       // accent
const paytmNavy   = (s) => (isTTY ? `\x1b[38;2;0;41;112m${s}\x1b[0m` : s);        // primary
const bold        = (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim         = (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const green       = (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const yellow      = (s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s);
const red         = (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);

export const colors = { paytmBlue, paytmNavy, bold, dim, green, yellow, red };

export function isInteractive() {
  return isTTY;
}

// Pad a string to a visible width, ignoring ANSI escape sequences.
function padVisible(s, width) {
  const visibleLen = s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const pad = Math.max(0, width - visibleLen);
  return s + " ".repeat(pad);
}

export function printBanner(version) {
  const W = 62; // visible inner width of the box

  const top    = "╔" + "═".repeat(W) + "╗";
  const bottom = "╚" + "═".repeat(W) + "╝";
  const blank  = "║" + " ".repeat(W) + "║";

  const titleInner = "  " + bold(paytmBlue("Paytm Payments")) + dim("  ·  ") + "Agent Skills installer";
  const versionInner = "  " + dim(`bundle: paytm@${version}`);

  const title   = "║" + padVisible(titleInner,   W) + "║";
  const verLine = "║" + padVisible(versionInner, W) + "║";

  console.log("");
  console.log("  " + paytmNavy(top));
  console.log("  " + paytmNavy(blank));
  console.log("  " + paytmNavy("║") + padVisible(titleInner,   W) + paytmNavy("║"));
  console.log("  " + paytmNavy(blank));
  console.log("  " + paytmNavy("║") + padVisible(versionInner, W) + paytmNavy("║"));
  console.log("  " + paytmNavy(blank));
  console.log("  " + paytmNavy(bottom));
  console.log("");
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

/**
 * y/n prompt. Returns true/false. Empty input = default.
 */
async function confirm(rl, label, defaultYes = true) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const a = await ask(rl, `  ${label} ${dim(hint)} `);
  if (!a) return defaultYes;
  return /^y(es)?$/i.test(a);
}

/**
 * Comma-separated multi-pick from a list of {id, label} items.
 * Returns the picked ids (empty = picked all).
 */
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
    if (Number.isInteger(n) && n >= 1 && n <= items.length) {
      picked.add(items[n - 1].id);
    }
  }
  return [...picked];
}

/**
 * Drive the interactive install flow.
 * Returns { targets: string[], skills: string[], force: boolean, withBackends: boolean, cancelled: boolean }.
 */
export async function runInteractiveInstall({ manifest, detected }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // ---- detection summary ----
    const supported = (manifest.targets || []).filter((t) => t.status === "supported");
    const installable = supported.filter((t) => t.format !== "project-files");
    const detectedInstallable = installable.filter((t) => detected.has(t.id));

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

    // ---- target selection ----
    let pickedTargetIds;
    if (detectedInstallable.length > 0) {
      const installAllDetected = await confirm(
        rl,
        `Install into all ${detectedInstallable.length} detected tool${detectedInstallable.length > 1 ? "s" : ""}?`,
        true
      );
      if (installAllDetected) {
        pickedTargetIds = detectedInstallable.map((t) => t.id);
      } else {
        pickedTargetIds = await multiPick(
          rl,
          installable.map((t) => ({ id: t.id, label: t.name + (detected.has(t.id) ? dim("  (detected)") : "") })),
          "Pick tools"
        );
      }
    } else {
      // none detected
      pickedTargetIds = await multiPick(
        rl,
        installable.map((t) => ({ id: t.id, label: t.name })),
        "Pick tools to install for"
      );
    }

    if (pickedTargetIds.length === 0) {
      console.log("");
      console.log(yellow("  Nothing selected. Run with --target <id> next time."));
      return { cancelled: true };
    }

    // ---- skill selection ----
    console.log("");
    const allSkills = await confirm(rl, `Install all ${manifest.skills.length} skills?`, true);
    let pickedSkills = [];
    if (!allSkills) {
      pickedSkills = await multiPick(
        rl,
        manifest.skills.map((s) => ({ id: s.name, label: s.name + dim("  — " + (s.description || "").slice(0, 70)) })),
        "Pick skills"
      );
      if (pickedSkills.length === 0) {
        console.log("");
        console.log(yellow("  No skills selected. Aborting."));
        return { cancelled: true };
      }
    }

    // ---- backends ----
    console.log("");
    const withBackends = await confirm(rl, "Also copy reference backend implementations? (Node, Python, Java)", false);

    // ---- force ----
    console.log("");
    const force = await confirm(rl, "Force-overwrite any existing install? (recommended on upgrades)", false);

    // ---- confirm ----
    console.log("");
    console.log(bold("  Summary"));
    console.log("");
    console.log(`    Tools:    ${pickedTargetIds.join(", ")}`);
    console.log(`    Skills:   ${pickedSkills.length ? pickedSkills.join(", ") : dim("(all)")}`);
    console.log(`    Backends: ${withBackends ? "yes" : "no"}`);
    console.log(`    Force:    ${force ? "yes" : "no"}`);
    console.log("");

    const go = await confirm(rl, "Proceed?", true);
    if (!go) return { cancelled: true };

    return {
      targets: pickedTargetIds,
      skills: pickedSkills,
      withBackends,
      force,
      cancelled: false,
    };
  } finally {
    rl.close();
  }
}
