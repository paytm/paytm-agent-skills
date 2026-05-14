---
name: paytm-migrate-from-juspay
description: >
  Migration playbook for moving from Juspay (HyperSDK / Hyper Checkout / ExpressCheckout API) to
  Paytm Payment Gateway. Juspay is an orchestrator that routes through multiple underlying PGs;
  moving to Paytm means accepting Paytm as the single PG, losing the multi-PG routing /
  smart-retry layer. Covers the orchestrator -> direct-PG mental shift, HyperSDK -> Paytm
  All-in-One SDK, ExpressCheckout REST -> Paytm /theia/api/v1/initiateTransaction, webhook
  scheme, refunds, and dual-write rollout. Load when the user mentions migrating from Juspay,
  or has Juspay integration code (HyperSDK, hyperServices, juspay.in, /orders endpoint,
  JUSPAY_API_KEY, juspay-node, in.juspay.hypersdk).
triggers:
  # Code-context signals
  - "juspay"
  - "Juspay"
  - "HyperSDK"
  - "hyperServices"
  - "HyperCheckout"
  - "ExpressCheckout"
  - "juspay.in"
  - "api.juspay.in"
  - "sandbox.juspay.in"
  - "JUSPAY_API_KEY"
  - "JUSPAY_MERCHANT_ID"
  - "in.juspay.hypersdk"
  - "juspay-node"
  - "client_auth_token"
  # Direct migration intent
  - "migrate from juspay"
  - "migrating from juspay"
  - "migration from juspay"
  - "juspay to paytm"
  - "juspay → paytm"
  - "juspay -> paytm"
  - "from juspay to paytm"
  - "switch from juspay"
  - "switching from juspay"
  - "move from juspay"
  - "port from juspay"
  - "shift from juspay"
  - "replace juspay"
  - "replacing juspay"
  - "remove juspay"
  - "drop juspay"
  - "ditch juspay"
  - "leave juspay"
  - "exit juspay"
  - "retire juspay"
  - "phase out juspay"
  - "replace hypersdk"
  - "replace hyper sdk"
  - "replace hypercheckout"
  - "remove smart routing juspay"
  - "juspay orchestrator replacement"
  # Merchant conversational
  - "want to use paytm instead of juspay"
  - "thinking of switching from juspay"
  - "considering paytm over juspay"
  - "juspay alternative"
  - "alternative to juspay"
  - "instead of juspay"
  - "unhappy with juspay"
  - "juspay not working for us"
  - "juspay smart routing not needed"
  - "moving away from juspay orchestration"
  - "change payment gateway from juspay"
  - "change pg from juspay"
  - "stop using juspay"
  - "get rid of juspay"
  - "dual write juspay paytm"
---

# Juspay → Paytm Migration

Juspay is fundamentally **different from Razorpay / PayU / Cashfree** — it's a **payment orchestrator**, not a PG. It routes each transaction through one of many underlying gateways (HDFC FSS, Razorpay, Cashfree, ICICI, Paytm itself, etc.) based on success-rate / routing rules / smart-retry logic. Migrating to Paytm means:

1. **You give up multi-PG routing.** Juspay's main value-add (auto-selecting the best PG per transaction) goes away. You accept Paytm as your single PG.
2. **You give up smart-retry across PGs.** Juspay retries a failed UPI on a different acquirer transparently. With direct Paytm you only retry on Paytm.
3. **You replace HyperSDK with Paytm's SDK** (or JS Checkout for web). HyperSDK is a thick client that handles dynamic config + UI; Paytm SDKs are lighter.

This is a bigger architectural change than the other migrations. Make sure the merchant understands what they're giving up before generating code.

> This skill is split across two files. `SKILL.md` (this file) gives the orchestrator-vs-PG mental model + per-flow summary + when NOT to migrate. `references/REFERENCE.md` contains the full Juspay product surface (8 products — only 4 map cleanly), pre-migration questions to ask the merchant, HTTP Basic auth deep dive (the empty-password trap), per-step code diff, Juspay's 15+ status enum mapped to Paytm's 3 statuses, dual-write tweaks (mobile-app-size doubling, success-rate parity check), and 120-day cutover checklist — all NOT repeated here.
>
> **Do not generate any Juspay → Paytm migration code until you have read `references/REFERENCE.md`.**

---

## At a glance

| Concept | Juspay | Paytm |
|---|---|---|
| Product type | Orchestrator (routes across many PGs) | Single PG |
| Identifier | `merchant_id` + `api_key` | `MID` + `MERCHANT_KEY` |
| Order create | `POST /orders` (ExpressCheckout API) — returns `order_id`, `client_auth_token` | `POST /theia/api/v1/initiateTransaction` — returns `txnToken` |
| Auth on each request | HTTP Basic (`api_key:` — note trailing colon) | Body checksum in `head.signature` |
| Web checkout | Hyper Checkout (hosted overlay loaded via `hyperServices.openIframe`) | Paytm JS Checkout (`Paytm.CheckoutJS.init`) |
| Mobile SDK | HyperSDK (Android/iOS) — `in.juspay.hypersdk.core.HyperServices` | Paytm All-in-One SDK or Custom SDK |
| Webhook signature | HMAC-SHA256 over raw body with `webhook_secret`, header (e.g. `x-juspay-signature`) | `head.signature` field in JSON body |
| Refund | `POST /orders/{order_id}/refunds` | `POST /refund/apply` |
| Subscription | Juspay doesn't have a first-class subscription product — recurring is configured per-underlying-PG | `POST /subscription/create` (NATIVE_SUBSCRIPTION) |
| Source of truth | `GET /orders/{order_id}` | `POST /v3/order/status` |

**Critical mental shift #1:** Juspay's `client_auth_token` (returned with the order) is what HyperSDK uses to render. It is **not** equivalent to Paytm's `txnToken` — Juspay's token is opaque, HyperSDK-specific, and includes dynamic config baked in. Paytm's `txnToken` is a short-lived (15 min) payment token. Don't try to map them 1:1; rebuild the frontend bootstrap.

**Critical mental shift #2:** Juspay merchants often have **very little PG-specific code** because Juspay abstracts it. When porting, the new Paytm code will look much more verbose — that's expected, not a bug.

---

## Migration paths (pick one)

| User situation | Recommended path | Reference section |
|---|---|---|
| Single-PG merchant who set up Juspay for "future-proofing" | **Direct cutover** — replace HyperSDK / ExpressCheckout with Paytm | `REFERENCE.md` § Direct cutover |
| Multi-PG merchant on Juspay (smart-routing real value) | **Reconsider** — moving to a single PG is a downgrade in this dimension. Make sure stakeholders agree. | `REFERENCE.md` § Pre-migration questions |
| Production traffic, can roll out gradually | **Dual-write canary** — sticky-hash by customer, % to Paytm direct | `REFERENCE.md` § Dual-write |

If the merchant is genuinely using Juspay's smart-routing across multiple PGs, document the success-rate baseline before cutover so you can detect regressions.

---

## Per-flow mapping (high level)

### One-time payments (web — Hyper Checkout iframe)

```
Juspay (HyperCheckout)                              Paytm
──────────────────                                  ─────
1. POST /orders                               →     POST /theia/api/v1/initiateTransaction
   Authorization: Basic base64(api_key:)              body checksum in head.signature
   body: { order_id, amount, customer_id,             body: { requestType: "Payment", mid, orderId,
           customer_email, customer_phone,                    callbackUrl, txnAmount, userInfo }
           return_url, ... }
   returns: { order_id, client_auth_token,            returns: { body: { txnToken, resultInfo } }
              udf1..udf10, gateway_reference_id }

2. Frontend: hyperServices.openIframe({       →     Paytm.CheckoutJS.init({ data: { token: txnToken, ... } })
     order_id, client_auth_token, ... })                .then(() => Paytm.CheckoutJS.invoke())
   (loads juspay.in/hyperloader/...)

3. Customer redirected to return_url           →     Paytm POSTs callback to callbackUrl
   verify signature via order status API              verify CHECKSUMHASH server-side

4. Source of truth: GET /orders/:order_id     →     POST /v3/order/status
                                                      head: { signature } ONLY
```

→ Load the `js-checkout` skill alongside.

### One-time payments (mobile — HyperSDK)

```
Juspay HyperSDK                                     Paytm All-in-One SDK
────────────────                                    ────────────────────
1. Backend: POST /orders                      →     Backend: POST /theia/api/v1/initiateTransaction
                                                       (same as web - mints txnToken)
2. App: HyperServices(activity)               →     App: new PaytmOrder(orderId, mid, txnToken,
        .process(processPayload)                                          amount, callbackUrl)
   processPayload = { order_id, client_auth_token,   txManager = new TransactionManager(order, callback)
                      action: "paymentPage", ... }    txManager.startTransaction(activity, REQUEST_CODE)

3. SDK renders dynamic config-driven UI       →     SDK renders standard Paytm-branded UI

4. Callback: HyperPaymentsCallback            →     Callback: PaytmPaymentTransactionCallback
   .onEvent(event, data)                              .onTransactionResponse(bundle)
```

→ Load the `all-in-one-sdk` skill alongside (or `custom-sdk` if user wants their own UI).

### Refunds

```
Juspay                                              Paytm
──────                                              ─────
POST /orders/:order_id/refunds                →     POST /refund/apply
  { unique_request_id, amount }                      { head: { signature },
                                                       body: { txnType: "REFUND", orderId, txnId,
                                                               refId, refundAmount } }

GET /orders/:order_id/refunds/:refund_id      →     POST /refund/status
```

→ Load the `refunds` skill alongside.

### Subscriptions

Juspay does **not** have a unified Subscription product the way Cashfree / Razorpay do. Recurring on Juspay typically means:

- Card SI (Standing Instruction) configured via the underlying PG's SI flow, surfaced through HyperSDK.
- UPI Autopay configured per underlying PG.

**Migration to Paytm subscriptions is a clean win** if the merchant wants a first-class subscription product. Use `POST /subscription/create` with `NATIVE_SUBSCRIPTION`.

→ Load the `subscriptions` skill alongside.

### Webhooks

```
Juspay                                              Paytm
──────                                              ─────
HTTP POST { event, content: { order: {...} } }  →   HTTP POST { head: { signature }, body: { ... } }
Header: x-juspay-signature  (HMAC-SHA256 of           Body field: head.signature
        rawBody with webhook_secret, hex)
Verify: HMAC-SHA256(rawBody, webhook_secret).hex   Verify: PaytmChecksum.verifySignature(rawBody, KEY, sig)
```

→ Load the `webhooks` skill alongside.

---

## When NOT to migrate from Juspay

Be honest with the merchant before generating code:

- If they're paying Juspay specifically for **smart-routing success rate** and have measurable revenue gains from it, switching to single-PG Paytm will hurt that metric. Quantify the loss first.
- If they have **complex multi-PG settlement** flows that Juspay handles centrally, replicating that on top of Paytm requires custom engineering work that is out of scope for this skill.
- If they use Juspay's **fraud / risk products** (Juspay Safe), Paytm has its own risk engine but it's a different surface — feature parity is not guaranteed.

When the merchant still wants to migrate, full mapping in `references/REFERENCE.md`.

---

## When to load related skills

- One-time payment (web) → also load `js-checkout`
- One-time payment (mobile) → also load `all-in-one-sdk` or `custom-sdk`
- Recurring → also load `subscriptions`
- Refund → also load `refunds`
- Webhook → also load `webhooks`
- Errors during migration → `troubleshooting`
