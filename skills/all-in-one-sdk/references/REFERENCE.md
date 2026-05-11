# Paytm All-in-One SDK - Reference

> _Companion to **`SKILL.md`** - load this file alongside `SKILL.md`, never instead of it._

Full event lifecycle, every callback field, error codes, deep-link / scheme configuration, and per-platform debugging.

---

## Callback fields (both platforms, identical keys)

The bundle / dictionary returned to your callback contains:

| Key | Type | Notes |
|---|---|---|
| `STATUS` | string | `TXN_SUCCESS` / `TXN_FAILURE` / `PENDING` |
| `RESPCODE` | string | Numeric response code (`01` = success, see troubleshooting RESPCODE table) |
| `RESPMSG` | string | Human-readable message |
| `ORDERID` | string | Your `orderId` echoed back |
| `MID` | string | Your MID echoed back |
| `TXNID` | string | Paytm's TXNID (NOT your orderId) - persist this for refunds |
| `TXNAMOUNT` | string | Two-decimal amount as string |
| `PAYMENTMODE` | string | `UPI` / `CARD` / `NET_BANKING` / `EMI` |
| `BANKTXNID` | string | Bank's reference (may be empty for UPI) |
| `BANKNAME` | string | Issuing bank name |
| `CURRENCY` | string | Always `INR` for domestic Paytm PG |
| `TXNDATE` | string | Format: `2024-05-11 15:30:12.0` |
| `GATEWAYNAME` | string | Acquiring gateway used |
| `CHECKSUMHASH` | string | Sign of the response - verify before trusting |

**Verify `CHECKSUMHASH` server-side**, not in the app. Bundle the response in your fulfilment request to your backend, verify there. App-side verification leaks `MERCHANT_KEY` into the binary.

---

## Event lifecycle (Android - `PaytmPaymentTransactionCallback`)

```
SDK opens
  |
  v
TransactionManager.startTransaction(activity, requestCode)
  |
  +--> User pays in SDK UI
  |     |
  |     +--> onTransactionResponse(bundle)        // success or failure with full bundle
  |
  +--> User cancels via back button
  |     |
  |     +--> onBackPressedCancelTransaction()
  |
  +--> User cancels explicitly (X button etc.)
  |     |
  |     +--> onTransactionCancel(error, bundle)
  |
  +--> Network drops
  |     |
  |     +--> networkNotAvailable()
  |
  +--> SDK validates auth & fails (MID/key mismatch, env mismatch)
  |     |
  |     +--> clientAuthenticationFailed(error)
  |
  +--> Generic SDK error
        |
        +--> onErrorProceed(error)  /  someUIErrorOccurred(error)
```

Every callback path needs handling. Skipping `onBackPressedCancelTransaction` means a user who taps back gets a frozen UI.

## Event lifecycle (iOS - `AIDelegate`)

```
AppInvokeSDK.shared.openPaytm(...)
  |
  +--> didFinish(response)        // success / failure with response dict
  +--> didCancel()                // user backed out
  +--> didFail(error)             // network / SDK error
```

Simpler than Android - 3 paths. Same rule: fulfilment goes through your backend reconciliation, not the response dict directly.

---

## Deep-link return handling

### Android

If you launch your activity in `singleTask` or `singleInstance` mode, the SDK callback might not deliver because the callback Intent gets routed to a fresh task. Two solutions:

1. **Use `standard` launch mode for the checkout activity.** Cleanest.
2. **Override `onNewIntent`** in your activity:
   ```kotlin
   override fun onNewIntent(intent: Intent) {
       super.onNewIntent(intent)
       setIntent(intent)
       // forward to SDK or your callback handler
   }
   ```

Test on real devices, not just the emulator.

### iOS

Some flows (UPI Intent payments) bounce the user to the Paytm consumer app and back. This requires a custom URL scheme registered in `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>paytmYOURMID</string>     <!-- or whatever the SDK docs specify -->
        </array>
    </dict>
</array>
<key>LSApplicationQueriesSchemes</key>
<array>
    <string>paytmmp</string>
</array>
```

And handle the return in your `AppDelegate`:

```swift
func application(_ app: UIApplication, open url: URL, options: [...]) -> Bool {
    return AppInvokeSDK.shared.application(app, open: url, options: options)
}
```

Skip these and the user lands on a blank screen after paying in the Paytm app.

---

## Common error codes

Most error codes match the JS Checkout / API codes. SDK-specific codes:

| Code / Message | Meaning | Fix |
|---|---|---|
| `clientAuthenticationFailed` | MID / merchant key / environment mismatch | Verify staging vs prod; check `setShowPaymentUrl` / `isStaging` flag matches your `txnToken` source |
| `someUIErrorOccurred` | SDK couldn't render its UI (low memory, missing permissions, broken assets) | Reinstall, check Android permissions (`INTERNET`, `ACCESS_NETWORK_STATE`) |
| `networkNotAvailable` | Genuine offline | Surface retry button, don't auto-retry from background |
| `403 Forbidden` from SDK loader | PG host unreachable / wrong env | Check if device can hit `secure.paytmpayments.com` (or `securestage.paytmpayments.com`) |
| Empty bundle in `onTransactionResponse` | SDK got the activity result but couldn't parse the response (rare, usually OS bug) | Reconcile via `/v3/order/status` |

Full error code reference: load the `troubleshooting` skill.

---

## Versioning + upgrades

- Pin to a specific SDK version (`1.6.1` not `1.+`). Paytm has historically shipped breaking changes in minor versions.
- Test the upgrade in staging first - the response bundle structure has changed across major versions.
- `paytmchecksum` (the JVM library you use server-side) is decoupled from the mobile SDK version - upgrade independently.

---

## Subscription mandate consent

For UPI Autopay mandate creation on mobile, the flow is:

1. Backend calls `/subscription/create` (load `subscriptions` skill) to get a `txnToken`.
2. Mobile app calls `SDK.startTransaction(orderId, txnToken, amount, callbackUrl)` exactly the same way as a one-time payment.
3. SDK opens the consent screen instead of the payment UI.
4. User approves the mandate. Callback fires. `STATUS == TXN_SUCCESS` means the mandate is created (not that money has moved).

The recurring debits then happen asynchronously without any further mobile interaction. Reconcile via `/v3/order/status` for each scheduled debit's `orderId`.

---

## Operational checklist

- App requests `INTERNET` and `ACCESS_NETWORK_STATE` permissions (Android).
- ProGuard / R8 rules: keep Paytm SDK classes (`-keep class com.paytm.** { *; }`).
- Crash reporting (Crashlytics / Sentry) excludes the SDK package OR scrubs PII before upload.
- Deep-link / URL scheme registered (iOS) and tested on a device with the Paytm app installed AND uninstalled (UPI fallback flow differs).
- Server-side reconciliation always runs after app callback - don't ship app-only success state.
- Build flavor / scheme picks the right `MID` + URL: staging in `Debug`, production in `Release`. Hardcoding either is the most common cause of "works on my machine, fails for users".

---

## When NOT to use this SDK

- You want a **fully custom** payment UI that matches your app's brand. -> Load `custom-sdk`.
- You're building a **web** experience inside a webview. -> Load `js-checkout`.
- You need to support **non-mobile platforms** (desktop apps, Smart TVs). -> Use server-side flows: payment links or QR.
- The user is **outside India** and you're collecting cross-border payments. -> Out of scope for the domestic Paytm PG; needs a separate cross-border account.
