"""Paytm merchant config — env-driven, mirrors backend-node/paytmConfig.js."""
import os

PROD_PG_DOMAIN = "https://secure.paytmpayments.com"
STAGING_PG_DOMAIN = "https://securestage.paytmpayments.com"


def _strip(v: str | None, default: str = "") -> str:
    return (v or default).strip().rstrip("/")


def get_paytm_config() -> dict:
    env = (os.environ.get("PAYTM_ENVIRONMENT") or "production").strip().lower()
    default_pg = STAGING_PG_DOMAIN if env == "staging" else PROD_PG_DOMAIN
    pg_domain = _strip(os.environ.get("PAYTM_PG_DOMAIN"), default_pg)

    mid = (os.environ.get("PAYTM_MID") or "").strip()
    merchant_key = (os.environ.get("PAYTM_MERCHANT_KEY") or "").strip()
    website_name = (os.environ.get("PAYTM_WEBSITE_NAME") or "DEFAULT").strip()
    callback_base = _strip(os.environ.get("PAYTM_CALLBACK_BASE"), "http://localhost:5001")
    callback_url = (os.environ.get("PAYTM_CALLBACK_URL") or "").strip()

    return {
        "pg_domain": pg_domain,
        "mid": mid,
        "merchant_key": merchant_key,
        "website_name": website_name,
        "callback_base": callback_base,
        "callback_url": callback_url,
        "initiate_transaction_url": f"{pg_domain}/theia/api/v1/initiateTransaction",
        "order_status_url": (os.environ.get("PAYTM_STATUS_API_URL") or f"{pg_domain}/v3/order/status").strip(),
        "checkout_js_loader_url": (
            f"{pg_domain}/merchantpgpui/checkoutjs/merchants/{mid}.js" if mid else ""
        ),
    }
