package com.paytm.sample.razorpay;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;

/**
 * REST endpoints for the Razorpay -> Paytm dual-write canary.
 *
 * Mount under your normal API prefix (this sample uses /api/migration/...).
 */
@RestController
@RequestMapping("/api/migration")
public class RazorpayMigrationController {

    private final DualWriteService dualWrite;

    @Value("${migration.canaryPct:0}")
    private int canaryPct;

    public RazorpayMigrationController(DualWriteService dualWrite) {
        this.dualWrite = dualWrite;
    }

    @PostMapping("/checkout/start")
    public ResponseEntity<?> start(@RequestBody Map<String, Object> req) {
        try {
            String orderId = (String) req.get("orderId");
            String customerId = (String) req.get("customerId");
            Object amountObj = req.get("amount");
            if (orderId == null || customerId == null || amountObj == null) {
                Map<String, Object> err = new HashMap<>();
                err.put("error", "orderId, amount, customerId required");
                return ResponseEntity.badRequest().body(err);
            }
            BigDecimal amount = new BigDecimal(amountObj.toString());
            return ResponseEntity.ok(dualWrite.createOrder(orderId, amount, customerId));
        } catch (Exception e) {
            Map<String, Object> err = new HashMap<>();
            err.put("error", e.getMessage());
            return ResponseEntity.internalServerError().body(err);
        }
    }

    @GetMapping("/checkout/which-psp")
    public Map<String, Object> whichPsp(@RequestParam String customerId) {
        Map<String, Object> out = new HashMap<>();
        out.put("customerId", customerId);
        out.put("psp", dualWrite.pickPsp(customerId));
        out.put("canaryPct", canaryPct);
        return out;
    }
}
