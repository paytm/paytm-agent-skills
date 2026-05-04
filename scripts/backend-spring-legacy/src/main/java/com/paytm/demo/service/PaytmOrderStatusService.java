package com.paytm.demo.service;

import com.paytm.demo.config.PaytmMerchantConfig;
import com.paytm.pg.merchant.PaytmChecksum;
import org.json.JSONObject;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Transaction Status API per Paytm JS Checkout "Verify Payment Status":
 * https://www.paytmpayments.com/docs/jscheckout-verify-payment
 */
@Service
public class PaytmOrderStatusService {

  private final RestTemplate restTemplate;

  public PaytmOrderStatusService(RestTemplate restTemplate) {
    this.restTemplate = restTemplate;
  }

  public String fetchOrderStatusJson(String orderId) throws Exception {
    JSONObject body = new JSONObject();
    body.put("mid", PaytmMerchantConfig.mid());
    body.put("orderId", orderId);

    String checksum = PaytmChecksum.generateSignature(body.toString(), PaytmMerchantConfig.merchantKey());

    JSONObject head = new JSONObject();
    head.put("signature", checksum);

    JSONObject paytmParams = new JSONObject();
    paytmParams.put("body", body);
    paytmParams.put("head", head);

    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    HttpEntity<String> entity = new HttpEntity<>(paytmParams.toString(), headers);

    ResponseEntity<String> response =
        restTemplate.postForEntity(PaytmMerchantConfig.transactionStatusApiUrl(), entity, String.class);
    return response.getBody();
  }
}
