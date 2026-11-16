"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const version = require(path.join(root, "package.json")).version;
const releaseDir = path.join(root, "release");
const exeName = `Qono-Setup-${version}.exe`;
const exePath = path.join(releaseDir, exeName);
const ymlPath = path.join(releaseDir, "latest.yml");
const blockmapPath = `${exePath}.blockmap`;
const updateConfigPath = path.join(releaseDir, "win-unpacked", "resources", "app-update.yml");

function must(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("ok", message);
  }
}

const yml = fs.readFileSync(ymlPath, "utf8");
const hash = crypto.createHash("sha512").update(fs.readFileSync(exePath)).digest("base64");
const size = fs.statSync(exePath).size;
const updateConfig = fs.readFileSync(updateConfigPath, "utf8");

must(new RegExp(`^version:\\s*${version}\\s*$`, "m").test(yml), `latest.yml version is ${version}`);
must(yml.includes(`url: ${exeName}`), `latest.yml url is ${exeName}`);
must(yml.includes(`path: ${exeName}`), `latest.yml path is ${exeName}`);
must(yml.includes(hash), "latest.yml sha512 matches the installer");
must(yml.includes(`size: ${size}`), `latest.yml size is ${size}`);
must(fs.statSync(blockmapPath).size > 0, "blockmap is non-empty");
must(size > 1024 * 1024, "installer is larger than 1MB");
must(/owner:\s*DeanMoore96/.test(updateConfig), "app-update.yml owner is DeanMoore96");
must(/repo:\s*qono-desktop/.test(updateConfig), "app-update.yml repo is qono-desktop");
must(/provider:\s*github/.test(updateConfig), "app-update.yml provider is github");
must(!/publisherName/.test(updateConfig), "app-update.yml has no publisherName (unsigned builds)");

if (process.exitCode) process.exit(process.exitCode);
console.log("latest.yml verified");
