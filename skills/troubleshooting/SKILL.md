---
name: paytm-troubleshooting
description: >
  Symptom -> cause -> fix tree for Paytm integration failures: checksum mismatches (227), invalid /
  duplicate orderId (330/334), bad request (400), JS Checkout modal not opening, callback verification
  failures, transaction-status confusion, refund pending, and corp-proxy TLS interception
  (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). Includes the expanded RESPCODE reference and a top-level
  decision tree. Load this skill when the user reports an error code, an unexpected behavior, or
  asks "why is X failing?" in a Paytm context.
triggers:
  - "resultCode: 227"
  - "resultCode: 330"
  - "resultCode: 334"
  - "resultCode: 400"
  - "RESPCODE"
  - "checksum mismatch"
  - "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
  - "MISSING_TXN_TOKEN"
---

# Paytm Troubleshooting

Symptom-driven debugging. Always start at the decision tree, then dive into the matching section in `references/REFERENCE.md`.

---

## Decision tree

```
Payment failed?
├─ Did initiateTransaction return a txnToken?
│   ├─ No  -> check resultInfo.resultMsg -> "Initiate Transaction fails" in REFERENCE
│   └─ Yes
│       ├─ Did JS Checkout render?
│       │   ├─ No  -> "JS Checkout doesn't render" in REFERENCE
│       │   └─ Yes
│       │       ├─ Did Paytm POST callback?
│       │       │   ├─ No  -> call Transaction Status API anyway (browser issue)
│       │       │   └─ Yes
│       │       │       └─ Did CHECKSUMHASH verify?
│       │       │           ├─ No  -> "Callback arrives but is ignored" in REFERENCE
│       │       │           └─ Yes -> call /v3/order/status - that is the truth
```

---

## Top-of-page RESPCODE / resultCode reference

| Code | Meaning | First check |
|---|---|---|
| `01` | Txn success | Fulfill order |
| `141` | User cancelled at bank page | Allow retry |
| `227` | Checksum mismatch | Body bytes used to sign must equal bytes sent. `MERCHANT_KEY` quoted in `.env`. Wrong env (staging key on prod host). |
| `235` | Insufficient bank balance | Show retry / different option |
| `267` | Bank declined | Retry / switch option |
| `295` | Invalid card details | User error |
| `334` | Duplicate orderId | Generate new orderId per attempt |
| `335` | Request expired | Server clock skew / stale request |
| `400` | Bad request | Missing required field; check `websiteName` matches dashboard |
| `401` | Unauthorized | MID/key mismatch, env mismatch |
| `402` | Pending - awaiting bank | Poll Transaction Status |
| `501` | System error | Retry |
| `810` | Risk system declined | Contact Paytm support |
| `911` / `BANK_PENDING` | Bank confirmation pending | Poll, do not refund |
| `4001` | Subscription: grace > frequency | Drop `subscriptionGraceDays` or set < cycle length |
| `5007` | Payment Link: invalid char in `linkName` | Strip spaces — `linkName` is alphanumerics only |

For unfamiliar codes, query `/v3/order/status` with the orderId — `body.resultInfo.resultMsg` is canonical.

---

## When to look in REFERENCE

`references/REFERENCE.md` has full sections on:

- Initiate Transaction failures (per resultCode)
- "Failed to parse URL from /paytm/create-order" (SSR issue)
- "Pay" button does nothing (the `onLoad` trap, popup blocker, expired token)
- JS Checkout doesn't render
- Callback arrives but is ignored / treated as failure
- Transaction Status mismatches
- Refund pending / stuck
- **Corp proxy TLS interception** — `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, asymmetric MITM, `SSL_CERT_FILE` vs `NODE_EXTRA_CA_CERTS` semantics, OS-specific CA extraction commands
- Environment / config gotchas (PG domain mismatch, `websiteName`, currency)

Open the reference, jump to the matching heading.

---

## Skill cross-reference

The reference is symptom-organized. If the symptom is product-specific:

- Subscription error codes → also see `subscriptions` skill
- Payment Link error codes → also see `payment-links` skill
- Webhook signature failures → also see `webhooks` skill
- Card / Net Banking simulator behavior → also see `js-checkout` skill
