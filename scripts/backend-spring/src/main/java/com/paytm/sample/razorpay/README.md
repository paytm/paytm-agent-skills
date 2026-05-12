# Razorpay -> Paytm dual-write sample (Spring Boot 3 / Jakarta)

Reference implementation of the dual-write canary rollout pattern in Spring Boot 3
with Jakarta servlets. Mirror of the Node + Python samples.

## Files

- `DualWriteService.java`        - canary routing + order creation for both PSPs
- `RazorpayMigrationController.java` - REST endpoints
- `RazorpayWebhookVerifier.java` - HMAC-SHA256 verification
- `PaytmWebhookVerifier.java`    - PaytmChecksum verification
- `WebhookController.java`       - one endpoint, dispatches to the right verifier
- `ReconciliationService.java`   - daily reconciliation job stub

## Dependencies

Add to `pom.xml` alongside the existing Paytm Spring Boot 3 backend:

```xml
<dependency>
  <groupId>com.razorpay</groupId>
  <artifactId>razorpay-java</artifactId>
  <version>1.4.6</version>
</dependency>
```

Paytm checksum library should already be wired from the parent backend.

## Config

In `application.properties` (or env vars):

```
razorpay.keyId=rzp_test_xxx
razorpay.keySecret=xxx
razorpay.webhookSecret=xxx
paytm.mid=YOUR_PAYTM_MID
paytm.merchantKey=YOUR_PAYTM_MERCHANT_KEY
paytm.websiteName=WEBSTAGING
paytm.environment=staging
paytm.callbackUrl=http://localhost:8080/paytm/callback
migration.canaryPct=5
```

Bump `migration.canaryPct` weekly to roll out. Set to `0` to roll back instantly.
