const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("qonoDesktop", {
  isDesktop: true,
  platform: process.platform,
});