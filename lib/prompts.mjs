/**
 * Zero-dep interactive terminal prompts (arrow-key navigation, space to toggle,
 * enter to confirm). Stylistically modelled on `inquirer` / `@clack/prompts`
 * but with no external dependencies and a Paytm color palette.
 *
 * Three primitives:
 *   - confirm(question, defaultYes)         -> boolean
 *   - select(question, items, opts)         -> item.value
 *   - multiSelect(question, items, opts)    -> array of item.value
 *
 * Each takes over stdin (raw mode), redraws inline on every keypress, and
 * cleans up the terminal state when finished or interrupted.
 */

const isTTY = process.stdout.isTTY && process.stdin.isTTY;

const c = {
  blue:  (s) => (isTTY ? `\x1b[38;2;0;186;242m${s}\x1b[0m` : s),
  navy:  (s) => (isTTY ? `\x1b[38;2;0;41;112m${s}\x1b[0m` : s),
  bold:  (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim:   (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow:(s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red:   (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  // High-contrast highlight for focused row: white text on Paytm blue background.
  highlight: (s) => (isTTY ? `\x1b[48;2;0;186;242m\x1b[38;2;255;255;255m\x1b[1m${s}\x1b[0m` : s),
};

// ─── ANSI helpers ───────────────────────────────────────────────────────
const ESC = "\x1b[";
const CLEAR_LINE = ESC + "2K";
const CURSOR_HIDE = ESC + "?25l";
const CURSOR_SHOW = ESC + "?25h";
const moveUp = (n) => (n > 0 ? ESC + n + "A" : "");
const goCol1 = "\r";

// Visible length (strips ANSI)
function vlen(s) { return s.replace(/\x1b\[[0-9;]*m/g, "").length; }

// ─── core keyboard loop ────────────────────────────────────────────────
function startInput() {
  if (!isTTY) throw new Error("interactive prompts require a TTY");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdout.write(CURSOR_HIDE);
}

function stopInput() {
  process.stdout.write(CURSOR_SHOW);
  try { process.stdin.setRawMode(false); } catch {}
  process.stdin.pause();
}

/**
 * Subscribe to keys until `handler` returns a value (truthy non-undefined ends).
 * Handler receives a key descriptor: { name, raw }.
 */
function readKeys(handler) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const key = decodeKey(chunk);
      let result;
      try { result = handler(key); }
      catch (e) { cleanup(); reject(e); return; }
      if (result !== undefined) { cleanup(); resolve(result); }
    };
    const onSigint = () => { cleanup(); reject(new Error("cancelled")); };
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.removeListener("SIGINT", onSigint);
    };
    process.stdin.on("data", onData);
    process.once("SIGINT", onSigint);
  });
}

function decodeKey(chunk) {
  // Common keys
  if (chunk === "\x03") return { name: "ctrl-c", raw: chunk };
  if (chunk === "\r" || chunk === "\n") return { name: "enter", raw: chunk };
  if (chunk === " ") return { name: "space", raw: chunk };
  if (chunk === "\x1b") return { name: "escape", raw: chunk };
  // Arrow keys
  if (chunk === "\x1b[A") return { name: "up", raw: chunk };
  if (chunk === "\x1b[B") return { name: "down", raw: chunk };
  if (chunk === "\x1b[C") return { name: "right", raw: chunk };
  if (chunk === "\x1b[D") return { name: "left", raw: chunk };
  // Letters
  if (/^[a-zA-Z0-9]$/.test(chunk)) return { name: chunk.toLowerCase(), raw: chunk };
  return { name: "unknown", raw: chunk };
}

// ─── rendering helpers ─────────────────────────────────────────────────
// Each render writes a block ending with `\n`, so the cursor sits on the
// line BELOW the block. To redraw, jump up `n` lines and clear from there
// to the end of the screen — single ANSI sequence, no per-line loop.
function clearLines(n) {
  if (n <= 0) return;
  process.stdout.write(moveUp(n) + goCol1 + ESC + "0J");
}

// ─── confirm (Y / N with arrows) ───────────────────────────────────────
export async function confirm(question, { defaultYes = true } = {}) {
  if (!isTTY) return defaultYes;

  startInput();
  let value = defaultYes;
  let linesRendered = 0;

  const render = (final = false) => {
    clearLines(linesRendered);
    // Highlighted choice gets a colored "pill" treatment; the other is dim.
    const yes = value ? c.highlight("  Yes  ") : c.dim("  Yes  ");
    const no  = !value ? c.highlight("  No  ") : c.dim("  No  ");
    const tag = final ? c.green("✓") : c.blue("?");
    const arrowHint = final ? "" : "\n  " + c.dim("  use ← →   ·   enter to confirm");
    const line = `  ${tag} ${c.bold(question)}   ${yes}  ${no}` + arrowHint;
    process.stdout.write(line + "\n");
    linesRendered = final ? 1 : 2;
  };

  render();

  try {
    await readKeys((key) => {
      if (key.name === "ctrl-c") {
        clearLines(linesRendered);
        stopInput();
        throw new Error("cancelled");
      }
      if (key.name === "enter") {
        render(true);
        return value;
      }
      if (key.name === "left" || key.name === "y")  value = true;
      else if (key.name === "right" || key.name === "n") value = false;
      else if (key.name === "up" || key.name === "down") value = !value;
      else return undefined;
      render();
    });
  } finally {
    stopInput();
  }
  return value;
}

// ─── select (single-pick, arrows + enter) ──────────────────────────────
export async function select(question, items, { defaultIndex = 0 } = {}) {
  if (!isTTY) return items[defaultIndex]?.value;

  startInput();
  let cursor = Math.min(defaultIndex, items.length - 1);
  let linesRendered = 0;

  // Compute a stable row width so the highlight bar is consistent.
  const maxLabel = items.reduce((m, it) => Math.max(m, vlen(it.label)), 0);
  const rowWidth = maxLabel + 4;
  const pad = (s) => s + " ".repeat(Math.max(0, rowWidth - vlen(s)));

  const render = (final = false) => {
    clearLines(linesRendered);
    const tag = final ? c.green("✓") : c.blue("?");
    const hint = final ? "" : "  " + c.dim("use ↑ ↓   ·   enter to confirm");
    let out = `  ${tag} ${c.bold(question)}${hint}\n`;
    out += "\n";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isCursor = i === cursor;
      if (isCursor) {
        out += "  " + c.highlight(pad(" ❯ " + it.label)) + "\n";
      } else {
        out += "    " + it.label + "\n";
      }
    }
    process.stdout.write(out);
    linesRendered = 2 + items.length;
  };

  render();
  try {
    await readKeys((key) => {
      if (key.name === "ctrl-c") {
        clearLines(linesRendered); stopInput();
        throw new Error("cancelled");
      }
      if (key.name === "enter") {
        render(true);
        return items[cursor].value;
      }
      if (key.name === "up")   cursor = (cursor - 1 + items.length) % items.length;
      else if (key.name === "down") cursor = (cursor + 1) % items.length;
      else return undefined;
      render();
    });
  } finally {
    stopInput();
  }
  return items[cursor].value;
}

// ─── multi-select (checkboxes, arrows + space + enter) ─────────────────
export async function multiSelect(question, items, { defaults = [], minSelected = 0 } = {}) {
  if (!isTTY) return items.map((i) => i.value);

  startInput();
  const checked = new Set(defaults);
  let cursor = 0;
  let linesRendered = 0;

  // Stable row width so the highlight bar is a consistent rectangle.
  const maxLabel = items.reduce((m, it) => Math.max(m, vlen(it.label)), 0);
  const rowWidth = maxLabel + 8;   // " ❯ [✓] " prefix
  const pad = (s) => s + " ".repeat(Math.max(0, rowWidth - vlen(s)));

  const render = (final = false) => {
    clearLines(linesRendered);
    const tag = final ? c.green("✓") : c.blue("?");
    const hint = final
      ? ""
      : "\n  " + c.dim("use ↑ ↓   ·   space to toggle   ·   a = all / i = invert   ·   enter to confirm");
    let out = `  ${tag} ${c.bold(question)}` + hint + "\n";
    out += "\n";

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isCursor = i === cursor;
      const isChecked = checked.has(it.value);

      // Checkbox glyph
      const box = isChecked ? c.green("[✓]") : c.dim("[ ]");

      if (isCursor) {
        // Full-row highlight bar (white-on-paytm-blue, bold)
        // Inside the bar we use plain text so the bg color is unbroken.
        const inner = ` ❯ ${isChecked ? "[✓]" : "[ ]"} ${it.label}`;
        out += "  " + c.highlight(pad(inner)) + "\n";
      } else {
        // Not focused: visible but quieter. Checked rows are normal, unchecked are dim.
        const labelStyled = isChecked ? it.label : c.dim(it.label);
        out += `      ${box} ${labelStyled}\n`;
      }
    }

    // Selection count + minSelected hint when relevant
    const countLine =
      `  ${c.dim(`(${checked.size} of ${items.length} selected${minSelected ? `, min ${minSelected}` : ""})`)}`;
    out += countLine + "\n";

    process.stdout.write(out);
    linesRendered = 3 + items.length + 1; // question + blank + items + count
  };

  render();
  try {
    await readKeys((key) => {
      if (key.name === "ctrl-c") {
        clearLines(linesRendered); stopInput();
        throw new Error("cancelled");
      }
      if (key.name === "enter") {
        if (checked.size < minSelected) return undefined; // ignore
        render(true);
        return [...checked];
      }
      if (key.name === "up")   cursor = (cursor - 1 + items.length) % items.length;
      else if (key.name === "down") cursor = (cursor + 1) % items.length;
      else if (key.name === "space") {
        const v = items[cursor].value;
        if (checked.has(v)) checked.delete(v); else checked.add(v);
      } else if (key.name === "a") {
        // toggle all
        if (checked.size === items.length) checked.clear();
        else items.forEach((it) => checked.add(it.value));
      } else if (key.name === "i") {
        const next = new Set();
        items.forEach((it) => { if (!checked.has(it.value)) next.add(it.value); });
        checked.clear();
        next.forEach((v) => checked.add(v));
      } else return undefined;
      render();
    });
  } finally {
    stopInput();
  }
  return [...checked];
}
