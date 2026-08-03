import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  onSnapshot,
  runTransaction,
  deleteField,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import type { WmsState } from "@/lib/wms/types";
import { downloadWarehouseStateJson, uploadWarehouseStateJson } from "@/lib/wms/storageState";

/** Single shared warehouse for the whole team (not per-user). */
export const SHARED_WAREHOUSE_PATH = ["shared", "main", "warehouse", "state"] as const;

export type WarehouseSnapshot = {
  state: WmsState | null;
  revision: number;
  /** Firestore updatedAt millis — detects writes from clients that don't bump revision. */
  updatedAtMs: number;
  /** True when blob lives in Storage (no Firestore `data`). */
  storageBacked?: boolean;
};

/** Thrown when another device advanced the warehouse revision before our write. */
export class StaleWarehouseWriteError extends Error {
  readonly remote: WarehouseSnapshot;

  constructor(remote: WarehouseSnapshot) {
    super("Cloud was updated on another device — reloaded. Retry your edit.");
    this.name = "StaleWarehouseWriteError";
    this.remote = remote;
  }
}

function warehouseRef() {
  const [a, b, c, d] = SHARED_WAREHOUSE_PATH;
  return doc(getFirebaseDb(), a, b, c, d);
}

function parseUpdatedAtMs(raw: unknown): number {
  if (!raw || typeof raw !== "object") {
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  }
  const ts = raw as { toMillis?: () => number; seconds?: number };
  if (typeof ts.toMillis === "function") {
    try {
      return ts.toMillis();
    } catch {
      /* fall through */
    }
  }
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function parseMeta(raw: Record<string, unknown> | undefined): {
  revision: number;
  updatedAtMs: number;
  legacyData: WmsState | null;
} {
  if (!raw) return { revision: 0, updatedAtMs: 0, legacyData: null };
  const revision =
    typeof raw.revision === "number" && Number.isFinite(raw.revision) ? raw.revision : 0;
  const updatedAtMs = parseUpdatedAtMs(raw.updatedAt);
  const payload = raw.data;
  const legacyData = payload && typeof payload === "object" ? (payload as WmsState) : null;
  return { revision, updatedAtMs, legacyData };
}

/** True when remote is strictly newer than what this tab last applied. */
export function isNewerWarehouseSnapshot(
  remote: WarehouseSnapshot,
  localRevision: number,
  localUpdatedAtMs: number,
): boolean {
  if (remote.revision > localRevision) return true;
  if (remote.revision < localRevision) return false;
  return remote.updatedAtMs > localUpdatedAtMs;
}

let migrateInFlight: Promise<void> | null = null;

/**
 * One-time: copy legacy Firestore `data` into Storage and clear the field.
 */
async function migrateLegacyFirestoreData(
  legacy: WmsState,
  revision: number,
  updatedAtMs: number,
): Promise<void> {
  if (migrateInFlight) {
    await migrateInFlight;
    return;
  }
  migrateInFlight = (async () => {
    await uploadWarehouseStateJson(legacy);
    const ref = warehouseRef();
    await runTransaction(getFirebaseDb(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        tx.set(ref, {
          revision: Math.max(1, revision),
          updatedAt: serverTimestamp(),
          storageBacked: true,
        });
        return;
      }
      const meta = parseMeta(snap.data() as Record<string, unknown>);
      // Another client may have already cleared `data` or advanced revision.
      if (!meta.legacyData) return;
      tx.set(
        ref,
        {
          revision: meta.revision || Math.max(1, revision),
          updatedAt: serverTimestamp(),
          storageBacked: true,
          data: deleteField(),
        },
        { merge: true },
      );
    });
    void updatedAtMs;
  })().finally(() => {
    migrateInFlight = null;
  });
  await migrateInFlight;
}

async function resolveStateFromCloud(
  legacyData: WmsState | null,
  revision: number,
  updatedAtMs: number,
): Promise<{ state: WmsState | null; storageBacked: boolean }> {
  const fromStorage = await downloadWarehouseStateJson();
  if (fromStorage) {
    if (legacyData) {
      // Clear Firestore blob in background so we stop hitting the 1 MiB cap.
      void migrateLegacyFirestoreData(legacyData, revision, updatedAtMs).catch((err) => {
        console.warn("Warehouse Storage migration (clear Firestore data) failed", err);
      });
    }
    return { state: fromStorage, storageBacked: true };
  }
  if (legacyData) {
    try {
      await migrateLegacyFirestoreData(legacyData, revision, updatedAtMs);
    } catch (err) {
      console.warn("Warehouse migrate to Storage failed; using Firestore data once", err);
    }
    return { state: legacyData, storageBacked: false };
  }
  return { state: null, storageBacked: false };
}

/** Load the shared warehouse snapshot. Returns null if no cloud doc / blob yet. */
export async function loadWarehouseSnapshot(): Promise<WarehouseSnapshot | null> {
  const snap = await getDoc(warehouseRef());
  if (!snap.exists()) {
    // Doc missing — still try Storage (partial deploy / wiped pointer).
    const fromStorage = await downloadWarehouseStateJson().catch(() => null);
    if (!fromStorage) return null;
    return {
      state: fromStorage,
      revision: 1,
      updatedAtMs: Date.now(),
      storageBacked: true,
    };
  }

  const meta = parseMeta(snap.data() as Record<string, unknown>);
  const resolved = await resolveStateFromCloud(meta.legacyData, meta.revision, meta.updatedAtMs);
  if (!resolved.state && meta.revision === 0) return null;
  return {
    state: resolved.state,
    revision: meta.revision,
    updatedAtMs: meta.updatedAtMs,
    storageBacked: resolved.storageBacked,
  };
}

/** @deprecated Prefer loadWarehouseSnapshot — kept for older call sites. */
export async function loadWarehouseState(): Promise<WmsState | null> {
  const snap = await loadWarehouseSnapshot();
  return snap?.state ?? null;
}

export type SaveWarehouseResult = {
  revision: number;
  updatedAtMs: number;
};

/**
 * Persist warehouse state: Storage blob + tiny Firestore revision pointer.
 */
export async function saveWarehouseState(
  state: WmsState,
  expectedRevision: number,
  expectedUpdatedAtMs: number = 0,
): Promise<SaveWarehouseResult> {
  const nextRevision = expectedRevision + 1;
  const writeStartedAt = Date.now();

  // Upload blob first so a successful revision always has Storage content.
  await uploadWarehouseStateJson(state);

  const ref = warehouseRef();
  let staleRemote: WarehouseSnapshot | null = null;

  try {
    await runTransaction(getFirebaseDb(), async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists()
        ? parseMeta(snap.data() as Record<string, unknown>)
        : { revision: 0, updatedAtMs: 0, legacyData: null };

      if (current.revision !== expectedRevision || current.updatedAtMs > expectedUpdatedAtMs) {
        // Load full remote for the error payload (best-effort).
        staleRemote = {
          state: null,
          revision: current.revision,
          updatedAtMs: current.updatedAtMs,
          storageBacked: !current.legacyData,
        };
        throw new Error("STALE_WAREHOUSE_REVISION");
      }

      tx.set(
        ref,
        {
          revision: nextRevision,
          updatedAt: serverTimestamp(),
          storageBacked: true,
          data: deleteField(),
        },
        { merge: true },
      );
    });
  } catch (error) {
    if (staleRemote) {
      const fresh = await loadWarehouseSnapshot().catch(() => null);
      throw new StaleWarehouseWriteError(fresh ?? staleRemote);
    }
    if (error instanceof Error && error.message.includes("STALE_WAREHOUSE_REVISION")) {
      const fresh = await loadWarehouseSnapshot();
      throw new StaleWarehouseWriteError(fresh ?? { state: null, revision: 0, updatedAtMs: 0 });
    }
    throw error;
  }

  return {
    revision: nextRevision,
    updatedAtMs: Math.max(expectedUpdatedAtMs, writeStartedAt),
  };
}

/** Live updates: Firestore revision pointer → download Storage blob. */
export function subscribeWarehouseState(
  onNext: (snapshot: WarehouseSnapshot) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  let cancelled = false;
  let lastHandledRevision = -1;
  let lastHandledUpdatedAtMs = -1;
  let loadSeq = 0;

  const unsub = onSnapshot(
    warehouseRef(),
    (snap) => {
      void (async () => {
        const seq = ++loadSeq;
        try {
          if (!snap.exists()) {
            if (cancelled || seq !== loadSeq) return;
            const fromStorage = await downloadWarehouseStateJson().catch(() => null);
            if (cancelled || seq !== loadSeq) return;
            onNext({
              state: fromStorage,
              revision: fromStorage ? 1 : 0,
              updatedAtMs: Date.now(),
              storageBacked: Boolean(fromStorage),
            });
            return;
          }

          const meta = parseMeta(snap.data() as Record<string, unknown>);
          if (
            meta.revision === lastHandledRevision &&
            meta.updatedAtMs === lastHandledUpdatedAtMs
          ) {
            return;
          }

          const resolved = await resolveStateFromCloud(
            meta.legacyData,
            meta.revision,
            meta.updatedAtMs,
          );
          if (cancelled || seq !== loadSeq) return;

          lastHandledRevision = meta.revision;
          lastHandledUpdatedAtMs = meta.updatedAtMs;
          onNext({
            state: resolved.state,
            revision: meta.revision,
            updatedAtMs: meta.updatedAtMs,
            storageBacked: resolved.storageBacked,
          });
        } catch (error) {
          if (cancelled || seq !== loadSeq) return;
          onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    },
    (error) => {
      onError?.(error);
    },
  );

  return () => {
    cancelled = true;
    unsub();
  };
}

export type UserProfile = {
  uid: string;
  email: string;
  isAdmin: boolean;
  updatedAt?: unknown;
};

export async function upsertUserProfile(
  uid: string,
  email: string,
  isAdmin: boolean,
): Promise<void> {
  const db = getFirebaseDb();
  const payload = {
    email,
    isAdmin,
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "users", uid), payload, { merge: true });
  await setDoc(doc(db, "users", uid, "meta", "profile"), payload, { merge: true });
}

/** Admin: list registered app profiles. */
export async function listUserProfiles(): Promise<UserProfile[]> {
  const usersSnap = await getDocs(collection(getFirebaseDb(), "users"));
  return usersSnap.docs
    .map((userDoc) => {
      const data = userDoc.data();
      return {
        uid: userDoc.id,
        email: String(data.email ?? ""),
        isAdmin: Boolean(data.isAdmin),
        updatedAt: data.updatedAt,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}
