import type { WmsState } from "./types";
import type { MergeSummary } from "./mergeImport";

export interface DbBridge {
  load: () => Promise<WmsState>;
  save: (state: WmsState) => Promise<{ ok: true }>;
  exportBackup: () => Promise<{ ok: boolean; path?: string; error?: string; cancelled?: boolean }>;
  importBackup: () => Promise<{ ok: boolean; state?: WmsState; error?: string; cancelled?: boolean }>;
  importMergeBackup: () => Promise<{
    ok: boolean;
    state?: WmsState;
    summary?: MergeSummary;
    error?: string;
    cancelled?: boolean;
  }>;
  getAppVersion: () => Promise<string>;
  getTheme: () => Promise<"dark" | "light">;
  setTheme: (theme: "dark" | "light") => Promise<{ ok: true }>;
  isElectron: true;
}

declare global {
  interface Window {
    db?: DbBridge;
  }
}

export {};
