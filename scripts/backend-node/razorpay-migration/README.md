# Razorpay -> Paytm dual-write sample (Node.js)

Reference implementation of the dual-write canary rollout pattern described in
`skills/migrate-from-razorpay/`.

Routes a configurable percentage of new orders to Paytm (the rest stay on Razorpay)
using sticky-per-customer hashing, then reconciles state from both gateways.

## Files

- `dualWriteService.js` - canary routing + order creation for both PSPs
- `webhookRouter.js`    - one webhook endpoint, dispatches to Razorpay or Paytm verifier
- `reconciliation.js`   - daily reconciliation cron stub
- `server.js`           - Express wiring

## Run

```bash
# from repo root
cd scripts/backend-node
npm install razorpay paytmchecksum express dotenv

# in .env (do NOT commit real credentials)
RAZORPAY_KEY_ID="rzp_test_xxx"
RAZORPAY_KEY_SECRET="xxx"
PAYTM_MID="YOUR_PAYTM_MID"
PAYTM_MERCHANT_KEY="YOUR_PAYTM_MERCHANT_KEY"
PAYTM_WEBSITE_NAME="WEBSTAGING"
PAYTM_ENVIRONMENT="staging"
CANARY_PCT="5"   # 0 - 100. Increase weekly during rollout.

node razorpay-migration/server.js
```

Adjust `CANARY_PCT` env var to slowly increase Paytm's share of traffic. Roll back
instantly by setting it to `0`.
