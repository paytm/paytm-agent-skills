# Paytm Subscriptions — Recurring Lifecycle (after consent)

> _Companion to **`SKILL.md`** and **`REFERENCE.md`**. `REFERENCE.md` covers mandate **creation**; this file covers everything **after** the user approves the mandate: status checks, recurring debits, pre-debit notification, cancellation, per-charge status, and the subscription webhook events._
>
> **Read this before building any production subscription plugin.** Creation alone is not a working subscription — you must also be able to detect cancellations, charge renewals, and verify callbacks.

---

## ⚠️ The single biggest gotcha: the `/theia/` vs non-`/theia/` host split

On **production**, the subscription endpoints do **not** all live under the same path prefix. `create` is the *exception* — it has `/theia/api/v1/`. **Every management API does NOT.** Reusing the `create` base URL for the management calls returns HTTP 404 (`SVE-003`) or an HTML "Something went wrong" page (the `/theia/` host is browser-facing, not the JSON management API).

| Endpoint | Production base | Staging base |
|---|---|---|
| `subscription/create` | `secure.paytmpayments.com/theia/api/v1/` | `securestage.paytmpayments.com/` |
| `subscription/checkStatus` | `secure.paytmpayments.com/` (non-theia) | `securestage.paytmpayments.com/` |
| `subscription/renew` | `secure.paytmpayments.com/` (non-theia) | `securestage.paytmpayments.com/` |
| `subscription/preNotify` | `secure.paytmpayments.com/` (non-theia) | `securestage.paytmpayments.com/` |
| `subscription/preNotify/status` | `secure.paytmpayments.com/` (non-theia) | `securestage.paytmpayments.com/` |
| `subscription/cancel` | `secure.paytmpayments.com/` (non-theia) | `securestage.paytmpayments.com/` |
| `v3/order/status` | `secure.paytmpayments.com/` (non-versioned host) | `securestage.paytmpayments.com/` |

> **Staging has no `/theia/` prefix on anything** — including `create`. So `create` is the only endpoint whose host changes between staging and prod, and the only one on `/theia/` at all.

Live production probes (status call) that prove this:

```
secure.paytmpayments.com/subscription/status
  → {"errorDetails":{"code":404,"errorCode":"SVE-003","errorMessage":"Requested API could not be located..."}}
    (right gateway, wrong route name — the route is checkStatus, not status — see below)

secure.paytmpayments.com/theia/api/v1/subscription/status
  → HTML "Something went wrong" page (the /theia/ host is browser-facing, not the JSON management API)

secure.paytmpayments.com/subscription/checkStatus
  → success (correct gateway + correct route)
```

**Rule:** derive management URLs as `{PG_DOMAIN}/subscription/<op>` for *all* environments. Only `create` gets the `/theia/api/v1/` prefix, and only on production.

---

## The mandate ID has three different names

The same identifier is spelled differently on each surface. Read all three defensively.

| Surface | Field name |
|---|---|
| `create` response | `subscriptionId` |
| `checkStatus` / `order/status` response | `subsId` |
| Redirect callback POST / webhook | `SUBS_ID` |

```js
const mandateId = resp.subscriptionId || resp.subsId || resp.SUBS_ID;
```

Persist one canonical value (the `subscriptionId` from create) and match against all three on read.

---

## Per-endpoint `head` requirements

The `head` envelope differs per endpoint — `create`'s head does NOT carry over. Document/use the right one per call:

| Endpoint | Required `head` fields |
|---|---|
| `subscription/create` | `clientId` (`"C11"`) + `channelId` (`"WEB"`) + `signature` |
| `subscription/checkStatus` | `tokenType: "AES"` + `signature` (optional `clientId` / `version`) |
| `subscription/preNotify` | `signature` + `tokenType: "AES"` |
| `subscription/preNotify/status` | `clientId` + `tokenType: "AES"` + `version` + `signature` |
| `subscription/renew` | bare `signature` |
| `subscription/cancel` | `signature` (+ `tokenType: "AES"`) |
| `v3/order/status` | bare `signature` |

`signature` is always `PaytmChecksum.generateSignature(JSON.stringify(body), MERCHANT_KEY)` over the **body** object.

---

## 1. `POST /subscription/checkStatus` — the only reliable cancellation signal

`v3/order/status` reports only the original SALE txn, which stays `TXN_SUCCESS` forever. The `SUBSCRIPTION_CANCEL` webhook **may never fire on your MID** (confirmed in production). So `checkStatus` polling is the *only* dependable way to detect a cancelled or expired mandate.

- **Host:** non-theia — `{PG_DOMAIN}/subscription/checkStatus` (both envs).
- **Identifier:** `subsId` (NOT `subscriptionId`) — or `orderId` + `custId`, or `linkId`.
- **Head:** `tokenType: "AES"` + `signature`.

Request:

```json
{
  "head": { "tokenType": "AES", "signature": "<checksum over body>" },
  "body": { "mid": "YOUR_MID", "subsId": "1012567997xx" }
}
```

Live response for a **cancelled** mandate (abridged, real):

```json
{
  "body": {
    "resultInfo": { "code": "3006", "message": "SUCCESS", "status": "SUCCESS" },
    "subsId": "1012567997xx",
    "status": "REJECT",
    "subStatus": "MERCHANT_CANCELLED",
    "lastOrderStatus": "SUCCESS",
    "amountType": "VARIABLE",
    "frequencyUnit": "MONTH",
    "frequency": "1",
    "expiryDate": "2028-06-13 00:00:00"
  }
}
```

> ### 🚨 Critical gotcha — read `subStatus`, not `status`, to detect a cancellation
> A cancelled mandate reports **`status: "REJECT"`**. Only **`subStatus`** (`MERCHANT_CANCELLED` / `USER_CANCELLED`) reveals it was a *cancellation* rather than a payment failure. **If you map on `status` alone you wrongly conclude `TXN_FAILURE`.** Always read `subStatus` first.

**`status` value set:** `INIT`, `ACTIVE`, `REJECT`, `IN_AUTHORIZATION`, `AUTHORIZED`, `AUTHORIZATION_FAILED`, `EXPIRED`, `CLOSED`, `SUSPENDED`.

**`subStatus` value set:** `ACTIVE`, `MERCHANT_CANCELLED`, `USER_CANCELLED`, `TIMED_OUT`, … (treat as open-ended; default unknown values to "needs review").

Interpretation cheat sheet:

| `status` | `subStatus` | Meaning |
|---|---|---|
| `ACTIVE` | `ACTIVE` | Mandate live; safe to debit |
| `REJECT` | `MERCHANT_CANCELLED` | You cancelled it — stop debiting |
| `REJECT` | `USER_CANCELLED` | User cancelled (often in their UPI app) — stop debiting |
| `REJECT` | `TIMED_OUT` | Consent never completed |
| `EXPIRED` | — | Past `expiryDate`; create a new mandate |

---

## 2. `POST /subscription/renew` — trigger a recurring debit

Charges the mandate for one cycle. Run on your own scheduler (Paytm does not auto-debit for `NATIVE_SUBSCRIPTION`).

- **Host:** non-theia — `{PG_DOMAIN}/subscription/renew` (both envs).
- **Head:** bare `signature`.

Request:

```json
{
  "head": { "signature": "<checksum over body>" },
  "body": {
    "mid": "YOUR_MID",
    "subscriptionId": "1012567997xx",
    "orderId": "RENEW_ORD_2026_06_01",
    "txnAmount": { "value": "499.00", "currency": "INR" }
  }
}
```

- Use a **fresh `orderId`** per debit (it becomes the charge's transaction order id).
- After renew, confirm the actual money movement with `v3/order/status` on that `orderId` — `renew` accepting the request is not the same as the debit succeeding.
- For `VARIABLE` amount mandates, `txnAmount.value` may differ per cycle but must be ≤ `subscriptionMaxAmount`.

---

## 3. `POST /subscription/preNotify` (+ `/status`) — NPCI pre-debit notification

> **Paytm does NOT auto-handle pre-notification for `NATIVE_SUBSCRIPTION`.** NPCI requires the payer be notified ~24h before each debit. The merchant must call `preNotify` **before every debit**, then optionally poll `preNotify/status`. (A merchant-hosted pre-notify URL returning `ACCEPT`/`REJECT` is also supported.)

`preNotify` — **Host:** non-theia. **Head:** `signature` + `tokenType: "AES"`.

```json
{
  "head": { "tokenType": "AES", "signature": "<checksum over body>" },
  "body": {
    "mid": "YOUR_MID",
    "subscriptionId": "1012567997xx",
    "orderId": "PRENOTIFY_2026_06_01",
    "txnAmount": { "value": "499.00", "currency": "INR" },
    "subscriptionScheduledExecutionDate": "2026-06-02"
  }
}
```

`preNotify/status` — **Host:** non-theia. **Head:** `clientId` + `tokenType: "AES"` + `version` + `signature`.

```json
{
  "head": { "clientId": "C11", "version": "v1", "tokenType": "AES", "signature": "<checksum over body>" },
  "body": { "mid": "YOUR_MID", "subscriptionId": "1012567997xx", "orderId": "PRENOTIFY_2026_06_01" }
}
```

Typical sequence per cycle: `preNotify` (≥24h ahead) → wait → `renew` → `v3/order/status` to confirm.

---

## 4. `POST /subscription/cancel` — cancel a mandate

- **Host:** non-theia — `{PG_DOMAIN}/subscription/cancel` (both envs).
- **Head:** `signature` (+ `tokenType: "AES"`).

```json
{
  "head": { "tokenType": "AES", "signature": "<checksum over body>" },
  "body": { "mid": "YOUR_MID", "subscriptionId": "1012567997xx" }
}
```

After cancelling, a subsequent `checkStatus` returns `status: "REJECT"` + `subStatus: "MERCHANT_CANCELLED"`. Cancellation is terminal — create a new mandate to resume.

---

## 5. `POST /v3/order/status` — per-charge transaction status

Reports a single transaction (the original SALE, or a `renew` debit identified by its `orderId`). **Host:** non-versioned, same on both envs — `{PG_DOMAIN}/v3/order/status`. **Head:** bare `signature`.

```json
{
  "head": { "signature": "<checksum over body>" },
  "body": { "mid": "YOUR_MID", "orderId": "RENEW_ORD_2026_06_01" }
}
```

> **Do not use `order/status` to detect cancellation.** It only reflects the txn for that `orderId`; the original SALE stays `TXN_SUCCESS` forever even after the mandate is cancelled. Use `checkStatus` for mandate state, `order/status` for "did this specific debit go through".

---

## 6. Callback / redirect verification (real-world wrinkle)

After consent, Paytm redirects the user with a POST to your `callbackUrl`. The skill says "verify `CHECKSUMHASH`" — but in production the **redirect POST may arrive with no `CHECKSUMHASH` field at all**. A naive "reject if checksum invalid" on the redirect path will block legitimate users.

**Robust pattern — never trust the posted form; re-confirm server-to-server:**

1. Receive the redirect POST (it carries `ORDERID` / `SUBS_ID` / `STATUS`).
2. If `CHECKSUMHASH` is present, verify it (see the `webhooks` / `js-checkout` verification reference).
3. **Regardless**, re-confirm authoritatively server-side: call `checkStatus` (mandate state) and/or `v3/order/status` (the SALE txn) before activating the subscription.

```js
// Express — redirect callback handler (consent return)
app.post("/paytm/callback", express.urlencoded({ extended: false }), async (req, res) => {
  const posted = req.body;                       // ORDERID, SUBS_ID, STATUS, maybe CHECKSUMHASH
  const mandateId = posted.SUBS_ID;

  // CHECKSUMHASH may be absent on the redirect — do NOT hard-reject if missing.
  if (posted.CHECKSUMHASH) {
    const ok = PaytmChecksum.verifySignature(posted, MERCHANT_KEY, posted.CHECKSUMHASH);
    if (!ok) console.warn("[paytm] redirect checksum mismatch — falling back to S2S confirm");
  }

  // Authoritative: re-confirm server-to-server.
  const state = await checkSubscriptionStatus({ subsId: mandateId });
  const active = state.status === "ACTIVE" && state.subStatus === "ACTIVE";

  res.redirect(active ? "/subscription/active" : "/subscription/pending");
});
```

---

## 7. Subscription webhook events

Cross-link the `webhooks` skill for signature verification, raw-body handling, dedup, and retry. Subscription-specific `txnType` values:

| `txnType` | Meaning | Key fields |
|---|---|---|
| `SUBSCRIPTION_DEBIT` | A recurring debit occurred | `SUBS_ID`, `STATUS`, `ORDERID`, amount |
| `SUBSCRIPTION_CANCEL` | Mandate cancelled | `SUBS_ID`, `STATUS` |

> **`SUBSCRIPTION_CANCEL` may not fire on all MIDs** (confirmed missing in production). Teams relying on it for cancellation silently miss every cancel. **Treat the webhook as best-effort and use `checkStatus` polling as the reliable fallback** for detecting cancellations/expiries.

---

## Putting it together — production lifecycle loop

1. **Create** mandate → consent via JS Checkout (see `REFERENCE.md`).
2. **On callback:** re-confirm via `checkStatus` (don't trust the redirect form).
3. **Per billing cycle:** `preNotify` (≥24h ahead) → `renew` → `v3/order/status` to confirm the debit.
4. **Continuously / before each debit:** `checkStatus` to detect `REJECT`+`MERCHANT_CANCELLED`/`USER_CANCELLED` or `EXPIRED`; stop debiting if not `ACTIVE`/`ACTIVE`.
5. **On user request:** `cancel`, then verify terminal state via `checkStatus`.
6. **Webhooks** (`SUBSCRIPTION_DEBIT` / `SUBSCRIPTION_CANCEL`) augment but never replace the polling.
