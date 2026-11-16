"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CONSENT_VERSION,
  readConsent,
  hasValidConsent,
  writeConsent,
  clearConsent,
} = require("../consent-store");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qono-consent-"));

assert.equal(hasValidConsent(dir), false);
assert.equal(readConsent(dir), null);

const record = writeConsent(dir, new Date("2026-11-15T12:00:00.000Z"));
assert.equal(record.version, CONSENT_VERSION);
assert.equal(record.acceptedAt, "2026-11-15T12:00:00.000Z");
assert.equal(hasValidConsent(dir), true);

fs.writeFileSync(path.join(dir, "consent.json"), JSON.stringify({ version: "old", acceptedAt: record.acceptedAt }));
assert.equal(hasValidConsent(dir), false);
assert.equal(readConsent(dir).version, "old");

writeConsent(dir);
assert.equal(hasValidConsent(dir), true);
clearConsent(dir);
assert.equal(hasValidConsent(dir), false);
assert.equal(fs.existsSync(path.join(dir, "consent.json")), false);
clearConsent(dir);

fs.writeFileSync(path.join(dir, "consent.json"), "{");
assert.equal(readConsent(dir), null);

console.log("consent store tests passed");
