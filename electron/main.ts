import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  APP_VERSION,
  buildExportPayload,
  importState,
  mergeImportState,
  readPreferences,
  readState,
  validateExportPayload,
  writePreferences,
  writeStateAtomic,
} from "./database";
import type { WmsState } from "../src/lib/wms/types";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function preloadPath(): string {
  return path.join(process.cwd(), "electron", "preload.mjs");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.setFullScreen(true);
    mainWindow?.show();
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
      return;
    }
    if (input.key === "Escape" && mainWindow?.isFullScreen()) {
      mainWindow.setFullScreen(false);
      event.preventDefault();
    }
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
    console.log("[electron] Loading dev URL:", devUrl);
    void mainWindow.loadURL(devUrl).catch((err) => {
      console.error("[electron] Failed to load dev URL:", err);
    });
    mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.error("[electron] did-fail-load", { code, desc, url });
    });
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexHtml = path.join(app.getAppPath(), "dist", "client", "index.html");
    if (fs.existsSync(indexHtml)) {
      mainWindow.loadFile(indexHtml);
    } else {
      mainWindow.loadURL("http://127.0.0.1:5173");
    }
  }

  // Allow print preview popups (blob: / about:blank) as real BrowserWindows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("blob:") || url === "about:blank" || url.startsWith("data:text/html")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
          },
        },
      };
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  console.log("[electron] IPC handlers registered (db)");

  ipcMain.handle("db:load", (): WmsState => readState());

  ipcMain.handle("db:save", (_e, state: WmsState): { ok: true } => {
    writeStateAtomic(state);
    return { ok: true };
  });

  ipcMain.handle("db:version", (): string => APP_VERSION);

  ipcMain.handle("prefs:getTheme", () => readPreferences().theme);

  ipcMain.handle("prefs:setTheme", (_e, theme: "dark" | "light") => {
    writePreferences({ theme });
    return { ok: true };
  });

  ipcMain.handle("db:export", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: "Export warehouse backup",
      defaultPath: `warehouse-backup-${stamp}.json`,
      filters: [{ name: "Warehouse Backup", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    const payload = buildExportPayload(readState());
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    return { ok: true, path: filePath };
  });

  ipcMain.handle("db:import", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: "Import warehouse backup",
      filters: [{ name: "Warehouse Backup", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return { ok: false, cancelled: true };

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
    } catch {
      return { ok: false, error: "Could not read file — invalid JSON." };
    }

    if (!validateExportPayload(parsed)) {
      return {
        ok: false,
        error: "Invalid backup file. Expected schemaVersion, exportDate, appVersion, and data with all entity tables.",
      };
    }

    const confirm = await dialog.showMessageBox(win!, {
      type: "warning",
      buttons: ["Cancel", "Replace All Data"],
      defaultId: 0,
      cancelId: 0,
      title: "Replace all data?",
      message: "Importing will REPLACE all current warehouse data.",
      detail:
        "A snapshot of your current data will be saved to the automatic backups folder before import.",
    });

    if (confirm.response !== 1) return { ok: false, cancelled: true };

    const state = importState(parsed);
    return { ok: true, state };
  });

  ipcMain.handle("db:importMerge", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: "Merge backup (add only)",
      filters: [{ name: "JSON Backup", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths[0]) return { ok: false, cancelled: true };

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
    } catch {
      return { ok: false, error: "Could not read backup file (invalid JSON)." };
    }

    if (!validateExportPayload(parsed)) {
      return {
        ok: false,
        error:
          "Invalid backup file. Expected schemaVersion, exportDate, appVersion, and data with all entity tables.",
      };
    }

    const confirm = await dialog.showMessageBox(win!, {
      type: "question",
      buttons: ["Cancel", "Merge Additions"],
      defaultId: 1,
      cancelId: 0,
      title: "Merge backup?",
      message: "Add new products, customers, transporters, and open bons from this backup.",
      detail:
        "Your cash, stock, ledgers, sales, and settings stay unchanged. Duplicate invoices are skipped. A snapshot of current data is saved first.",
    });

    if (confirm.response !== 1) return { ok: false, cancelled: true };

    const { state, summary } = mergeImportState(parsed);
    return { ok: true, state, summary };
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
