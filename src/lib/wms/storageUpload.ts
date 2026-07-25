import { ref, uploadBytes, getDownloadURL, deleteObject, refFromURL } from "firebase/storage";
import { getFirebaseAuth, getFirebaseStorage } from "@/lib/firebase";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/** Upload a warehouse photo to Firebase Storage; returns a public download URL. */
export async function uploadWarehousePhoto(
  file: File,
  folder: string = "bons",
): Promise<string> {
  const uid = getFirebaseAuth().currentUser?.uid ?? "anonymous";
  const path = `warehouse/photos/${folder}/${uid}/${Date.now()}-${safeName(file.name) || "photo.jpg"}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file, {
    contentType: file.type || "image/jpeg",
    customMetadata: { uploadedBy: uid },
  });
  return getDownloadURL(storageRef);
}

/** Best-effort delete by download URL (ignores failures). */
export async function tryDeleteStorageUrl(url: string | null | undefined): Promise<void> {
  if (!url || url.startsWith("data:")) return;
  try {
    await deleteObject(refFromURL(getFirebaseStorage(), url));
  } catch {
    /* ignore — may already be gone or not a Storage URL */
  }
}
