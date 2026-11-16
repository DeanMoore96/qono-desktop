"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Bump this when the disclosure text changes. Older acceptance no longer counts.
const CONSENT_VERSION = "1.2.0-1";

function consentFile(dir) {
  return path.join(dir, "consent.json");
}

function readConsent(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(consentFile(dir), "utf8"));
    if (!data || typeof data.version !== "string" || typeof data.acceptedAt !== "string") return null;
    if (Number.isNaN(Date.parse(data.acceptedAt))) return null;
    return { version: data.version, acceptedAt: data.acceptedAt };
  } catch {
    return null;
  }
}

function hasValidConsent(dir, version = CONSENT_VERSION) {
  const data = readConsent(dir);
  return !!(data && data.version === version);
}

function writeConsent(dir, now = new Date(), version = CONSENT_VERSION) {
  fs.mkdirSync(dir, { recursive: true });
  const record = { version, acceptedAt: now.toISOString() };
  fs.writeFileSync(consentFile(dir), JSON.stringify(record));
  return record;
}

function clearConsent(dir) {
  try {
    fs.unlinkSync(consentFile(dir));
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

module.exports = {
  CONSENT_VERSION,
  consentFile,
  readConsent,
  hasValidConsent,
  writeConsent,
  clearConsent,
};
