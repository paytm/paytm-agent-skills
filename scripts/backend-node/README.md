# Node backend (Express) — Paytm JS Checkout demo API

This is an **optional** backend stack for the same Paytm JS Checkout flow:

`initiateTransaction (server) → txnToken → CheckoutJS (browser) → callback → verify via order status`.

It mirrors the routes in the Spring MVC WAR:

- `POST /paytm/create-order`
- `POST /paytm/order-status`
- `GET|POST /paytm/callback`
- `GET /paytm-client-config.json`

## Run (local)

```bash
cd backend-node
npm install
npm start
```

Then open `http://localhost:3001/checkout.html`.

## Config

All secrets stay server-side. Provide credentials via env vars:

- `PAYTM_MID` (optional; defaults to the QA demo MID used in this repo)
- `PAYTM_MERCHANT_KEY`
- `PAYTM_CALLBACK_URL`
- Optional: `PAYTM_PG_DOMAIN` (defaults to QA `https://pgp-qa12.paytm.in`)
