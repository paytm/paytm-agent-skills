"""Native Create Subscription - POST /subscription/create.

Doc: https://www.paytmpayments.com/docs/api/initiate-subscription-api
Defaults baked in:
- subscriptionPaymentMode: "UNKNOWN"  (Paytm renders all enabled rails)
- txnAmount.value: "2.00"             (CC/DC mandates require > Rs.1)
- subscriptionGraceDays: "3"          (CC/DC max)
- subscriptionStartDate: today (IST)
- subscriptionEnableRetry: "0"        (retry off; subscriptionRetryCount omitted)
"""
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

import requests
from paytmchecksum import PaytmChecksum

from paytm_config import get_paytm_config
from paytm_service import PaytmError

IST = timezone(timedelta(hours=5, minutes=30))


def _sanitize_cust_id(s: Optional[str]) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", s or "CUST_DEMO")


def _today_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def _plus_one_year(yyyymmdd: str) -> str:
    d = datetime.strptime(yyyymmdd, "%Y-%m-%d")
    return d.replace(year=d.year + 1).strftime("%Y-%m-%d")


_TWO_PLACES = Decimal("0.01")


def _normalize_amount(amount: Any, min_rupees: float = 2.0) -> str:
    """Two-decimal currency normalization using Decimal (avoids binary-float drift)."""
    floor = Decimal(str(min_rupees)).quantize(_TWO_PLACES)
    raw = ("" if amount is None else str(amount)).strip()
    try:
        d = Decimal(raw) if raw else floor
    except Exception:
        d = floor
    if d < floor:
        d = floor
    return str(d.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP))


def create_subscription(
    *,
    amount: Any = "2.00",
    renewal_amount: Optional[Any] = None,
    cust_id: Optional[str] = None,
    mobile: Optional[str] = None,
    email: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    frequency: str = "1",
    frequency_unit: str = "MONTH",
    amount_type: str = "FIX",       # FIX | VARIABLE
    max_amount: Optional[Any] = None,
    start_date: Optional[str] = None,
    expiry_date: Optional[str] = None,
    grace_days: str = "3",
    payment_mode: str = "UNKNOWN",  # CC | DC | BANK_MANDATE | UNKNOWN
    mandate_type: Optional[str] = None,  # E_MANDATE | PAPER_MANDATE - only with BANK_MANDATE
    order_id: Optional[str] = None,
    server_base_url: str = "",
) -> dict:
    cfg = get_paytm_config()
    if not cfg["mid"]:
        raise PaytmError("MISSING_MID", "Missing PAYTM_MID")
    if not cfg["merchant_key"]:
        raise PaytmError("MISSING_MERCHANT_KEY", "Missing PAYTM_MERCHANT_KEY")

    order_id = (order_id or "").strip() or ("SUB_" + secrets.token_hex(10).upper())
    trace_id = "TRC_" + secrets.token_hex(10).upper()
    start = (start_date or "").strip() or _today_ist()
    expiry = (expiry_date or "").strip() or _plus_one_year(start)
    callback_url = cfg["callback_url"] or f"{server_base_url.rstrip('/')}/paytm/callback"

    user_info: dict = {"custId": _sanitize_cust_id(cust_id)}
    if mobile and mobile.strip(): user_info["mobile"] = mobile.strip()
    if email and email.strip(): user_info["email"] = email.strip()
    if first_name and first_name.strip(): user_info["firstName"] = first_name.strip()
    if last_name and last_name.strip(): user_info["lastName"] = last_name.strip()

    body: dict = {
        "requestType": "NATIVE_SUBSCRIPTION",
        "mid": cfg["mid"],
        "orderId": order_id,
        "websiteName": cfg["website_name"],
        "txnAmount": {"value": _normalize_amount(amount), "currency": "INR"},
        "subscriptionPaymentMode": payment_mode,
        "subscriptionAmountType": amount_type,
        "subscriptionFrequency": str(frequency),
        "subscriptionFrequencyUnit": frequency_unit,
        "subscriptionStartDate": start,
        "subscriptionExpiryDate": expiry,
        "subscriptionGraceDays": str(grace_days),
        "subscriptionEnableRetry": "0",
        "userInfo": user_info,
        "callbackUrl": callback_url,
    }

    if amount_type == "VARIABLE":
        if not max_amount:
            raise PaytmError("MISSING_MAX_AMOUNT",
                             "subscriptionMaxAmount required for VARIABLE amount type")
        body["subscriptionMaxAmount"] = _normalize_amount(max_amount)
    elif max_amount:
        body["subscriptionMaxAmount"] = _normalize_amount(max_amount)
    if renewal_amount:
        body["renewalAmount"] = _normalize_amount(renewal_amount)
    if payment_mode == "BANK_MANDATE":
        body["mandateType"] = mandate_type or "E_MANDATE"

    signature = PaytmChecksum.generateSignature(json.dumps(body), cfg["merchant_key"])
    head = {
        "clientId": cfg["client_id"],
        "channelId": "WEB",
        "version": "v1",
        "requestTimestamp": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
        "signature": signature,
    }

    url = f"{cfg['subscription_create_url']}?mid={cfg['mid']}&orderId={order_id}&traceId={trace_id}"
    r = requests.post(url, json={"head": head, "body": body},
                      headers={"Content-Type": "application/json"}, timeout=15)
    text = r.text
    if not r.ok:
        raise _upstream("SUBSCRIPTION_HTTP_ERROR",
                        f"subscription/create HTTP {r.status_code}", order_id, text)

    data = json.loads(text)
    info = (data.get("body") or {}).get("resultInfo") or {}
    if info.get("resultStatus") != "S":
        raise _upstream("SUBSCRIPTION_FAILED",
                        info.get("resultMsg") or "subscription/create failed", order_id, text)

    return {
        "orderId": order_id,
        "traceId": trace_id,
        "txnToken": (data.get("body") or {}).get("txnToken"),
        "subscriptionId": (data.get("body") or {}).get("subscriptionId"),
        "amount": body["txnAmount"]["value"],
        "mid": cfg["mid"],
        "tokenType": "TXN_TOKEN",
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


# ---------------------------------------------------------------------------
# Post-consent recurring lifecycle.
#
# IMPORTANT host split: subscription/create is the ONLY endpoint on the
# /theia/api/v1 prefix (and only on production). EVERY management API below
# lives on the NON-/theia/ host on BOTH environments - see paytm_config.py.
# Reusing subscription_create_url for these returns 404 / HTML on prod.
#
# The `head` envelope differs per endpoint; each function sets only the fields
# that endpoint requires (create's head does NOT carry over).
# ---------------------------------------------------------------------------


def _post_signed(url: str, body: dict, head_extra: dict, cfg: dict) -> dict:
    """Sign `body` and POST {head, body} to `url`. `head_extra` carries the
    per-endpoint head fields (e.g. {"tokenType": "AES"})."""
    signature = PaytmChecksum.generateSignature(json.dumps(body), cfg["merchant_key"])
    head = {**head_extra, "signature": signature}
    r = requests.post(url, json={"head": head, "body": body},
                      headers={"Content-Type": "application/json"}, timeout=15)
    text = r.text
    if not r.ok:
        raise _upstream("SUBSCRIPTION_HTTP_ERROR", f"{url} HTTP {r.status_code}",
                        body.get("orderId", ""), text)
    try:
        return json.loads(text)
    except Exception:
        # A non-JSON (HTML) body almost always means the wrong host/prefix was used.
        raise _upstream("SUBSCRIPTION_NON_JSON",
                        f"{url} returned non-JSON (wrong host/prefix?)",
                        body.get("orderId", ""), text)


def check_subscription_status(*, subs_id: Optional[str] = None,
                              order_id: Optional[str] = None,
                              cust_id: Optional[str] = None) -> dict:
    """POST /subscription/checkStatus - the only reliable cancel/expiry signal.
    head: tokenType "AES" + signature. A cancelled mandate is status:"REJECT" +
    subStatus MERCHANT_CANCELLED/USER_CANCELLED - read subStatus to interpret."""
    cfg = get_paytm_config()
    body: dict = {"mid": cfg["mid"]}
    if subs_id:
        body["subsId"] = subs_id
    if order_id:
        body["orderId"] = order_id
    if cust_id:
        body["custId"] = _sanitize_cust_id(cust_id)
    data = _post_signed(cfg["subscription_check_status_url"], body, {"tokenType": "AES"}, cfg)
    b = data.get("body") or {}
    sub_status = b.get("subStatus") or ""
    return {
        "subsId": b.get("subsId"),
        "status": b.get("status"),
        "subStatus": b.get("subStatus"),
        "lastOrderStatus": b.get("lastOrderStatus"),
        "expiryDate": b.get("expiryDate"),
        "cancelled": b.get("status") == "REJECT" and sub_status.endswith("CANCELLED"),
        "active": b.get("status") == "ACTIVE" and sub_status == "ACTIVE",
        "raw": b,
    }


def renew_subscription(*, subscription_id: str, amount: Any,
                       order_id: Optional[str] = None) -> dict:
    """POST /subscription/renew - trigger one recurring debit. head: bare signature.
    Use a fresh order_id per debit, then confirm with get_order_status(order_id)."""
    cfg = get_paytm_config()
    order_id = (order_id or "").strip() or ("RENEW_" + secrets.token_hex(8).upper())
    body = {
        "mid": cfg["mid"],
        "subscriptionId": subscription_id,
        "orderId": order_id,
        "txnAmount": {"value": _normalize_amount(amount), "currency": "INR"},
    }
    data = _post_signed(cfg["subscription_renew_url"], body, {}, cfg)
    return {"orderId": order_id, "raw": data.get("body") or data}


def pre_notify_subscription(*, subscription_id: str, amount: Any,
                            order_id: Optional[str] = None,
                            scheduled_execution_date: Optional[str] = None) -> dict:
    """POST /subscription/preNotify - NPCI pre-debit notice. You MUST call this
    before every debit; Paytm does not auto-handle it. head: tokenType "AES" + signature."""
    cfg = get_paytm_config()
    order_id = (order_id or "").strip() or ("PRENOTIFY_" + secrets.token_hex(8).upper())
    body: dict = {
        "mid": cfg["mid"],
        "subscriptionId": subscription_id,
        "orderId": order_id,
        "txnAmount": {"value": _normalize_amount(amount), "currency": "INR"},
    }
    if scheduled_execution_date:
        body["subscriptionScheduledExecutionDate"] = scheduled_execution_date
    data = _post_signed(cfg["subscription_pre_notify_url"], body, {"tokenType": "AES"}, cfg)
    return {"orderId": order_id, "raw": data.get("body") or data}


def pre_notify_status(*, subscription_id: str, order_id: str) -> dict:
    """POST /subscription/preNotify/status.
    head: clientId + tokenType "AES" + version + signature."""
    cfg = get_paytm_config()
    body = {"mid": cfg["mid"], "subscriptionId": subscription_id, "orderId": order_id}
    data = _post_signed(
        cfg["subscription_pre_notify_status_url"], body,
        {"clientId": cfg["client_id"], "version": "v1", "tokenType": "AES"}, cfg,
    )
    return data.get("body") or data


def cancel_subscription(*, subscription_id: str) -> dict:
    """POST /subscription/cancel - terminal. head: signature + tokenType "AES"."""
    cfg = get_paytm_config()
    body = {"mid": cfg["mid"], "subscriptionId": subscription_id}
    data = _post_signed(cfg["subscription_cancel_url"], body, {"tokenType": "AES"}, cfg)
    return data.get("body") or data


def get_order_status(*, order_id: str) -> dict:
    """POST /v3/order/status - per-charge transaction status (NOT mandate state).
    head: bare signature. Same host on both envs (non-/theia/, non-versioned)."""
    cfg = get_paytm_config()
    body = {"mid": cfg["mid"], "orderId": order_id}
    data = _post_signed(cfg["order_status_url"], body, {}, cfg)
    return data.get("body") or data
