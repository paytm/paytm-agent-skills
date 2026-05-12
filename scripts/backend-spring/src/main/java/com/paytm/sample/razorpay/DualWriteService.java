package com.paytm.sample.razorpay;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.paytm.pg.merchant.PaytmChecksum;
import com.razorpay.Order;
import com.razorpay.RazorpayClient;
import com.razorpay.RazorpayException;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/**
 * Dual-write canary routing between Razorpay and Paytm.
 *
 * Sticky hashing on customerId pins a given customer to one PSP within the
 * canary window. CANARY_PCT is read on every call so rollout can happen via
 * config change, no redeploy.
 */
@Service
public class DualWriteService {

    private final ObjectMapper mapper = new ObjectMapper();
    private final RestTemplate http = new RestTemplate();

    @Value("${razorpay.keyId}") private String razorpayKeyId;
    @Value("${razorpay.keySecret}") private String razorpayKeySecret;

    @Value("${paytm.mid}") private String paytmMid;
    @Value("${paytm.merchantKey}") private String paytmMerchantKey;
    @Value("${paytm.websiteName:WEBSTAGING}") private String paytmWebsiteName;
    @Value("${paytm.environment:staging}") private String paytmEnvironment;
    @Value("${paytm.callbackUrl}") private String paytmCallbackUrl;

    @Value("${migration.canaryPct:0}") private int canaryPct;

    public String pickPsp(String customerId) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(customerId.getBytes(StandardCharsets.UTF_8));
            int bucket = ((h[0] & 0xFF) << 24 | (h[1] & 0xFF) << 16 | (h[2] & 0xFF) << 8 | (h[3] & 0xFF));
            bucket = Math.floorMod(bucket, 100);
            return bucket < canaryPct ? "paytm" : "razorpay";
        } catch (Exception e) {
            return "razorpay"; // safe default
        }
    }

    public Map<String, Object> createOrder(String orderId, BigDecimal amount, String customerId) throws Exception {
        String psp = pickPsp(customerId);
        Map<String, Object> result = "paytm".equals(psp)
                ? createPaytmOrder(orderId, amount, customerId)
                : createRazorpayOrder(orderId, amount, customerId);
        result.put("pspRouted", psp);
        return result;
    }

    private Map<String, Object> createRazorpayOrder(String orderId, BigDecimal amount, String customerId) throws RazorpayException {
        RazorpayClient client = new RazorpayClient(razorpayKeyId, razorpayKeySecret);
        long paise = amount.multiply(new BigDecimal(100)).setScale(0, RoundingMode.HALF_UP).longValueExact();
        JSONObject body = new JSONObject();
        body.put("amount", paise);
        body.put("currency", "INR");
        body.put("receipt", orderId);
        JSONObject notes = new JSONObject();
        notes.put("customer_id", customerId);
        body.put("notes", notes);
        Order order = client.orders.create(body);

        Map<String, Object> client_payload = new HashMap<>();
        client_payload.put("key", razorpayKeyId);
        client_payload.put("order_id", order.get("id"));
        client_payload.put("amount", order.get("amount"));

        Map<String, Object> out = new HashMap<>();
        out.put("psp", "razorpay");
        out.put("pspOrderId", order.get("id"));
        out.put("clientPayload", client_payload);
        return out;
    }

    private Map<String, Object> createPaytmOrder(String orderId, BigDecimal amount, String customerId) throws Exception {
        String value = amount.setScale(2, RoundingMode.HALF_UP).toPlainString();
        String safeCustId = customerId.replaceAll("[^A-Za-z0-9_@-]", "_");

        ObjectNode body = mapper.createObjectNode();
        body.put("requestType", "Payment");
        body.put("mid", paytmMid);
        body.put("websiteName", paytmWebsiteName);
        body.put("orderId", orderId);
        body.put("callbackUrl", paytmCallbackUrl);
        ObjectNode txn = body.putObject("txnAmount");
        txn.put("value", value);
        txn.put("currency", "INR");
        body.putObject("userInfo").put("custId", safeCustId);

        String bodyJson = mapper.writeValueAsString(body);
        String signature = PaytmChecksum.generateSignature(bodyJson, paytmMerchantKey);

        ObjectNode envelope = mapper.createObjectNode();
        envelope.putObject("head").put("signature", signature);
        envelope.set("body", body);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<String> req = new HttpEntity<>(mapper.writeValueAsString(envelope), headers);

        String base = "production".equals(paytmEnvironment)
                ? "https://secure.paytmpayments.com"
                : "https://securestage.paytmpayments.com";
        String url = base + "/theia/api/v1/initiateTransaction?mid=" + paytmMid + "&orderId=" + orderId;
        String response = http.postForObject(url, req, String.class);
        JsonNode root = mapper.readTree(response);
        JsonNode tokenNode = root.path("body").path("txnToken");
        if (tokenNode.isMissingNode() || tokenNode.asText().isEmpty()) {
            String msg = root.path("body").path("resultInfo").path("resultMsg").asText("no token");
            throw new RuntimeException("Paytm initiate failed: " + msg);
        }

        Map<String, Object> client_payload = new HashMap<>();
        client_payload.put("mid", paytmMid);
        client_payload.put("orderId", orderId);
        client_payload.put("txnToken", tokenNode.asText());
        client_payload.put("amount", value);

        Map<String, Object> out = new HashMap<>();
        out.put("psp", "paytm");
        out.put("pspOrderId", orderId);
        out.put("txnToken", tokenNode.asText());
        out.put("clientPayload", client_payload);
        return out;
    }
}
