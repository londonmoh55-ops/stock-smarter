/**
 * JSON file persistence in userData.
 * Chose JSON over better-sqlite3: single-user offline app, monolithic WmsState,
 * no relational queries — avoids native-module packaging complexity in Electron.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { WmsState } from "../src/lib/wms/types";
import { buildSeed } from "../src/lib/wms/seed";
import { migrateToCurrent } from "../src/lib/wms/migrate";
import {
  BACKUP_APP_VERSION,
  applyMergeBackup,
  applyReplaceBackup,
  buildExportPayload,
  validateExportPayload,
  type ExportPayload,
  type MergeSummary,
} from "../src/lib/wms/backupPayload";

export type { ExportPayload, MergeSummary };
export { buildExportPayload, validateExportPayload };

const DB_FILE = "warehouse-data.json";
const BACKUP_COUNT = 10;

export const APP_VERSION = BACKUP_APP_VERSION;

function dbPath(): string {
  return path.join(app.getPath("userData"), DB_FILE);
}

function backupsDir(): string {
  return path.join(app.getPath("userData"), "backups");
}

function preferencesPath(): string {
  return path.join(app.getPath("userData"), "preferences.json");
}

function ensureDirs(): void {
  fs.mkdirSync(backupsDir(), { recursive: true });
}

function rotateBackup(snapshot: string): void {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupsDir(), `warehouse-data-${stamp}.json`);
  fs.writeFileSync(backupFile, snapshot, "utf8");

  const files = fs
    .readdirSync(backupsDir())
    .filter((f) => f.startsWith("warehouse-data-") && f.endsWith(".json"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(backupsDir(), f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of files.slice(BACKUP_COUNT)) {
    fs.unlinkSync(path.join(backupsDir(), old.name));
  }
}

/** Atomic write: temp file then rename. */
export function writeStateAtomic(state: WmsState, options?: { skipBackup?: boolean }): void {
  ensureDirs();
  const target = dbPath();
  const payload = JSON.stringify(state, null, 2);

  if (!options?.skipBackup && fs.existsSync(target)) {
    try {
      rotateBackup(fs.readFileSync(target, "utf8"));
    } catch {
      /* best-effort */
    }
  }

  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, target);
}

export function readState(): WmsState {
  ensureDirs();
  const target = dbPath();
  if (!fs.existsSync(target)) {
    const seed = buildSeed();
    writeStateAtomic(seed, { skipBackup: true });
    return seed;
  }
  try {
    const raw = fs.readFileSync(target, "utf8");
    return migrateToCurrent(JSON.parse(raw) as WmsState);
  } catch {
    const seed = buildSeed();
    writeStateAtomic(seed, { skipBackup: true });
    return seed;
  }
}

export function importState(payload: ExportPayload): WmsState {
  const next = applyReplaceBackup(payload);
  if (fs.existsSync(dbPath())) {
    rotateBackup(fs.readFileSync(dbPath(), "utf8"));
  }
  writeStateAtomic(next, { skipBackup: true });
  return next;
}

/** Keep local cash/stock/ledgers; add new master data and open bons from backup. */
export function mergeImportState(payload: ExportPayload): {
  state: WmsState;
  summary: MergeSummary;
} {
  const local = readState();
  if (fs.existsSync(dbPath())) {
    rotateBackup(fs.readFileSync(dbPath(), "utf8"));
  }
  const { state, summary } = applyMergeBackup(local, payload);
  writeStateAtomic(state, { skipBackup: true });
  return { state, summary };
}

export function readPreferences(): { theme: "dark" | "light" } {
  try {
    if (fs.existsSync(preferencesPath())) {
      const p = JSON.parse(fs.readFileSync(preferencesPath(), "utf8")) as { theme?: string };
      const theme = p.theme === "dark" || p.theme === "light" ? p.theme : "light";
      return { theme };
    }
  } catch {
    /* ignore */
  }
  return { theme: "light" };
}

export function writePreferences(prefs: { theme?: "dark" | "light" }): void {
  ensureDirs();
  const current = readPreferences();
  const merged = { ...current, ...prefs };
  const tmp = `${preferencesPath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
  fs.renameSync(tmp, preferencesPath());
}
