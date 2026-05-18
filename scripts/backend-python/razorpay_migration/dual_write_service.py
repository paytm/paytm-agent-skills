"""
Dual-write canary routing - Razorpay <-> Paytm (Python / Flask).

Sticky hashing on customer_id keeps a given customer pinned to one gateway
within the canary window. CANARY_PCT is read from env on every call so you can
roll out / back without redeploying.
"""

from __future__ import annotations

import hashlib
import json
import os
from decimal import Decimal, ROUND_HALF_UP

import razorpay
import requests
from paytmchecksum import PaytmChecksum


def _money(amount) -> str:
    """Two-decimal string. Paytm rejects '1', '1.0', '1.000'."""
    q = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{q:.2f}"


def _bucket(customer_id: str) -> int:
    h = hashlib.sha256(str(customer_id).encode("utf-8")).digest()
    return int.from_bytes(h[:4], "big") % 100


def pick_psp(customer_id: str) -> str:
    canary = int(os.getenv("CANARY_PCT", "0"))
    return "paytm" if _bucket(customer_id) < canary else "razorpay"


def _paytm_base() -> str:
    return (
        "https://secure.paytmpayments.com"
        if os.getenv("PAYTM_ENVIRONMENT", "staging") == "production"
        else "https://securestage.paytmpayments.com"
    )


def _sanitize_cust_id(s: str) -> str:
    import re

    return re.sub(r"[^A-Za-z0-9_@-]", "_", str(s))


def create_razorpay_order(order_id: str, amount, customer_id: str) -> dict:
    client = razorpay.Client(auth=(os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")))
    paise = int(Decimal(str(amount)) * 100)
    res = client.order.create(
        {
            "amount": paise,
            "currency": "INR",
            "receipt": order_id,
            "notes": {"customer_id": customer_id},
        }
    )
    return {
        "psp": "razorpay",
        "psp_order_id": res["id"],
        "client_payload": {
            "key": os.getenv("RAZORPAY_KEY_ID"),
            "order_id": res["id"],
            "amount": res["amount"],
        },
    }


def create_paytm_order(order_id: str, amount, customer_id: str) -> dict:
    body = {
        "requestType": "Payment",
        "mid": os.getenv("PAYTM_MID"),
        "websiteName": os.getenv("PAYTM_WEBSITE_NAME", "WEBSTAGING"),
        "orderId": order_id,
        "callbackUrl": os.getenv("PAYTM_CALLBACK_URL"),
        "txnAmount": {"value": _money(amount), "currency": "INR"},
        "userInfo": {"custId": _sanitize_cust_id(customer_id)},
    }
    signature = PaytmChecksum.generateSignature(json.dumps(body), os.getenv("PAYTM_MERCHANT_KEY"))
    url = (
        f"{_paytm_base()}/theia/api/v1/initiateTransaction"
        f"?mid={os.getenv('PAYTM_MID')}&orderId={order_id}"
    )
    r = requests.post(
        url,
        json={"head": {"signature": signature}, "body": body},
        timeout=15,
    )
    js = r.json()
    token = (js.get("body") or {}).get("txnToken")
    if not token:
        msg = ((js.get("body") or {}).get("resultInfo") or {}).get("resultMsg", "no token")
        raise RuntimeError(f"Paytm initiate failed: {msg}")

    return {
        "psp": "paytm",
        "psp_order_id": order_id,
        "txn_token": token,
        "client_payload": {
            "mid": os.getenv("PAYTM_MID"),
            "orderId": order_id,
            "txnToken": token,
            "amount": _money(amount),
        },
    }


def create_order(order_id: str, amount, customer_id: str) -> dict:
    psp = pick_psp(customer_id)
    if psp == "paytm":
        out = create_paytm_order(order_id, amount, customer_id)
    else:
        out = create_razorpay_order(order_id, amount, customer_id)
    out["psp_routed"] = psp
    return out
