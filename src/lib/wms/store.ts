import { useSyncExternalStore } from "react";
import type { WmsState } from "./types";
import { buildSeed } from "./seed";
import { migrateToCurrent } from "./migrate";

/** Frozen snapshot for SSR — must match client’s first paint before disk hydrate. */
const SSR_STATE: WmsState = buildSeed();
let state: WmsState = SSR_STATE;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function hydrateFromDisk(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hydrated) return;
  if (window.db) {
    try {
      state = migrateToCurrent(await window.db.load());
    } catch {
      /* keep in-memory seed */
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
  if (typeof window !== "undefined" && window.db) {
    void window.db.save(state);
  }
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
