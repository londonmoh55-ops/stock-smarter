import { useSyncExternalStore } from "react";
import type { WmsState } from "./types";
import { buildSeed } from "./seed";
import { migrateToCurrent } from "./migrate";
import { loadWarehouseState, saveWarehouseState } from "./firestoreSync";

/** Frozen snapshot for SSR — must match client’s first paint before disk hydrate. */
const SSR_STATE: WmsState = buildSeed();
let state: WmsState = SSR_STATE;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
/** When true, persist/hydrate the shared Firestore warehouse (web). */
let cloudSync = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Enable/disable shared Firestore persistence (web). Pass false on sign-out. */
export function setCloudSync(enabled: boolean): void {
  if (cloudSync === enabled) return;
  cloudSync = enabled;
  hydrated = false;
  hydratePromise = null;
  if (!enabled) {
    state = SSR_STATE;
    listeners.forEach((l) => l());
  }
}

/** @deprecated Use setCloudSync — kept for older call sites. */
export function setCloudUser(uid: string | null): void {
  setCloudSync(Boolean(uid));
}

async function hydrateFromDisk(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hydrated) return;
  if (window.db) {
    try {
      state = migrateToCurrent(await window.db.load());
    } catch {
      /* keep in-memory seed */
    }
  } else if (cloudSync) {
    try {
      const remote = await loadWarehouseState();
      if (remote) state = migrateToCurrent(remote);
      else {
        state = buildSeed();
        await saveWarehouseState(state);
      }
    } catch (error) {
      console.error("Firestore hydrate failed", error);
    }
  }
  hydrated = true;
  listeners.forEach((l) => l());
}

export function waitForStore(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydratePromise) {
    hydratePromise = hydrateFromDisk();
  }
  return hydratePromise;
}

export function isStoreReady(): boolean {
  return hydrated;
}

function persist() {
  if (typeof window === "undefined") return;
  if (window.db) {
    void window.db.save(state);
    return;
  }
  if (!cloudSync) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!cloudSync) return;
    void saveWarehouseState(state).catch((error) => {
      console.error("Firestore save failed", error);
    });
  }, 400);
}

export function getState(): WmsState {
  return state;
}

export function setState(updater: (s: WmsState) => WmsState) {
  state = updater(state);
  persist();
  listeners.forEach((l) => l());
}

/** Replace entire state (e.g. after import) and notify subscribers. */
export function replaceState(next: WmsState) {
  state = migrateToCurrent(next);
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useWms<T>(selector: (s: WmsState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
    () => selector(SSR_STATE),
  );
}

export function resetToInitial() {
  state = buildSeed();
  persist();
  listeners.forEach((l) => l());
}

export function peekNextNumber(
  kind: keyof WmsState["counters"],
  prefix: string,
  s: WmsState = state,
): { number: string; counters: WmsState["counters"] } {
  const n = s.counters[kind] + 1;
  return {
    number: `${prefix}-${String(n).padStart(4, "0")}`,
    counters: { ...s.counters, [kind]: n },
  };
}

/** @deprecated Use peekNextNumber inside a single setState to avoid double-writes. */
export function nextNumber(kind: keyof WmsState["counters"], prefix: string): string {
  const { number, counters } = peekNextNumber(kind, prefix);
  setState((s) => ({ ...s, counters }));
  return number;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
