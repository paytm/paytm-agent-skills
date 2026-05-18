"""
Minimal Flask app wiring the dual-write services. Demo / reference only.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from dual_write_service import create_order, pick_psp
from webhook_router import webhook_bp

load_dotenv()

app = Flask(__name__)
app.register_blueprint(webhook_bp)


@app.post("/api/checkout/start")
def checkout_start():
    payload = request.get_json(force=True, silent=True) or {}
    order_id = payload.get("orderId")
    amount = payload.get("amount")
    customer_id = payload.get("customerId")
    if not (order_id and amount is not None and customer_id):
        return jsonify({"error": "orderId, amount, customerId required"}), 400
    try:
        result = create_order(order_id, amount, customer_id)
        return jsonify(result)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500


@app.get("/api/checkout/which-psp")
def which_psp():
    customer_id = request.args.get("customerId")
    if not customer_id:
        return jsonify({"error": "customerId required"}), 400
    return jsonify(
        {
            "customerId": customer_id,
            "psp": pick_psp(customer_id),
            "canaryPct": os.getenv("CANARY_PCT", "0"),
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    print(f"[razorpay-migration] listening on http://localhost:{port}")
    print(f"  canary: {os.getenv('CANARY_PCT', '0')}% to Paytm")
    app.run(host="0.0.0.0", port=port, debug=False)
