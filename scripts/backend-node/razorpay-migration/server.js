/**
 * Minimal Express server wiring the dual-write services.
 * For demo / reference only - in production this lives inside your existing app.
 */

import "dotenv/config";
import express from "express";
import { createOrder, pickPsp } from "./dualWriteService.js";
import { handleWebhook } from "./webhookRouter.js";
import { reconcileOrder } from "./reconciliation.js";

const app = express();

// Webhook FIRST (raw body needed for signature). Don't put express.json() above this.
app.post("/paytm/webhook", express.raw({ type: "*/*" }), handleWebhook);

// JSON body parser for the rest of the app.
app.use(express.json());

// New order - dual-write canary
app.post("/api/checkout/start", async (req, res) => {
  const { orderId, amount, customerId } = req.body || {};
  if (!orderId || !amount || !customerId) {
    return res.status(400).json({ error: "orderId, amount, customerId required" });
  }
  try {
    const result = await createOrder({ orderId, amount: Number(amount), customerId });
    // Persist `psp`, `pspOrderId`, `orderId`, `amount`, `customerId` to your DB here.
    return res.json(result);
  } catch (err) {
    console.error("[checkout/start]", err);
    return res.status(500).json({ error: err.message, pspRouted: err.pspRouted });
  }
});

// Operator endpoint: which PSP would this customer get right now?
app.get("/api/checkout/which-psp", (req, res) => {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: "customerId required" });
  res.json({ customerId, psp: pickPsp(customerId), canaryPct: process.env.CANARY_PCT || "0" });
});

// Operator endpoint: reconcile a single order on demand
app.post("/api/recon/order", async (req, res) => {
  // body: { orderId, psp, pspOrderId, status }
  const result = await reconcileOrder(req.body);
  res.json(result);
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`[razorpay-migration] listening on http://localhost:${PORT}`);
  console.log(`  canary: ${process.env.CANARY_PCT || "0"}% to Paytm`);
});
