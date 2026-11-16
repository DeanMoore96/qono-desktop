"use strict";

const assert = require("node:assert/strict");
const { buildMenuTemplate, loginItemOptions } = require("../menu");

function labels(options) {
  return buildMenuTemplate({
    onOpen() {},
    onPrivacy() {},
    onSignOut() {},
    onManageAccount() {},
    onQuit() {},
    onCheck() {},
    onRestart() {},
    onLoginToggle() {},
    ...options,
  })
    .filter((item) => item.label)
    .map((item) => item.label);
}

assert.deepEqual(labels({ platform: "win32", openAtLogin: false, updateReady: false }), [
  "Open Qono",
  "Privacy & consent…",
  "Sign out",
  "Manage account on qono.net…",
  "Start with Windows",
  "Check for updates",
  "Quit",
]);

assert.deepEqual(labels({ platform: "win32", openAtLogin: true, updateReady: true }), [
  "Open Qono",
  "Privacy & consent…",
  "Sign out",
  "Manage account on qono.net…",
  "Start with Windows",
  "Check for updates",
  "Restart to update",
  "Quit",
]);

const winMenu = buildMenuTemplate({
  platform: "win32",
  openAtLogin: true,
  updateReady: false,
  onOpen() {},
  onPrivacy() {},
  onSignOut() {},
  onManageAccount() {},
  onQuit() {},
  onCheck() {},
  onRestart() {},
  onLoginToggle() {},
});
const startup = winMenu.find((item) => item.label === "Start with Windows");
assert.equal(startup.type, "checkbox");
assert.equal(startup.checked, true);

assert.deepEqual(labels({ platform: "darwin", openAtLogin: false, updateReady: true }), [
  "Open Qono",
  "Privacy & consent…",
  "Sign out",
  "Manage account on qono.net…",
  "Start at Login",
  "Quit",
]);

assert.deepEqual(labels({ platform: "linux", openAtLogin: false, updateReady: true }), [
  "Open Qono",
  "Privacy & consent…",
  "Sign out",
  "Manage account on qono.net…",
  "Quit",
]);

assert.deepEqual(
  loginItemOptions({
    platform: "win32",
    isPackaged: true,
    execPath: "C:\\Users\\Dean\\AppData\\Local\\Programs\\Qono\\Qono.exe",
    appPath: "C:\\src\\qono",
    openAtLogin: true,
  }),
  {
    openAtLogin: true,
    path: "C:\\Users\\Dean\\AppData\\Local\\Programs\\Qono\\Qono.exe",
    args: ["--hidden"],
  },
);

assert.deepEqual(
  loginItemOptions({
    platform: "win32",
    isPackaged: false,
    execPath: "C:\\electron\\electron.exe",
    appPath: "C:\\src\\qono desktop",
    openAtLogin: false,
  }).args,
  ['"C:\\src\\qono desktop"', "--hidden"],
);

assert.equal(loginItemOptions({ platform: "darwin", isPackaged: true, execPath: "/App", appPath: "/App", openAtLogin: true }).openAsHidden, true);

let toggled = null;
const item = { checked: false };
buildMenuTemplate({
  platform: "win32",
  openAtLogin: false,
  updateReady: false,
  onOpen() {},
  onPrivacy() {},
  onSignOut() {},
  onQuit() {},
  onCheck() {},
  onRestart() {},
  onLoginToggle(checked) {
    toggled = checked;
  },
})
  .find((entry) => entry.label === "Start with Windows")
  .click(item);
assert.equal(toggled, false);

console.log("menu tests passed");
