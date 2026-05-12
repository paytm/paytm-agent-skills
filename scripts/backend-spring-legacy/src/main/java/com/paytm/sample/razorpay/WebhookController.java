package com.paytm.sample.razorpay;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paytm.pg.merchant.PaytmChecksum;
import javax.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * One webhook endpoint, two verifiers. Detects which PSP sent the request
 * by signature location: header (Razorpay) vs body field (Paytm).
 *
 * Raw body MUST be read here, not via @RequestBody Map - Spring's binding
 * re-serializes and the signature won't match.
 */
@RestController
@RequestMapping("/paytm/webhook")
public class WebhookController {

    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${paytm.merchantKey}") private String paytmMerchantKey;
    @Value("${razorpay.webhookSecret:}") private String razorpayWebhookSecret;

    private final Map<String, Long> seen = new LinkedHashMap<>();
    private static final long TTL_MS = 10 * 60 * 1000L;

    private synchronized boolean dedup(String key) {
        long now = System.currentTimeMillis();
        seen.entrySet().removeIf(e -> now - e.getValue() > TTL_MS);
        if (seen.containsKey(key)) return true;
        seen.put(key, now);
        return false;
    }

    @PostMapping
    public ResponseEntity<String> handle(HttpServletRequest request) throws Exception {
        String rawBody;
        try (var reader = request.getReader()) {
            rawBody = reader.lines().collect(Collectors.joining("\n"));
        }
        JsonNode parsed;
        try {
            parsed = mapper.readTree(rawBody);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("invalid json");
        }

        String razorpaySig = request.getHeader("X-Razorpay-Signature");
        String paytmSig = parsed.path("head").path("signature").asText(null);

        String psp;
        boolean ok;
        String event;
        String dedupKey;

        if (razorpaySig != null && !razorpaySig.isBlank()) {
            psp = "razorpay";
            ok = verifyRazorpay(rawBody, razorpaySig);
            event = parsed.path("event").asText("unknown");
            String evtId = request.getHeader("X-Razorpay-Event-Id");
            dedupKey = "razorpay:" + (evtId != null ? evtId : sha1(rawBody));
        } else if (paytmSig != null && !paytmSig.isBlank()) {
            psp = "paytm";
            ok = PaytmChecksum.verifySignature(rawBody, paytmMerchantKey, paytmSig);
            JsonNode body = parsed.path("body");
            event = body.path("txnType").asText("SALE") + "." + body.path("status").asText("UNKNOWN");
            dedupKey = "REFUND".equals(body.path("txnType").asText(""))
                    ? "paytm:refund:" + body.path("refId").asText() + ":" + body.path("status").asText()
                    : "paytm:" + body.path("orderId").asText() + ":" + body.path("status").asText();
        } else {
            return ResponseEntity.status(401).body("no signature");
        }

        if (!ok) return ResponseEntity.status(401).body("invalid signature");
        if (dedup(dedupKey)) return ResponseEntity.ok("duplicate");

        try {
            fulfill(psp, event, parsed);
            return ResponseEntity.ok("ok");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("retry");
        }
    }

    private boolean verifyRazorpay(String rawBody, String signature) throws Exception {
        if (razorpayWebhookSecret == null || razorpayWebhookSecret.isBlank()) return false;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(razorpayWebhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] hash = mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) sb.append(String.format("%02x", b));
        return MessageDigest.isEqual(sb.toString().getBytes(), signature.getBytes());
    }

    private void fulfill(String psp, String event, JsonNode parsed) {
        if ("razorpay".equals(psp)) {
            JsonNode payment = parsed.path("payload").path("payment").path("entity");
            System.out.printf("[fulfil][razorpay] %s %s %s%n", event,
                    payment.path("order_id").asText(), payment.path("status").asText());
        } else {
            JsonNode body = parsed.path("body");
            if ("REFUND".equals(body.path("txnType").asText())) {
                System.out.printf("[fulfil][paytm][refund] %s %s%n",
                        body.path("refId").asText(), body.path("status").asText());
            } else {
                System.out.printf("[fulfil][paytm] %s %s%n",
                        body.path("orderId").asText(), body.path("status").asText());
            }
        }
    }

    private String sha1(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] h = md.digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(h.length * 2);
        for (byte b : h) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
