# Paytm Web Integration Reference

## JS Checkout (Recommended for Web)

### Integration Steps

**1. Server: Call Initiate Transaction API → get txnToken**

**2. Client: Load Paytm JS script (merchant-specific URL):**
```html
<script src="https://securegw-stage.paytm.in/merchantpgpui/checkoutjs/merchants/{MID}.js"
        type="application/javascript" crossorigin="anonymous"></script>
```
For production:
```html
<script src="https://securegw.paytm.in/merchantpgpui/checkoutjs/merchants/{MID}.js"
        type="application/javascript" crossorigin="anonymous"></script>
```

**3. Initialize and invoke checkout:**
```javascript
var config = {
  root: "",
  flow: "DEFAULT",   // or "CHECKOUT_ORDER" for custom order page
  merchant: {
    mid: "YOUR_MID",
    name: "Your Store Name",
    logo: "https://yoursite.com/logo.png",
    redirect: false   // true = full page redirect, false = popup
  },
  order: {
    id: "ORDERID_98765",
    token: "<txnToken>",
    amount: "1.00",
    currency: "INR"
  },
  handler: {
    transactionStatus: function(data) {
      // data.STATUS: TXN_SUCCESS / TXN_FAILURE / PENDING
      // ALWAYS verify via Transaction Status API on your server
      console.log("Payment result:", data);
      window.Paytm.CheckoutJS.close();
    },
    notifyMerchant: function(eventType, data) {
      if (eventType === "SESSION_EXPIRED") {
        alert("Session expired. Please retry.");
      }
    }
  }
};

window.Paytm.CheckoutJS.onLoad(function() {
  window.Paytm.CheckoutJS.init(config).then(function() {
    window.Paytm.CheckoutJS.invoke();
  }).catch(function(error) {
    console.error("Checkout error:", error);
  });
});
```

### JS Checkout Events

| Event | Trigger |
|---|---|
| `SESSION_EXPIRED` | txnToken has expired (15 min TTL) |
| `APP_CLOSED` | User closed the payment popup |
| `CHECK_ORDER_STATUS` | Merchant should poll Transaction Status API |

---

## Non-SDK Web Integration (HTML Form POST)

For merchants who cannot use the JS SDK, Paytm supports a redirect-based form POST flow.

**1. Generate `txnToken` server-side.**

**2. Submit HTML form to Paytm:**
```html
<form method="POST"
      action="https://securegw-stage.paytm.in/theia/api/v1/showPaymentPage?mid={MID}&orderId={ORDER_ID}">
  <input type="hidden" name="mid" value="{MID}">
  <input type="hidden" name="orderId" value="{ORDER_ID}">
  <input type="hidden" name="txnToken" value="{TXN_TOKEN}">
  <script type="text/javascript">document.forms[0].submit();</script>
</form>
```

**3. Paytm redirects back to your `callbackUrl` via POST.**

---

## Payment Link API

Create shareable payment links programmatically:

```
POST {BASE_URL}/link/create
```

```json
{
  "head": { "signature": "<CHECKSUMHASH>" },
  "body": {
    "mid": "YOUR_MID",
    "amount": "100.00",
    "linkName": "Invoice-001",
    "linkType": "FIXED",
    "linkDescription": "Payment for order 001",
    "expiryDate": "30/12/2025 23:59:59",
    "sendSms": true,
    "sendEmail": false,
    "customerMobile": "9999999999",
    "customerEmail": "customer@example.com"
  }
}
```

Response includes `longUrl` and `shortUrl` (e.g., `https://paytm.me/XXXXXXX`).

---

## Subscriptions (UPI Autopay) — Web

```
POST {BASE_URL}/subscription/create
```

Key additional params in Initiate Transaction body:
```json
{
  "requestType": "SUBSCRIPTION",
  "subscriptionDetails": {
    "subscriptionId": "SUB_001",
    "subscriptionAmountType": "FIXED",
    "subscriptionFrequency": "MONTH",
    "subscriptionFrequencyUnit": "1",
    "subscriptionStartDate": "2025-01-01",
    "subscriptionEndDate": "2026-01-01",
    "subscriptionMaxAmount": "500.00"
  }
}
```

---

## eCommerce Plugins (No-code)

| Platform | Plugin Location |
|---|---|
| WooCommerce | WordPress Plugin Repository → search "Paytm" |
| Magento 2 | `https://www.paytmpayments.com/docs/magento` |
| Shopify | Shopify App Store → search "Paytm" |
| PrestaShop | `https://www.paytmpayments.com/docs/prestashop` |
| OpenCart | `https://www.paytmpayments.com/docs/opencart` |

All plugins require MID, Merchant Key, Industry Type, and Website Name from your Paytm dashboard.