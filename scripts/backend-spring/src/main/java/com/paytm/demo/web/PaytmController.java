package com.paytm.demo.web;

import com.paytm.demo.service.PaytmInitiateTransactionService;
import com.paytm.demo.service.PaytmInitiateTransactionService.InitiateResult;
import com.paytm.demo.service.PaytmOrderStatusService;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
@RequestMapping("/paytm")
public class PaytmController {

  private final PaytmInitiateTransactionService initiateService;
  private final PaytmOrderStatusService orderStatusService;

  public PaytmController(PaytmInitiateTransactionService initiateService, PaytmOrderStatusService orderStatusService) {
    this.initiateService = initiateService;
    this.orderStatusService = orderStatusService;
  }

  /**
   * initiateTransaction → txnToken (JSON for the HTML demo).
   */
  @PostMapping(value = "/create-order", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
  @ResponseBody
  public ResponseEntity<Map<String, Object>> createOrder(@RequestBody(required = false) Map<String, String> body) {
    Map<String, String> safe = body != null ? body : Collections.emptyMap();
    String amount = safe.get("amount");
    String custId = safe.get("custId");
    InitiateResult r;
    try {
      r = initiateService.initiate(amount, custId);
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new IllegalStateException(e.getMessage(), e);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("orderId", r.orderId);
    out.put("txnToken", r.txnToken);
    out.put("amount", r.amount);
    out.put("mid", r.mid);
    out.put("tokenType", "TXN_TOKEN");
    return ResponseEntity.ok(out);
  }

  /**
   * Transaction Status API (server-side verification) — recommended in JS Checkout docs before fulfilling orders.
   *
   * @see <a href="https://www.paytmpayments.com/docs/jscheckout-verify-payment">Verify Payment Status</a>
   */
  @PostMapping(value = "/order-status", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
  @ResponseBody
  public ResponseEntity<String> orderStatus(@RequestBody Map<String, String> body) throws Exception {
    Map<String, String> safe = body != null ? body : Collections.emptyMap();
    String orderId = safe.get("orderId");
    if (orderId == null || orderId.isEmpty()) {
      return ResponseEntity.badRequest().body("{\"error\":\"orderId required\"}");
    }
    String json = orderStatusService.fetchOrderStatusJson(orderId);
    return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(json);
  }

  /**
   * Paytm browser redirect / POST callback after payment attempt.
   */
  @PostMapping(value = "/callback", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
  public ResponseEntity<String> callbackForm(HttpServletRequest request) {
    return callbackView(request);
  }

  @GetMapping("/callback")
  public ResponseEntity<String> callbackGet(HttpServletRequest request) {
    return callbackView(request);
  }

  private ResponseEntity<String> callbackView(HttpServletRequest request) {
    boolean checksumOk = PaytmCallbackChecksum.verify(request);
    StringBuilder b = new StringBuilder();
    b.append("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Paytm callback</title></head><body>");
    b.append("<h1>Paytm callback</h1>");
    b.append("<p><strong>CHECKSUMHASH validation:</strong> ");
    b.append(checksumOk ? "OK (signature verified)" : "FAILED or CHECKSUMHASH missing — do not treat as paid");
    b.append("</p>");
    b.append("<p>Per <a href=\"https://www.paytmpayments.com/docs/jscheckout-verify-payment\">Verify Payment Status</a>, ");
    b.append("also call Transaction Status API (or webhook) before confirming the order.</p>");
    b.append("<pre>");
    request.getParameterMap().forEach((k, v) -> b.append(k).append("=").append(String.join(",", v)).append('\n'));
    b.append("</pre></body></html>");
    return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(b.toString());
  }
}
