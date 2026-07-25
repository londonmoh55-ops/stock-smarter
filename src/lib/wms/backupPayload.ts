import type { WmsState } from "./types";
import { migrateToCurrent } from "./migrate";
import { mergeWmsState, type MergeSummary } from "./mergeImport";

export type { MergeSummary };

export const BACKUP_APP_VERSION = "1.0.0";

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

export function buildExportPayload(
  state: WmsState,
  appVersion: string = BACKUP_APP_VERSION,
): ExportPayload {
  return {
    schemaVersion: 4,
    exportDate: new Date().toISOString(),
    appVersion,
    data: state,
  };
}

export function applyReplaceBackup(raw: unknown): WmsState {
  if (!validateExportPayload(raw)) {
    throw new Error("Invalid backup file structure.");
  }
  return migrateToCurrent(raw.data);
}

export function applyMergeBackup(
  local: WmsState,
  raw: unknown,
): { state: WmsState; summary: MergeSummary } {
  if (!validateExportPayload(raw)) {
    throw new Error("Invalid backup file structure.");
  }
  return mergeWmsState(local, raw.data);
}

export function downloadJsonBackup(filename: string, payload: ExportPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readBackupFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}

export function backupFilename(date = new Date()): string {
  return `warehouse-backup-${date.toISOString().slice(0, 10)}.json`;
}
