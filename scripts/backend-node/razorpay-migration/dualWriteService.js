/**
 * Dual-write canary routing - Razorpay <-> Paytm.
 *
 * Sticky hashing on customerId ensures a given customer always hits the same
 * gateway across retries within the canary window. The percentage is read
 * from env on every call so you can bump it without redeploying.
 */

import crypto from "node:crypto";
import Razorpay from "razorpay";
import PaytmChecksum from "paytmchecksum";

const RAZORPAY = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PAYTM = {
  mid: process.env.PAYTM_MID,
  key: process.env.PAYTM_MERCHANT_KEY,
  websiteName: process.env.PAYTM_WEBSITE_NAME || "WEBSTAGING",
  env: process.env.PAYTM_ENVIRONMENT || "staging",
};
const PAYTM_BASE =
  PAYTM.env === "production"
    ? "https://secure.paytmpayments.com"
    : "https://securestage.paytmpayments.com";

/** Sticky 0-99 bucket per customer. */
function bucket(customerId) {
  const h = crypto.createHash("sha256").update(String(customerId)).digest();
  return h.readUInt32BE(0) % 100;
}

/** Returns "paytm" or "razorpay" for this customer. */
export function pickPsp(customerId) {
  const canary = Number(process.env.CANARY_PCT || "0");
  return bucket(customerId) < canary ? "paytm" : "razorpay";
}

/** Create order on Razorpay. Amount is INR rupees as a number. */
async function createRazorpayOrder({ orderId, amount, customerId }) {
  const res = await RAZORPAY.orders.create({
    amount: Math.round(amount * 100), // paise
    currency: "INR",
    receipt: orderId,
    notes: { customer_id: customerId },
  });
  return {
    psp: "razorpay",
    pspOrderId: res.id, // razorpay-issued
    clientPayload: { key: process.env.RAZORPAY_KEY_ID, order_id: res.id, amount: res.amount },
  };
}

/** Create order on Paytm. Amount is INR rupees as a number. */
async function createPaytmOrder({ orderId, amount, customerId }) {
  const body = {
    requestType: "Payment",
    mid: PAYTM.mid,
    websiteName: PAYTM.websiteName,
    orderId,
    callbackUrl: process.env.PAYTM_CALLBACK_URL,
    txnAmount: { value: amount.toFixed(2), currency: "INR" },
    userInfo: { custId: String(customerId).replace(/[^A-Za-z0-9_@-]/g, "_") },
  };
  const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), PAYTM.key);
  const url = `${PAYTM_BASE}/theia/api/v1/initiateTransaction?mid=${PAYTM.mid}&orderId=${orderId}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ head: { signature }, body }),
  });
  const json = await r.json();
  if (!json?.body?.txnToken) {
    throw new Error(`Paytm initiate failed: ${json?.body?.resultInfo?.resultMsg || "no token"}`);
  }
  return {
    psp: "paytm",
    pspOrderId: orderId,
    txnToken: json.body.txnToken,
    clientPayload: {
      mid: PAYTM.mid,
      orderId,
      txnToken: json.body.txnToken,
      amount: amount.toFixed(2),
    },
  };
}

/** Top-level dispatch. Use this from your /api/checkout/start endpoint. */
export async function createOrder({ orderId, amount, customerId }) {
  const psp = pickPsp(customerId);
  // emit telemetry (metric: psp, customerId hash, amount, outcome)
  const start = Date.now();
  try {
    const result =
      psp === "paytm"
        ? await createPaytmOrder({ orderId, amount, customerId })
        : await createRazorpayOrder({ orderId, amount, customerId });
    return { ...result, latencyMs: Date.now() - start, pspRouted: psp };
  } catch (err) {
    // Optional fallback to the other PSP if one is down. Keep symmetric retry
    // logic out of this file - that's a separate concern.
    err.pspRouted = psp;
    throw err;
  }
}
