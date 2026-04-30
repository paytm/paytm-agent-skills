# Paytm QR Codes (Dynamic & Static)

For in-person, kiosk, table-top, or social-commerce flows where the customer scans with any UPI app.

---

## Static vs Dynamic

| | Static QR | Dynamic QR |
|---|---|---|
| Amount | Customer enters | Pre-set per QR |
| Reuse | Many payments per QR | One QR per intended payment |
| API | Generated once on dashboard | Generated per order via API |
| Reconciliation | All payments to same VPA — disambiguate via webhook `orderId` (if you encode one) or amount + time | Each QR has a unique orderId |
| Use case | Counter, menu, tip jar | Restaurant bill, kiosk, invoice scan |

---

## Generate a Dynamic QR

> **⚠️ Common 400 causes (read first):**
> - **`posId` is REQUIRED** — omitting it returns HTTP 400. Use any non-empty terminal identifier (`"POS001"`, `"COUNTER_07"`, etc.) even for software-only setups.
> - **`amount` MUST be a string** with two decimals (`"499.00"`), not a number (`499` / `499.00`).
> - **`head` requires `clientId` and `version`** in addition to `signature`.
> - **`businessType` must be exactly `"UPI_QR_CODE"`** — case-sensitive.

```
POST {pgDomain}/paymentservices/qr/create
Content-Type: application/json
```

```json
{
  "head": {
    "clientId": "C11",
    "version": "v1",
    "signature": "<CHECKSUMHASH over JSON.stringify(body)>"
  },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "QR_ORD_001",
    "amount": "499.00",
    "businessType": "UPI_QR_CODE",
    "posId": "POS001"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `mid` | ✅ | Merchant ID |
| `orderId` | ✅ | Unique per QR (single-use semantics) |
| `amount` | ✅ | **String**, two decimals; INR only (`"499.00"`, not `499`) |
| `businessType` | ✅ | Exactly `"UPI_QR_CODE"` |
| `posId` | ✅ | Terminal / store identifier — **must be non-empty** even if you don't have physical POS |
| `head.clientId` | ✅ | E.g. `"C11"` — provided by Paytm during onboarding |
| `head.version` | ✅ | `"v1"` |
| `displayName` | optional | What the customer sees in their UPI app (≤ 30 chars) |
| `expiryDate` | optional | `yyyy-MM-dd HH:mm:ss` IST |
| `imageRequired` | optional | Boolean — when `true`, response includes base64 PNG |
| `orderDetails` / `invoiceDetails` | optional | Free-form objects for receipt context |
| `additionalInfo` / `gstInformation` | optional | Per-merchant metadata |

### Response

```json
{
  "head": { "responseTimestamp": "...", "signature": "..." },
  "body": {
    "resultInfo": { "resultStatus": "SUCCESS", "resultCode": "QR_0001" },
    "qrCodeId": "<paytm qrCodeId>",
    "qrData": "upi://pay?pa=...&pn=...&am=499.00&tr=...",
    "image": "data:image/png;base64,iVBOR..."
  }
}
```

Render `image` directly, or generate your own QR from `qrData` using any QR library (it's a standard UPI deep-link).

---

## Fetch QR status

```
POST {pgDomain}/paymentservices/qr/status
```

```json
{
  "head": { "signature": "<sig>" },
  "body": { "mid": "YOUR_MID", "qrCodeId": "<paytm qrCodeId>" }
}
```

Response carries `qrCodeStatus` and (once paid) the underlying `txnId` / `orderId` of the completed payment.

For real-time UX (customer pays → screen shows "Paid"), **don't poll** — wire up the QR webhook (event group "QR Payment") and push to the screen via SSE/WebSocket.

---

## Static QR

Generate once on the dashboard → print → mount. All payments to it land in the same Paytm-side merchant VPA, surfaced via:

- Webhook `STATIC_QR_PAYMENT` event with the customer's UPI ref + amount + time
- Daily Settlement Report

For "which customer paid?" you have to use customer-supplied context (table number on receipt, name in UPI note) since the merchant cannot pre-bind an orderId.

---

## Pitfalls

1. **`posId` is required** — most common cause of HTTP 400 on QR generation. Always send a non-empty value.
2. **`amount` must be a string with two decimals.** `"499.00"` works; `499`, `499.0`, `"499"` all fail.
3. **`head.clientId` and `head.version` are required**, not just `signature`.
4. **`orderId` is single-use** for dynamic QRs even if the customer never pays — generate a new one for retry.
5. **UPI deep-links are time-sensitive.** Some apps cache; always re-render on retry rather than reusing an old `qrData`.
6. **Don't expose `qrCodeId` as a customer-facing reference** — use your own `orderId`.
7. **Static QR amount changes** on the dashboard apply going forward only — in-flight scans use the value at scan time.
8. **Refunds for QR payments** go through the standard `/refund/apply` flow using the resulting `orderId` + `txnId`.
9. **Some UPI apps strip `displayName`** and show only the merchant VPA — don't put critical info there.
