/**
 * One webhook endpoint, two verifiers.
 *
 * Razorpay POSTs with the signature in `X-Razorpay-Signature` header; Paytm
 * POSTs with the signature in `body.head.signature`. We detect by shape.
 *
 * Mount with raw body parser BEFORE any JSON middleware - both verifiers
 * require the exact byte sequence Paytm/Razorpay signed over.
 */

import crypto from "node:crypto";
import PaytmChecksum from "paytmchecksum";

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const PAYTM_MERCHANT_KEY = process.env.PAYTM_MERCHANT_KEY;

// Simple in-memory dedupe. Replace with Redis SETEX in production.
const recent = new Map();
const SEEN_TTL_MS = 10 * 60 * 1000;
function dedup(key) {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > SEEN_TTL_MS) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

function verifyRazorpay(rawBody, signature) {
  if (!signature || !RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  // timingSafeEqual would be ideal here in real code.
  return expected === signature;
}

async function verifyPaytm(rawBody, signature) {
  if (!signature) return false;
  return await PaytmChecksum.verifySignature(rawBody, PAYTM_MERCHANT_KEY, signature);
}

/** Express handler. Pass `express.raw({ type: "*/*" })` as middleware. */
export async function handleWebhook(req, res) {
  const rawBody = req.body.toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return res.status(400).send("invalid json");
  }

  const razorpaySig = req.get("X-Razorpay-Signature");
  const paytmSig = parsed?.head?.signature;

  let psp, ok, event;
  if (razorpaySig) {
    psp = "razorpay";
    ok = verifyRazorpay(rawBody, razorpaySig);
    event = parsed.event;
  } else if (paytmSig) {
    psp = "paytm";
    ok = await verifyPaytm(rawBody, paytmSig);
    event = `${parsed?.body?.txnType || "SALE"}.${parsed?.body?.status || "UNKNOWN"}`;
  } else {
    return res.status(401).send("no signature");
  }
  if (!ok) return res.status(401).send("invalid signature");

  // Dedup
  const dedupKey =
    psp === "razorpay"
      ? `razorpay:${req.get("X-Razorpay-Event-Id") || crypto.createHash("sha1").update(rawBody).digest("hex")}`
      : parsed?.body?.txnType === "REFUND"
        ? `paytm:refund:${parsed.body.refId}:${parsed.body.status}`
        : `paytm:${parsed.body.orderId}:${parsed.body.status}`;
  if (dedup(dedupKey)) return res.status(200).send("duplicate");

  try {
    await fulfillEvent({ psp, event, parsed, raw: rawBody });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("[webhook]", psp, "fulfilment error", err);
    return res.status(500).send("retry");
  }
}

/**
 * Normalize and dispatch. Replace with your real business logic
 * (DB write, queue push, email, etc.).
 */
async function fulfillEvent({ psp, event, parsed }) {
  if (psp === "razorpay") {
    // Razorpay payload shape: { event, payload: { payment: { entity: { id, order_id, amount, status, ... } } } }
    const payment = parsed?.payload?.payment?.entity;
    if (!payment) return;
    // ... await db.updateOrderFromRazorpay(payment)
    console.log("[fulfil][razorpay]", event, payment.order_id, payment.status);
  } else {
    // Paytm payload shape: { head, body: { orderId, txnId, status, txnType, refId?, refundId?, ... } }
    const body = parsed?.body || {};
    if (body.txnType === "REFUND") {
      // ... await db.updateRefund(body)
      console.log("[fulfil][paytm][refund]", body.refId, body.status);
    } else {
      // ... await db.updateOrderFromPaytm(body)
      console.log("[fulfil][paytm]", body.orderId, body.status);
    }
  }
}
