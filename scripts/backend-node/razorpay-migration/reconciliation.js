/**
 * Daily reconciliation cron stub.
 *
 * For each order created in the last 24h, pull final state from the gateway it
 * used and compare to your DB. Flag discrepancies.
 *
 * Replace `db.*` calls with your real persistence layer. The shape returned
 * here is what your monitoring / paging should consume.
 */

import Razorpay from "razorpay";
import PaytmChecksum from "paytmchecksum";

const RAZORPAY = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const PAYTM_BASE =
  (process.env.PAYTM_ENVIRONMENT || "staging") === "production"
    ? "https://secure.paytmpayments.com"
    : "https://securestage.paytmpayments.com";

async function fetchRazorpayStatus(razorpayOrderId) {
  const payments = await RAZORPAY.orders.fetchPayments(razorpayOrderId);
  // Pick latest captured payment, or the latest one if nothing captured.
  const captured = payments.items.find((p) => p.status === "captured");
  const latest = payments.items[0];
  return {
    found: !!(captured || latest),
    status: captured ? "TXN_SUCCESS" : latest?.status === "failed" ? "TXN_FAILURE" : "PENDING",
    raw: captured || latest,
  };
}

async function fetchPaytmStatus(orderId) {
  const body = { mid: process.env.PAYTM_MID, orderId };
  const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), process.env.PAYTM_MERCHANT_KEY);
  const r = await fetch(`${PAYTM_BASE}/v3/order/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ head: { signature }, body }),
  });
  const json = await r.json();
  const status = json?.body?.resultInfo?.resultStatus || "UNKNOWN";
  return { found: status !== "UNKNOWN", status, raw: json?.body };
}

/**
 * Reconcile a single order. Returns { match: boolean, dbState, gatewayState }.
 */
export async function reconcileOrder(order) {
  const dbState = order.status; // your DB's view: TXN_SUCCESS / TXN_FAILURE / PENDING
  const gateway = order.psp === "razorpay"
    ? await fetchRazorpayStatus(order.pspOrderId)
    : await fetchPaytmStatus(order.orderId);

  return {
    orderId: order.orderId,
    psp: order.psp,
    dbState,
    gatewayState: gateway.status,
    match: dbState === gateway.status,
    found: gateway.found,
  };
}

/**
 * Run-once reconciliation. Wire to cron / cloud scheduler.
 */
export async function reconcileLast24h({ getOrders }) {
  const orders = await getOrders({ sinceHours: 24 });
  const results = await Promise.all(orders.map(reconcileOrder));

  const summary = {
    total: results.length,
    matches: results.filter((r) => r.match).length,
    mismatches: results.filter((r) => !r.match).length,
    byPsp: {
      razorpay: { total: 0, mismatches: 0 },
      paytm: { total: 0, mismatches: 0 },
    },
    mismatchDetail: results.filter((r) => !r.match),
  };
  for (const r of results) {
    summary.byPsp[r.psp].total++;
    if (!r.match) summary.byPsp[r.psp].mismatches++;
  }
  return summary;
}

/*
Example wire-up (cron every 2h or so):

import { reconcileLast24h } from "./reconciliation.js";
import { db } from "./db.js";

const summary = await reconcileLast24h({
  getOrders: ({ sinceHours }) => db.ordersCreatedSince(sinceHours),
});
if (summary.mismatches > 0) await alerts.page("PSP reconciliation drift", summary);
*/
