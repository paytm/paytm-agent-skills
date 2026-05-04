# Paytm Payment Links

> _Companion to **`SKILL.md`** — see SKILL.md for output restrictions (no `PPI` / `BALANCE` (or any user-facing label for them) in any generated text) and the global credentials block. Load this file alongside `SKILL.md`, never instead of it._

Server-generated short URLs that open Paytm-hosted checkout. No client SDK; works in SMS, WhatsApp, email. Use for invoices, manual collections, social-commerce, agent-assisted sales.

> **⚠️ READ THIS FIRST — common mistakes that cause silent failures and 400 errors:**
>
> 1. The link identifier **`linkId` must be sent as a JSON number (long integer)**, NOT a quoted string. `"linkId": "31309"` fails. `"linkId": 31309` works.
> 2. **Read the response link id defensively** — current Paytm responses return `linkId` (camelCase); older docs / staging environments may still return `LinkID` (capitalized). Use `body.linkId ?? body.LinkID`. Always send it back to Paytm as `linkId` (camelCase) on subsequent calls.
> 3. The **resend** endpoint is `/link/resendNotification`, NOT `/link/resend`.
> 4. **Every link API call requires `head.tokenType: "AES"`**, not just `signature`. Omitting it returns `"Invalid tokenType"`. Applies to create / fetch / update / resend / expire — all of them.
> 5. **`linkDescription` must be ≥ 3 chars and contain NO special characters** (alphanumerics + spaces only). Anything else returns a validation error.
> 6. **Fetch response wraps the link in `body.links[0]`**, not `body` directly. Reading `json.body.linkStatus` returns `undefined` — read `json.body.links[0].linkStatus`.
> 7. **Customer phone / email / name go inside a `customerContact` object** — they are **NOT** top-level body fields. Putting `customerMobile` / `customerEmail` at the top of `body` is silently accepted but Paytm never sends the SMS/email.
> 8. **`amount` in create-link is a JSON number** (e.g. `100.00`), not a string — different from `txnAmount.value` in Initiate Transaction. Quoting it as a string can fail validation.
> 9. **`head` should include a `timestamp`** (Unix epoch seconds as a string) alongside `tokenType` + `signature` per the official Create Link doc.
> 10. **`expiryDate` format is MID-dependent.** Most MIDs accept `DD/MM/YYYY HH:MM:SS` (returns error code `5021: Date should be in format DD/MM/YYYY` when wrong). The Paytm doc shows `yyyy-MM-dd HH:mm:ss` for some. **Default to `DD/MM/YYYY HH:MM:SS`** — switch only if your MID rejects it.
> 11. **Use `linkType: "FIXED"` for fixed-amount, single-payer links.** `"GENERIC"` is an open-amount link — it silently ignores `amount` on create (fetch shows `amount: null`) AND rejects amount updates with error `5082`. Don't use GENERIC unless you actually want payer-chosen amount.
> 12. **Create response key is `linkId` (camelCase)** in current Paytm responses — older docs / earlier versions of this skill said `LinkID`. Read defensively: `const id = body.linkId ?? body.LinkID;`

Reference: <https://www.paytmpayments.com/docs/api/create-link-api?ref=paymentLinks>

---

## Create a link

```
POST {pgDomain}/link/create
Content-Type: application/json
```

```json
{
  "head": {
    "tokenType": "AES",
    "signature": "<sig>",
    "timestamp": "1714464000"
  },
  "body": {
    "mid": "YOUR_MID",
    "linkType": "FIXED",
    "linkName": "Invoice 001",
    "linkDescription": "Payment for Invoice 001",
    "amount": 499.00,
    "sendSms": true,
    "sendEmail": true,
    "customerContact": {
      "customerName": "Buyer Name",
      "customerEmail": "buyer@example.com",
      "customerMobile": "9999999999",
      "customerId": "CUST_001"
    },
    "expiryDate": "30/12/2026 23:59:59",
    "orderId": "ORD_INV_001",
    "callbackUrl": "https://yoursite.com/paytm/link-callback",
    "merchantUniqueReference": "INV-001-v1"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `mid` | ✅ | Merchant ID |
| `linkName` | ✅ | Short label, alphanumerics + spaces only |
| `linkDescription` | ✅ | **Min 3 chars, alphanumerics + spaces only — no special characters.** `!`, `@`, `#`, `$`, `&`, `-`, `_`, `.`, `/`, `:` etc. all fail validation. Keep it short and clean (`"Invoice 001"`, `"Gym membership"`) |
| `linkType` | ✅ | `"FIXED"` for single-payer fixed-amount (most common), `"GENERIC"` for open-amount payer-chosen. **Don't use GENERIC for fixed amounts** — it ignores `amount` on create and rejects updates with error `5082` |
| `amount` | conditional | **JSON number** (`499.00`), NOT a string. Required for `FIXED`; ignored for `GENERIC` |
| `head.tokenType` | ✅ | Always `"AES"` |
| `head.signature` | ✅ | CHECKSUMHASH over the body |
| `head.timestamp` | ✅ | Unix epoch seconds as string (e.g. `"1714464000"`) |
| `sendSms` / `sendEmail` | optional | Booleans — instruct Paytm to dispatch to `customerContact.customerMobile` / `customerContact.customerEmail` |
| `customerContact` | optional | **Nested object** — see below. Required for SMS / email dispatch |
| `customerContact.customerName` | optional | Display name |
| `customerContact.customerEmail` | optional | Required if `sendEmail: true` |
| `customerContact.customerMobile` | optional | Required if `sendSms: true` |
| `customerContact.customerId` | optional | Your customer ID for reconciliation |
| `expiryDate` | optional | `DD/MM/YYYY HH:MM:SS` IST (most MIDs). Max ~1 year out. If MID rejects this format try `yyyy-MM-dd HH:mm:ss` |
| `orderId` | optional | **Strongly recommended** — lets you reconcile via `/v3/order/status` |
| `callbackUrl` | optional | Same semantics as JS Checkout callback (browser POST after payment) |
| `merchantUniqueReference` | optional | Echoed back; useful for invoice ↔ link mapping |

For payer-chosen amount: omit `amount` and provide `minAmount` / `maxAmount` as numbers (`10.00`, `10000.00`). Confirm support with your account manager — some Paytm MIDs don't allow open-amount links.

### Response

```json
{
  "head": { "responseTimestamp": "...", "version": "v1", "signature": "..." },
  "body": {
    "resultInfo": { "resultStatus": "SUCCESS", "resultCode": "200", "resultMsg": "Success" },
    "linkId": 31309,
    "shortUrl": "https://paytm.me/XXXXXXX",
    "longUrl": "https://secure.paytmpayments.com/link/...",
    "linkStatus": "ACTIVE"
  }
}
```

> **Read the link id defensively.** Production Paytm currently returns `linkId` (camelCase); older docs / some staging environments may still return `LinkID` (capitalized). Use:
>
> ```js
> const linkId = body.linkId ?? body.LinkID;   // works for both
> ```
>
> **Persist the value as an integer**, not a string — JavaScript will silently widen large IDs into floats; use `BigInt` or a string-of-digits internally if your stack mishandles long integers, but always send it back to Paytm as a JSON number.

Send `shortUrl` to the customer via your own channels, or rely on Paytm's SMS/email dispatch.

---

## Fetch link details

```
POST {pgDomain}/link/fetch
```

```json
{
  "head": { "tokenType": "AES", "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkId": 31309
  }
}
```

`linkId` is a **JSON number**. Quoting it (`"31309"`) returns "invalid link id".

### Fetch response shape — read carefully

```json
{
  "head": { "responseTimestamp": "...", "signature": "..." },
  "body": {
    "resultInfo": { "resultStatus": "SUCCESS", "resultCode": "200", "resultMsg": "Success" },
    "links": [
      {
        "linkId": 31309,
        "linkType": "FIXED",
        "linkStatus": "ACTIVE",
        "amount": "499.00",
        "shortUrl": "https://paytm.me/XXXXXXX",
        "longUrl": "https://...",
        "expiryDate": "30/12/2026 23:59:59",
        "transactions": [],
        "merchantUniqueReference": "INV-001-v1"
      }
    ]
  }
}
```

> **⚠️ The link is wrapped in `body.links[0]`, not `body` directly.** Reading `json.body.linkStatus` returns `undefined`. Read `json.body.links[0].linkStatus` (and similarly for every other link field). The array is always length 1 for fetch (single-link lookup) but the wrapper is always there.

---

## Update a link

```
POST {pgDomain}/link/update
```

```json
{
  "head": { "tokenType": "AES", "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkId": 31309,
    "amount": "599.00",
    "expiryDate": "15/01/2027 23:59:59",
    "linkDescription": "Updated invoice description"
  }
}
```

Only some fields are mutable post-creation (amount, expiry, description, customer contact). Trying to change `linkType` or `orderId` returns an error.

---

## Resend the link notification (SMS / email)

```
POST {pgDomain}/link/resendNotification
```

> **Endpoint slug is `resendNotification`, NOT `resend`.** Wrong path → 404 / invalid endpoint error.

```json
{
  "head": { "tokenType": "AES", "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkId": 31309,
    "sendSms": true,
    "notifyContact": {
      "customerMobile": "9999999999",
      "customerEmail": "buyer@example.com"
    }
  }
}
```

Use this if the original SMS/email didn't reach the customer, or to nudge unpaid invoices. Same DLT-template caveat as `create` — SMS may be silently dropped if templates aren't approved.

---

## Expire / cancel a link

```
POST {pgDomain}/link/expire
```

```json
{
  "head": { "tokenType": "AES", "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkId": 31309
  }
}
```

Idempotent. Once expired, payers see "link no longer active". You cannot un-expire — create a new link.

---

## After payment

The flow merges back into the standard one:

1. Customer opens the link → Paytm-hosted checkout → pays.
2. Paytm POSTs to your `callbackUrl` (browser redirect) with the same UPPERCASE field set as JS Checkout: `ORDERID`, `TXNID`, `STATUS`, `RESPCODE`, `CHECKSUMHASH`, etc.
3. **Verify CHECKSUMHASH**, then call `/v3/order/status` server-to-server to confirm.
4. Webhook (if configured) gives you the same data reliably.

> **⚠️ When calling `/v3/order/status` from a Payment Link flow, the head shape is DIFFERENT from `/link/*`.** Build it from scratch — do NOT carry over `tokenType: "AES"` or `timestamp` from the link API.
>
> ```json
> // ✅ CORRECT — Transaction Status request
> {
>   "head": { "signature": "<sig>" },
>   "body": { "mid": "YOUR_MID", "orderId": "ORD_INV_001" }
> }
> ```
>
> ```json
> // ❌ WRONG — extra tokenType + timestamp leaked from /link/* head
> {
>   "head": { "tokenType": "AES", "timestamp": "1777662548", "signature": "<sig>" },
>   "body": { "mid": "YOUR_MID", "orderId": "ORD_INV_001" }
> }
> ```
>
> The wrong head triggers checksum-mismatch errors (`227`) that look like a key problem but are actually about the extra fields being included in the signed body.

---

## Endpoint reference

| Action | Path | Identifier |
|---|---|---|
| Create | `POST /link/create` | n/a |
| Fetch | `POST /link/fetch` | `linkId` (number) |
| Update | `POST /link/update` | `linkId` (number) |
| Resend | `POST /link/resendNotification` | `linkId` (number) |
| Expire | `POST /link/expire` | `linkId` (number) |

---

## Pitfalls

1. **`linkId` MUST be a JSON number** in fetch / update / resend / expire calls. Quoting it as a string is the #1 cause of "invalid link id" responses.
2. **Response field is `LinkID`, request field is `linkId`** — different casing. Convert when persisting.
3. **`head.tokenType: "AES"` is required on every call.** Omitting it returns `"Invalid tokenType"`. Easy to miss because the field isn't called out in older Paytm samples.
4. **`linkDescription` rules:** minimum 3 characters, alphanumerics + spaces only. No `-`, `_`, `.`, `#`, `@`, `&`, `/`, `:`, etc. Validation error if violated.
5. **Fetch response wraps the link in `body.links[0]`**, not `body` directly. `json.body.linkStatus` is `undefined`; you must read `json.body.links[0].linkStatus`.
6. **Customer details must be nested in `customerContact`.** Putting `customerMobile` / `customerEmail` / `customerName` at the top level of `body` is silently accepted but Paytm never dispatches the SMS / email. The link is created but the customer is never notified.
7. **Create-link `amount` is a JSON number**, not a string. `499.00` works; `"499.00"` may fail validation. (Different from `txnAmount.value` in Initiate Transaction, which IS a string.)
8. **`head.timestamp` is required on create-link** per the official doc — Unix epoch seconds as a string.
9. **`orderId` reconciles to a single payment for one-shot links** — for reusable/multi-payer links iterate `transactions[]` from the fetch response.
10. **Expired links can't be charged.** Build a renewal job for unpaid invoices instead of relying on long expiry windows.
11. **Open-amount links** (no fixed `amount`, only `minAmount`/`maxAmount`) are fraud-prone — set tight bounds and verify the paid amount server-side.
12. **SMS dispatch requires DLT-registered templates** on the Paytm side (Indian regulation). New merchants may see SMS silently dropped until templates are approved on the dashboard.
13. **`shortUrl` redirects to a long URL on the PG host** — link previews (WhatsApp, iMessage) hit the long URL, which can affect link analytics if you depend on click-through tracking.
14. **Update can't change `linkType` or `orderId`** — only mutable fields (amount, expiry, description, contact).
15. **`/v3/order/status` head shape differs from `/link/*`.** Transaction Status uses `head: { signature }` only — NO `tokenType`, NO `timestamp`. When polling order status from inside a payment-link flow, build the head from scratch instead of copying the link-API head.
