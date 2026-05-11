# Paytm Custom SDK - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Per-instrument request shapes, PCI scope reality, 3DS WebView gotchas, UPI flow variants, and debugging.

---

## Payment instrument shapes

The `processTransaction` call accepts one of these instrument types. The exact field names may differ slightly between the Android and iOS SDKs (camelCase vs snake_case) but the semantics are identical.

### Card

```json
{
  "type": "CARD",
  "cardNumber": "4111111111111111",   // no spaces, no separators
  "expiry": "12/29",                  // MM/YY
  "cvv": "123",
  "nameOnCard": "Buyer Name",
  "saveCard": false                   // tokenization (separate flow)
}
```

PCI implication: this field set leaves your app's memory at call time. The SDK transports it to Paytm's tokenizer. **Your app handles raw PAN** - that's the scope you're taking on.

### UPI Collect (request to user's VPA)

```json
{
  "type": "UPI",
  "subType": "COLLECT",
  "vpa": "buyer@upi"
}
```

User approves in their UPI app. Your app polls or receives a webhook. No further screens in your UI.

### UPI Intent (launch user's UPI app)

```json
{
  "type": "UPI",
  "subType": "INTENT",
  "packageName": "net.one97.paytm"   // or any UPI app
}
```

Launches the picked UPI app via intent (Android) / universal link (iOS). User pays in their UPI app, app returns to yours.

### Net Banking

```json
{
  "type": "NET_BANKING",
  "bankCode": "HDFC"
}
```

`bankCode` comes from the `fetchPaymentOptions` response's `banks[].code` field. Don't hardcode bank codes - Paytm has added / removed banks over time.

### EMI

```json
{
  "type": "EMI",
  "cardNumber": "4111111111111111",
  "expiry": "12/29",
  "cvv": "123",
  "nameOnCard": "Buyer Name",
  "tenure": 6,                       // months
  "issuingBank": "HDFC"
}
```

Same PCI scope as cards.

---

## Response shapes

```json
{
  "next": {
    "type": "REDIRECT | UPI_INTENT | TXN_RESULT",
    "url": "...",                    // for REDIRECT
    "intent": "...",                 // for UPI_INTENT
    "status": "TXN_SUCCESS | TXN_FAILURE | PENDING",  // for TXN_RESULT
    "respCode": "...",
    "respMsg": "..."
  },
  "txnId": "...",
  "orderId": "..."
}
```

For `REDIRECT`: load the URL in a WebView. The WebView will navigate to your `callbackUrl` (passed in Initiate Transaction) when the customer finishes. Detect that navigation and treat it as "payment flow done - go reconcile server-side".

For `UPI_INTENT`: launch the intent. Poll `/v3/order/status` periodically (30 s -> 2 m -> 5 m) until you get a final state or give up.

For `TXN_RESULT`: immediate. Still reconcile server-side before fulfilling.

---

## PCI scope - the honest version

If your app touches **PAN + CVV + expiry** (raw card data), you're in PCI DSS scope. Implications:

- **SAQ A-EP** (Self-Assessment Questionnaire A-EP) at minimum if cards never persist locally and you tokenize immediately. Annual self-assessment + quarterly external vulnerability scans (ASV scans).
- **SAQ D** if you persist cards (even encrypted) locally. Significantly more work - annual penetration test, dedicated security policies, etc.
- Your company likely has a security / compliance team that has to sign off. Loop them in **before** writing the integration, not after.

If PCI compliance is the dealbreaker:
- Switch to **All-in-One SDK** for cards (load `all-in-one-sdk`) - Paytm handles all card data, you stay out of scope.
- Use Custom SDK only for **UPI / Net Banking / EMI on saved cards** where PCI doesn't apply.
- Or mix: Custom UI + Paytm-hosted card iframe (web only, not available in mobile SDK).

---

## 3DS WebView gotchas

When the bank returns a 3DS / OTP page in a WebView:

### Android (WebView)

```kotlin
webView.settings.apply {
    javaScriptEnabled = true
    domStorageEnabled = true
    databaseEnabled = true
    setSupportMultipleWindows(true)
    userAgentString = "$userAgentString PaytmApp/$versionName"  // some banks check
}
webView.webViewClient = object : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val url = request?.url?.toString() ?: return false
        if (url.startsWith(callbackUrl)) {
            // payment flow finished - close webview, reconcile server-side
            finish()
            return true
        }
        return false
    }
}
```

### iOS (WKWebView)

```swift
let config = WKWebViewConfiguration()
config.preferences.javaScriptEnabled = true
let webView = WKWebView(frame: view.bounds, configuration: config)
webView.customUserAgent = (webView.value(forKey: "userAgent") as? String ?? "") + " PaytmApp/\(version)"
webView.navigationDelegate = self
```

Detect callbackUrl navigation in `webView(_:decidePolicyFor:decisionHandler:)`.

Specific bank quirks (failure modes I've actually seen):

- **HDFC 3DS:** rejects WKWebView entirely without a custom UA. Set the UA before the load.
- **ICICI:** sometimes opens a new window (`window.open`) - enable multi-window support on Android.
- **SBI:** the OTP iframe doesn't render in WKWebView with default content blockers. Disable rule lists.
- **Axis:** TLS handshake fails if you've pinned to an outdated cert. Don't pin Paytm's cert in your app.

Test on real cards from the top-5 issuing banks in your geography before shipping.

---

## UPI Collect: polling pattern

After `processTransaction` returns with a UPI Collect instrument, no further UI changes happen on your side until the user approves in their UPI app. Poll:

```kotlin
val pollIntervalsMs = listOf(15_000L, 30_000L, 60_000L, 120_000L, 300_000L)  // 15s -> 5m
var i = 0
while (i < pollIntervalsMs.size) {
    delay(pollIntervalsMs[i])
    val status = backend.fetchOrderStatus(orderId)  // calls /v3/order/status
    if (status.resultInfo.resultStatus != "PENDING") return status
    i++
}
return TIMEOUT_FAILURE
```

Don't poll faster than 15s - Paytm rate-limits. Don't poll for more than ~5 minutes - the UPI mandate window typically expires within that.

---

## fetchPaymentOptions response

Example response:

```json
{
  "options": [
    {
      "type": "UPI",
      "subTypes": ["COLLECT", "INTENT"],
      "appList": [
        { "appName": "Paytm", "packageName": "net.one97.paytm", "iconUrl": "..." },
        { "appName": "GPay",  "packageName": "com.google.android.apps.nbu.paisa.user", "iconUrl": "..." }
      ]
    },
    {
      "type": "CARD",
      "subTypes": ["CREDIT_CARD", "DEBIT_CARD"],
      "supportedNetworks": ["VISA", "MASTERCARD", "RUPAY"]
    },
    {
      "type": "NET_BANKING",
      "banks": [
        { "code": "HDFC", "name": "HDFC Bank", "iconUrl": "..." },
        { "code": "ICICI", "name": "ICICI Bank", "iconUrl": "..." }
        // ...
      ]
    },
    {
      "type": "EMI",
      "banks": [
        { "code": "HDFC", "name": "HDFC Bank", "tenures": [3, 6, 9, 12], "minAmount": "3000.00" }
      ]
    }
  ]
}
```

Only render the options the response actually contains. Hide hardcoded options that aren't in the response - showing "Net Banking" when your MID doesn't have it enabled wastes the user's tap.

---

## Common error codes

Most match the JS Checkout / API codes. Custom-SDK-specific:

| Code / Message | Meaning | Fix |
|---|---|---|
| `INVALID_INSTRUMENT` | Field validation failed (bad card number, malformed VPA) | Validate client-side BEFORE calling - Luhn check for cards, regex for VPA |
| `OPTION_NOT_ENABLED` | User picked a payment option not enabled on the MID | Should never happen if you only show options from `fetchPaymentOptions` response - if it does, your UI is showing stale state |
| `UPI_VPA_INVALID` | VPA doesn't exist | Call `validateVPA` before submitting |
| `NPCI_ERROR` | UPI rail issue (out of your control) | Show retry option, NOT a hard failure |
| 3DS WebView blank | Bank's 3DS page failed to render | UA / multi-window / TLS pinning - see 3DS section above |
| `redirect_url_mismatch` | The redirect URL coming back doesn't match what you passed in Initiate Transaction | Make sure `callbackUrl` is identical in step 1 and the actual WebView callback - including trailing slashes |

Full RESPCODE reference: load the `troubleshooting` skill.

---

## Server-side: don't trust the app

Same rule as everywhere else. Even if your app shows a success screen, you only fulfil after `/v3/order/status` returns `TXN_SUCCESS` AND the amount matches.

This matters more for Custom SDK because the app touches more state - it's easier to ship a bug where the app thinks success but the payment actually failed. The server reconciliation is the safety net.

---

## When NOT to use Custom SDK

- **You don't have the engineering bandwidth.** Custom SDK is 5-10x the integration effort of All-in-One. Estimate honestly.
- **PCI compliance is a hard blocker.** Use All-in-One for cards.
- **You're a small team / MVP.** Ship with All-in-One first, switch to Custom if and when UX feedback demands it. Don't pre-optimize.
- **You only need UPI / scan-to-pay.** Use the `qr-codes` skill - simpler, no SDK at all.
