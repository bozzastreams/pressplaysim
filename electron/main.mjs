import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { startServer } from "../dist-server/index.js";

let service;
let closing = false;

async function createWindow() {
  service = await startServer({
    port: 0,
    dev: false,
    dataDir: join(app.getPath("userData"), "data"),
    staticDir: join(import.meta.dirname, "..", "dist"),
  });

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
    title: "PressPlaySim",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL(`http://127.0.0.1:${service.port}`);
}

app.whenReady().then(createWindow).catch((error) => {
  console.error("Could not start PressPlaySim", error);
  app.quit();
});

app.on("before-quit", (event) => {
  if (!service || closing) return;
  event.preventDefault();
  closing = true;
  service.close().finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
