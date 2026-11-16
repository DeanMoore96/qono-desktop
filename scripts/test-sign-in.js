"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SIGN_IN_TTL_MS,
  SIGN_IN_CHECK_MS,
  SESSION_PARTITION,
  AUTH_TOKEN_KEY,
  isSignInCurrent,
  needsSignIn,
  loginUrlFor,
  gateUrl,
  didSignIn,
  isAuthPath,
  isProtectedPath,
  isOAuthUrl,
  isInAppAuthUrl,
  isContinuingAuth,
  isProtectedAppUrl,
  sessionOrigins,
} = require("../sign-in");
const { readSignIn, writeSignIn, clearSignIn, signInFile } = require("../sign-in-store");
const { manageAccountUrl, MANAGE_ACCOUNT_PATH } = require("../urls");

const now = Date.parse("2026-11-16T12:00:00.000Z");
const fresh = new Date(now - (SIGN_IN_TTL_MS - 1)).toISOString();
const exact = new Date(now - SIGN_IN_TTL_MS).toISOString();
const old = new Date(now - SIGN_IN_TTL_MS - 1).toISOString();

assert.equal(SIGN_IN_TTL_MS, 24 * 60 * 60 * 1000);
assert.equal(SIGN_IN_CHECK_MS, 5 * 60 * 1000);
assert.equal(SESSION_PARTITION, "persist:qono");
assert.equal(AUTH_TOKEN_KEY, "base44_access_token");

assert.equal(isSignInCurrent(null, now), false);
assert.equal(isSignInCurrent(undefined, now), false);
assert.equal(isSignInCurrent("", now), false);
assert.equal(isSignInCurrent("not-a-date", now), false);
assert.equal(isSignInCurrent(new Date(now + 1000).toISOString(), now), false);
assert.equal(isSignInCurrent(fresh, now), true);
assert.equal(isSignInCurrent(exact, now), false);
assert.equal(isSignInCurrent(old, now), false);
assert.equal(needsSignIn(fresh, now), false);
assert.equal(needsSignIn(exact, now), true);
assert.equal(needsSignIn(old, now), true);

const connections = "https://qono.net/connections?onboarding=1";
const login = new URL(loginUrlFor(connections));
assert.equal(login.origin, "https://qono.net");
assert.equal(login.pathname, "/login");
assert.equal(login.searchParams.get("from_url"), connections);
assert.equal(login.searchParams.get("returnTo"), connections);

const voices = "https://qono.net/voices";
const gated = gateUrl(voices, null, now);
assert.equal(gated.intent, "sign-in");
assert.equal(new URL(gated.url).searchParams.get("from_url"), voices);
assert.equal(gateUrl(connections, fresh, now).url, connections);
assert.equal(gateUrl(connections, exact, now).intent, "sign-in");

assert.equal(didSignIn({ token: "abc", pageUrl: connections }), true);
assert.equal(didSignIn({ token: "  ", pageUrl: connections }), false);
assert.equal(didSignIn({ token: "", pageUrl: "https://qono.net/connections?access_token=oauth-token" }), true);
assert.equal(didSignIn({ token: "abc", pageUrl: "https://qono.net/login?from_url=" + encodeURIComponent(connections) }), false);
assert.equal(didSignIn({ token: "abc", pageUrl: "https://qono.net/register" }), false);
assert.equal(didSignIn({ token: "abc", pageUrl: "https://qono.net/forgot-password" }), false);
assert.equal(didSignIn({ token: "abc", pageUrl: "https://qono.net/reset-password/abc" }), false);
assert.equal(didSignIn({ token: "abc", pageUrl: "https://qono.net/mfa" }), false);
assert.equal(didSignIn({ token: "", pageUrl: "https://qono.net/workspace" }), false);

assert.equal(isAuthPath("/login"), true);
assert.equal(isAuthPath("/login/sso"), true);
assert.equal(isProtectedPath("/workspace"), true);
assert.equal(isProtectedPath("/connections"), true);
assert.equal(isProtectedPath("/voices"), true);
assert.equal(isProtectedPath("/instructions/new"), true);
assert.equal(isProtectedPath("/support"), false);
assert.equal(isProtectedPath("/login"), false);

const hosts = ["qono.net", "www.qono.net", "127.0.0.1"];
assert.equal(isOAuthUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"), true);
assert.equal(isOAuthUrl("https://accounts.google.com/signin/oauth"), true);
assert.equal(isOAuthUrl("https://oauth2.googleapis.com/token"), true);
assert.equal(isOAuthUrl("https://base44.app/api/apps/auth/login"), true);
assert.equal(isOAuthUrl("https://qono.net/login"), false);
assert.equal(isOAuthUrl("https://www.google.com/search?q=qono"), false);
assert.equal(isInAppAuthUrl("https://qono.net/login", hosts), true);
assert.equal(isInAppAuthUrl("https://qono.net/register", hosts), true);
assert.equal(isInAppAuthUrl("https://qono.net/forgot-password", hosts), true);
assert.equal(isInAppAuthUrl("https://qono.net/reset-password", hosts), true);
assert.equal(isInAppAuthUrl("https://qono.net/api/apps/auth/login?app_id=1", hosts), true);
assert.equal(isInAppAuthUrl("https://qono.net/api/apps/6af527e3132baa0ccb8873b4/auth/login", hosts), true);
assert.equal(isInAppAuthUrl("https://qono.net/workspace", hosts), false);
assert.equal(isInAppAuthUrl("https://qono.net/members", hosts), false);
assert.equal(isContinuingAuth("https://accounts.google.com/o/oauth2/v2/auth", hosts), true);
assert.equal(isContinuingAuth("https://qono.net/connections", hosts), false);
assert.equal(isProtectedAppUrl("https://qono.net/connections?onboarding=1", hosts), true);
assert.equal(isProtectedAppUrl("https://qono.net/voices", hosts), true);
assert.equal(isProtectedAppUrl("https://qono.net/login", hosts), false);
assert.equal(isProtectedAppUrl("https://example.com/connections", hosts), false);
assert.equal(isProtectedAppUrl("https://qono.net/members", hosts), false);

assert.deepEqual(sessionOrigins("https://qono.net"), [
  "https://qono.net",
  "https://www.qono.net",
  "https://base44.app",
]);
assert.deepEqual(sessionOrigins("http://127.0.0.1:9"), [
  "https://qono.net",
  "https://www.qono.net",
  "https://base44.app",
  "http://127.0.0.1:9",
]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qono-sign-in-"));
assert.equal(readSignIn(dir), null);
const record = writeSignIn(dir, new Date(fresh));
assert.equal(record.lastSignInAt, fresh);
assert.deepEqual(readSignIn(dir), { lastSignInAt: fresh });
assert.equal(isSignInCurrent(readSignIn(dir).lastSignInAt, now), true);
clearSignIn(dir);
assert.equal(readSignIn(dir), null);
assert.equal(fs.existsSync(signInFile(dir)), false);
clearSignIn(dir);
fs.writeFileSync(signInFile(dir), "{");
assert.equal(readSignIn(dir), null);
fs.writeFileSync(signInFile(dir), JSON.stringify({ lastSignInAt: "nope" }));
assert.equal(readSignIn(dir), null);

delete process.env.QONO_URL;
assert.equal(MANAGE_ACCOUNT_PATH, "/members");
assert.equal(manageAccountUrl(), "https://qono.net/members");

console.log("sign-in tests passed");
