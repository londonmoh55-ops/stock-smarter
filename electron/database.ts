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
import { mergeWmsState, type MergeSummary } from "../src/lib/wms/mergeImport";

export type { MergeSummary };

const DB_FILE = "warehouse-data.json";
const BACKUP_COUNT = 10;

export const APP_VERSION = "1.0.0";

export interface BackupMetadata {
  exportDate: string;
  appVersion: string;
  schemaVersion: 1 | 2 | 3 | 4;
}

export interface ExportPayload extends BackupMetadata {
  data: WmsState;
}

const WMS_KEYS_V2 = [
  "products",
  "customers",
  "transporters",
  "cargoBons",
  "customerStock",
  "customerLedger",
  "transporterLedger",
  "cashRegisters",
  "cashTransactions",
  "bonExceptions",
  "company",
  "counters",
] as const;

const WMS_KEYS_V3 = [
  ...WMS_KEYS_V2,
  "preArrivalBons",
  "arrivalVerifications",
  "shortageHistory",
] as const;

const WMS_KEYS_V4 = [...WMS_KEYS_V3, "settings"] as const;

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

export function validateExportPayload(raw: unknown): raw is ExportPayload {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 4 && o.schemaVersion !== 3 && o.schemaVersion !== 2 && o.schemaVersion !== 1) {
    return false;
  }
  if (typeof o.exportDate !== "string") return false;
  if (typeof o.appVersion !== "string") return false;
  if (!o.data || typeof o.data !== "object") return false;
  const data = o.data as Record<string, unknown>;
  if (o.schemaVersion === 4) {
    return WMS_KEYS_V4.every((k) => k in data);
  }
  if (o.schemaVersion === 3) {
    return WMS_KEYS_V3.every((k) => k in data);
  }
  if (o.schemaVersion === 2) {
    return WMS_KEYS_V2.every((k) => k in data);
  }
  return typeof data.products === "object" && typeof data.customers === "object";
}

export function buildExportPayload(state: WmsState): ExportPayload {
  return {
    schemaVersion: 4,
    exportDate: new Date().toISOString(),
    appVersion: APP_VERSION,
    data: state,
  };
}

export function importState(payload: ExportPayload): WmsState {
  if (!validateExportPayload(payload)) {
    throw new Error("Invalid backup file structure.");
  }
  // Pre-import snapshot of current data
  if (fs.existsSync(dbPath())) {
    rotateBackup(fs.readFileSync(dbPath(), "utf8"));
  }
  writeStateAtomic(migrateToCurrent(payload.data), { skipBackup: true });
  return migrateToCurrent(payload.data);
}

/** Keep local cash/stock/ledgers; add new master data and open bons from backup. */
export function mergeImportState(payload: ExportPayload): {
  state: WmsState;
  summary: MergeSummary;
} {
  if (!validateExportPayload(payload)) {
    throw new Error("Invalid backup file structure.");
  }
  const local = readState();
  if (fs.existsSync(dbPath())) {
    rotateBackup(fs.readFileSync(dbPath(), "utf8"));
  }
  const { state, summary } = mergeWmsState(local, payload.data);
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
