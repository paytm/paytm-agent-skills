"""Paytm server-side flow: initiateTransaction, order status, callback verify.

Mirrors backend-node/paytmService.js. Uses Paytm's official `paytmchecksum` package.
"""
import json
import secrets
from typing import Any, Optional

import requests
from paytmchecksum import PaytmChecksum

from paytm_config import get_paytm_config


class PaytmError(Exception):
    def __init__(self, code: str, message: str, *, http_status: int = 500,
                 order_id: Optional[str] = None, paytm: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.order_id = order_id
        self.paytm = paytm


def _normalize_amount(amount: Any) -> str:
    raw = ("" if amount is None else str(amount)).strip()
    if not raw:
        return "1.00"
    try:
        n = float(raw)
    except ValueError:
        return "1.00"
    if n <= 0:
        return "1.00"
    return f"{n:.2f}"


def _require_credentials() -> dict:
    cfg = get_paytm_config()
    if not cfg["mid"]:
        raise PaytmError("MISSING_MID", "Missing PAYTM_MID")
    if not cfg["merchant_key"]:
        raise PaytmError("MISSING_MERCHANT_KEY", "Missing PAYTM_MERCHANT_KEY")
    return cfg


def initiate_transaction(amount: Any, cust_id: Optional[str], server_base_url: str) -> dict:
    cfg = _require_credentials()
    # 20 hex chars (10 random bytes), uppercased — matches Node + Spring backends.
    order_id = "ORD_" + secrets.token_hex(10).upper()
    callback_url = cfg["callback_url"] or f"{server_base_url.rstrip('/')}/paytm/callback"

    body = {
        "requestType": "Payment",
        "mid": cfg["mid"],
        "websiteName": cfg["website_name"],
        "orderId": order_id,
        "callbackUrl": callback_url,
        "txnAmount": {"value": _normalize_amount(amount), "currency": "INR"},
        "userInfo": {"custId": (cust_id or "").strip() or "CUST_DEMO"},
    }
    signature = PaytmChecksum.generateSignature(json.dumps(body), cfg["merchant_key"])
    payload = {"body": body, "head": {"signature": signature}}

    url = f"{cfg['initiate_transaction_url']}?mid={cfg['mid']}&orderId={order_id}"
    r = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=15)
    text = r.text
    if not r.ok:
        raise _upstream("INITIATE_HTTP_ERROR", f"initiateTransaction failed (HTTP {r.status_code})", order_id, text)

    data = json.loads(text)
    info = (data.get("body") or {}).get("resultInfo") or {}
    if info.get("resultStatus") != "S":
        raise _upstream("INITIATE_FAILED", info.get("resultMsg") or "initiateTransaction failed", order_id, text)
    txn_token = (data.get("body") or {}).get("txnToken")
    if not txn_token:
        raise _upstream("MISSING_TXN_TOKEN", "Missing txnToken in Paytm response", order_id, text)

    return {
        "orderId": order_id,
        "txnToken": txn_token,
        "amount": body["txnAmount"]["value"],
        "mid": cfg["mid"],
        "tokenType": "TXN_TOKEN",
    }


def fetch_order_status(order_id: str) -> str:
    cfg = _require_credentials()
    body = {"mid": cfg["mid"], "orderId": order_id}
    signature = PaytmChecksum.generateSignature(json.dumps(body), cfg["merchant_key"])
    payload = {"body": body, "head": {"signature": signature}}
    r = requests.post(cfg["order_status_url"], json=payload,
                      headers={"Content-Type": "application/json"}, timeout=15)
    if not r.ok:
        raise PaytmError("STATUS_HTTP_ERROR", f"order status HTTP {r.status_code} — {r.text}",
                         http_status=502, order_id=order_id)
    return r.text


def verify_callback_checksum(params: dict) -> bool:
    cfg = get_paytm_config()
    signature = params.get("CHECKSUMHASH")
    if not signature or not cfg["merchant_key"]:
        return False
    to_verify = {k: v for k, v in params.items() if k != "CHECKSUMHASH"}
    try:
        return PaytmChecksum.verifySignature(to_verify, cfg["merchant_key"], signature)
    except Exception:
        return False


def _upstream(code: str, message: str, order_id: str, raw_body: str) -> PaytmError:
    paytm: dict = {}
    try:
        info = ((json.loads(raw_body) or {}).get("body") or {}).get("resultInfo") or {}
        for k in ("resultStatus", "resultCode", "resultMsg"):
            if info.get(k):
                paytm[k] = info[k]
    except Exception:
        pass
    return PaytmError(code, message, http_status=502, order_id=order_id, paytm=paytm or None)
