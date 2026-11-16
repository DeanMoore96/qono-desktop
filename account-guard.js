"use strict";

// Routes read from the live qono.net bundle (assets/index-BhiPvuiP.js) on
// 2026-11-16, plus the account/billing paths Dean named so later links are
// caught. No Wix pay host is in the bundle. Checkout leaves the site through
// Stripe or PayPal (create-checkout sets window.location to redirectUrl).
//
// Interactive product routes are an allowlist checked first. Anything on that
// list stays in the app even if a later billing rule would match it.

const IN_APP_ROUTES = [
  "/workspace",
  "/connections",
  "/voices",
  "/instructions",
  "/demonstration",
  "/support",
  "/download",
  "/technical-note",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/mfa",
];

const ACCOUNT_BILLING_ROUTES = [
  "/account",
  "/settings",
  "/profile",
  "/billing",
  "/subscription",
  "/subscriptions",
  "/membership",
  "/members",
  "/pricing",
  "/checkout",
  "/credits",
  "/credit",
  "/payments",
  "/plans",
  "/invoices",
  "/invoice",
  "/dashboard",
  "/_admin",
  "/thank-you",
];

const ACCOUNT_BILLING_HOST_SUFFIXES = ["stripe.com", "paypal.com"];

const ACCOUNT_NOTICE = "Account and billing open on qono.net in your browser.";

function normalizePath(pathname) {
  if (!pathname) return "/";
  const path = pathname.split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function pathMatches(pathname, prefix) {
  const path = normalizePath(pathname);
  return path === prefix || path.startsWith(prefix + "/");
}

function isInteractivePath(pathname) {
  const path = normalizePath(pathname);
  if (path === "/") return true;
  return IN_APP_ROUTES.some((prefix) => pathMatches(path, prefix));
}

function isAccountPath(pathname) {
  return ACCOUNT_BILLING_ROUTES.some((prefix) => pathMatches(pathname, prefix));
}

function isPaymentHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ACCOUNT_BILLING_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith("." + suffix));
}

function isAppHost(hostname, appHosts) {
  const host = String(hostname || "").toLowerCase();
  return appHosts.some((item) => host === String(item).toLowerCase());
}

function isAccountBillingNavigation(urlString, options = {}) {
  const appHosts = options.appHosts || ["qono.net", "www.qono.net"];
  let url;
  try {
    url = new URL(String(urlString));
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (isPaymentHost(url.hostname)) return true;
  if (!isAppHost(url.hostname, appHosts)) return false;
  if (isInteractivePath(url.pathname)) return false;
  return isAccountPath(url.pathname);
}

module.exports = {
  IN_APP_ROUTES,
  ACCOUNT_BILLING_ROUTES,
  ACCOUNT_BILLING_HOST_SUFFIXES,
  ACCOUNT_NOTICE,
  isInteractivePath,
  isAccountPath,
  isPaymentHost,
  isAccountBillingNavigation,
};
