"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const electron = require("electron");
const { writeConsent } = require("../consent-store");
const root = path.join(__dirname, "..");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "qono-smoke-"));
writeConsent(userData);
const page = fs.readFileSync(path.join(__dirname, "fixtures", "page.html"));

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function waitFor(child, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
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
  const pending = waitFor(
    child,
    responseType,
    timeoutMs,
  );
  child.send({ ...message, id });
  return pending.then((response) => {
    if (response.id !== id) return request(child, message, timeoutMs);
    return response;
  });
}

function exitOf(child, timeoutMs) {
  if (child.exitCode != null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for exit")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function launch(args, { ipc = false } = {}) {
  const child = spawn(electron, ["--disable-gpu", "--no-sandbox", root, ...args], {
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : "ignore",
    env: {
      ...process.env,
      ...dbusEnv(),
      QONO_SMOKE: "1",
      QONO_USER_DATA: userData,
      QONO_URL: pageUrl,
    },
  });
  if (ipc) {
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }
  return child;
}

async function poll(child, predicate, timeoutMs = 8000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await request(child, { cmd: "status" });
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`condition not met: ${JSON.stringify(last)}`);
}

function dbusEnv() {
  if (process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.DBUS_SESSION_BUS_ADDRESS.startsWith("autolaunch")) {
    return {};
  }
  try {
    const socket = fs.readdirSync("/tmp").find((name) => {
      if (!name.startsWith("dbus-")) return false;
      try {
        return fs.statSync(path.join("/tmp", name)).isSocket();
      } catch {
        return false;
      }
    });
    if (!socket) return {};
    return { DBUS_SESSION_BUS_ADDRESS: `unix:path=/tmp/${socket}` };
  } catch {
    return {};
  }
}

let pageUrl;
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});

(async () => {
  const port = await listen(server);
  pageUrl = `http://127.0.0.1:${port}/`;
  const app = launch([], { ipc: true });
  try {
    const ready = await waitFor(app, "ready", 45000);
    assert.equal(ready.loadError, null);
    assert.equal(ready.tray, true);
    assert.equal(ready.visible, true);
    assert.equal(ready.hooked, "extension");
    assert.ok(ready.menu.includes("Open Qono"));
    assert.ok(ready.menu.includes("Privacy & consent…"));
    assert.ok(ready.menu.includes("Sign out"));
    assert.ok(ready.menu.includes("Manage account on qono.net…"));
    assert.ok(ready.menu.includes("Quit"));
    assert.equal(ready.consentAccepted, true);
    assert.equal(ready.sharing, false);
    assert.equal(ready.tooltip, "Qono");
    assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+\//);

    fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
    const shot = await request(app, { cmd: "screenshot", path: "/opt/cursor/artifacts/qono-window.png" });
    assert.equal(shot.ok, true);

    const hooked = await request(app, { cmd: "eval", code: "window.__qonoShareHooked === true" });
    assert.equal(hooked.result, true);

    const before = await request(app, {
      cmd: "eval",
      code: "({ ticks: window.ticks, visibility: document.visibilityState })",
    });
    app.send({ cmd: "close-window" });
    const hidden = await poll(app, (status) => status.visible === false && status.concealed === true);
    assert.equal(hidden.destroyed, false);
    assert.equal(app.exitCode, null);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const after = await request(app, {
      cmd: "eval",
      code: "({ ticks: window.ticks, visibility: document.visibilityState, hidden: document.hidden })",
    });
    assert.ok(after.result.ticks > before.result.ticks, `ticks did not advance (${before.result.ticks} -> ${after.result.ticks})`);
    console.log("hidden visibility", after.result.visibility, "ticks", before.result.ticks, "->", after.result.ticks);

    let shareResult = null;
    try {
      shareResult = await request(
        app,
        {
          cmd: "eval",
          code: `(async () => {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            window.__shareStream = stream;
            const track = stream.getVideoTracks()[0];
            return { readyState: track ? track.readyState : null, tracks: stream.getTracks().length };
          })()`,
        },
        15000,
      );
    } catch (err) {
      shareResult = { error: String(err) };
    }

    if (shareResult && shareResult.result && shareResult.result.readyState === "live") {
      const sharing = await poll(app, (status) => status.sharing === true);
      assert.equal(sharing.tooltip, "Qono: screen sharing on");
      assert.match(sharing.iconFile, /sharing/);
      const whileHidden = await request(app, {
        cmd: "eval",
        code: "window.__shareStream.getVideoTracks()[0].readyState",
      });
      assert.equal(whileHidden.result, "live");
      await request(app, {
        cmd: "eval",
        code: "window.__shareStream.getTracks().forEach((track) => track.stop())",
      });
      const stopped = await poll(app, (status) => status.sharing === false);
      assert.equal(stopped.tooltip, "Qono");
      console.log("screen share stayed live while hidden, then stopped");
    } else {
      console.log("screen share capture unavailable in this environment:", JSON.stringify(shareResult));
    }

    const second = launch([]);
    const secondCode = await exitOf(second, 20000);
    assert.equal(secondCode, 0);
    const focused = await poll(app, (status) => status.visible === true);
    assert.equal(focused.concealed, false);
    console.log("second instance focused the existing window");

    const killer = launch(["--quit"]);
    const killerCode = await exitOf(killer, 20000);
    assert.equal(killerCode, 0);
    const appCode = await exitOf(app, 20000);
    assert.equal(appCode, 0);
    console.log("quit via --quit exited the running instance");

    const hiddenApp = launch(["--hidden"], { ipc: true });
    try {
      const hiddenReady = await waitFor(hiddenApp, "ready", 45000);
      assert.equal(hiddenReady.visible, false);
      assert.equal(hiddenReady.concealed, true);
      assert.match(hiddenReady.url, /^http:\/\/127\.0\.0\.1:\d+\//);
      const stillThere = await request(hiddenApp, { cmd: "eval", code: "window.ticks" });
      assert.equal(typeof stillThere.result, "number");
      hiddenApp.send({ cmd: "quit" });
      assert.equal(await exitOf(hiddenApp, 20000), 0);
      console.log("login-style --hidden start stayed in the tray");
    } finally {
      if (hiddenApp.exitCode == null) hiddenApp.kill("SIGKILL");
    }

    console.log("smoke tests passed");
  } finally {
    server.close();
    if (app.exitCode == null) app.kill("SIGKILL");
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
