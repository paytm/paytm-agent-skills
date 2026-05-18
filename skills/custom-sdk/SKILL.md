---
name: paytm-custom-sdk
description: >
  Paytm Custom SDK for native Android and iOS apps where the merchant builds their own payment UI
  and uses the SDK only as a thin client to Paytm's APIs (fetch payment options, generate
  instrument tokens, submit a payment, get status). Use this when the user wants their app's
  branding / UX on the payment screen instead of Paytm's default. More work than All-in-One,
  more flexibility. Do NOT use when the user just wants the fastest mobile checkout - load
  `all-in-one-sdk` instead.
triggers:
  - "Custom SDK"
  - "fetchPaymentOptions"
  - "processTransaction"
  - "Paytm Custom"
  - "headless payment SDK"
---

# Paytm Custom SDK (Android / iOS)

A **headless** mobile SDK. You build the payment screen yourself - card input, UPI VPA field, bank list, etc. - and call the SDK only to:

- Fetch the list of payment options enabled on your MID.
- Submit a payment request with the customer's instrument details.
- Receive payment status.

Trade-offs:

| | All-in-One SDK | Custom SDK |
|---|---|---|
| UI ownership | Paytm | You |
| Time to integrate | Hours | Days to weeks |
| Brand consistency | Paytm-branded | Fully your brand |
| PCI scope (cards) | Out of scope - SDK handles | **In scope** - your app collects card details |
| Useful when | Standard checkout, fastest path | Premium app where Paytm UI breaks the experience |

When to load this skill: user explicitly says they want their own UI on the payment screen, OR is willing to take on PCI compliance for cards in exchange for full UX control.

> This skill is split across two files. `SKILL.md` (this file) gives the high-level flow + the tradeoffs vs All-in-One. `references/REFERENCE.md` contains the per-instrument request shapes (Card / UPI Collect / UPI Intent / Net Banking / EMI), the honest PCI scope reality (SAQ A-EP vs SAQ D), 3DS WebView quirks per issuing bank (HDFC / ICICI / SBI / Axis), the UPI Collect polling backoff, the `fetchPaymentOptions` response shape, the per-step error codes, and the "when NOT to use Custom SDK" guidance — all NOT repeated here.
>
> **Do not generate any Custom SDK code until you have read `references/REFERENCE.md`.**

---

## High-level flow

```
1. Server          -> POST /theia/api/v1/initiateTransaction      -> get txnToken
2. App (UI)        -> render your own payment screen
3. App (SDK call)  -> SDK.fetchPaymentOptions(mid, orderId, txnToken)
                       returns: list of payment options enabled for this MID
4. App (UI)        -> show the options in your design
5. User picks an option, enters details (card / UPI VPA / bank choice)
6. App (SDK call)  -> SDK.processTransaction(orderId, txnToken, instrument)
                       returns: status + redirect URL (for OTP / 3DS / bank page)
7. App             -> render redirect in WebView OR handle UPI intent
8. Server (S2S)    -> POST /v3/order/status                       -> authoritative result
```

The backend leg (steps 1 + 8) is identical to JS Checkout. All the work is in steps 2-7.

---

## Step 1 - Backend (same as JS Checkout)

Identical to the `js-checkout` skill. Backend mints a `txnToken` via Initiate Transaction. No Custom SDK-specific changes.

---

## Step 2 - Add the SDK

### Android

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("com.paytm.pgsdk:pgplussdk:1.4.3")  // check Maven Central for current version
}
```

### iOS

```ruby
# Podfile
pod 'PGPlusSDK', '~> 2.0'
```

Pin versions explicitly. Custom SDK has historically had more breaking changes than All-in-One.

---

## Step 3 - Fetch payment options enabled for this MID

```kotlin
// Android (Kotlin)
val response = pgPlusSDK.fetchPaymentOptions(mid, orderId, txnToken)
// response.options is a list of:
//   { type: "UPI", details: {...} }
//   { type: "CARD", subTypes: ["CREDIT_CARD", "DEBIT_CARD"], banks: [...] }
//   { type: "NET_BANKING", banks: [...] }
//   { type: "EMI", banks: [...] }
```

```swift
// iOS (Swift)
PGPlusSDK.shared.fetchPaymentOptions(mid: mid, orderId: orderId, txnToken: txnToken) { options in
    // options is an array of PaymentOption
}
```

What's enabled depends on your dashboard configuration. Hide options that aren't returned - don't show "Net Banking" if your MID doesn't have it enabled, the user just sees an error after picking it.

---

## Step 4 + 5 - Render your UI

This is your work entirely. Build the screens with your design system. Required UX:

- Show the payment options returned by the SDK in step 3, in the order Paytm returned them (or your preferred order).
- For UPI: VPA input field + "VPA verify" button (the SDK has a `validateVPA` helper).
- For Cards: card number / expiry / CVV / name fields. **PCI scope warning** - see `references/REFERENCE.md`.
- For Net Banking: bank picker showing only the banks Paytm returned for your MID.
- For EMI: bank picker + tenure picker (3 / 6 / 9 / 12 months).

---

## Step 6 - Submit the payment

```kotlin
// Android - card example
val instrument = CardInstrument(
    cardNumber = "4111 1111 1111 1111",
    expiry = "12/29",
    cvv = "123",
    nameOnCard = "Buyer"
)
val txResponse = pgPlusSDK.processTransaction(orderId, txnToken, instrument)
// txResponse.next: { type: "REDIRECT", url: "..." } for 3DS/OTP
//                  OR { type: "TXN_RESULT", status: "TXN_SUCCESS", ... } if no further step
```

```kotlin
// Android - UPI example (collect)
val instrument = UpiCollectInstrument(vpa = "buyer@upi")
val txResponse = pgPlusSDK.processTransaction(orderId, txnToken, instrument)
// txResponse.next: typically polling - the customer approves in their UPI app
```

iOS uses the same shape - swap callback patterns for the platform.

---

## Step 7 - Handle the next step

The SDK tells you what to do next. Three cases:

1. **`REDIRECT`** (3DS, OTP page, bank page) - render the URL in a WebView. When the WebView navigates to your `callbackUrl`, the payment is done.
2. **`UPI_INTENT`** - launch a UPI app via intent (Android) / universal link (iOS). The app handles the rest. Reconcile via polling `/v3/order/status`.
3. **`TXN_RESULT`** - immediate result, no further user interaction. Verify server-side anyway.

---

## Step 8 - Server-side reconciliation

Always. Same as JS Checkout / All-in-One. SDK responses are the UX truth, your backend's `/v3/order/status` call is the financial truth.

---

## ❗ Three field-discovered bugs you MUST handle

These have all hit production. The skill is incomplete if your generated code doesn't handle all three.

### Bug A — `GW00460 "Invalid tranportal id"` on retry (stale `txnToken`)

**Symptom:** user enters card → taps Pay → Paytm shows `GW00460 Invalid tranportal id`. Often on the second attempt of the same session.

**Cause:** Paytm invalidates a `txnToken` **immediately** after any payment attempt completes (success, failure, OR user cancellation). Reusing the same token on a retry — even within seconds, well inside the 15-min TTL — fails with `GW00460`. This is different from the TTL expiry.

**Fix:** treat every `txnToken` as **single-use**. When the user returns to your checkout screen from the SDK / WebView, discard the token AND generate a **fresh `orderId`** (otherwise `334 Duplicate orderId` from the next initiateTransaction). Pattern:

```kotlin
// Android — orderId refresh on every attempt
fun fetchToken() {
  orderId = "${baseOrderId}_${System.currentTimeMillis()}"  // fresh orderId
  // ... call initiateTransaction with this orderId, store returned txnToken
}

override fun onResume() {
  super.onResume()
  if (returningFromPaymentScreen) {
    returningFromPaymentScreen = false
    txnToken = ""        // discard stale token
    fetchToken()         // fetch fresh token + fresh orderId
  }
}
```

### Bug B — WebView callback never fires after bank 3DS (the silent killer)

**Symptom:** payment completes successfully on the bank's 3DS page. WebView shows Paytm's "Redirect back to app" message. Your `shouldOverrideUrlLoading` is **never called**. User is stuck, no result delivered.

**Cause:** Android `WebViewClient.shouldOverrideUrlLoading` is only fired for navigations initiated by the renderer (JS, link clicks). It is **NOT fired for server-side HTTP 302 redirects following a cross-origin form POST** — which is exactly the chain bank 3DS uses (browser POSTs to bank → bank POSTs to Paytm → Paytm 302s to your callback URL).

**Fix:** wire the callback check into **three hooks** with a `callbackHandled` guard (since all three can fire for the same URL):

```kotlin
private var callbackHandled = false

private fun checkForCallback(url: String): Boolean {
  if (callbackHandled) return false
  if (!CALLBACK_PREFIXES.any { url.startsWith(it) }) return false

  callbackHandled = true
  val uri    = Uri.parse(url)
  val status = uri.getQueryParameter("STATUS") ?: "UNKNOWN"
  val txnId  = uri.getQueryParameter("TXNID")  ?: ""
  goToResultScreen(orderId, status, txnId)
  return true
}

// Hook 1: catches JS / link-click navigations
override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
  return checkForCallback(request.url.toString())
}

// Hook 2: ⭐ THE CRITICAL ONE — catches 302 redirects after cross-origin POST
override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
  checkForCallback(url)
}

// Hook 3: last-resort safety net
override fun onPageFinished(view: WebView, url: String) {
  checkForCallback(url)
}
```

Without the `callbackHandled` flag the result screen launches up to 3 times.

### Bug C — Back button takes user back into a completed payment flow

**Symptom:** after the payment result screen, pressing Back navigates back to the WebView / checkout, letting the user re-enter a completed (or refunded) order.

**Fix:** use `finishAffinity()` (Android) when launching the result screen to clear the entire payment flow from the back stack:

```kotlin
private fun goToResultScreen(orderId: String, status: String, txnId: String) {
  lifecycleScope.launch {
    val confirmed = BackendApi.fetchOrderStatus(orderId).getOrNull()?.txnStatus ?: status
    startActivity(Intent(this@WebViewActivity, PaymentResultActivity::class.java).apply {
      putExtra(RESULT_ORDER_ID,   orderId)
      putExtra(RESULT_TXN_STATUS, confirmed)
      putExtra(RESULT_TXN_ID,     txnId)
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    })
    finishAffinity()    // clears WebViewActivity + checkout from stack
  }
}
```

iOS equivalent: pop to root of the navigation stack with the result screen as the new root, or use `setViewControllers([resultVC], animated: true)`.

---

## Critical gotchas

1. **PCI scope.** Your app touches raw card data. You're responsible for PCI DSS SAQ A-EP / SAQ D depending on flow. **This is the single biggest reason to use All-in-One SDK instead** - if PCI compliance is a non-starter, don't go custom for cards. UPI / Net Banking don't have this issue.

2. **Card validation in your UI.** Paytm's API doesn't pre-validate card numbers. Implement Luhn check + BIN-to-bank lookup yourself, or you'll send invalid requests and get cryptic errors back.

3. **Don't store cards in app preferences.** Even encrypted local storage is PCI scope. Tokenization (cards on file) requires Paytm's separate "card vault" flow - not part of this SDK.

4. **3DS WebView quirks.** Some banks' 3DS pages don't work in WKWebView (iOS) without specific user-agent overrides. Test against a real card on each top-5 issuing bank for your geography.

5. **UPI VPA validation.** The SDK's `validateVPA` is best-effort - it tells you if the VPA exists, not if it's actively in use. A "valid" VPA can still get a `NPCI_ERROR` on payment. Always handle that error path.

6. **Per-MID feature gates.** Same as All-in-One - check the dashboard for which payment options are enabled. Hide what isn't enabled.

7. **No fallback to All-in-One mid-flow.** Once you call `processTransaction` you're committed to handling the response in your UI. You can't switch to All-in-One halfway.

---

## When to load related skills

- **Backend Initiate Transaction** -> `js-checkout` (Step 1-2 are identical).
- **Server-side verification** -> `js-checkout` (Step 5).
- **S2S webhooks for fulfilment** -> `webhooks`.
- **Standard / non-custom UI** -> `all-in-one-sdk` (faster, no PCI scope).
- **Subscriptions on mobile** -> `subscriptions` (mandate creation), then this SDK or All-in-One for consent.
- **Refunds on mobile** -> server-side only via `refunds` skill (no app-side refund SDK).
