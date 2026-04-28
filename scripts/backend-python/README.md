# Paytm backend — Python (Flask)

Minimal reference matching `scripts/backend-node` and `scripts/backend-spring`.

## Setup
```bash
pip install -r requirements.txt
```

## Run
```bash
PAYTM_MID=YOUR_MID \
PAYTM_MERCHANT_KEY=YOUR_KEY \
PAYTM_WEBSITE_NAME=YOUR_WEBSITE_NAME \
PAYTM_ENVIRONMENT=staging \
python app.py
```

Then drop `scripts/frontend/js-checkout.html` into `./public/checkout.html` and open `http://localhost:5001/checkout.html`.

## Env vars

| Var | Default |
|---|---|
| `PAYTM_MID` | required |
| `PAYTM_MERCHANT_KEY` | required |
| `PAYTM_WEBSITE_NAME` | `DEFAULT` (use the value from your dashboard, e.g. `WEBSTAGING` or `retail`) |
| `PAYTM_ENVIRONMENT` | `production` (set to `staging` for sandbox) |
| `PAYTM_PG_DOMAIN` | derived from environment |
| `PAYTM_CALLBACK_URL` | derived from request host + `/paytm/callback` |
| `PAYTM_STATUS_API_URL` | `<pg>/v3/order/status` |
| `PORT` | `5001` |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/paytm-client-config.json` | mid + JS loader URL for the browser |
| POST | `/paytm/create-order` | initiateTransaction → `{orderId, txnToken, amount, mid}` |
| POST | `/paytm/order-status` | server-side Transaction Status API |
| GET\|POST | `/paytm/callback` | Paytm browser redirect; verifies CHECKSUMHASH |
