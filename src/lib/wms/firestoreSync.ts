import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import type { WmsState } from "@/lib/wms/types";

/** Single shared warehouse for the whole team (not per-user). */
export const SHARED_WAREHOUSE_PATH = ["shared", "main", "warehouse", "state"] as const;

function warehouseRef() {
  const [a, b, c, d] = SHARED_WAREHOUSE_PATH;
  return doc(getFirebaseDb(), a, b, c, d);
}

/** Load the shared warehouse. Returns null if no cloud doc yet. */
export async function loadWarehouseState(): Promise<WmsState | null> {
  const snap = await getDoc(warehouseRef());
  if (!snap.exists()) return null;
  const payload = snap.data()?.data;
  if (!payload || typeof payload !== "object") return null;
  return payload as WmsState;
}

/** Persist full warehouse state (JSON-safe) to the shared doc. */
export async function saveWarehouseState(state: WmsState): Promise<void> {
  const data = JSON.parse(JSON.stringify(state)) as WmsState;
  await setDoc(
    warehouseRef(),
    {
      data,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export type UserProfile = {
  uid: string;
  email: string;
  isAdmin: boolean;
  updatedAt?: unknown;
};

export async function upsertUserProfile(uid: string, email: string, isAdmin: boolean): Promise<void> {
  const db = getFirebaseDb();
  const payload = {
    email,
    isAdmin,
    updatedAt: serverTimestamp(),
  };
  // Parent doc required so admin can list /users
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
