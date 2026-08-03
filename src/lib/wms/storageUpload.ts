import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseAuth, getFirebaseStorage } from "@/lib/firebase";
import type { WmsState } from "@/lib/wms/types";
import { buildExportPayload } from "@/lib/wms/backupPayload";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/** Map Firebase / network errors to short UI messages. */
export function storageErrorMessage(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  const raw = err instanceof Error ? err.message : String(err ?? "Upload failed");

  if (code === "storage/unauthorized" || /unauthorized|permission/i.test(raw)) {
    return "Storage permission denied — sign in and confirm Storage rules are deployed.";
  }
  if (code === "storage/unauthenticated" || /unauthenticated/i.test(raw)) {
    return "Sign in to upload to Firebase Storage.";
  }
  if (code === "storage/canceled") {
    return "Upload canceled.";
  }
  if (code === "storage/retry-limit-exceeded" || /network|fetch/i.test(raw)) {
    return "Network error uploading to Storage — try again.";
  }
  if (code === "storage/unknown" || /unknown error/i.test(raw)) {
    return "Storage unknown error — check bucket name and that Storage is enabled for this project.";
  }
  if (/Missing Firebase config|STORAGE_BUCKET|storageBucket/i.test(raw)) {
    return "Firebase Storage is not configured (missing VITE_FIREBASE_STORAGE_BUCKET).";
  }
  if (raw.length > 160) return `${raw.slice(0, 157)}…`;
  return raw || "Upload failed";
}

function requireSignedInUid(): string {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) {
    throw new Error("Sign in to upload to Firebase Storage.");
  }
  return uid;
}

/** Upload a warehouse photo to Firebase Storage; returns a public download URL. */
export async function uploadWarehousePhoto(
  file: File,
  folder: string = "bons",
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be uploaded.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Image must be under 15 MB.");
  }

  const uid = requireSignedInUid();
  const path = `warehouse/photos/${folder}/${uid}/${Date.now()}-${safeName(file.name) || "photo.jpg"}`;
  const storageRef = ref(getFirebaseStorage(), path);
  const contentType = file.type || "image/jpeg";
  try {
    await uploadBytes(storageRef, file, {
      contentType,
      customMetadata: { uploadedBy: uid },
    });
    return await getDownloadURL(storageRef);
  } catch (err) {
    throw new Error(storageErrorMessage(err));
  }
}

const DATED_BACKUP_MIN_MS = 5 * 60 * 1000;
let lastDatedBackupAt = 0;
let backupInFlight: Promise<void> | null = null;

/**
 * Write warehouse snapshot to Storage:
 * - warehouse/backups/latest.json every call
 * - warehouse/backups/{ISO}.json at most once per 5 minutes
 */
export async function uploadWarehouseBackupJson(state: WmsState): Promise<void> {
  requireSignedInUid();

  const payload = buildExportPayload(state);
  const body = JSON.stringify(payload);
  const bytes = new Blob([body], { type: "application/json" });

  const storage = getFirebaseStorage();
  const latestRef = ref(storage, "warehouse/backups/latest.json");
  await uploadBytes(latestRef, bytes, {
    contentType: "application/json",
    customMetadata: { kind: "latest" },
  });

  const now = Date.now();
  if (now - lastDatedBackupAt >= DATED_BACKUP_MIN_MS) {
    lastDatedBackupAt = now;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const datedRef = ref(storage, `warehouse/backups/${stamp}.json`);
    await uploadBytes(datedRef, bytes, {
      contentType: "application/json",
      customMetadata: { kind: "dated" },
    });
  }
}

/** Debounced-friendly: skip overlapping backup uploads. */
export function queueWarehouseBackupJson(state: WmsState): void {
  if (backupInFlight) return;
  backupInFlight = uploadWarehouseBackupJson(state)
    .catch((error) => {
      console.error("Storage backup failed", error);
    })
    .finally(() => {
      backupInFlight = null;
    });
}
