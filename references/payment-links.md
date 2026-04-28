# Paytm Payment Links

Server-generated short URLs that open Paytm-hosted checkout. No client SDK; works in SMS, WhatsApp, email. Use for invoices, manual collections, social-commerce, agent-assisted sales.

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
    "expiryDate": "30/12/2025 23:59:59",
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
| `expiryDate` | `dd/MM/yyyy HH:mm:ss` IST. Max ~1 year out |
| `orderId` | Optional but **strongly recommended** — lets you reconcile via `/v3/order/status` |
| `sendSms` / `sendEmail` | Paytm dispatches the link to the customer; requires `customerMobile` / `customerEmail` |
| `callbackUrl` | Same semantics as JS Checkout callback (browser POST after payment) |
| `merchantUniqueReference` | Echoed back; useful for invoice ↔ link mapping |
| `notifyMerchant.useExisting` | Use existing webhook config instead of `callbackUrl` |

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
    "linkId": "<paytm linkId>",
    "shortUrl": "https://paytm.me/XXXXXXX",
    "longUrl": "https://securegw.paytmpayments.com/link/...",
    "linkStatus": "ACTIVE"
  }
}
```

Send `shortUrl` to the customer via your own channels, or rely on Paytm's SMS/email dispatch.

---

## Fetch link details

```
POST {pgDomain}/link/fetch
```

```json
{
  "head": { "signature": "<sig>" },
  "body": { "mid": "YOUR_MID", "linkId": "<paytm linkId>" }
}
```

Response includes `linkStatus`, `transactions[]` (per-payer txns for REUSABLE / OPEN), expiry, and current usage count.

---

## Expire / cancel a link

```
POST {pgDomain}/link/expire
```

```json
{
  "head": { "signature": "<sig>" },
  "body": { "mid": "YOUR_MID", "linkId": "<paytm linkId>" }
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

## Pitfalls

1. **`orderId` is per-link for FIXED/OPEN, but per-payment for REUSABLE.** Don't try to look up a REUSABLE link by orderId — use `linkId` and iterate `transactions[]`.
2. **Expired links can't be charged.** Build a renewal job for unpaid invoices instead of relying on long expiry windows.
3. **`OPEN` links** are fraud-prone — set `minAmount` / `maxAmount` realistically.
4. **SMS dispatch requires DLT-registered templates** on the Paytm side (Indian regulation). New merchants may see SMS silently dropped until templates are approved on the dashboard.
5. **`shortUrl` redirects to a long URL on the PG host** — link previews (WhatsApp, iMessage) hit the long URL, which can affect link analytics if you depend on click-through tracking.
