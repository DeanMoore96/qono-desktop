"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const electron = require("electron");
const { CONSENT_VERSION, writeConsent } = require("../consent-store");

const root = path.join(__dirname, "..");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "qono-consent-flow-"));
const page = fs.readFileSync(path.join(__dirname, "fixtures", "page.html"));

function dbusEnv() {
  if (process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.DBUS_SESSION_BUS_ADDRESS.startsWith("autolaunch")) return {};
  try {
    const socket = fs.readdirSync("/tmp").find((name) => name.startsWith("dbus-") && fs.statSync(path.join("/tmp", name)).isSocket());
    return socket ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=/tmp/${socket}` } : {};
  } catch {
    return {};
  }
}

function waitFor(child, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for " + type)), timeoutMs);
    function onMessage(message) {
      if (!message || message.type !== type) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve(message);
    }
    child.on("message", onMessage);
  });
}

function request(child, message, timeoutMs = 8000) {
  const id = `${Date.now()}-${Math.random()}`;
  const responseType = message.cmd === "eval" ? "eval" : message.cmd === "screenshot" ? "screenshot" : "status";
  const pending = waitFor(child, responseType, timeoutMs);
  child.send({ ...message, id });
  return pending.then((response) => (response.id === id ? response : request(child, message, timeoutMs)));
}

async function poll(child, predicate) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < 8000) {
    last = await request(child, { cmd: "status" });
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("condition not met: " + JSON.stringify(last));
}

function launch(envUrl) {
  const child = spawn(electron, ["--disable-gpu", "--no-sandbox", root], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      ...dbusEnv(),
      QONO_SMOKE: "1",
      QONO_USER_DATA: userData,
      QONO_URL: envUrl,
    },
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});

(async () => {
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const origin = `http://127.0.0.1:${port}/`;
  const app = launch(origin);
  try {
    await waitFor(app, "ready", 15000);
    const ready = await poll(app, (status) => status.consentVisible === true);
    assert.equal(ready.consentAccepted, false);
    assert.equal(ready.url, null);
    const html = fs.readFileSync(path.join(root, "consent.html"), "utf8");
    assert.match(html, /only the window or screen you pick/);
    assert.match(html, /system-wide control of your mouse or keyboard/);
    assert.match(html, /AI-generated voice/);
    assert.match(html, /Base44/);
    assert.match(html, /connect button/);
    fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
    const shot = await request(app, { cmd: "screenshot", path: "/opt/cursor/artifacts/qono-consent.png" });
    assert.equal(shot.ok, true);

    const stillBlocked = await request(app, { cmd: "open-link", url: "qono://voices" });
    assert.equal(stillBlocked.url, null);
    assert.equal(stillBlocked.consentAccepted, false);

    await request(app, { cmd: "agree" });
    const opened = await poll(app, (status) => status.url && status.url.includes("/settings/voice"));
    assert.equal(opened.consentAccepted, true);
    assert.equal(opened.consentVisible, false);

    await request(app, { cmd: "withdraw" });
    const withdrawn = await poll(app, (status) => status.consentAccepted === false && status.consentVisible === true && !status.url);
    assert.equal(withdrawn.url, null);
    console.log("consent gating, deep link, and withdraw passed");
  } finally {
    if (app.exitCode == null) app.kill("SIGKILL");
  }

  writeConsent(userData);
  fs.writeFileSync(
    path.join(userData, "consent.json"),
    JSON.stringify({ version: "old", acceptedAt: "2026-11-15T00:00:00.000Z" }),
  );
  const stale = launch(origin);
  try {
    await waitFor(stale, "ready", 45000);
    const ready = await poll(stale, (status) => status.consentVisible === true);
    assert.equal(ready.consentAccepted, false);
    assert.equal(ready.url, null);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(userData, "consent.json"), "utf8")).version, CONSENT_VERSION);
    console.log("outdated consent version re-prompts");
  } finally {
    if (stale.exitCode == null) stale.kill("SIGKILL");
    server.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
  console.log("consent flow tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
