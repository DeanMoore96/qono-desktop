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
  ipcMain,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { HIDDEN_ARG, buildMenuTemplate, loginItemOptions } = require("./menu");
const { SHARE_PREFIX, shareHookSource, parseSharePayload } = require("./share-hook");
const { hasValidConsent, writeConsent, clearConsent } = require("./consent-store");
const { parseQonoLink, findQonoLink, classifyLink } = require("./routes");
const { QONO_START_URL, startUrl, homeUrl, appOrigin, appUrl, manageAccountUrl } = require("./urls");
const { isAccountBillingNavigation, ACCOUNT_NOTICE } = require("./account-guard");
const { readSignIn, writeSignIn, clearSignIn } = require("./sign-in-store");
const {
  SIGN_IN_CHECK_MS,
  SESSION_PARTITION,
  AUTH_TOKEN_KEY,
  isSignInCurrent,
  isContinuingAuth,
  isProtectedAppUrl,
  isProtectedPath,
  didSignIn,
  loginUrlFor,
  sessionOrigins,
} = require("./sign-in");

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
let consentWindow = null;
let accountNoticeWindow = null;
let accountNoticeTimer = null;
let pendingRoute = null;
let pendingProtocolUrl = null;
let allowMainClose = false;
let loadIntent = "start";
let fellBack = false;
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
let awaitingSignIn = false;
let signInInFlight = null;
let sessionGeneration = 0;
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
    onPrivacy: () => showConsent({ review: consentAccepted() }),
    onSignOut: () => {
      signOut().catch((err) => log("error", "signOut", err));
    },
    onManageAccount: () => openAccountInBrowser(),
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

function consentDir() {
  return app.getPath("userData");
}

function consentAccepted() {
  return hasValidConsent(consentDir());
}

function appSession() {
  return session.fromPartition(SESSION_PARTITION);
}

function signInStillValid(now = Date.now()) {
  const record = readSignIn(consentDir());
  return isSignInCurrent(record && record.lastSignInAt, now);
}

function currentUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const url = mainWindow.webContents.getURL();
  if (!url || url === "about:blank") return null;
  return url;
}

function currentReturnUrl() {
  const current = currentUrl();
  if (current) {
    try {
      const parsed = new URL(current);
      if (isContinuingAuth(current, appHosts())) {
        const back = parsed.searchParams.get("from_url") || parsed.searchParams.get("returnTo");
        if (back) return back;
      } else if (appHosts().includes(parsed.hostname)) {
        return current;
      }
    } catch {
      // Keep the default start URL.
    }
  }
  if (pendingRoute && pendingRoute.kind === "page") return appUrl(pendingRoute.path);
  return startUrl();
}

async function clearRemoteSession() {
  const ses = appSession();
  for (const origin of sessionOrigins(appOrigin())) {
    try {
      await ses.clearStorageData({ origin, storages: ["cookies", "localstorage"] });
    } catch (err) {
      log("warn", "clear storage", origin, err);
    }
  }
}

function forceSignIn(returnUrl, options = {}) {
  if (signInInFlight) return signInInFlight;
  awaitingSignIn = true;
  const generation = ++sessionGeneration;
  signInInFlight = (async () => {
    log("info", "force-sign-in-begin", returnUrl || startUrl());
    clearSignIn(consentDir());
    await clearRemoteSession();
    log("info", "force-sign-in-cleared", sessionGeneration);
    if (generation !== sessionGeneration) return;
    const login = loginUrlFor(returnUrl || startUrl());
    log("info", "sign-in-required", login);
    await openRemote(login, "sign-in", options);
  })().finally(() => {
    signInInFlight = null;
  });
  return signInInFlight;
}

function enforceSignIn({ show = true } = {}) {
  if (!consentAccepted() || signInStillValid()) return null;
  const current = currentUrl();
  if (current && isContinuingAuth(current, appHosts())) return null;
  return forceSignIn(currentReturnUrl(), { show });
}

async function signOut() {
  awaitingSignIn = true;
  sessionGeneration += 1;
  clearSignIn(consentDir());
  await clearRemoteSession();
  if (!consentAccepted()) {
    stopRemotePage();
    showConsent({ review: false });
    return;
  }
  await openRemote(loginUrlFor(startUrl()), "sign-in", { show: true });
}

function showMainWindow() {
  if (!consentAccepted()) {
    showConsent({ review: false });
    return;
  }
  if (!signInStillValid()) {
    const current = currentUrl();
    if (!current || !isContinuingAuth(current, appHosts())) {
      forceSignIn(currentReturnUrl(), { show: true }).catch((err) => log("error", "forceSignIn", err));
      if (!mainWindow || mainWindow.isDestroyed()) return;
    }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    windowConcealed = false;
    createWindow({ show: true, url: startUrl(), intent: "start" }).catch((err) => log("error", "createWindow", err));
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
    await appSession().loadExtension(dir, { allowFileAccess: true });
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

async function observeAuth(win) {
  if (!win || win.isDestroyed()) return;
  const url = win.webContents.getURL();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!appHosts().includes(parsed.hostname)) return;
  const generation = sessionGeneration;
  let token = "";
  try {
    token = await win.webContents.executeJavaScript(
      `(() => { try { return localStorage.getItem(${JSON.stringify(AUTH_TOKEN_KEY)}) || ""; } catch (e) { return ""; } })()`,
      true,
    );
  } catch (err) {
    log("warn", "auth token read failed", err);
    return;
  }
  if (generation !== sessionGeneration || win.isDestroyed()) return;
  if (awaitingSignIn && didSignIn({ token, pageUrl: url })) {
    writeSignIn(consentDir());
    awaitingSignIn = false;
    log("info", "sign-in-recorded", parsed.pathname);
    return;
  }
  if (isProtectedPath(parsed.pathname) && !signInStillValid()) {
    await forceSignIn(url);
  }
}

async function createWindow({ show, url, intent }) {
  if (!consentAccepted()) {
    showConsent({ review: false });
    return;
  }
  windowConcealed = !show;
  loadIntent = intent || "start";
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
      partition: SESSION_PARTITION,
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
    const decision = decideNavigation(url);
    if (decision === "protocol") {
      handleQonoLink(url);
      return { action: "deny" };
    }
    if (decision === "auth") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: win,
          webPreferences: {
            partition: SESSION_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        },
      };
    }
    if (decision === "account") {
      openAccountUrl(url);
      return { action: "deny" };
    }
    if (isAppPage(url)) {
      openRemote(url, "deep").catch((err) => log("error", "openRemote", err));
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  const blockAccountNavigation = (event, url) => {
    if (classifyLink(url) === "in-app") {
      event.preventDefault();
      handleQonoLink(url);
      return;
    }
    const decision = decideNavigation(url);
    if (decision === "account") {
      event.preventDefault();
      openAccountUrl(url);
      return;
    }
    // A sign-in in progress navigates from /login (or Google) to the return
    // path before did-finish-load can record the token. Let that navigation
    // finish; observeAuth sends it back to login if the token is missing.
    if (decision !== "auth" && isProtectedAppUrl(url, appHosts()) && !signInStillValid() && !awaitingSignIn) {
      event.preventDefault();
      forceSignIn(url).catch((err) => log("error", "forceSignIn", err));
    }
  };
  win.webContents.on("will-navigate", blockAccountNavigation);
  win.webContents.on("will-redirect", blockAccountNavigation);

  win.on("close", (event) => {
    if (isQuitting || allowMainClose || !trayAvailable) return;
    event.preventDefault();
    concealWindow();
  });

  const onReveal = () => {
    const check = enforceSignIn({ show: false });
    if (check && typeof check.catch === "function") {
      check.catch((err) => log("error", "sign-in reveal", err));
    }
  };
  win.on("show", onReveal);
  win.on("restore", onReveal);

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
    if (loadIntent === "start" && !fellBack && homeUrl() !== startUrl()) {
      fellBack = true;
      loadIntent = "home";
      log("warn", "start url failed, opening", homeUrl(), code, description);
      win.loadURL(homeUrl());
      return;
    }
    loadError = `${code} ${description} ${url}`;
    log("error", "did-fail-load", loadError);
    sendSmokeReady();
  });

  const watchAuth = () => {
    observeAuth(win).catch((err) => log("warn", "auth observe", err));
  };
  win.webContents.on("did-finish-load", () => {
    pageLoaded = true;
    log("info", "window-loaded", win.webContents.getURL());
    watchAuth();
    maybeSmokeReady();
  });
  win.webContents.on("did-navigate", watchAuth);
  win.webContents.on("did-navigate-in-page", watchAuth);

  win.once("ready-to-show", () => {
    if (!windowConcealed) showMainWindow();
    maybeSmokeReady();
  });

  watchShareMessages(win);
  win.loadURL(url || startUrl());
}

function showConsent({ review }) {
  const query = { mode: review ? "review" : "first" };
  if (consentWindow && !consentWindow.isDestroyed()) {
    consentWindow.loadFile(path.join(__dirname, "consent.html"), { query });
    consentWindow.show();
    consentWindow.focus();
    return;
  }
  consentWindow = new BrowserWindow({
    width: 760,
    height: 820,
    show: false,
    title: "Qono",
    backgroundColor: "#07070b",
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "consent-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const win = consentWindow;
  win.setMenu(null);
  win.on("closed", () => {
    if (consentWindow === win) consentWindow = null;
  });
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.show();
    sendSmokeReady();
  });
  win.webContents.on("did-finish-load", () => {
    log("info", "consent-loaded", win.webContents.getURL());
    if (!win.isDestroyed()) win.show();
    sendSmokeReady();
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    log("error", "consent-failed", code, description, url);
    sendSmokeReady();
  });
  win.loadFile(path.join(__dirname, "consent.html"), { query });
}

function stopRemotePage() {
  shareCounts.clear();
  setSharing(false);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const win = mainWindow;
  allowMainClose = true;
  mainWindow = null;
  win.destroy();
  allowMainClose = false;
}

async function openRemote(url, intent, { show = true } = {}) {
  if (!consentAccepted()) {
    showConsent({ review: false });
    return;
  }
  if (intent !== "sign-in" && !signInStillValid()) {
    await forceSignIn(url, { show });
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow({ show, url, intent });
    return;
  }
  windowConcealed = !show;
  loadIntent = intent;
  if (show) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  mainWindow.loadURL(url);
}

function handleQonoLink(raw) {
  const route = parseQonoLink(raw);
  if (!route) {
    log("warn", "ignored qono link", raw);
    return;
  }
  log("info", "qono-link", raw);
  if (route.kind === "consent") {
    showConsent({ review: consentAccepted() });
    return;
  }
  if (!consentAccepted()) {
    pendingRoute = route;
    showConsent({ review: false });
    return;
  }
  pendingRoute = null;
  openRemote(appUrl(route.path), "deep").catch((err) => log("error", "openRemote", err));
}

function acceptConsent() {
  writeConsent(consentDir());
  const route = pendingRoute;
  pendingRoute = null;
  if (consentWindow && !consentWindow.isDestroyed()) consentWindow.close();
  const url = route && route.kind === "page" ? appUrl(route.path) : startUrl();
  return openRemote(url, route && route.kind === "page" ? "deep" : "start");
}

function withdrawConsent() {
  clearConsent(consentDir());
  pendingRoute = null;
  stopRemotePage();
  showConsent({ review: false });
}

function registerConsentIpc() {
  ipcMain.handle("qono-consent-agree", () => acceptConsent());
  ipcMain.handle("qono-consent-quit", () => beginQuit({ hard: false }));
  ipcMain.handle("qono-consent-withdraw", () => withdrawConsent());
  ipcMain.handle("qono-consent-close", () => {
    if (consentWindow && !consentWindow.isDestroyed()) consentWindow.close();
  });
}

function appHosts() {
  const hosts = ["qono.net", "www.qono.net"];
  if (process.env.QONO_URL) {
    try {
      hosts.push(new URL(process.env.QONO_URL).hostname);
    } catch {
      // Ignore a bad test override.
    }
  }
  return hosts;
}

function decideNavigation(url) {
  if (classifyLink(url) === "in-app") return "protocol";
  if (isContinuingAuth(url, appHosts())) return "auth";
  if (isAccountBillingNavigation(url, { appHosts: appHosts() })) return "account";
  return "app";
}

function isAppPage(url) {
  try {
    const parsed = new URL(url);
    return appHosts().includes(parsed.hostname);
  } catch {
    return false;
  }
}

function openAccountUrl(url) {
  const target = url || manageAccountUrl();
  log("info", "account-external", target);
  shell.openExternal(target);
  showAccountNotice();
}

function openAccountInBrowser() {
  openAccountUrl(manageAccountUrl());
}

function showAccountNotice() {
  log("info", "account-notice", ACCOUNT_NOTICE);
  if (accountNoticeTimer) clearTimeout(accountNoticeTimer);
  if (accountNoticeWindow && !accountNoticeWindow.isDestroyed()) {
    accountNoticeWindow.showInactive();
    accountNoticeTimer = setTimeout(() => closeAccountNotice(), 4500);
    return;
  }
  accountNoticeWindow = new BrowserWindow({
    width: 460,
    height: 64,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    title: "Qono",
    backgroundColor: "#1c1c27",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const win = accountNoticeWindow;
  win.setMenu(null);
  win.on("closed", () => {
    if (accountNoticeWindow === win) accountNoticeWindow = null;
  });
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    const anchor = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : win.getBounds();
    win.setPosition(
      Math.round(anchor.x + (anchor.width - 460) / 2),
      Math.round(anchor.y + anchor.height - 90),
    );
    win.showInactive();
  });
  win.loadFile(path.join(__dirname, "account-notice.html"));
  accountNoticeTimer = setTimeout(() => closeAccountNotice(), 4500);
}

function closeAccountNotice() {
  if (accountNoticeTimer) clearTimeout(accountNoticeTimer);
  accountNoticeTimer = null;
  if (accountNoticeWindow && !accountNoticeWindow.isDestroyed()) accountNoticeWindow.close();
}

function installUserAgent() {
  const suffix = `QonoDesktop/${app.getVersion()}`;
  const current = appSession().getUserAgent();
  if (!current.includes(suffix)) {
    appSession().setUserAgent(`${current} ${suffix}`);
  }
  log("info", "user-agent", suffix);
}

function registerProtocol() {
  if (process.env.QONO_SMOKE === "1") return;
  try {
    const registered = process.defaultApp
      ? app.setAsDefaultProtocolClient("qono", process.execPath, [path.resolve(process.argv[1])])
      : app.setAsDefaultProtocolClient("qono");
    log("info", "protocol-qono", registered);
  } catch (err) {
    log("warn", "protocol registration failed", err);
  }
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
  const link = findQonoLink(argv);
  if (link) {
    if (app.isReady()) handleQonoLink(link);
    else pendingProtocolUrl = link;
    return;
  }
  if (app.isReady()) showMainWindow();
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
    consentAccepted: consentAccepted(),
    consentVisible: !!(consentWindow && !consentWindow.isDestroyed() && consentWindow.isVisible()),
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
        const target = consentWindow && !consentWindow.isDestroyed() && consentWindow.isVisible()
          ? consentWindow
          : mainWindow;
        const image = await target.webContents.capturePage();
        fs.writeFileSync(msg.path, image.toPNG());
        sendSmoke({ type: "screenshot", id: msg.id, ok: true });
      } catch (err) {
        sendSmoke({ type: "screenshot", id: msg.id, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (msg.cmd === "agree") {
      try {
        await acceptConsent();
        sendSmoke({ type: "status", id: msg.id, ...snapshot() });
      } catch (err) {
        log("error", "consent-agree", err);
        sendSmoke({ type: "status", id: msg.id, error: String(err && err.message || err), ...snapshot() });
      }
      return;
    }
    if (msg.cmd === "withdraw") {
      withdrawConsent();
      sendSmoke({ type: "status", id: msg.id, ...snapshot() });
      return;
    }
    if (msg.cmd === "open-link") {
      handleQonoLink(msg.url);
      sendSmoke({ type: "status", id: msg.id, ...snapshot() });
      return;
    }
    if (msg.cmd === "eval") {
      const target = msg.target === "consent" || !mainWindow || mainWindow.isDestroyed()
        ? consentWindow
        : mainWindow;
      log("info", "smoke-eval", msg.target || "main", !!(target && !target.isDestroyed()));
      try {
        const result = await Promise.race([
          target.webContents.executeJavaScript(msg.code, true),
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error("eval timeout")), 3000)),
        ]);
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
  appSession().setDisplayMediaRequestHandler(
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
  registerConsentIpc();
  installUserAgent();
  setupDisplayMedia();
  await installShareExtension();
  try {
    createTray();
  } catch (err) {
    trayAvailable = false;
    log("error", "tray failed", err);
    if (process.env.QONO_SMOKE === "1") throw err;
  }
  log("info", "start-url-constant", QONO_START_URL);
  const launchLink = pendingProtocolUrl || findQonoLink(process.argv);
  pendingProtocolUrl = null;
  if (launchLink) {
    handleQonoLink(launchLink);
  } else if (consentAccepted()) {
    if (signInStillValid()) {
      await createWindow({ show: !shouldStartHidden(), url: startUrl(), intent: "start" });
    } else {
      await forceSignIn(startUrl(), { show: !shouldStartHidden() });
    }
  } else if (!shouldStartHidden()) {
    showConsent({ review: false });
  } else {
    log("info", "hidden-without-consent");
    sendSmokeReady();
  }
  startUpdater();
  setInterval(() => {
    const check = enforceSignIn({ show: true });
    if (check && typeof check.catch === "function") {
      check.catch((err) => log("error", "sign-in check", err));
    }
  }, SIGN_IN_CHECK_MS);
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

  registerProtocol();
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) handleQonoLink(url);
    else pendingProtocolUrl = url;
  });
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
