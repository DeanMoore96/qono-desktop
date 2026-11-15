"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  desktopCapturer,
  session,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { HIDDEN_ARG, buildMenuTemplate, loginItemOptions } = require("./menu");
const { SHARE_PREFIX, shareHookSource, parseSharePayload } = require("./share-hook");

const APP_URL = process.env.QONO_URL || "https://qono.net";
const APP_ID = "net.qono.desktop";
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_START_DELAY_MS = 15 * 1000;
const ASSETS = path.join(__dirname, "assets");

// Hidden renderers are frozen aggressively enough to stall getDisplayMedia.
// backgroundThrottling:false covers the visibility state; these switches cover
// Chromium's occlusion and wake-up throttling, which that flag does not.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch(
  "disable-features",
  "CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
);

if (process.env.QONO_USER_DATA) {
  app.setPath("userData", process.env.QONO_USER_DATA);
}
if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

let mainWindow = null;
let tray = null;
let trayAvailable = false;
let windowConcealed = false;
let isQuitting = false;
let hardQuit = false;
let shareActive = false;
let updateReady = false;
let updaterStarted = false;
let shareHookMode = "none";
let loadError = null;
let logPath = null;
let currentTemplate = [];
let currentTooltip = "Qono";
let currentIconFile = null;
const shareCounts = new Map();

function formatArg(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function log(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatArg).join(" ")}`;
  if (level === "error") console.error(line);
  else console.log(line);
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, line + "\n");
  } catch {
    // Logging must not take the tray app down.
  }
}

function openLog() {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, "main.log");
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      fs.renameSync(logPath, path.join(dir, "main.log.1"));
    }
  } catch (err) {
    console.error("log init failed", err);
  }
}

function hasFlag(flag, argv = process.argv) {
  return argv.includes(flag);
}

function loadImage(file, { template = false } = {}) {
  const img = nativeImage.createFromPath(path.join(ASSETS, file));
  if (img.isEmpty()) {
    throw new Error(`Missing icon ${file}`);
  }
  if (template) img.setTemplateImage(true);
  return img;
}

function iconFileFor(sharing) {
  if (process.platform === "darwin") return sharing ? "tray-sharingTemplate.png" : "trayTemplate.png";
  if (process.platform === "win32") return sharing ? "tray-sharing.ico" : "tray.ico";
  return sharing ? "tray-sharing.png" : "tray.png";
}

function tooltipFor() {
  let tip = shareActive ? "Qono: screen sharing on" : "Qono";
  if (updateReady) tip += " — update ready";
  return tip.slice(0, 127);
}

function applyTrayState() {
  if (!tray) return;
  currentIconFile = iconFileFor(shareActive);
  currentTooltip = tooltipFor();
  tray.setImage(loadImage(currentIconFile, { template: process.platform === "darwin" }));
  tray.setToolTip(currentTooltip);
}

function readOpenAtLogin() {
  if (process.platform !== "win32" && process.platform !== "darwin") return false;
  try {
    const options = currentLoginOptions(true);
    const query = process.platform === "win32" ? { path: options.path, args: options.args } : {};
    return app.getLoginItemSettings(query).openAtLogin === true;
  } catch (err) {
    log("warn", "login item read failed", err);
    return false;
  }
}

function currentLoginOptions(openAtLogin) {
  return loginItemOptions({
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    appPath: path.resolve(app.getAppPath()),
    openAtLogin,
  });
}

function setOpenAtLogin(open) {
  if (process.env.QONO_SMOKE === "1") return;
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  try {
    app.setLoginItemSettings(currentLoginOptions(open));
    log("info", "login-item", open);
  } catch (err) {
    log("error", "login item write failed", err);
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  currentTemplate = buildMenuTemplate({
    platform: process.platform,
    openAtLogin: readOpenAtLogin(),
    updateReady,
    onOpen: () => showMainWindow(),
    onQuit: () => beginQuit({ hard: false }),
    onCheck: () => checkForUpdates(),
    onRestart: () => restartToUpdate(),
    onLoginToggle: (checked) => {
      setOpenAtLogin(checked);
      rebuildTrayMenu();
    },
  });
  tray.setContextMenu(Menu.buildFromTemplate(currentTemplate));
}

function createTray() {
  currentIconFile = iconFileFor(false);
  tray = new Tray(loadImage(currentIconFile, { template: process.platform === "darwin" }));
  trayAvailable = true;
  tray.setToolTip("Qono");
  currentTooltip = "Qono";
  rebuildTrayMenu();
  const show = () => showMainWindow();
  tray.on("click", show);
  tray.on("double-click", show);
  log("info", "tray-ready");
}

function windowIcon() {
  return path.join(ASSETS, "icon.png");
}

function isUserVisible() {
  return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !windowConcealed);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    windowConcealed = false;
    createWindow({ show: true }).catch((err) => log("error", "createWindow", err));
    return;
  }
  windowConcealed = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  log("info", "window-shown");
}

function concealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  windowConcealed = true;
  mainWindow.hide();
  log("info", "window-hidden");
}

function totalShareTracks() {
  let total = 0;
  for (const count of shareCounts.values()) total += count;
  return total;
}

function setSharing(active) {
  const next = !!active;
  if (next === shareActive) return;
  shareActive = next;
  log("info", next ? "screen-sharing-started" : "screen-sharing-stopped");
  applyTrayState();
}

function applySharePayload(payload) {
  const parsed = parseSharePayload(payload);
  if (!parsed) return;
  shareCounts.set(parsed.frame, parsed.tracks);
  setSharing(totalShareTracks() > 0);
}

async function installShareExtension() {
  const dir = path.join(app.getPath("userData"), "share-hook-extension");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "hook.js"), shareHookSource());
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      name: "Qono share hook",
      version: "1.0.0",
      manifest_version: 3,
      content_scripts: [
        {
          matches: ["<all_urls>"],
          js: ["hook.js"],
          run_at: "document_start",
          world: "MAIN",
          all_frames: true,
        },
      ],
    }),
  );
  try {
    await session.defaultSession.loadExtension(dir, { allowFileAccess: true });
    shareHookMode = "extension";
  } catch (err) {
    shareHookMode = "console";
    log("warn", "share hook extension failed", err);
  }
  log("info", "share-hook", shareHookMode);
}

function watchShareMessages(win) {
  const contents = win.webContents;
  contents.on("console-message", (_event, _level, message) => {
    const text = typeof message === "string" ? message : message && message.message;
    if (typeof text !== "string" || !text.startsWith(SHARE_PREFIX)) return;
    applySharePayload(text.slice(SHARE_PREFIX.length));
  });
  contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    shareCounts.clear();
    setSharing(false);
  });
  contents.on("render-process-gone", () => {
    shareCounts.clear();
    setSharing(false);
  });
  if (shareHookMode !== "extension") {
    const source = shareHookSource();
    contents.on("dom-ready", () => {
      contents.executeJavaScript(source).catch((err) => log("warn", "share hook inject failed", err));
    });
  }
}

async function createWindow({ show }) {
  windowConcealed = !show;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: "Qono",
    icon: windowIcon(),
    backgroundColor: "#07070b",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  const win = mainWindow;
  win.webContents.setBackgroundThrottling(false);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("close", (event) => {
    if (isQuitting || !trayAvailable) return;
    event.preventDefault();
    concealWindow();
  });

  let pageLoaded = false;
  const maybeSmokeReady = () => {
    if (!pageLoaded) return;
    if (!windowConcealed && !isUserVisible()) return;
    sendSmokeReady();
  };

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    loadError = `${code} ${description} ${url}`;
    log("error", "did-fail-load", loadError);
    sendSmokeReady();
  });

  win.webContents.on("did-finish-load", () => {
    pageLoaded = true;
    log("info", "window-loaded", win.webContents.getURL());
    maybeSmokeReady();
  });

  win.once("ready-to-show", () => {
    if (!windowConcealed) showMainWindow();
    maybeSmokeReady();
  });

  watchShareMessages(win);
  win.loadURL(APP_URL);
}

function shouldStartHidden() {
  if (hasFlag(HIDDEN_ARG)) return true;
  if (process.platform !== "darwin") return false;
  try {
    const settings = app.getLoginItemSettings();
    return settings.wasOpenedAtLogin === true || settings.wasOpenedAsHidden === true;
  } catch (err) {
    log("warn", "login launch check failed", err);
    return false;
  }
}

function beginQuit({ hard }) {
  if (hard) {
    hardQuit = true;
    autoUpdater.autoInstallOnAppQuit = false;
  }
  isQuitting = true;
  log("info", hard ? "quit-hard" : "quit");
  app.quit();
}

function onSecondInstance(_event, argv) {
  log("info", "second-instance", argv.join(" "));
  if (hasFlag("--quit", argv)) {
    beginQuit({ hard: true });
    return;
  }
  showMainWindow();
}

function snapshot() {
  const menu = [];
  const checks = {};
  for (const item of currentTemplate) {
    if (!item.label) continue;
    menu.push(item.label);
    if (item.type === "checkbox") checks[item.label] = !!item.checked;
  }
  return {
    visible: isUserVisible(),
    concealed: windowConcealed,
    sharing: shareActive,
    tooltip: currentTooltip,
    iconFile: currentIconFile,
    menu,
    checks,
    url: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : null,
    hooked: shareHookMode,
    loadError,
    destroyed: !mainWindow || mainWindow.isDestroyed(),
    quitting: isQuitting,
    tray: trayAvailable,
  };
}

function sendSmoke(message) {
  if (process.env.QONO_SMOKE !== "1" || typeof process.send !== "function") return;
  try {
    process.send(message);
  } catch {
    // The test runner may already be gone.
  }
}

let smokeReadySent = false;
function sendSmokeReady() {
  if (smokeReadySent) return;
  smokeReadySent = true;
  sendSmoke({ type: "ready", ...snapshot() });
}

function installSmokeHooks() {
  if (process.env.QONO_SMOKE !== "1" || typeof process.send !== "function") return;
  process.on("message", async (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.cmd === "status") {
      sendSmoke({ type: "status", id: msg.id, ...snapshot() });
      return;
    }
    if (msg.cmd === "close-window") {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      return;
    }
    if (msg.cmd === "show-window") {
      showMainWindow();
      return;
    }
    if (msg.cmd === "quit") {
      beginQuit({ hard: false });
      return;
    }
    if (msg.cmd === "screenshot") {
      try {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(msg.path, image.toPNG());
        sendSmoke({ type: "screenshot", id: msg.id, ok: true });
      } catch (err) {
        sendSmoke({ type: "screenshot", id: msg.id, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (msg.cmd === "eval") {
      try {
        const result = await mainWindow.webContents.executeJavaScript(msg.code, true);
        sendSmoke({ type: "eval", id: msg.id, result });
      } catch (err) {
        sendSmoke({ type: "eval", id: msg.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}

function updaterActive() {
  return process.platform === "win32" && app.isPackaged && process.env.QONO_UPDATE_TEST !== "1";
}

function checkForUpdates() {
  if (!updaterStarted) {
    log("info", "update check skipped");
    return;
  }
  autoUpdater.checkForUpdates().catch(() => {
    // The error event logs the failure. Offline is not fatal.
  });
}

function restartToUpdate() {
  if (!updateReady) return;
  isQuitting = true;
  log("info", "restart-to-update");
  autoUpdater.quitAndInstall(true, true);
}

function startUpdater() {
  if (!updaterActive()) {
    log("info", "updater disabled", process.platform, "packaged=" + app.isPackaged);
    return;
  }

  autoUpdater.logger = {
    info: (...args) => log("info", ...args),
    warn: (...args) => log("warn", ...args),
    error: (...args) => log("error", ...args),
    debug: (...args) => log("debug", ...args),
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  // Unsigned NSIS builds have no publisherName in app-update.yml, so
  // electron-updater skips Authenticode checks. Do not set publisherName
  // until the installer is actually signed.

  autoUpdater.on("error", (err) => {
    log("error", "updater", err);
  });
  autoUpdater.on("update-available", (info) => {
    log("info", "update-available", info && info.version);
  });
  autoUpdater.on("update-not-available", (info) => {
    log("info", "update-not-available", info && info.version);
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    log("info", "update-downloaded", info && info.version);
    rebuildTrayMenu();
    applyTrayState();
  });

  updaterStarted = true;
  setTimeout(() => checkForUpdates(), UPDATE_START_DELAY_MS);
  setInterval(() => checkForUpdates(), UPDATE_INTERVAL_MS);
  log("info", "updater-started");
}

function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      callback({ video: sources[0] });
    },
    { useSystemPicker: true },
  );
}

async function start() {
  openLog();
  log("info", "starting", app.getVersion(), process.platform, "packaged=" + app.isPackaged);
  installSmokeHooks();
  setupDisplayMedia();
  await installShareExtension();
  try {
    createTray();
  } catch (err) {
    trayAvailable = false;
    log("error", "tray failed", err);
    if (process.env.QONO_SMOKE === "1") throw err;
  }
  await createWindow({ show: !shouldStartHidden() });
  startUpdater();
  if (!trayAvailable && process.env.QONO_SMOKE === "1") {
    sendSmokeReady();
  }
}

async function runUpdaterSelfTest() {
  const configPath = path.join(app.getAppPath(), "dev-app-update.yml");
  const url = process.env.QONO_UPDATE_URL;
  const expectError = process.env.QONO_UPDATE_EXPECT === "error";
  let result = "none";
  try {
    fs.writeFileSync(
      configPath,
      `provider: generic\nurl: ${url}\nupdaterCacheDirName: qono-test-updater\n`,
    );
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = {
      info: (...args) => console.log("[updater]", ...args),
      warn: (...args) => console.warn("[updater]", ...args),
      error: (...args) => console.error("[updater]", ...args),
      debug: () => {},
    };
    autoUpdater.on("update-not-available", () => {
      result = "not-available";
    });
    autoUpdater.on("update-available", () => {
      result = "available";
    });
    autoUpdater.on("error", (err) => {
      result = "error:" + (err && err.message ? err.message : err);
    });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      if (!String(result).startsWith("error")) {
        result = "error:" + (err && err.message ? err.message : err);
      }
    }
  } finally {
    try {
      fs.unlinkSync(configPath);
    } catch {
      // already removed
    }
  }
  console.log("QONO_UPDATE_RESULT " + result);
  const ok = expectError ? String(result).startsWith("error") : result === "not-available";
  app.exit(ok ? 0 : 1);
}

function main() {
  if (process.env.QONO_UPDATE_TEST === "1") {
    app.whenReady().then(runUpdaterSelfTest).catch((err) => {
      console.error(err);
      app.exit(1);
    });
    return;
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock || hasFlag("--quit")) {
    app.exit(0);
    return;
  }

  app.on("second-instance", onSecondInstance);
  app.on("before-quit", () => {
    isQuitting = true;
    if (hardQuit) autoUpdater.autoInstallOnAppQuit = false;
  });
  app.on("window-all-closed", () => {
    if (!trayAvailable && process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    showMainWindow();
  });
  app.on("will-quit", () => {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.whenReady().then(start).catch((err) => {
    log("error", "fatal", err);
    app.exit(1);
  });
}

main();
