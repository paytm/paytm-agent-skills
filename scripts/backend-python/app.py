"""Flask backend for Paytm JS Checkout — mirrors backend-node/server.js routes.

Endpoints:
  GET  /paytm-client-config.json     mid + loader_url for the browser
  POST /paytm/create-order           initiateTransaction → { orderId, txnToken, amount, mid }
  POST /paytm/order-status           server-side Transaction Status API
  GET|POST /paytm/callback           Paytm browser redirect; verifies CHECKSUMHASH

Run:  PAYTM_MID=... PAYTM_MERCHANT_KEY=... python app.py
"""
import os

from flask import Flask, jsonify, request, send_from_directory

from paytm_config import get_paytm_config
from paytm_service import (
    PaytmError,
    fetch_order_status,
    initiate_transaction,
    verify_callback_checksum,
)

app = Flask(__name__, static_folder=None)
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")


def _request_base() -> str:
    proto = (request.headers.get("X-Forwarded-Proto") or request.scheme or "http").split(",")[0].strip()
    host = (request.headers.get("X-Forwarded-Host") or request.host or "localhost").split(",")[0].strip()
    return f"{proto}://{host}"


@app.get("/paytm-client-config.json")
def client_config():
    cfg = get_paytm_config()
    return jsonify({"mid": cfg["mid"], "api_host": cfg["pg_domain"], "loader_url": cfg["checkout_js_loader_url"]})


@app.post("/paytm/create-order")
def create_order():
    payload = request.get_json(silent=True) or {}
    try:
        out = initiate_transaction(payload.get("amount"), payload.get("custId"), _request_base())
        return jsonify(out)
    except PaytmError as e:
        body = {"error": True, "code": e.code, "message": str(e)}
        if e.order_id: body["orderId"] = e.order_id
        if e.paytm: body["paytm"] = e.paytm
        return jsonify(body), e.http_status


@app.post("/paytm/order-status")
def order_status():
    order_id = (request.get_json(silent=True) or {}).get("orderId")
    if not order_id:
        return jsonify({"error": True, "message": "orderId required"}), 400
    try:
        return app.response_class(fetch_order_status(order_id), mimetype="application/json")
    except PaytmError as e:
        return jsonify({"error": True, "message": str(e)}), e.http_status


def _callback_html(params: dict, ok: bool) -> str:
    lines = "\n".join(f"{k}={v}" for k, v in params.items())
    verdict = "OK (signature verified)" if ok else "FAILED or CHECKSUMHASH missing — do not treat as paid"
    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Paytm callback</title></head><body>'
        f'<h1>Paytm callback</h1><p><strong>CHECKSUMHASH validation:</strong> {verdict}</p>'
        '<p>Also verify via Transaction Status API (or webhook) before confirming an order.</p>'
        f'<pre>{lines}</pre></body></html>'
    )


@app.route("/paytm/callback", methods=["GET", "POST"])
def callback():
    params = request.form.to_dict() if request.method == "POST" else request.args.to_dict()
    return _callback_html(params, verify_callback_checksum(params)), 200, {"Content-Type": "text/html"}


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(PUBLIC_DIR, path)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5001)), debug=False)
