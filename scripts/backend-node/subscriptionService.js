// Native Create Subscription - POST /subscription/create
// Doc: https://www.paytmpayments.com/docs/api/initiate-subscription-api
// Defaults baked in:
//   - subscriptionPaymentMode: "UNKNOWN"  (Paytm renders all enabled rails)
//   - txnAmount.value: "2.00"             (CC/DC mandates require > ₹1)
//   - subscriptionGraceDays: "3"          (CC/DC max)
//   - subscriptionStartDate: today (IST)
//   - subscriptionEnableRetry: "0"        (retry off; subscriptionRetryCount omitted)
import crypto from "node:crypto";
import PaytmChecksum from "paytmchecksum";
import { getPaytmConfig } from "./paytmConfig.js";

function sanitizeCustId(s) {
  return (s || "CUST_DEMO").replace(/[^a-zA-Z0-9_]/g, "_");
}

function todayIST() {
  // YYYY-MM-DD in IST regardless of server timezone.
  const offsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}

function todayISTddmmyyyy() {
  // DD-MM-YYYY in IST — preNotify.txnDate format (differs from the YYYY-MM-DD dates).
  const [y, m, d] = todayIST().split("-");
  return `${d}-${m}-${y}`;
}

function plusOneYear(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeAmount(amount, minRupees = 2) {
  // Two-decimal currency normalization, integer-paise rounding to avoid
  // binary-float drift. Returns a string (Paytm subscription `txnAmount.value`
  // contract).
  const n = Number(String(amount ?? "").trim());
  if (!Number.isFinite(n) || n < minRupees) return minRupees.toFixed(2);
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2);
}

export async function createSubscription({
  amount,                           // first-debit amount (string/number, ≥ ₹2 for cross-rail)
  renewalAmount,                    // optional; only set if you want a different recurring amount
  custId,
  mobile,
  email,
  firstName,
  lastName,
  frequency = "1",                  // number of units per cycle
  frequencyUnit = "MONTH",          // DAY | WEEK | MONTH | YEAR | ONDEMAND
  amountType = "FIX",               // FIX | VARIABLE (VARIABLE requires subscriptionMaxAmount)
  maxAmount,                        // required when amountType === "VARIABLE"
  startDate,                        // YYYY-MM-DD; defaults to today
  expiryDate,                       // YYYY-MM-DD; defaults to startDate + 1 year
  graceDays = "3",
  paymentMode = "UPI",              // UPI (default) | CC | DC | BANK_MANDATE | UNKNOWN
                                    // "UNKNOWN" can render an empty checkout on some prod MIDs.
                                    // Note: UPI accepts only WEEK/MONTH/YEAR frequency units (not DAY).
  mandateType,                      // E_MANDATE | PAPER_MANDATE - only with BANK_MANDATE
  orderId: callerOrderId,
  serverBaseUrl,
}) {
  const cfg = getPaytmConfig();
  if (!cfg.mid) throw asError("MISSING_MID", "Missing PAYTM_MID");
  if (!cfg.merchantKey) throw asError("MISSING_MERCHANT_KEY", "Missing PAYTM_MERCHANT_KEY");

  const orderId = callerOrderId?.trim()
    || `SUB_${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
  const traceId = `TRC_${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
  const start = startDate?.trim() || todayIST();
  const expiry = expiryDate?.trim() || plusOneYear(start);
  const callbackUrl = cfg.callbackUrl?.trim()
    || `${(serverBaseUrl || cfg.callbackBase).replace(/\/+$/, "")}/paytm/callback`;

  const body = {
    requestType: "NATIVE_SUBSCRIPTION",
    mid: cfg.mid,
    orderId,
    websiteName: cfg.websiteName,
    txnAmount: { value: normalizeAmount(amount), currency: "INR" },
    subscriptionPaymentMode: paymentMode,
    subscriptionAmountType: amountType,
    subscriptionFrequency: String(frequency),
    subscriptionFrequencyUnit: frequencyUnit,
    subscriptionStartDate: start,
    subscriptionExpiryDate: expiry,
    subscriptionGraceDays: String(graceDays),
    subscriptionEnableRetry: "0",
    userInfo: {
      custId: sanitizeCustId(custId),
      ...(mobile?.trim() ? { mobile: mobile.trim() } : {}),
      ...(email?.trim() ? { email: email.trim() } : {}),
      ...(firstName?.trim() ? { firstName: firstName.trim() } : {}),
      ...(lastName?.trim() ? { lastName: lastName.trim() } : {}),
    },
    callbackUrl,
  };
  if (amountType === "VARIABLE") {
    if (!maxAmount) throw asError("MISSING_MAX_AMOUNT", "subscriptionMaxAmount required for VARIABLE amount type");
    body.subscriptionMaxAmount = normalizeAmount(maxAmount);
  } else if (maxAmount) {
    body.subscriptionMaxAmount = normalizeAmount(maxAmount);
  }
  if (renewalAmount) body.renewalAmount = normalizeAmount(renewalAmount);
  if (paymentMode === "BANK_MANDATE") {
    body.mandateType = mandateType || "E_MANDATE";
  }

  const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), cfg.merchantKey);
  const head = {
    clientId: cfg.clientId,
    channelId: "WEB",
    version: "v1",
    requestTimestamp: String(Date.now()),
    signature,
  };

  const url = new URL(cfg.subscriptionCreateUrl);
  url.searchParams.set("mid", cfg.mid);
  url.searchParams.set("orderId", orderId);
  url.searchParams.set("traceId", traceId);

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ head, body }),
  });
  const text = await r.text();
  if (!r.ok) throw upstream("SUBSCRIPTION_HTTP_ERROR", `subscription/create HTTP ${r.status}`, orderId, text);

  const json = JSON.parse(text);
  const status = json?.body?.resultInfo?.resultStatus;
  if (status !== "S") {
    throw upstream("SUBSCRIPTION_FAILED", json?.body?.resultInfo?.resultMsg || "subscription/create failed", orderId, text);
  }
  return {
    orderId,
    traceId,
    txnToken: json?.body?.txnToken,
    subscriptionId: json?.body?.subscriptionId,
    amount: body.txnAmount.value,
    mid: cfg.mid,
    tokenType: "TXN_TOKEN",
  };
}

function asError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function upstream(code, message, orderId, raw) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = 502;
  e.orderId = orderId;
  try {
    const info = JSON.parse(raw)?.body?.resultInfo;
    if (info) e.paytm = { resultStatus: info.resultStatus, resultCode: info.resultCode, resultMsg: info.resultMsg };
  } catch {}
  return e;
}

// ---------------------------------------------------------------------------
// Post-consent recurring lifecycle.
//
// IMPORTANT host split: subscription/create is the ONLY endpoint on the
// /theia/api/v1 prefix (and only on production). EVERY management API below
// lives on the NON-/theia/ host on BOTH environments — see paytmConfig.js.
// Reusing cfg.subscriptionCreateUrl for these returns 404 / HTML on prod.
//
// The `head` envelope differs per endpoint; each function below sets the
// fields that endpoint actually requires (create's head does NOT carry over).
// ---------------------------------------------------------------------------

// Signs `body` and POSTs `{ head, body }` to `url`. `headExtra` carries the
// per-endpoint head fields (e.g. { tokenType: "AES" }).
async function postSigned(url, body, headExtra, cfg) {
  const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), cfg.merchantKey);
  const head = { ...headExtra, signature };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ head, body }),
  });
  const text = await r.text();
  if (!r.ok) throw upstream("SUBSCRIPTION_HTTP_ERROR", `${url} HTTP ${r.status}`, body.orderId, text);
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON (HTML) body almost always means the wrong host/prefix was used.
    throw upstream("SUBSCRIPTION_NON_JSON", `${url} returned non-JSON (wrong host/prefix?)`, body.orderId, text);
  }
}

// POST /subscription/checkStatus — the only reliable cancel/expiry signal.
// head: tokenType "AES" + signature. Identify by subsId (or orderId+custId).
// Returns { status, subStatus, ... } — read subStatus to interpret a REJECT.
export async function checkSubscriptionStatus({ subsId, orderId, custId } = {}) {
  const cfg = getPaytmConfig();
  const body = { mid: cfg.mid };
  if (subsId) body.subsId = subsId;
  if (orderId) body.orderId = orderId;
  if (custId) body.custId = sanitizeCustId(custId);
  const json = await postSigned(cfg.subscriptionCheckStatusUrl, body, { tokenType: "AES" }, cfg);
  const b = json?.body || {};
  return {
    subsId: b.subsId,
    status: b.status,
    subStatus: b.subStatus,
    lastOrderStatus: b.lastOrderStatus,
    expiryDate: b.expiryDate,
    // A cancelled mandate is status:"REJECT" + subStatus:MERCHANT_CANCELLED/USER_CANCELLED.
    cancelled: b.status === "REJECT" && /CANCELLED$/.test(b.subStatus || ""),
    active: b.status === "ACTIVE" && b.subStatus === "ACTIVE",
    raw: b,
  };
}

// POST /subscription/renew — trigger one recurring debit. head: bare signature.
// mid + orderId MUST also be in the query string (else 1007 / 2014). A successful
// preNotify must precede renew, else renew returns 3054.
// Use a fresh orderId per debit, then confirm with getOrderStatus(orderId).
export async function renewSubscription({ subscriptionId, amount, orderId: callerOrderId }) {
  const cfg = getPaytmConfig();
  const orderId = callerOrderId?.trim()
    || `RENEW_${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  const body = {
    mid: cfg.mid,
    subscriptionId,
    orderId,
    txnAmount: { value: normalizeAmount(amount), currency: "INR" },
  };
  const url = new URL(cfg.subscriptionRenewUrl);
  url.searchParams.set("mid", cfg.mid);
  url.searchParams.set("orderId", orderId);
  const json = await postSigned(url.toString(), body, {}, cfg);
  return { orderId, raw: json?.body || json };
}

// POST /subscription/preNotify — NPCI pre-debit notice. You MUST call this
// before every debit; Paytm does not auto-handle it. head: tokenType "AES" + signature.
// Field quirks (live prod): txnAmount is a FLAT STRING (not {value,currency});
// txnDate = today in DD-MM-YYYY; subsId + referenceId = subscriptionId; txnMessage /
// merchantName / merchantLogoUrl required. Call within 1–7 days before the billing date.
export async function preNotifySubscription({
  subscriptionId, amount, orderId: callerOrderId,
  scheduledExecutionDate,           // billing date, YYYY-MM-DD
  txnMessage = "Subscription renewal",
  merchantName = "Subscription",
  merchantLogoUrl = "",
}) {
  const cfg = getPaytmConfig();
  const orderId = callerOrderId?.trim()
    || `PRENOTIFY_${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  const body = {
    mid: cfg.mid,
    subscriptionId,
    subsId: subscriptionId,
    referenceId: subscriptionId,
    orderId,
    txnAmount: normalizeAmount(amount),   // flat string, NOT an object
    txnDate: todayISTddmmyyyy(),          // today, DD-MM-YYYY
    txnMessage,
    merchantName,
    merchantLogoUrl,
  };
  if (scheduledExecutionDate) body.subscriptionScheduledExecutionDate = scheduledExecutionDate;
  const json = await postSigned(cfg.subscriptionPreNotifyUrl, body, { tokenType: "AES" }, cfg);
  return { orderId, raw: json?.body || json };
}

// POST /subscription/preNotify/status. head: clientId + tokenType "AES" + version + signature.
export async function preNotifyStatus({ subscriptionId, orderId }) {
  const cfg = getPaytmConfig();
  const body = { mid: cfg.mid, subscriptionId, orderId };
  const json = await postSigned(
    cfg.subscriptionPreNotifyStatusUrl,
    body,
    { clientId: cfg.clientId, version: "v1", tokenType: "AES" },
    cfg,
  );
  return json?.body || json;
}

// POST /subscription/cancel — terminal. head: signature + tokenType "AES".
// subscriptionId must also be in the query string; subsId (same value) required in body
// (else 400 "Subscription Id field can not be empty").
export async function cancelSubscription({ subscriptionId }) {
  const cfg = getPaytmConfig();
  const body = { mid: cfg.mid, subscriptionId, subsId: subscriptionId };
  const url = new URL(cfg.subscriptionCancelUrl);
  url.searchParams.set("mid", cfg.mid);
  url.searchParams.set("subscriptionId", subscriptionId);
  const json = await postSigned(url.toString(), body, { tokenType: "AES" }, cfg);
  return json?.body || json;
}

// POST /v3/order/status — per-charge transaction status (NOT mandate state).
// head: bare signature. Same host on both envs (non-/theia/, non-versioned).
export async function getOrderStatus({ orderId }) {
  const cfg = getPaytmConfig();
  const body = { mid: cfg.mid, orderId };
  const json = await postSigned(cfg.orderStatusUrl, body, {}, cfg);
  return json?.body || json;
}
