"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const electron = require("electron");
const root = path.join(__dirname, "..");
const version = require(path.join(root, "package.json")).version;

const latest = [
  `version: ${version}`,
  "files:",
  "  - url: Qono-Setup-" + version + ".exe",
  "    sha512: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  "    size: 1",
  "path: Qono-Setup-" + version + ".exe",
  "sha512: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  "releaseDate: '2026-11-15T00:00:00.000Z'",
  "",
].join("\n");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [root], {
      env: { ...process.env, QONO_UPDATE_TEST: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
      process.stderr.write(chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("updater test timed out\n" + out));
    }, 30000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = req.url.split("?")[0];
    // Windows asks for latest.yml. Linux (this VM) asks for latest-linux.yml.
    // The version comparison is the same either way.
    if (pathname.endsWith(".yml")) {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(latest);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const port = await listen(server);
  try {
    const same = await run({ QONO_UPDATE_URL: `http://127.0.0.1:${port}/updates` });
    if (same.code !== 0 || !same.out.includes("QONO_UPDATE_RESULT not-available")) {
      throw new Error("expected update-not-available, got " + same.code + "\n" + same.out);
    }
    const offline = await run({
      QONO_UPDATE_URL: "http://127.0.0.1:59999/updates",
      QONO_UPDATE_EXPECT: "error",
    });
    if (offline.code !== 0 || !offline.out.includes("QONO_UPDATE_RESULT error:")) {
      throw new Error("expected a handled updater error, got " + offline.code + "\n" + offline.out);
    }
    const leftover = path.join(root, "dev-app-update.yml");
    if (fs.existsSync(leftover)) {
      throw new Error("dev-app-update.yml was left behind");
    }
    console.log("updater tests passed");
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
