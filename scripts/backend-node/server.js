#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOrderStatus, initiateTransaction, verifyCallbackChecksum } from "./paytmService.js";
import { getPaytmConfig } from "./paytmConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function requestBase(req) {
  const protoRaw = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
  const hostRaw = (req.headers["x-forwarded-host"] || req.headers.host || "localhost").toString();
  const proto = protoRaw.split(",")[0].trim();
  const host = hostRaw.split(",")[0].trim();
  return `${proto}://${host}`;
}

app.get("/paytm-client-config.json", (req, res) => {
  const cfg = getPaytmConfig();
  res.json({
    mid: cfg.mid,
    api_host: cfg.pgDomain,
    loader_url: cfg.checkoutJsLoaderUrl,
  });
});

app.post("/paytm/create-order", async (req, res) => {
  try {
    const { amount, custId } = req.body ?? {};
    const out = await initiateTransaction({ amount, custId, serverBaseUrl: requestBase(req) });
    res.json(out);
  } catch (e) {
    const httpStatus = Number(e?.httpStatus) || 500;
    const out = { error: true, code: e?.code || "INTERNAL_ERROR", message: e?.message || String(e) };
    if (e?.orderId) out.orderId = e.orderId;
    if (e?.paytm) out.paytm = e.paytm;
    res.status(httpStatus).json(out);
  }
});

app.post("/paytm/order-status", async (req, res) => {
  try {
    const orderId = req.body?.orderId;
    if (!orderId) return res.status(400).json({ error: true, message: "orderId required" });
    const json = await fetchOrderStatus({ orderId });
    res.type("application/json").send(json);
  } catch (e) {
    res.status(500).json({ error: true, message: e?.message || String(e) });
  }
});

function callbackHtml(params, checksumOk) {
  const lines = Object.entries(params || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`).join("\n");
  return [
    "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Paytm callback</title></head><body>",
    "<h1>Paytm callback</h1>",
    `<p><strong>CHECKSUMHASH validation:</strong> ${checksumOk ? "OK (signature verified)" : "FAILED or CHECKSUMHASH missing — do not treat as paid"}</p>`,
    "<p>Also verify via Transaction Status API (or webhook) before confirming an order.</p>",
    `<pre>${lines}</pre>`,
    "</body></html>",
  ].join("");
}

app.post("/paytm/callback", (req, res) => {
  const params = req.body ?? {};
  const ok = verifyCallbackChecksum(params);
  res.type("text/html").send(callbackHtml(params, ok));
});

app.get("/paytm/callback", (req, res) => {
  const params = req.query ?? {};
  const ok = verifyCallbackChecksum(params);
  res.type("text/html").send(callbackHtml(params, ok));
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Node backend running at http://localhost:${PORT}`);
});
