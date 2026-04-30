# Paytm Payment Links

Server-generated short URLs that open Paytm-hosted checkout. No client SDK; works in SMS, WhatsApp, email. Use for invoices, manual collections, social-commerce, agent-assisted sales.

> **⚠️ READ THIS FIRST — common mistakes that cause "invalid link id" / 400 errors:**
>
> 1. The link identifier **`linkId` must be sent as a JSON number (long integer)**, NOT a quoted string. `"linkId": "31309"` fails. `"linkId": 31309` works.
> 2. The create response returns the field as **`LinkID`** (capitalized). You must convert it to **`linkId`** (lowercase `l`, lowercase `d`) for fetch / update / resend / expire calls.
> 3. The **resend** endpoint is `/link/resendNotification`, NOT `/link/resend`.

---

## Link types

| `linkType` | Use |
|---|---|
| `FIXED` | One-time link, single payment, configurable amount |
| `REUSABLE` | Many payers can pay; each payment generates its own txn |
| `OPEN` | Payer chooses amount (within optional min/max) |

---

## Create a link

```
POST {pgDomain}/link/create
Content-Type: application/json
```

```json
{
  "head": { "tokenType": "AES", "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkType": "FIXED",
    "linkDescription": "Payment for Order INV-001",
    "linkName": "INV-001",
    "amount": "499.00",
    "currency": "INR",
    "expiryDate": "2026-12-30 23:59:59",
    "orderId": "ORD_INV_001",
    "sendSms": true,
    "sendEmail": true,
    "customerMobile": "9999999999",
    "customerEmail": "buyer@example.com",
    "customerName": "Buyer Name",
    "callbackUrl": "https://yoursite.com/paytm/link-callback",
    "merchantUniqueReference": "INV-001-v1"
  }
}
```

| Field | Notes |
|---|---|
| `linkType` | `FIXED` / `REUSABLE` / `OPEN` |
| `amount` | String, two decimals. Omit (or use min/max) for `OPEN` |
| `expiryDate` | `yyyy-MM-dd HH:mm:ss` IST. Max ~1 year out |
| `orderId` | Optional but **strongly recommended** — lets you reconcile via `/v3/order/status` |
| `sendSms` / `sendEmail` | Paytm dispatches the link to the customer; requires `customerMobile` / `customerEmail` |
| `callbackUrl` | Same semantics as JS Checkout callback (browser POST after payment) |
| `merchantUniqueReference` | Echoed back; useful for invoice ↔ link mapping |

For `OPEN`:
```json
{ "amount": null, "minAmount": "10.00", "maxAmount": "10000.00" }
```

### Response

```json
{
  "head": { "responseTimestamp": "...", "version": "v1", "signature": "..." },
  "body": {
    "resultInfo": { "resultStatus": "SUCCESS", "resultCode": "200", "resultMsg": "Success" },
    "LinkID": 31309,
    "shortUrl": "https://paytm.me/XXXXXXX",
    "longUrl": "https://securegw.paytmpayments.com/link/...",
    "linkStatus": "ACTIVE"
  }
}
```

> **Note the casing:** the response field is **`LinkID`** (capital L, capital ID) but every subsequent API call expects **`linkId`** (camelCase). Persist the integer value, not the casing.
> **Persist the value as an integer**, not a string — JavaScript will silently widen large IDs into floats; use `BigInt` or a string-of-digits internally if your stack mishandles long integers, but always send it back to Paytm as a JSON number.

Send `shortUrl` to the customer via your own channels, or rely on Paytm's SMS/email dispatch.

---

## Fetch link details

```
POST {pgDomain}/link/fetch
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkId": 31309
  }
}
```

`linkId` is a **JSON number**. Quoting it (`"31309"`) returns "invalid link id".

Response includes `linkStatus`, `transactions[]` (per-payer txns for REUSABLE / OPEN), expiry, and current usage count.

---

## Update a link

```
POST {pgDomain}/link/update
```

```json
{
  "head": { "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "linkId": 31309,
    "amount": "599.00",
    "expiryDate": "2027-01-15 23:59:59",
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
  "head": { "signature": "<sig>" },
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
  "head": { "signature": "<sig>" },
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
3. **Resend path is `/link/resendNotification`**, not `/link/resend`. Wrong path → 404.
4. **`orderId` is per-link for FIXED/OPEN, but per-payment for REUSABLE.** Don't try to look up a REUSABLE link by orderId — use `linkId` and iterate `transactions[]`.
5. **Expired links can't be charged.** Build a renewal job for unpaid invoices instead of relying on long expiry windows.
6. **`OPEN` links** are fraud-prone — set `minAmount` / `maxAmount` realistically.
7. **SMS dispatch requires DLT-registered templates** on the Paytm side (Indian regulation). New merchants may see SMS silently dropped until templates are approved on the dashboard.
8. **`shortUrl` redirects to a long URL on the PG host** — link previews (WhatsApp, iMessage) hit the long URL, which can affect link analytics if you depend on click-through tracking.
9. **Update can't change `linkType` or `orderId`** — only mutable fields (amount, expiry, description, contact).
