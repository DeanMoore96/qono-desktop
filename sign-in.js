"use strict";

// 24-hour desktop sign-in gate. The qono.net site is unchanged.
//
// Signed-in detection (Base44 client, bundle index-BhiPvuiP.js, Nov 16 2026):
// a successful email login or OAuth return calls setToken(), which writes a
// non-empty localStorage key `base44_access_token` (and a copy under `token`).
// OAuth also lands with ?access_token= before the client moves it into that key.
// The login page reads ?from_url= and ?returnTo= (returnTo wins) and then
// navigates there. We treat the session as signed in only after that navigation
// has left the auth pages below. Seeing the token on a later visit does not
// extend lastSignInAt; the 24-hour clock starts once, when sign-in is detected.

const SIGN_IN_TTL_MS = 24 * 60 * 60 * 1000;
const SIGN_IN_CHECK_MS = 5 * 60 * 1000;
const SESSION_PARTITION = "persist:qono";
const AUTH_TOKEN_KEY = "base44_access_token";

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password", "/mfa"];
const PROTECTED_PAGES = ["/workspace", "/connections", "/voices", "/instructions"];

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

function isAuthPath(pathname) {
  return AUTH_PAGES.some((prefix) => pathMatches(pathname, prefix));
}

function isProtectedPath(pathname) {
  return PROTECTED_PAGES.some((prefix) => pathMatches(pathname, prefix));
}

function isAuthApiPath(pathname) {
  return /^\/api\/apps\/(?:[^/]+\/)?auth(?:\/|$)/.test(normalizePath(pathname));
}

function parseHttpUrl(urlString) {
  try {
    const url = new URL(String(urlString));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function hostIs(hostname, expected) {
  const host = String(hostname || "").toLowerCase();
  const name = String(expected).toLowerCase();
  return host === name || host.endsWith("." + name);
}

function isAppHost(hostname, appHosts) {
  const host = String(hostname || "").toLowerCase();
  return (appHosts || []).some((item) => host === String(item).toLowerCase());
}

function isOAuthUrl(urlString) {
  const url = parseHttpUrl(urlString);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (host === "accounts.google.com" || host.endsWith(".accounts.google.com")) return true;
  if (host === "accounts.youtube.com") return true;
  if (host === "oauth2.googleapis.com" || host === "www.googleapis.com") return true;
  if (hostIs(host, "base44.app")) return true;
  return false;
}

function isInAppAuthUrl(urlString, appHosts) {
  const url = parseHttpUrl(urlString);
  if (!url || !isAppHost(url.hostname, appHosts)) return false;
  return isAuthPath(url.pathname) || isAuthApiPath(url.pathname);
}

function isContinuingAuth(urlString, appHosts) {
  return isOAuthUrl(urlString) || isInAppAuthUrl(urlString, appHosts);
}

function isProtectedAppUrl(urlString, appHosts) {
  const url = parseHttpUrl(urlString);
  if (!url || !isAppHost(url.hostname, appHosts)) return false;
  return isProtectedPath(url.pathname);
}

function isSignInCurrent(lastSignInAt, now, ttl = SIGN_IN_TTL_MS) {
  const signedInAt = Date.parse(lastSignInAt);
  if (!Number.isFinite(signedInAt) || !Number.isFinite(now)) return false;
  const age = now - signedInAt;
  return age >= 0 && age < ttl;
}

function needsSignIn(lastSignInAt, now, ttl = SIGN_IN_TTL_MS) {
  return !isSignInCurrent(lastSignInAt, now, ttl);
}

function loginUrlFor(returnUrl) {
  const back = new URL(returnUrl);
  const login = new URL("/login", back.origin + "/");
  login.searchParams.set("from_url", back.href);
  login.searchParams.set("returnTo", back.href);
  return login.href;
}

function gateUrl(desiredUrl, lastSignInAt, now) {
  if (isSignInCurrent(lastSignInAt, now)) {
    return { url: desiredUrl, intent: "app" };
  }
  return { url: loginUrlFor(desiredUrl), intent: "sign-in" };
}

function didSignIn({ token, pageUrl }) {
  const url = parseHttpUrl(pageUrl);
  if (!url || isAuthPath(url.pathname)) return false;
  const stored = typeof token === "string" ? token.trim() : "";
  const query = url.searchParams.get("access_token");
  const fromQuery = typeof query === "string" ? query.trim() : "";
  return stored.length > 0 || fromQuery.length > 0;
}

function sessionOrigins(origin) {
  const origins = ["https://qono.net", "https://www.qono.net", "https://base44.app"];
  if (origin && !origins.includes(origin)) origins.push(origin);
  return origins;
}

module.exports = {
  SIGN_IN_TTL_MS,
  SIGN_IN_CHECK_MS,
  SESSION_PARTITION,
  AUTH_TOKEN_KEY,
  AUTH_PAGES,
  PROTECTED_PAGES,
  isAuthPath,
  isProtectedPath,
  isOAuthUrl,
  isInAppAuthUrl,
  isContinuingAuth,
  isProtectedAppUrl,
  isSignInCurrent,
  needsSignIn,
  loginUrlFor,
  gateUrl,
  didSignIn,
  sessionOrigins,
};
