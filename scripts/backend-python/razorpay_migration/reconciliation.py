"""
Daily reconciliation cron stub.

For each order in the past 24h, fetch final state from whichever gateway it
used and compare to your DB. Flag drift; page above threshold.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Callable, Iterable

import razorpay
import requests

from paytmchecksum import PaytmChecksum


def _paytm_base() -> str:
    return (
        "https://secure.paytmpayments.com"
        if os.getenv("PAYTM_ENVIRONMENT", "staging") == "production"
        else "https://securestage.paytmpayments.com"
    )


@dataclass
class Order:
    order_id: str
    psp: str  # "razorpay" | "paytm"
    psp_order_id: str
    status: str  # your DB's view


def _fetch_razorpay_status(razorpay_order_id: str) -> dict:
    client = razorpay.Client(auth=(os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")))
    payments = client.order.payments(razorpay_order_id)["items"]
    captured = next((p for p in payments if p["status"] == "captured"), None)
    latest = payments[0] if payments else None
    status = (
        "TXN_SUCCESS" if captured
        else "TXN_FAILURE" if (latest and latest["status"] == "failed")
        else "PENDING" if latest
        else "UNKNOWN"
    )
    return {"found": bool(captured or latest), "status": status, "raw": captured or latest}


def _fetch_paytm_status(order_id: str) -> dict:
    body = {"mid": os.getenv("PAYTM_MID"), "orderId": order_id}
    signature = PaytmChecksum.generateSignature(json.dumps(body), os.getenv("PAYTM_MERCHANT_KEY"))
    r = requests.post(
        f"{_paytm_base()}/v3/order/status",
        json={"head": {"signature": signature}, "body": body},
        timeout=15,
    )
    js = r.json()
    status = ((js.get("body") or {}).get("resultInfo") or {}).get("resultStatus", "UNKNOWN")
    return {"found": status != "UNKNOWN", "status": status, "raw": js.get("body")}


def reconcile_order(order: Order) -> dict:
    gateway = (
        _fetch_razorpay_status(order.psp_order_id)
        if order.psp == "razorpay"
        else _fetch_paytm_status(order.order_id)
    )
    return {
        "orderId": order.order_id,
        "psp": order.psp,
        "dbState": order.status,
        "gatewayState": gateway["status"],
        "match": order.status == gateway["status"],
        "found": gateway["found"],
    }


def reconcile_last_24h(get_orders: Callable[[int], Iterable[Order]]) -> dict:
    orders = list(get_orders(24))
    results = [reconcile_order(o) for o in orders]
    summary = {
        "total": len(results),
        "matches": sum(1 for r in results if r["match"]),
        "mismatches": sum(1 for r in results if not r["match"]),
        "byPsp": {
            "razorpay": {"total": 0, "mismatches": 0},
            "paytm": {"total": 0, "mismatches": 0},
        },
        "mismatchDetail": [r for r in results if not r["match"]],
    }
    for r in results:
        summary["byPsp"][r["psp"]]["total"] += 1
        if not r["match"]:
            summary["byPsp"][r["psp"]]["mismatches"] += 1
    return summary
