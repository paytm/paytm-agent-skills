// Create Payment Link — POST /link/create
// Doc: https://www.paytmpayments.com/docs/api/create-link-api
// Defaults & gotchas baked in:
//   - head requires tokenType: "AES" + timestamp (Unix epoch SECONDS as string)
//   - linkType: "FIXED" by default (GENERIC ignores amount)
//   - amount is a JSON number, NOT a string
//   - linkDescription must be ≥ 3 chars, alphanumerics + spaces only
//   - customer details nested under customerContact (not top-level)
//   - expiryDate format DD/MM/YYYY HH:MM:SS (most MIDs)
//   - Wallet (PPI / BALANCE) suppressed via disablePaymentMode
import crypto from "node:crypto";
import PaytmChecksum from "paytmchecksum";
import { getPaytmConfig } from "./paytmConfig.js";

function sanitizeDescription(s, fallback = "Invoice payment") {
  // Alphanumerics + spaces only; collapse to fallback if empty / too short.
  const cleaned = String(s ?? "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 ? cleaned : fallback;
}

function expiryOneYearFromNow() {
  // DD/MM/YYYY HH:MM:SS in IST
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const d = new Date(Date.now() + offsetMs + 365 * 24 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} 23:59:59`;
}

function normalizeAmount(amount) {
  // Payment Link API takes amount as a JSON number, two-decimal precision.
  const n = Number(String(amount ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 1.00;
  return Number(n.toFixed(2));
}

export async function createPaymentLink({
  amount,
  linkName,
  linkDescription,
  customerName,
  customerEmail,
  customerMobile,
  customerId,
  expiryDate,
  orderId: callerOrderId,
  sendSms = true,
  sendEmail = true,
  callbackUrl: callerCallback,
  merchantUniqueReference,
  serverBaseUrl,
}) {
  const cfg = getPaytmConfig();
  if (!cfg.mid) throw asError("MISSING_MID", "Missing PAYTM_MID");
  if (!cfg.merchantKey) throw asError("MISSING_MERCHANT_KEY", "Missing PAYTM_MERCHANT_KEY");

  const orderId = callerOrderId?.trim()
    || `LNK_${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
  const callbackUrl = callerCallback?.trim() || cfg.callbackUrl?.trim()
    || `${(serverBaseUrl || cfg.callbackBase).replace(/\/+$/, "")}/paytm/callback`;

  const body = {
    mid: cfg.mid,
    linkType: "FIXED",
    linkName: sanitizeDescription(linkName, "Invoice"),
    linkDescription: sanitizeDescription(linkDescription, "Invoice payment"),
    amount: normalizeAmount(amount),
    sendSms: !!sendSms,
    sendEmail: !!sendEmail,
    customerContact: {
      ...(customerName?.trim() ? { customerName: customerName.trim() } : {}),
      ...(customerEmail?.trim() ? { customerEmail: customerEmail.trim() } : {}),
      ...(customerMobile?.trim() ? { customerMobile: customerMobile.trim() } : {}),
      ...(customerId?.trim() ? { customerId: customerId.trim() } : {}),
    },
    expiryDate: expiryDate?.trim() || expiryOneYearFromNow(),
    orderId,
    callbackUrl,
    ...(merchantUniqueReference?.trim() ? { merchantUniqueReference: merchantUniqueReference.trim() } : {}),
    // Wallet (PPI / BALANCE) is permanently excluded from this skill's scope.
    disablePaymentMode: [{ mode: "PPI" }, { mode: "BALANCE" }],
  };

  const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), cfg.merchantKey);
  const head = {
    tokenType: "AES",
    signature,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };

  const r = await fetch(cfg.linkCreateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ head, body }),
  });
  const text = await r.text();
  if (!r.ok) throw upstream("LINK_HTTP_ERROR", `link/create HTTP ${r.status}`, orderId, text);

  const json = JSON.parse(text);
  const status = json?.body?.resultInfo?.resultStatus;
  if (status && status !== "SUCCESS" && status !== "S") {
    throw upstream("LINK_FAILED", json?.body?.resultInfo?.resultMsg || "link/create failed", orderId, text);
  }
  // Read defensively — current Paytm returns linkId; older docs LinkID.
  const linkId = json?.body?.linkId ?? json?.body?.LinkID;

  return {
    orderId,
    linkId,
    shortUrl: json?.body?.shortUrl,
    longUrl: json?.body?.longUrl,
    linkStatus: json?.body?.linkStatus || "ACTIVE",
    amount: body.amount,
    mid: cfg.mid,
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
