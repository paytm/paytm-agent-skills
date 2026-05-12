# Razorpay -> Paytm dual-write sample (Python)

Reference implementation of the dual-write canary rollout pattern. Mirror of
the Node sample at `scripts/backend-node/razorpay-migration/`.

## Files

- `dual_write_service.py` - canary routing + order creation for both PSPs
- `webhook_router.py`     - one endpoint, dispatches to the right verifier
- `reconciliation.py`     - daily reconciliation job stub
- `app.py`                - Flask wiring

## Run

```bash
cd scripts/backend-python
pip install flask razorpay paytmchecksum python-dotenv requests

# .env (do NOT commit real credentials)
RAZORPAY_KEY_ID="rzp_test_xxx"
RAZORPAY_KEY_SECRET="xxx"
RAZORPAY_WEBHOOK_SECRET="xxx"
PAYTM_MID="YOUR_PAYTM_MID"
PAYTM_MERCHANT_KEY="YOUR_PAYTM_MERCHANT_KEY"
PAYTM_WEBSITE_NAME="WEBSTAGING"
PAYTM_ENVIRONMENT="staging"
PAYTM_CALLBACK_URL="http://localhost:5001/paytm/callback"
CANARY_PCT="5"

python razorpay_migration/app.py
```
