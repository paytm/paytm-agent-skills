# Paytm Mobile SDK Integration Reference

## All-in-One SDK

The All-in-One SDK opens a payment sheet within your app — users can pay via Paytm Wallet, UPI, Cards, or Net Banking without leaving the app.

### Android Integration

**1. Add dependency (build.gradle):**
```gradle
repositories {
    maven { url "https://artifactory.paytm.in/libs-release-local" }
}
dependencies {
    implementation 'com.paytm.appinvoke:paytminvoke:1.x.x'
}
```

**2. Initiate payment:**
```kotlin
val paytmPayment = PaytmPayment(
    orderId = "ORDER_001",
    mid = "YOUR_MID",
    txnToken = "<txnToken from server>",
    txnAmount = "1.00",
    isStaging = true,
    callbackUrl = "https://yoursite.com/callback"
)
PaytmSDK.getBuilder()
    .setActivity(this)
    .setPaytmPayment(paytmPayment)
    .build()
    .startPaymentActivity()
```

**3. Handle result in `onActivityResult`:**
```kotlin
override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == PaytmSDK.REQUEST_CODE_PAYMENT) {
        val response = data?.getStringExtra("response")
        // Parse JSON response and verify with Transaction Status API
    }
}
```

---

### iOS Integration

**1. Add via CocoaPods:**
```ruby
pod 'PaytmNativeSdk', '~> 1.x.x'
```

**2. Initiate payment:**
```swift
import PaytmNativeSdk

let vc = AIOCheckoutViewController()
vc.mid = "YOUR_MID"
vc.orderId = "ORDER_001"
vc.txnAmount = "1.00"
vc.txnToken = "<txnToken from server>"
vc.callbackUrl = "https://yoursite.com/callback"
vc.isStaging = true
vc.delegate = self
present(vc, animated: true)
```

**3. Handle delegate callback:**
```swift
extension YourVC: AIOCheckoutDelegate {
    func onPaymentSuccess(_ response: [String: Any]) { /* verify with status API */ }
    func onPaymentFailure(_ response: [String: Any]) { /* handle failure */ }
    func onBackPressedCancelTransaction() { /* user cancelled */ }
}
```

---

### React Native Integration

```bash
npm install paytm-biz-sdk --save
cd ios && pod install
```

```javascript
import PaytmSdk from 'paytm-biz-sdk';

const config = {
  MID: 'YOUR_MID',
  ORDER_ID: 'ORDER_001',
  TXN_AMOUNT: '1.00',
  TXN_TOKEN: '<txnToken>',
  CALLBACK_URL: 'https://yoursite.com/callback',
  IS_STAGING: true,
};

PaytmSdk.startPayment(config, (response) => {
  // Verify with Transaction Status API on server
  console.log(response);
});
```

---

### Flutter Integration

```yaml
# pubspec.yaml
dependencies:
  paytm_allinonesdk: ^1.x.x
```

```dart
import 'package:paytm_allinonesdk/paytm_allinonesdk.dart';

String response = await AllInOneSdk.startTransaction(
  mid,
  orderId,
  txnAmount,
  txnToken,
  callbackUrl,
  isStaging,
  restrictAppInvoke,
);
// Parse response JSON and verify with status API
```

---

## Custom UI SDK

Custom UI SDK gives full control over the payment UI. You handle the UI/UX; the SDK handles payment processing.

### Key Methods

| Method | Description |
|---|---|
| `PaytmSDK.init()` | Initialize the SDK |
| `fetchPaymentOptions()` | Get enabled payment modes for MID |
| `processTransaction()` | Process payment with chosen method |
| `getBalance()` | Fetch Paytm Wallet balance |
| `fetchBin()` | Fetch card BIN info for EMI/card type |

### Account Linking (for Paytm Wallet)

Users must link their Paytm account to enable Wallet and saved cards:
```kotlin
PaytmSDK.init(context, mid, clientId, callbacks)
// clientId obtained from Paytm dashboard
```

Docs: `https://www.paytmpayments.com/docs/account-linking`

---

## Hybrid App Notes

- **Ionic/Cordova**: Use `paytm-cordova-plugin`
- **Xamarin**: Use `Paytm.SDK.Xamarin` NuGet package
- **Unity**: Use Paytm Unity SDK from the docs

All hybrid integrations require the same server-side `txnToken` generation flow.