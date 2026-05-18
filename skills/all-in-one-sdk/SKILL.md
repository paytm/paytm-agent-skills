---
name: paytm-all-in-one-sdk
description: >
  Paytm All-in-One SDK for native Android and iOS apps. The fastest mobile integration - the SDK
  renders the full Paytm payment UI (UPI, Credit Cards, Debit Cards, Net Banking, EMI) inside your
  app, handles all payment instruments, and returns a single result callback. Use this when the
  user wants a turn-key mobile checkout with the standard Paytm look and feel. Do NOT use for
  custom-branded payment screens - load `custom-sdk` instead.
triggers:
  - "All-in-One SDK"
  - "AIOSDK"
  - "PaytmSDK.startTransaction"
  - "AppInvokeSDK"
  - "com.paytm.pgsdk"
  - "PaytmAllInOneSDK"
---

# Paytm All-in-One SDK (Android / iOS)

Native mobile SDK that drops a full Paytm-styled payment screen into your app. Same backend flow as JS Checkout (Initiate Transaction -> txnToken), but the rendering happens inside the SDK rather than a web view.

When to load this skill: user is building an Android (Kotlin/Java) or iOS (Swift/Objective-C) app and wants the **shortest path** to accepting payments. The trade-off is the UI is Paytm-branded (logo, colors, language) and not customizable beyond a few config options. If they want their own UI, load `custom-sdk` instead.

> This skill is split across two files. `SKILL.md` (this file) gives the 4-step integration flow + Android / iOS code skeletons. `references/REFERENCE.md` contains the full callback bundle field table, the complete `PaytmPaymentTransactionCallback` (Android) and `AIDelegate` (iOS) lifecycle paths, deep-link return handling for `singleTask` activities and iOS URL schemes (`Info.plist`), per-bank 3DS quirks, ProGuard rules, the subscription-mandate-on-mobile flow, and the operational checklist — all NOT repeated here.
>
> **Do not generate any All-in-One SDK code until you have read `references/REFERENCE.md`.**

---

## Integration in 4 steps

```
1. Server         -> POST /theia/api/v1/initiateTransaction      -> get txnToken
2. Mobile app     -> SDK.startTransaction(orderId, txnToken, amount, callbackUrl)
3. SDK            -> renders Paytm UI, customer pays, returns to your activity / view
4. Server (S2S)   -> POST /v3/order/status                       -> authoritative result
```

The SDK gives you a callback in the app, but **NEVER trust that as the source of truth**. Always reconcile via `/v3/order/status` server-side before fulfilling. Same rule as JS Checkout.

---

## Step 1 - Backend: create order (same as JS Checkout)

Identical to the `js-checkout` skill's Step 1 + Step 2. The backend mints a `txnToken` via Initiate Transaction. No SDK-specific changes on the backend.

---

## Step 2 - Add the SDK

### Android (Gradle)

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("com.paytm.appinvokesdk:appinvokesdk:1.6.1")  // latest at time of writing - check Maven Central for newer
}
```

### iOS (CocoaPods or SwiftPM)

```ruby
# Podfile
pod 'AppInvokeSDK', '~> 2.7'
```

```swift
// Or via SwiftPM
.package(url: "https://github.com/paytm/paytm-allinone-ios-sdk.git", from: "2.7.0")
```

Always pin to a specific version. Don't use floating ranges in production builds.

---

## Step 3 - Start the transaction (mobile code)

### Android (Kotlin)

```kotlin
import com.paytm.pgsdk.TransactionManager
import com.paytm.pgsdk.PaytmOrder

class CheckoutActivity : AppCompatActivity() {

    private val launcher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        // result.data.extras carries: ORDERID, TXNID, STATUS, RESPCODE, RESPMSG, TXNAMOUNT, ...
        // Verify server-side via /v3/order/status before treating it as paid.
        handleSdkResult(result)
    }

    fun pay(orderId: String, txnToken: String, amount: String) {
        val order = PaytmOrder(
            orderId,
            BuildConfig.PAYTM_MID,
            txnToken,
            amount,
            "https://yourbackend.com/paytm/callback"
        )
        val txManager = TransactionManager(order, object : PaytmPaymentTransactionCallback {
            override fun onTransactionResponse(bundle: Bundle?) { /* callback path */ }
            override fun networkNotAvailable() { /* show retry */ }
            override fun onErrorProceed(error: String?) { /* surface error */ }
            override fun clientAuthenticationFailed(error: String?) { /* MID/key mismatch */ }
            override fun someUIErrorOccurred(error: String?) { /* internal SDK error */ }
            override fun onErrorLoadingWebPage(httpErrorCode: Int, errorMessage: String?, failingUrl: String?) {}
            override fun onBackPressedCancelTransaction() { /* user backed out */ }
            override fun onTransactionCancel(error: String?, bundle: Bundle?) { /* explicit cancel */ }
        })
        txManager.setShowPaymentUrl(if (isStaging) STAGING_URL else PROD_URL)
        txManager.startTransaction(this, REQUEST_CODE)
        // ...or use the launcher pattern for AndroidX activity result API
    }
}
```

### iOS (Swift)

```swift
import AppInvokeSDK

class CheckoutVC: UIViewController, AIDelegate {

    func pay(orderId: String, txnToken: String, amount: String) {
        let order = AIOrder(
            mid: Config.paytmMid,
            orderId: orderId,
            txnToken: txnToken,
            amount: amount,
            callbackUrl: "https://yourbackend.com/paytm/callback"
        )

        AppInvokeSDK.shared.openPaytm(
            withOrderDetails: order,
            from: self,
            isStaging: Config.isStaging,
            delegate: self
        )
    }

    // MARK: AIDelegate
    func didFinish(with response: [String: Any]) {
        // response: ORDERID, TXNID, STATUS, RESPCODE, RESPMSG, TXNAMOUNT, ...
        // Verify server-side before fulfilment.
    }
    func didCancel() { /* user backed out */ }
    func didFail(with error: Error) { /* network / SDK error */ }
}
```

---

## Step 4 - Verify server-side

Same as `js-checkout` Step 5. The SDK callback is for UI - the truth is on your backend.

```
POST {BASE}/v3/order/status
{
  "head": { "signature": "..." },
  "body": { "mid": "YOUR_MID", "orderId": "ORD_ABC123" }
}
```

If `body.resultInfo.resultStatus == "TXN_SUCCESS"` AND `body.txnAmount` matches what you charged, then fulfil. Anything else, don't.

---

## Critical gotchas

1. **Deep-link return handling on Android.** If your app uses single-task or single-instance launch modes, the SDK may not return to your activity correctly. Test on real devices with the actual launch mode you ship - not just the default.

2. **iOS scheme registration.** Some Paytm-app redirections require a custom URL scheme in `Info.plist`. The SDK docs list the exact entries - skipping them causes the customer to land on a blank screen after paying in the Paytm app.

3. **Don't store `txnToken` in app preferences.** It has a 15-minute TTL and is single-use. Treat it as ephemeral memory.

4. **Staging vs production URL.** Pass the right `setShowPaymentUrl` (Android) / `isStaging` flag (iOS) - mixing staging MID with production URL = checksum / auth errors that look unrelated.

5. **`amount` is a string with two decimals** - same rule as everywhere else. `1`, `1.0`, `1.000` break.

6. **Background-killed apps.** If Android kills the merchant activity while the user is in the Paytm app, the callback may not fire. Always do server-side reconciliation on app foreground - don't rely solely on the SDK callback.

7. **Per-MID feature flags.** Some payment options (UPI Intent, EMI on specific banks) need to be enabled on your MID from the dashboard. The SDK silently hides anything not enabled - users complain they don't see Net Banking when you haven't turned it on.

---

## When to load related skills

- **Backend Initiate Transaction setup** -> `js-checkout` (Step 1-2 are identical).
- **Server-side verification** -> `js-checkout` (Step 5).
- **S2S webhooks for fulfilment** -> `webhooks`.
- **Custom payment UI instead of Paytm-branded** -> `custom-sdk`.
- **Subscriptions on mobile** -> `subscriptions` (mandate creation), then this skill's `startTransaction` for the consent screen.
- **Error debugging** -> `troubleshooting`.
