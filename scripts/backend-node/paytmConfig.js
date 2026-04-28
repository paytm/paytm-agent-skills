export function getPaytmConfig() {
  const PROD_PG_DOMAIN = "https://secure.paytmpayments.com";
  const STAGING_PG_DOMAIN = "https://securestage.paytmpayments.com";
  const env = (process.env.PAYTM_ENVIRONMENT?.trim() || "production").toLowerCase();
  const defaultPg = env === "staging" ? STAGING_PG_DOMAIN : PROD_PG_DOMAIN;
  const pgDomain = (process.env.PAYTM_PG_DOMAIN?.trim() || defaultPg).replace(/\/+$/, "");

  const mid = process.env.PAYTM_MID?.trim() || "";
  const merchantKey = process.env.PAYTM_MERCHANT_KEY?.trim() || "";
  const websiteName = process.env.PAYTM_WEBSITE_NAME?.trim() || "DEFAULT";
  const callbackBase = (process.env.PAYTM_CALLBACK_BASE?.trim() || "http://localhost:3001").replace(/\/+$/, "");
  // '' unless PAYTM_CALLBACK_URL; actual callback URL = serverBaseUrl + /paytm/callback in paytmService (see create-order)
  const callbackUrl = process.env.PAYTM_CALLBACK_URL?.trim() || "";

  return {
    pgDomain,
    mid,
    merchantKey,
    websiteName,
    callbackBase,
    callbackUrl, // auto-set from serverBaseUrl at runtime when still ''
    initiateTransactionUrl: `${pgDomain}/theia/api/v1/initiateTransaction`,
    orderStatusUrl: process.env.PAYTM_STATUS_API_URL?.trim() || `${pgDomain}/v3/order/status`,
    checkoutJsLoaderUrl: mid
      ? `${pgDomain}/merchantpgpui/checkoutjs/merchants/${encodeURIComponent(mid)}.js`
      : "",
  };
}
