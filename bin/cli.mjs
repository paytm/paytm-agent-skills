#!/usr/bin/env node
/**
 * paytm-skills - one-command installer for the Paytm PG integration skill.
 *
 * Subcommands:
 *   install        Install into auto-detected AI tools (or --target <id> / --all-targets).
 *   uninstall      Remove from auto-detected tools (or --target <id> / --all-targets).
 *   list-targets   Show every target the manifest knows about + status + install dir.
 *   path           Print the install dir for a target (--target <id>).
 *   help           Show this help.
 *
 * Flags:
 *   --target <id>      Restrict to one target (e.g. claude-code, codex).
 *   --all-targets      Apply to every supported target (skips planned/manual).
 *   --with-backends    Also copy reference backend implementations (large; off by default).
 *   --force            For install: wipe target dir first. Otherwise files are overwritten in place.
 *   --dry-run          Print actions without touching disk.
 *   --version          Print version and exit.
 *
 * Exits:
 *   0 success, 1 user error, 2 internal error.
 */

import { loadManifest } from "../lib/manifest.mjs";
import { installTarget, uninstallTarget } from "../lib/install.mjs";
import { defaultTargets, detectInstalledTools } from "../lib/detect.mjs";
import { resolveInstallDir } from "../lib/paths.mjs";
import { printBanner, runInteractiveInstall, isInteractive } from "../lib/ui.mjs";

// Flags that can be repeated (collected into arrays).
const MULTI_FLAGS = new Set(["skill"]);

// --- tiny arg parser (no deps) ---
function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, vEq] = a.slice(2).split("=");
      let v;
      if (vEq !== undefined) v = vEq;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) v = argv[++i];
      else v = true;

      if (MULTI_FLAGS.has(k)) {
        if (!Array.isArray(args.flags[k])) args.flags[k] = [];
        args.flags[k].push(v);
      } else {
        args.flags[k] = v;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// --- output helpers ---
const isTTY = process.stdout.isTTY;
const c = {
  dim: (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
};

function printHelp() {
  console.log(`paytm-skills - install the Paytm PG integration skill bundle into your AI tools.

Usage:
  npx paytm-skills                       (interactive UI - recommended)
  npx paytm-skills add skills            (same as above)
  npx paytm-skills <command> [options]   (scripted / CI use)

Commands:
  install                  Install into detected AI tools.
  uninstall                Remove from detected AI tools.
  list-targets             Show all targets the manifest knows about + detection state.
  list-skills              Show all skills in the bundle with descriptions + triggers.
  path --target <id>       Print install dir for a target.
  help                     Show this help.

Options:
  --target <id>            Restrict to one target (e.g. claude-code, codex, cursor).
  --all-targets            Apply to every supported target.
  --skill <name>           Install only the named skill (e.g. subscriptions). Repeat to pick several.
                           Default: install every skill.
  --with-backends          Also copy reference backend implementations.
  --force                  Wipe target dir before install.
  --dry-run                Print actions without writing.
  --version                Print version and exit.

Examples:
  npx paytm-skills install
  npx paytm-skills install --target claude-code
  npx paytm-skills install --target cursor --skill subscriptions
  npx paytm-skills install --all-targets --with-backends
  npx paytm-skills uninstall --target codex
  npx paytm-skills list-targets
  npx paytm-skills list-skills
`);
}

function pickTargets(manifest, flags, { command }) {
  const all = manifest.targets || [];
  if (flags.target) {
    const t = all.find((x) => x.id === flags.target);
    if (!t) {
      console.error(c.red(`✗ Unknown target: ${flags.target}`));
      console.error(`  Run 'npx paytm-skills list-targets' to see options.`);
      process.exit(1);
    }
    return [t];
  }
  if (flags["all-targets"]) {
    return all.filter((t) => t.status === "supported" && t.install_dir != null);
  }
  // Auto-detect default
  const defaults = defaultTargets(manifest);
  if (defaults.length === 0) {
    console.error(c.yellow(`⚠ No AI tools auto-detected on this machine.`));
    console.error(`  Specify a target explicitly:`);
    console.error(`    npx paytm-skills ${command} --target claude-code`);
    console.error(`  Or list available targets:`);
    console.error(`    npx paytm-skills list-targets`);
    process.exit(1);
  }
  return defaults;
}

// --- commands ---

function filterManifestSkills(manifest, requestedNames) {
  if (!requestedNames || requestedNames.length === 0) return manifest;
  const known = new Map((manifest.skills || []).map((s) => [s.name, s]));
  const missing = requestedNames.filter((n) => !known.has(n));
  if (missing.length) {
    console.error(c.red(`✗ Unknown skill(s): ${missing.join(", ")}`));
    console.error(`  Run 'npx paytm-skills list-skills' to see available skills.`);
    process.exit(1);
  }
  // Return a shallow clone of the manifest with only the requested skills.
  return { ...manifest, skills: requestedNames.map((n) => known.get(n)) };
}

function cmdInstall(manifest, flags) {
  const targets = pickTargets(manifest, flags, { command: "install" });
  const dryRun = !!flags["dry-run"];
  const force = !!flags.force;
  const withBackends = !!flags["with-backends"];

  // Skill filter (--skill X --skill Y) returns a manifest view with only those skills.
  const requestedSkills = Array.isArray(flags.skill) ? flags.skill : (flags.skill ? [flags.skill] : []);
  const effectiveManifest = filterManifestSkills(manifest, requestedSkills);

  console.log(c.bold(`paytm-skills v${manifest.version} - installing bundle: ${manifest.name}`));
  if (requestedSkills.length) {
    console.log(c.dim(`(skills filter: ${requestedSkills.join(", ")})`));
  }
  if (dryRun) console.log(c.dim("(dry-run mode - nothing will be written)"));
  console.log("");

  let okCount = 0, skipCount = 0;
  for (const t of targets) {
    process.stdout.write(`  ${t.name} (${t.id})  ... `);
    try {
      const res = installTarget(effectiveManifest, t, { force, dryRun, withBackends });
      if (res.installed) {
        console.log(c.green(`ok`) + c.dim(`  -> ${res.dir} (${res.files} files)`));
        okCount++;
      } else {
        console.log(c.yellow(`skipped`) + c.dim(`  ${res.skipped}`));
        skipCount++;
      }
    } catch (e) {
      console.log(c.red(`failed`) + `  ${e.message}`);
      process.exitCode = 2;
    }
  }

  console.log("");
  console.log(`${c.green(okCount + " installed")}, ${c.yellow(skipCount + " skipped")}`);

  if (okCount > 0 && !dryRun) {
    const verifiable = targets.filter((t) => t.verify_command);
    if (verifiable.length) {
      console.log("");
      console.log(c.dim("Verify with:"));
      for (const t of verifiable) console.log(c.dim(`  ${t.name}: ${t.verify_command}`));
    }
  }
}

function cmdUninstall(manifest, flags) {
  const targets = pickTargets(manifest, flags, { command: "uninstall" });
  const dryRun = !!flags["dry-run"];

  console.log(c.bold(`paytm-skills - uninstalling`));
  console.log("");
  for (const t of targets) {
    process.stdout.write(`  ${t.name} (${t.id})  ... `);
    const res = uninstallTarget(t, { dryRun });
    if (res.removed) {
      console.log(c.green("removed") + c.dim(`  ${res.dir}`));
    } else {
      console.log(c.yellow("skipped") + c.dim(`  ${res.reason}`));
    }
  }
}

// Pad accounting for invisible ANSI color codes.
function padVisible(s, width) {
  const visibleLen = s.replace(/\x1b\[\d+m/g, "").length;
  return s + " ".repeat(Math.max(0, width - visibleLen));
}

function cmdListTargets(manifest) {
  const detected = new Set(detectInstalledTools());
  console.log(c.bold(`Targets declared in manifest (skill: ${manifest.name}@${manifest.version}):`));
  console.log("");
  console.log(`  ${"ID".padEnd(16)} ${"STATUS".padEnd(13)} ${"DETECTED".padEnd(10)} INSTALL DIR`);
  console.log(`  ${"-".repeat(16)} ${"-".repeat(13)} ${"-".repeat(10)} ${"-".repeat(40)}`);
  for (const t of manifest.targets || []) {
    const dir = resolveInstallDir(t) || c.dim("(manual)");
    const det = detected.has(t.id) ? c.green("yes") : c.dim("no");
    const status =
      t.status === "supported" ? c.green(t.status)
      : t.status === "planned" ? c.yellow(t.status)
      : c.dim(t.status);
    console.log(`  ${padVisible(t.id, 16)} ${padVisible(status, 13)} ${padVisible(det, 10)} ${dir}`);
  }
  console.log("");
  console.log(c.dim("Install one with: npx paytm-skills install --target <id>"));
}

// `npx paytm-skills add skills` -> interactive (mirrors Cashfree's UX)
function cmdAdd(manifest, args) {
  const sub = args._[1];
  if (sub === "skills" || sub === undefined) {
    if (!isInteractive()) {
      console.error(c.red("✗ Interactive mode requires a TTY. In non-interactive contexts use 'install --target <id>'."));
      process.exit(1);
    }
    return runInteractive(manifest);
  }
  console.error(c.red(`✗ Unknown subcommand: add ${sub}`));
  process.exit(1);
}

async function runInteractive(preLoadedManifest) {
  let manifest = preLoadedManifest;
  if (!manifest) {
    try { manifest = loadManifest(); }
    catch (e) { console.error(c.red("✗ " + e.message)); process.exit(2); }
  }

  printBanner(manifest.version);

  const detected = new Set(detectInstalledTools());
  const result = await runInteractiveInstall({ manifest, detected });
  if (result.cancelled) return;

  // Build a synthetic flags object and dispatch through the normal install path.
  const flags = {
    target: result.targets.length === 1 ? result.targets[0] : undefined,
    force: result.force,
    "with-backends": result.withBackends,
  };
  if (result.targets.length > 1) flags["all-targets"] = true;
  if (result.skills.length > 0) flags.skill = result.skills;

  console.log("");

  // Filter targets explicitly to the picked subset (since --all-targets includes
  // every supported target, but the user may have picked a subset).
  const pickedSet = new Set(result.targets);
  const targets = (manifest.targets || []).filter((t) => pickedSet.has(t.id));

  const requestedSkills = Array.isArray(flags.skill) ? flags.skill : [];
  const effective = requestedSkills.length
    ? { ...manifest, skills: manifest.skills.filter((s) => requestedSkills.includes(s.name)) }
    : manifest;

  let okCount = 0, skipCount = 0;
  for (const t of targets) {
    process.stdout.write(`  ${t.name} (${t.id})  ... `);
    try {
      const res = installTarget(effective, t, {
        force: result.force,
        dryRun: false,
        withBackends: result.withBackends,
      });
      if (res.installed) {
        console.log(c.green("ok") + c.dim(`  -> ${res.dir} (${res.files} files)`));
        okCount++;
      } else {
        console.log(c.yellow("skipped") + c.dim(`  ${res.skipped}`));
        skipCount++;
      }
    } catch (e) {
      console.log(c.red("failed") + `  ${e.message}`);
      process.exitCode = 2;
    }
  }

  console.log("");
  console.log(c.bold(`Done.`) + ` ${c.green(okCount + " installed")}, ${c.yellow(skipCount + " skipped")}`);
  console.log("");
  console.log(c.dim("Try it: open your AI tool and type \"Set up Paytm payments\"."));
}

function cmdListSkills(manifest) {
  console.log(c.bold(`Skills in bundle ${manifest.name}@${manifest.version}:`));
  console.log("");
  console.log(`  ${"NAME".padEnd(18)} ${"STATUS".padEnd(10)} ${"REFS".padEnd(6)} DESCRIPTION`);
  console.log(`  ${"-".repeat(18)} ${"-".repeat(10)} ${"-".repeat(6)} ${"-".repeat(60)}`);
  for (const s of manifest.skills || []) {
    const status = s.status === "stub" ? c.yellow("stub") : s.status === "deprecated" ? c.red("deprecated") : c.green("stable");
    const refs = String((s.references || []).length);
    const desc = (s.description || "").slice(0, 80);
    console.log(`  ${padVisible(s.name, 18)} ${padVisible(status, 10)} ${refs.padEnd(6)} ${desc}`);
  }
  console.log("");
  console.log(c.dim("Install one with: npx paytm-skills install --target <id> --skill <name>"));
  console.log(c.dim("Install several:  npx paytm-skills install --target <id> --skill subscriptions --skill payment-links"));
}

function cmdPath(manifest, flags) {
  if (!flags.target) {
    console.error(c.red("✗ --target <id> is required"));
    process.exit(1);
  }
  const t = (manifest.targets || []).find((x) => x.id === flags.target);
  if (!t) {
    console.error(c.red(`✗ Unknown target: ${flags.target}`));
    process.exit(1);
  }
  const dir = resolveInstallDir(t);
  if (dir == null) {
    console.error(c.yellow(`${t.name} has no install dir (manual setup required)`));
    process.exit(1);
  }
  console.log(dir);
}

// --- main ---

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version) {
    const m = loadManifest();
    console.log(m.version);
    return;
  }

  const cmd = args._[0];

  // Bare invocation with TTY -> launch interactive UI. Without TTY -> show help.
  if (!cmd) {
    if (isInteractive()) return runInteractive();
    printHelp();
    return;
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  let manifest;
  try {
    manifest = loadManifest();
  } catch (e) {
    console.error(c.red("✗ " + e.message));
    process.exit(2);
  }

  switch (cmd) {
    case "install":      return cmdInstall(manifest, args.flags);
    case "uninstall":    return cmdUninstall(manifest, args.flags);
    case "list-targets": return cmdListTargets(manifest);
    case "list-skills":  return cmdListSkills(manifest);
    case "path":         return cmdPath(manifest, args.flags);
    case "add":          return cmdAdd(manifest, args);
    default:
      console.error(c.red(`✗ Unknown command: ${cmd}`));
      console.error(`  Run 'npx paytm-skills help' for usage.`);
      process.exit(1);
  }
}

main();
