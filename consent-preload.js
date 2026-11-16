"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qonoConsent", {
  agree: () => ipcRenderer.invoke("qono-consent-agree"),
  quit: () => ipcRenderer.invoke("qono-consent-quit"),
  withdraw: () => ipcRenderer.invoke("qono-consent-withdraw"),
  closeReview: () => ipcRenderer.invoke("qono-consent-close"),
});
