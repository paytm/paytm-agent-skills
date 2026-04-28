package com.paytm.demo.config;

import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

/**
 * Paytm merchant configuration.
 *
 * Defaults point to Production PG; set PAYTM_PG_DOMAIN or PAYTM_ENVIRONMENT=staging to change.
 * No QA credentials are embedded; MID + merchant key must be provided via env/system properties.
 */
public final class PaytmMerchantConfig {

  private PaytmMerchantConfig() {
  }

  private static final Properties APP_PROPS = loadApplicationProperties();

  private static Properties loadApplicationProperties() {
    Properties p = new Properties();
    try (InputStream in = PaytmMerchantConfig.class.getClassLoader().getResourceAsStream("application.properties")) {
      if (in != null) {
        p.load(in);
      }
    } catch (Exception ignored) {
      // Optional; env vars / system properties can be used instead.
    }
    return p;
  }

  private static String fromProps(String... keys) {
    for (String k : keys) {
      String v = APP_PROPS.getProperty(k);
      if (v != null && !v.trim().isEmpty()) {
        return v.trim();
      }
    }
    return null;
  }

  public static final String WEBSITE_NAME = "retail";
  public static final String CHANNEL_ID = "WEB";

  public static final String PROD_PG_DOMAIN = "https://secure.paytmpayments.com";
  public static final String STAGING_PG_DOMAIN = "https://securestage.paytmpayments.com";

  /**
   * Merchant MID.
   * Override with system property {@code paytm.mid} or env {@code PAYTM_MID}.
   */
  public static String mid() {
    String fromSys = System.getProperty("paytm.mid");
    if (fromSys != null && !fromSys.isEmpty()) {
      return fromSys.trim();
    }
    String fromEnv = System.getenv("PAYTM_MID");
    if (fromEnv != null && !fromEnv.isEmpty()) {
      return fromEnv.trim();
    }
    String fromProps = fromProps("PAYTM_MID", "paytm.mid");
    if (fromProps != null) {
      return fromProps;
    }
    throw new IllegalStateException("Missing MID. Set PAYTM_MID or -Dpaytm.mid");
  }

  /**
   * Merchant key (required for checksum generation/verification).
   * Override with system property {@code paytm.merchant.key} or env {@code PAYTM_MERCHANT_KEY}.
   */
  public static String merchantKey() {
    String fromSys = System.getProperty("paytm.merchant.key");
    if (fromSys != null && !fromSys.isEmpty()) {
      return fromSys.trim();
    }
    String fromEnv = System.getenv("PAYTM_MERCHANT_KEY");
    if (fromEnv != null && !fromEnv.isEmpty()) {
      return fromEnv.trim();
    }
    String fromProps = fromProps("PAYTM_MERCHANT_KEY", "paytm.merchant.key");
    if (fromProps != null) {
      return fromProps;
    }
    throw new IllegalStateException("Missing merchant key. Set PAYTM_MERCHANT_KEY or -Dpaytm.merchant.key");
  }

  /**
   * Full callback URL that Paytm will call after payment attempt.
   * Override with system property {@code paytm.callback.url} or env {@code PAYTM_CALLBACK_URL}.
   */
  public static String callbackUrl() {
    String fromSys = System.getProperty("paytm.callback.url");
    if (fromSys != null && !fromSys.isEmpty()) {
      return fromSys.trim();
    }
    String fromEnv = System.getenv("PAYTM_CALLBACK_URL");
    if (fromEnv != null && !fromEnv.isEmpty()) {
      return fromEnv.trim();
    }
    String fromProps = fromProps("PAYTM_CALLBACK_URL", "paytm.callback.url");
    if (fromProps != null) {
      return fromProps;
    }
    return callbackBaseUrl() + "/paytm/callback";
  }

  /**
   * PG domain / host for Paytm APIs + CheckoutJS loader.
   * Defaults to Production {@code https://secure.paytmpayments.com}. Override via {@code paytm.pg.domain} /
   * {@code PAYTM_PG_DOMAIN} or set {@code PAYTM_ENVIRONMENT=staging}.
   */
  public static String pgDomain() {
    String fromSys = System.getProperty("paytm.pg.domain");
    if (fromSys != null && !fromSys.isEmpty()) {
      return trimTrailingSlash(fromSys);
    }
    String fromEnv = System.getenv("PAYTM_PG_DOMAIN");
    if (fromEnv != null && !fromEnv.isEmpty()) {
      return trimTrailingSlash(fromEnv);
    }
    String env = System.getenv("PAYTM_ENVIRONMENT");
    if (env != null && env.trim().equalsIgnoreCase("staging")) {
      return STAGING_PG_DOMAIN;
    }
    String fromProps = fromProps("PAYTM_PG_DOMAIN", "paytm.pg.domain");
    if (fromProps != null) {
      return trimTrailingSlash(fromProps);
    }
    return PROD_PG_DOMAIN;
  }

  /**
   * CheckoutJS loader URL for the configured MID (QA: {@code pgp-qa12} only).
   *
   * @see <a href="https://www.paytmpayments.com/docs/jscheckout-invoke-payment">Invoke Payment Page</a>
   */
  public static String checkoutJsLoaderUrl() {
    return pgDomain() + "/merchantpgpui/checkoutjs/merchants/"
        + URLEncoder.encode(mid(), StandardCharsets.UTF_8) + ".js";
  }

  /**
   * Transaction Status API on the same PG host as {@link #pgDomain()} ({@code /v3/order/status}).
   * Override with {@code paytm.status.api.url} or env {@code PAYTM_STATUS_API_URL} for other environments
   * (e.g. {@code https://securestage.paytmpayments.com/v3/order/status} per Paytm docs).
   *
   * @see <a href="https://www.paytmpayments.com/docs/jscheckout-verify-payment">Verify Payment Status</a>
   */
  public static String transactionStatusApiUrl() {
    String fromSys = System.getProperty("paytm.status.api.url");
    if (fromSys != null && !fromSys.isEmpty()) {
      return fromSys.trim();
    }
    String fromEnv = System.getenv("PAYTM_STATUS_API_URL");
    if (fromEnv != null && !fromEnv.isEmpty()) {
      return fromEnv.trim();
    }
    return pgDomain() + "/v3/order/status";
  }

  /**
   * Public base URL of this WAR (no trailing slash), used in callbackUrl.
   * Override with system property {@code paytm.callback.base} or env {@code PAYTM_CALLBACK_BASE}.
   */
  public static String callbackBaseUrl() {
    String fromSys = System.getProperty("paytm.callback.base");
    if (fromSys != null && !fromSys.isEmpty()) {
      return trimTrailingSlash(fromSys);
    }
    String fromEnv = System.getenv("PAYTM_CALLBACK_BASE");
    if (fromEnv != null && !fromEnv.isEmpty()) {
      return trimTrailingSlash(fromEnv);
    }
    return "http://localhost:8080/paytm-backend";
  }

  private static String trimTrailingSlash(String u) {
    if (u.endsWith("/")) {
      return u.substring(0, u.length() - 1);
    }
    return u;
  }
}
