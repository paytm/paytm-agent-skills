package com.paytm.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.paytm.demo.config.PaytmMerchantConfig;
import com.paytm.demo.web.PaytmUpstreamException;
import com.paytm.pg.merchant.PaytmChecksum;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONObject;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class PaytmInitiateTransactionService {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final RestTemplate restTemplate;

  public PaytmInitiateTransactionService(RestTemplate restTemplate) {
    this.restTemplate = restTemplate;
  }

  public InitiateResult initiate(String amount, String custId) throws Exception {
    String orderId = "ORD_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
    String normalizedAmount = normalizeAmount(amount);

    JSONObject body = new JSONObject();
    body.put("requestType", "Payment");
    body.put("mid", PaytmMerchantConfig.mid());
    body.put("websiteName", PaytmMerchantConfig.WEBSITE_NAME);
    body.put("orderId", orderId);
    body.put("callbackUrl", PaytmMerchantConfig.callbackUrl());

    JSONObject txnAmount = new JSONObject();
    txnAmount.put("value", normalizedAmount);
    txnAmount.put("currency", "INR");
    body.put("txnAmount", txnAmount);

    JSONObject userInfo = new JSONObject();
    userInfo.put("custId", custId != null && !custId.isEmpty() ? custId : "CUST_DEMO");
    body.put("userInfo", userInfo);

    String checksum = PaytmChecksum.generateSignature(body.toString(), PaytmMerchantConfig.merchantKey());

    JSONObject head = new JSONObject();
    head.put("signature", checksum);

    JSONObject paytmParams = new JSONObject();
    paytmParams.put("body", body);
    paytmParams.put("head", head);

    String url = UriComponentsBuilder
        .fromHttpUrl(PaytmMerchantConfig.pgDomain() + "/theia/api/v1/initiateTransaction")
        .queryParam("mid", PaytmMerchantConfig.mid())
        .queryParam("orderId", orderId)
        .toUriString();

    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    HttpEntity<String> entity = new HttpEntity<>(paytmParams.toString(), headers);

    ResponseEntity<String> response;
    String responseBody;
    try {
      response = restTemplate.postForEntity(url, entity, String.class);
      responseBody = response.getBody();
    } catch (RestClientResponseException e) {
      responseBody = e.getResponseBodyAsString();
      throw asUpstreamError("INITIATE_HTTP_ERROR", "initiateTransaction failed (HTTP " + e.getRawStatusCode() + ")",
          orderId, responseBody, HttpStatus.BAD_GATEWAY);
    }

    JsonNode root = MAPPER.readTree(responseBody);
    JsonNode resultInfo = root.path("body").path("resultInfo");
    String status = resultInfo.path("resultStatus").asText("");
    if (!"S".equals(status)) {
      String msg = resultInfo.path("resultMsg").asText("initiateTransaction failed");
      throw asUpstreamError("INITIATE_FAILED", msg, orderId, responseBody, HttpStatus.BAD_GATEWAY);
    }
    String txnToken = root.path("body").path("txnToken").asText(null);
    if (txnToken == null || txnToken.isEmpty()) {
      throw asUpstreamError("MISSING_TXN_TOKEN", "Missing txnToken in Paytm response", orderId, responseBody,
          HttpStatus.BAD_GATEWAY);
    }
    return new InitiateResult(orderId, txnToken, normalizedAmount, PaytmMerchantConfig.mid());
  }

  private static String normalizeAmount(String amount) {
    if (amount == null || amount.isEmpty()) {
      return "1.00";
    }
    try {
      double v = Double.parseDouble(amount);
      if (!Double.isFinite(v) || v <= 0) {
        throw new IllegalArgumentException("amount must be a positive number");
      }
      return String.format(java.util.Locale.US, "%.2f", v);
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("amount must be a valid number (e.g. 1.00)");
    }
  }

  private static PaytmUpstreamException asUpstreamError(
      String code, String message, String orderId, String paytmResponseBody, HttpStatus httpStatus) {
    Map<String, Object> paytm = new LinkedHashMap<>();
    try {
      if (paytmResponseBody != null && !paytmResponseBody.isEmpty()) {
        JsonNode root = MAPPER.readTree(paytmResponseBody);
        JsonNode info = root.path("body").path("resultInfo");
        String resultStatus = info.path("resultStatus").asText("");
        String resultCode = info.path("resultCode").asText("");
        String resultMsg = info.path("resultMsg").asText("");
        if (!resultStatus.isEmpty()) paytm.put("resultStatus", resultStatus);
        if (!resultCode.isEmpty()) paytm.put("resultCode", resultCode);
        if (!resultMsg.isEmpty()) paytm.put("resultMsg", resultMsg);
      }
    } catch (Exception ignored) {
      // Best-effort parsing; never throw from error building.
    }
    return new PaytmUpstreamException(httpStatus, code, message, orderId, paytm.isEmpty() ? null : paytm);
  }

  public static final class InitiateResult {
    public final String orderId;
    public final String txnToken;
    public final String amount;
    public final String mid;

    public InitiateResult(String orderId, String txnToken, String amount, String mid) {
      this.orderId = orderId;
      this.txnToken = txnToken;
      this.amount = amount;
      this.mid = mid;
    }
  }
}
