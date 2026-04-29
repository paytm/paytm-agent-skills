# Paytm PG Troubleshooting

Symptom → most-likely cause → fix. Work top-down per section.

---

## Initiate Transaction fails

### `resultCode: 227` — checksum mismatch
- Body bytes used to **generate** checksum must equal body bytes **sent**. Build `body` once, JSON-stringify once, hash the same string, then send that exact string.
- Don't pretty-print, re-serialize, or sort keys between hashing and sending.
- Wrong `MERCHANT_KEY` (staging key on prod host or vice versa).
- Trailing whitespace / newline in env var (`.env` files often add `\n`).
- For `verifySignature` on callbacks: pass the form params *minus* `CHECKSUMHASH` — and as the raw map, not a JSON string.

### `resultCode: 330` — invalid orderId
- `orderId` charset: alphanumerics + `_` / `@` / `-`. Avoid `.`, spaces, slashes, unicode.
- Length ≤ ~50 chars. UUIDs without hyphens or hex tokens are safe.

### `resultCode: 334` — duplicate orderId
- `orderId` already used (even for a *failed* prior attempt). Generate a fresh one for every retry; never reuse.

### `resultCode: 335` — request expired / invalid
- System clock skew on server, or stale request being retried.

### `resultCode: 400` / HTTP 400 — bad request
- Missing required field. Always include: `requestType`, `mid`, `websiteName`, `orderId`, `callbackUrl`, `txnAmount.value`, `txnAmount.currency`, `userInfo.custId`.
- `websiteName` must match the value provisioned for your MID on the dashboard (e.g. `WEBSTAGING`, `DEFAULT`, `retail`). Wrong value → silent failure or `400`.
- `txnAmount.value` must be a **string**, two-decimal, INR (`"1.00"`, not `1.0` or `1`).

### `resultCode: 501` / `502` / 5xx — Paytm system error
- Transient. Retry with the **same** orderId (idempotent on Paytm side until success).

### `MISSING_TXN_TOKEN`
- HTTP 200 but no `body.txnToken`. Inspect `body.resultInfo.resultMsg`. Usually a config error (websiteName / industryTypeId / channelId mismatch on dashboard).

---

## `Failed to parse URL from /paytm-client-config.json` (or `/paytm/create-order`)

You're calling `fetch()` with a relative or root-relative URL in a context where it's evaluated by **Node's `fetch`** (not the browser's). Node requires absolute URLs.

Where this happens:
- **Next.js / Remix / SvelteKit SSR** — the component runs server-side first.
- **React Server Components** — runs in Node.
- **Node test scripts** that import the frontend code.
- HTML opened via `file://` (relative resolves but the request fails differently).

Two fixes, pick one:

1. **Always use absolute URLs in browser-only code.** The reference frontends use `new URL("paytm/create-order", document.baseURI).toString()` — works in browser regardless of mount path, fails fast in SSR (so you know not to call it there).
2. **For SSR / Node contexts:** prepend the backend origin explicitly:
   ```js
   const base = process.env.PAYTM_BACKEND_BASE || "http://localhost:3001";
   fetch(`${base}/paytm/create-order`, { ... })
   ```
   Or move the fetch into a `useEffect` / client-only component so it never runs server-side.

Rule of thumb: any code that talks to your `/paytm/*` backend endpoints is client-side only — guard it with `"use client"` (Next.js), `onMount` (Svelte), or browser-only checks (`typeof window !== "undefined"`).

---

## "Pay" button does nothing — modal doesn't open on click

The most common cause is wrapping `CheckoutJS.init`/`invoke` inside `CheckoutJS.onLoad()` *inside* the click handler. `onLoad` fires once at script-load time; by the time the user clicks, it has already fired and your callback never runs.

**Fix:** Use `onLoad` only at page level (to enable the button); call `init`/`invoke` directly in the click handler. Full pattern in `SKILL.md` → "Common Vibe-Coded Bugs" → #3, and live code in `scripts/frontend/js-checkout.html`.

Other causes for the same symptom:
- Browser popup blocker — invoke must come from a real user gesture (it does, in the click handler).
- `txnToken` already used / expired — generate a fresh one for each click.
- `window.Paytm` undefined — script loader didn't finish; check Network tab for the merchant `.js` file.

---

## JS Checkout doesn't render

| Symptom | Likely cause |
|---|---|
| `window.Paytm` undefined | Loader `<script>` not loaded — wrong MID in URL, or merchant not provisioned for CheckoutJS on that environment |
| Blank popup, immediate close | Browser blocked the popup. Use `redirect: true` or trigger from a user gesture (click handler) |
| `init` resolves but `invoke` does nothing | `txnToken` already used / expired (15-min TTL) — generate a fresh one |
| `SESSION_EXPIRED` event | `txnToken` past its 15-minute TTL — call `/paytm/create-order` again |
| Loader 403 / 404 | Wrong host (`securegw.paytm.in` vs `secure.paytmpayments.com`) for that MID. Check the dashboard for the correct PG domain |
| Mixed-content blocked | Page on HTTP loading HTTPS Paytm script; serve your page over HTTPS |

---

## Callback arrives but is ignored / treated as failure

- **Callback verification is a separate scheme from API checksum.** Build a `TreeMap`/sorted dict of all POSTed params *except* `CHECKSUMHASH`, then call `PaytmChecksum.verifySignature(map, key, checksum)`.
- Field names from Paytm are uppercase (`ORDERID`, `TXNID`, `TXNAMOUNT`, `STATUS`, `RESPCODE`, `RESPMSG`, `CHECKSUMHASH`, `BANKTXNID`, `PAYMENTMODE`, `GATEWAYNAME`, `BANKNAME`, `CURRENCY`, `TXNDATE`).
- Some browsers receive the callback as **GET** (not POST) when the user hits *Back*. Implement both.
- The callback is the user's browser — **not** a webhook. It can be lost (popup blocker, network drop). Always reconcile with the Transaction Status API or the S2S webhook.

---

## Transaction Status API gives `S` / `TXN_SUCCESS` but order not delivered

- Don't trust the JS callback alone. Final source of truth: **`/v3/order/status`** server-to-server.
- Compare `TXNAMOUNT` against your stored amount before fulfilling — defends against tampered redirects.
- If `STATUS == PENDING` keep polling (typical: 30s → 2m → 5m → give up at 30m, then mark `FAILURE`).

---

## Refunds

| Symptom | Cause |
|---|---|
| `refundAmount > txnAmount` rejected | Partial refunds allowed but cumulative ≤ original |
| `Duplicate refId` | `refId` is unique per refund attempt; generate fresh per call |
| Refund stuck `PENDING` | Bank-side delay, can take up to T+7 working days |

---

## Expanded RESPCODE reference

Paytm publishes an authoritative table; common ones merchants hit:

| RESPCODE | RESPMSG / Meaning | Action |
|---|---|---|
| `01` | Txn success | Fulfill order |
| `141` | User cancelled at bank page | Allow retry |
| `227` | Checksum mismatch | See "Initiate Transaction fails" above |
| `235` | Insufficient bank balance | Show retry / different method |
| `267` | Bank declined | Retry / switch method |
| `295` | Invalid card details | User error |
| `334` | Duplicate orderId | Generate new orderId |
| `335` | Request expired | New session |
| `400` | Bad request | Check field formats |
| `401` | Unauthorized | MID/key mismatch |
| `402` | Pending — awaiting bank | Poll Transaction Status |
| `501` | System error | Retry |
| `810` | Risk system declined | Contact Paytm support |
| `911` / `BANK_PENDING` | Bank confirmation pending | Poll, do not refund |

For unfamiliar codes: query Transaction Status API with the orderId — `body.resultInfo.resultMsg` is the canonical explanation. Full list: <https://www.paytmpayments.com/docs/response-codes>.

---

## Environment / config gotchas

- **PG domain.** New merchants are provisioned on `secure.paytmpayments.com` (prod) / `securestage.paytmpayments.com` (staging). Older merchants may still be on `securegw.paytm.in` / `securegw-stage.paytm.in`. Check your dashboard; both are documented but not interchangeable per MID.
- **One environment per MID.** Staging MID will not authenticate against prod host (and gives `401`/checksum errors that look like a key mismatch).
- **`websiteName` is per-MID.** Defaults seen: `DEFAULT`, `WEB_STAGING`, `WEBSTAGING`, `retail`. Wrong value → `initiateTransaction` succeeds with a token that fails to render.
- **Currency is INR-only** for domestic Paytm PG. Cross-border requires a separate account.

---

## Quick decision tree

```
Payment failed?
├─ Did initiateTransaction return a txnToken?
│   ├─ No  → check resultInfo.resultMsg → see "Initiate Transaction fails"
│   └─ Yes
│       ├─ Did JS Checkout render?
│       │   ├─ No  → see "JS Checkout doesn't render"
│       │   └─ Yes
│       │       ├─ Did Paytm POST callback?
│       │       │   ├─ No  → call Transaction Status API anyway (browser issue)
│       │       │   └─ Yes
│       │       │       └─ Did CHECKSUMHASH verify?
│       │       │           ├─ No  → "Callback arrives but is ignored"
│       │       │           └─ Yes → call /v3/order/status — that is the truth
```
