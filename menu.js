"use strict";

const HIDDEN_ARG = "--hidden";

function buildMenuTemplate({
  platform,
  openAtLogin,
  updateReady,
  onOpen,
  onPrivacy,
  onManageAccount,
  onQuit,
  onCheck,
  onRestart,
  onLoginToggle,
}) {
  const template = [
    { label: "Open Qono", click: onOpen },
    { label: "Privacy & consent…", click: onPrivacy },
    { label: "Manage account on qono.net…", click: onManageAccount },
    { type: "separator" },
  ];

  if (platform === "win32" || platform === "darwin") {
    template.push({
      label: platform === "win32" ? "Start with Windows" : "Start at Login",
      type: "checkbox",
      checked: !!openAtLogin,
      click: (item) => onLoginToggle(!!item.checked),
    });
    template.push({ type: "separator" });
  }

  if (platform === "win32") {
    template.push({ label: "Check for updates", click: onCheck });
    if (updateReady) {
      template.push({ label: "Restart to update", click: onRestart });
    }
    template.push({ type: "separator" });
  }

  template.push({ label: "Quit", click: onQuit });
  return template;
}

function loginItemOptions({ platform, isPackaged, execPath, appPath, openAtLogin }) {
  if (platform === "darwin") {
    return { openAtLogin: !!openAtLogin, openAsHidden: true };
  }
  const appArg = appPath.includes(" ") ? `"${appPath}"` : appPath;
  return {
    openAtLogin: !!openAtLogin,
    path: execPath,
    args: isPackaged ? [HIDDEN_ARG] : [appArg, HIDDEN_ARG],
  };
}

module.exports = { HIDDEN_ARG, buildMenuTemplate, loginItemOptions };
