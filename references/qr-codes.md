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

```
POST {pgDomain}/paymentservices/qr/create
Content-Type: application/json
```

```json
{
  "head": { "tokenType": "AES", "signature": "<sig>" },
  "body": {
    "mid": "YOUR_MID",
    "orderId": "QR_ORD_001",
    "amount": "499.00",
    "businessType": "UPI_QR_CODE",
    "posId": "TERMINAL_07",
    "displayName": "Counter 7"
  }
}
```

| Field | Notes |
|---|---|
| `orderId` | Unique per QR (single-use semantics) |
| `amount` | String, two decimals; INR only |
| `businessType` | `UPI_QR_CODE` (most common) — Paytm publishes others for Bharat QR / DQR variants |
| `posId` | Optional terminal/store id — surfaces in reports |
| `displayName` | What the customer sees in their UPI app (≤ 30 chars) |
| `expiryDate` | `dd/MM/yyyy HH:mm:ss` IST; optional, defaults vary by MID |

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

1. **`orderId` is single-use** for dynamic QRs even if the customer never pays — generate a new one for retry.
2. **UPI deep-links are time-sensitive.** Some apps cache; always re-render on retry rather than reusing an old `qrData`.
3. **Don't expose `qrCodeId` as a customer-facing reference** — use your own `orderId`.
4. **Static QR amount changes** on the dashboard apply going forward only — in-flight scans use the value at scan time.
5. **Refunds for QR payments** go through the standard `/refund/apply` flow using the resulting `orderId` + `txnId`.
6. **Some UPI apps strip `displayName`** and show only the merchant VPA — don't put critical info there.
