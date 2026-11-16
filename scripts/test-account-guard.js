"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isAccountBillingNavigation, isInteractivePath, ACCOUNT_NOTICE } = require("../account-guard");

const hosts = ["qono.net", "www.qono.net", "127.0.0.1"];

function external(url) {
  assert.equal(isAccountBillingNavigation(url, { appHosts: hosts }), true, url);
}

function internal(url) {
  assert.equal(isAccountBillingNavigation(url, { appHosts: hosts }), false, url);
}

for (const path of [
  "/workspace",
  "/workspace/session",
  "/connections",
  "/connections?onboarding=1",
  "/connections?provider=openai",
  "/connections?provider=anthropic",
  "/voices",
  "/instructions",
  "/instructions/new",
  "/demonstration",
  "/",
  "/login",
  "/support",
]) {
  internal("https://qono.net" + path);
  internal("http://127.0.0.1:9" + path);
}

external("https://qono.net/account");
external("https://qono.net/settings");
external("https://qono.net/settings/account");
external("https://qono.net/profile");
external("https://qono.net/billing");
external("https://qono.net/billing/invoices");
external("https://qono.net/subscription");
external("https://qono.net/subscriptions/yearly");
external("https://qono.net/membership");
external("https://qono.net/members");
external("https://qono.net/pricing");
external("https://qono.net/checkout");
external("https://qono.net/credits");
external("https://qono.net/dashboard");
external("https://qono.net/thank-you");
external("https://qono.net/_admin/dashboard");
external("https://checkout.stripe.com/c/pay/cs_test_123");
external("https://pay.stripe.com/invoice/123");
external("https://www.paypal.com/checkoutnow?token=abc");
external("https://www.sandbox.paypal.com/checkoutnow");

internal("https://qono.net/some-future-feature");
internal("https://example.com/billing");
internal("qono://voices");
assert.equal(isInteractivePath("/workspace"), true);
assert.equal(isInteractivePath("/workspace-notes"), false);
assert.equal(isInteractivePath("/settings"), false);
assert.equal(ACCOUNT_NOTICE, "Account and billing open on qono.net in your browser.");
assert.match(
  fs.readFileSync(path.join(__dirname, "../account-notice.html"), "utf8"),
  /Account and billing open on qono\.net in your browser\./,
);

console.log("account guard tests passed");
