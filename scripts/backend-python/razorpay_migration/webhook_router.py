"""
Razorpay + Paytm webhook router. One endpoint, two verifiers.

Razorpay -> signature in `X-Razorpay-Signature` header.
Paytm    -> signature in `body.head.signature` field.

Detect by shape and dispatch.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time

from flask import Blueprint, request

from paytmchecksum import PaytmChecksum

webhook_bp = Blueprint("webhook", __name__)

# in-memory dedupe; swap for redis in prod
_seen: dict[str, float] = {}
_TTL = 600.0  # 10 min


def _dedup(key: str) -> bool:
    now = time.time()
    expired = [k for k, t in _seen.items() if now - t > _TTL]
    for k in expired:
        _seen.pop(k, None)
    if key in _seen:
        return True
    _seen[key] = now
    return False


def _verify_razorpay(raw_body: bytes, signature: str) -> bool:
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")
    if not signature or not secret:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _verify_paytm(raw_body_str: str, signature: str) -> bool:
    if not signature:
        return False
    return PaytmChecksum.verifySignature(raw_body_str, os.getenv("PAYTM_MERCHANT_KEY"), signature)


def _fulfill(psp: str, event: str, parsed: dict):
    """Replace with your business logic."""
    if psp == "razorpay":
        payment = (parsed.get("payload") or {}).get("payment", {}).get("entity") or {}
        print(f"[fulfil][razorpay] {event} {payment.get('order_id')} {payment.get('status')}")
    else:
        body = parsed.get("body") or {}
        if body.get("txnType") == "REFUND":
            print(f"[fulfil][paytm][refund] {body.get('refId')} {body.get('status')}")
        else:
            print(f"[fulfil][paytm] {body.get('orderId')} {body.get('status')}")


@webhook_bp.post("/paytm/webhook")
def handle_webhook():
    raw_body = request.get_data()
    raw_body_str = raw_body.decode("utf-8")
    try:
        parsed = json.loads(raw_body_str)
    except json.JSONDecodeError:
        return "invalid json", 400

    razorpay_sig = request.headers.get("X-Razorpay-Signature")
    paytm_sig = (parsed.get("head") or {}).get("signature")

    if razorpay_sig:
        psp = "razorpay"
        if not _verify_razorpay(raw_body, razorpay_sig):
            return "invalid signature", 401
        event = parsed.get("event", "unknown")
        dedup_key = (
            f"razorpay:{request.headers.get('X-Razorpay-Event-Id') or hashlib.sha1(raw_body).hexdigest()}"
        )
    elif paytm_sig:
        psp = "paytm"
        if not _verify_paytm(raw_body_str, paytm_sig):
            return "invalid signature", 401
        body = parsed.get("body") or {}
        event = f"{body.get('txnType') or 'SALE'}.{body.get('status') or 'UNKNOWN'}"
        if body.get("txnType") == "REFUND":
            dedup_key = f"paytm:refund:{body.get('refId')}:{body.get('status')}"
        else:
            dedup_key = f"paytm:{body.get('orderId')}:{body.get('status')}"
    else:
        return "no signature", 401

    if _dedup(dedup_key):
        return "duplicate", 200

    try:
        _fulfill(psp, event, parsed)
        return "ok", 200
    except Exception as e:  # noqa: BLE001
        print(f"[webhook] {psp} fulfilment error: {e}")
        return "retry", 500
