"""Create Payment Link — POST /link/create.

Doc: https://www.paytmpayments.com/docs/api/create-link-api
Defaults & gotchas baked in:
- head requires tokenType: "AES" + timestamp (Unix epoch SECONDS as string)
- linkType: "FIXED" by default (GENERIC ignores amount)
- amount is a JSON number, NOT a string
- linkDescription must be >= 3 chars, alphanumerics + spaces only
- customer details nested under customerContact (not top-level)
- expiryDate format DD/MM/YYYY HH:MM:SS (most MIDs)
- Wallet (PPI / BALANCE) suppressed via disablePaymentMode
"""
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import requests
from paytmchecksum import PaytmChecksum

from paytm_config import get_paytm_config
from paytm_service import PaytmError

IST = timezone(timedelta(hours=5, minutes=30))


def _sanitize_description(s: Optional[str], fallback: str = "Invoice payment") -> str:
    cleaned = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", s or "")).strip()
    return cleaned if len(cleaned) >= 3 else fallback


def _expiry_one_year_from_now() -> str:
    d = datetime.now(IST) + timedelta(days=365)
    return d.strftime("%d/%m/%Y 23:59:59")


def _normalize_amount(amount: Any) -> float:
    try:
        n = float(str(amount).strip())
    except (TypeError, ValueError):
        return 1.00
    if n <= 0:
        return 1.00
    return round(n, 2)


def create_payment_link(
    *,
    amount: Any = "1.00",
    link_name: Optional[str] = None,
    link_description: Optional[str] = None,
    customer_name: Optional[str] = None,
    customer_email: Optional[str] = None,
    customer_mobile: Optional[str] = None,
    customer_id: Optional[str] = None,
    expiry_date: Optional[str] = None,
    order_id: Optional[str] = None,
    send_sms: bool = True,
    send_email: bool = True,
    callback_url: Optional[str] = None,
    merchant_unique_reference: Optional[str] = None,
    server_base_url: str = "",
) -> dict:
    cfg = get_paytm_config()
    if not cfg["mid"]:
        raise PaytmError("MISSING_MID", "Missing PAYTM_MID")
    if not cfg["merchant_key"]:
        raise PaytmError("MISSING_MERCHANT_KEY", "Missing PAYTM_MERCHANT_KEY")

    order_id = (order_id or "").strip() or ("LNK_" + secrets.token_hex(10).upper())
    callback_url = (callback_url or cfg["callback_url"]
                    or f"{server_base_url.rstrip('/')}/paytm/callback")

    customer_contact: dict = {}
    if customer_name and customer_name.strip(): customer_contact["customerName"] = customer_name.strip()
    if customer_email and customer_email.strip(): customer_contact["customerEmail"] = customer_email.strip()
    if customer_mobile and customer_mobile.strip(): customer_contact["customerMobile"] = customer_mobile.strip()
    if customer_id and customer_id.strip(): customer_contact["customerId"] = customer_id.strip()

    body: dict = {
        "mid": cfg["mid"],
        "linkType": "FIXED",
        "linkName": _sanitize_description(link_name, "Invoice"),
        "linkDescription": _sanitize_description(link_description, "Invoice payment"),
        "amount": _normalize_amount(amount),
        "sendSms": bool(send_sms),
        "sendEmail": bool(send_email),
        "customerContact": customer_contact,
        "expiryDate": (expiry_date or "").strip() or _expiry_one_year_from_now(),
        "orderId": order_id,
        "callbackUrl": callback_url,
        # Wallet (PPI / BALANCE) is permanently excluded from this skill's scope.
        "disablePaymentMode": [{"mode": "PPI"}, {"mode": "BALANCE"}],
    }
    if merchant_unique_reference and merchant_unique_reference.strip():
        body["merchantUniqueReference"] = merchant_unique_reference.strip()

    signature = PaytmChecksum.generateSignature(json.dumps(body), cfg["merchant_key"])
    head = {
        "tokenType": "AES",
        "signature": signature,
        "timestamp": str(int(datetime.now(timezone.utc).timestamp())),
    }

    r = requests.post(cfg["link_create_url"], json={"head": head, "body": body},
                      headers={"Content-Type": "application/json"}, timeout=15)
    text = r.text
    if not r.ok:
        raise _upstream("LINK_HTTP_ERROR", f"link/create HTTP {r.status_code}", order_id, text)

    data = json.loads(text)
    info = (data.get("body") or {}).get("resultInfo") or {}
    status = info.get("resultStatus")
    if status and status not in ("SUCCESS", "S"):
        raise _upstream("LINK_FAILED", info.get("resultMsg") or "link/create failed", order_id, text)

    body_resp = data.get("body") or {}
    # Read defensively — current Paytm returns linkId; older docs LinkID.
    link_id = body_resp.get("linkId") if body_resp.get("linkId") is not None else body_resp.get("LinkID")

    return {
        "orderId": order_id,
        "linkId": link_id,
        "shortUrl": body_resp.get("shortUrl"),
        "longUrl": body_resp.get("longUrl"),
        "linkStatus": body_resp.get("linkStatus") or "ACTIVE",
        "amount": body["amount"],
        "mid": cfg["mid"],
    }


def _upstream(code: str, message: str, order_id: str, raw: str) -> PaytmError:
    paytm: dict = {}
    try:
        info = ((json.loads(raw) or {}).get("body") or {}).get("resultInfo") or {}
        for k in ("resultStatus", "resultCode", "resultMsg"):
            if info.get(k):
                paytm[k] = info[k]
    except Exception:
        pass
    return PaytmError(code, message, http_status=502, order_id=order_id, paytm=paytm or None)
