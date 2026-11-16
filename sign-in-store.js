"use strict";

const fs = require("node:fs");
const path = require("node:path");

function signInFile(dir) {
  return path.join(dir, "sign-in.json");
}

function readSignIn(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(signInFile(dir), "utf8"));
    if (!data || typeof data.lastSignInAt !== "string") return null;
    if (Number.isNaN(Date.parse(data.lastSignInAt))) return null;
    return { lastSignInAt: data.lastSignInAt };
  } catch {
    return null;
  }
}

function writeSignIn(dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const record = { lastSignInAt: now.toISOString() };
  fs.writeFileSync(signInFile(dir), JSON.stringify(record));
  return record;
}

function clearSignIn(dir) {
  try {
    fs.unlinkSync(signInFile(dir));
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

module.exports = { signInFile, readSignIn, writeSignIn, clearSignIn };
