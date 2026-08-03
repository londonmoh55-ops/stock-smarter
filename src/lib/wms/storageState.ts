import { ref, uploadBytes, getBytes } from "firebase/storage";
import { getFirebaseAuth, getFirebaseStorage } from "@/lib/firebase";
import type { WmsState } from "@/lib/wms/types";
import { buildExportPayload, validateExportPayload } from "@/lib/wms/backupPayload";
import { migrateToCurrent } from "@/lib/wms/migrate";
import { approxStateBytes, stripInlineDataUrlPhotos } from "@/lib/wms/cloudSanitize";
import { storageErrorMessage } from "@/lib/wms/storageUpload";

/** Live warehouse blob — replaces the Firestore `data` field. */
export const WAREHOUSE_STATE_OBJECT_PATH = "warehouse/state/current.json";

/** Match storage.rules JSON cap (20 MiB). */
export const STORAGE_STATE_SAFE_BYTES = 19 * 1024 * 1024;

function requireSignedInUid(): string {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    throw new Error("Sign in to sync warehouse to Firebase Storage.");
  }
  return uid;
}

function prepareStateForStorage(state: WmsState): WmsState {
  const { state: withoutInline } = stripInlineDataUrlPhotos(state);
  return JSON.parse(JSON.stringify(withoutInline)) as WmsState;
}

function parseWarehouseJson(raw: unknown): WmsState {
  if (validateExportPayload(raw)) {
    return migrateToCurrent(raw.data);
  }
  if (raw && typeof raw === "object" && "products" in (raw as object)) {
    return migrateToCurrent(raw);
  }
  throw new Error("Warehouse Storage file is not valid warehouse JSON.");
}

/**
 * Upload live warehouse state to Storage.
 * Returns approximate byte size written.
 */
export async function uploadWarehouseStateJson(state: WmsState): Promise<{ bytes: number }> {
  requireSignedInUid();
  const prepared = prepareStateForStorage(state);
  const payload = buildExportPayload(prepared);
  const body = JSON.stringify(payload);
  const bytes = body.length;
  if (bytes > STORAGE_STATE_SAFE_BYTES) {
    throw new Error(
      `Warehouse is too large for Storage sync (${(bytes / 1_000_000).toFixed(1)} MB). ` +
        `Limit is about 20 MB. Export a backup and trim old history if needed.`,
    );
  }

  const storageRef = ref(getFirebaseStorage(), WAREHOUSE_STATE_OBJECT_PATH);
  try {
    await uploadBytes(storageRef, new Blob([body], { type: "application/json" }), {
      contentType: "application/json",
      customMetadata: {
        kind: "live-state",
        approxBytes: String(bytes),
        revisionHint: String(approxStateBytes(prepared)),
      },
    });
  } catch (err) {
    throw new Error(storageErrorMessage(err));
  }
  return { bytes };
}

/**
 * Download live warehouse state from Storage.
 * Returns null if the object does not exist.
 */
export async function downloadWarehouseStateJson(): Promise<WmsState | null> {
  requireSignedInUid();
  const storageRef = ref(getFirebaseStorage(), WAREHOUSE_STATE_OBJECT_PATH);
  try {
    const buffer = await getBytes(storageRef);
    const text = new TextDecoder().decode(buffer);
    const raw = JSON.parse(text) as unknown;
    return parseWarehouseJson(raw);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "storage/object-not-found") {
      return null;
    }
    throw new Error(storageErrorMessage(err));
  }
}
