import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import type { WmsState } from "@/lib/wms/types";

function warehouseRef(uid: string) {
  return doc(getFirebaseDb(), "users", uid, "warehouse", "state");
}

/** Load warehouse state for a user. Returns null if no cloud doc yet. */
export async function loadWarehouseState(uid: string): Promise<WmsState | null> {
  const snap = await getDoc(warehouseRef(uid));
  if (!snap.exists()) return null;
  const payload = snap.data()?.data;
  if (!payload || typeof payload !== "object") return null;
  return payload as WmsState;
}

/** Persist full warehouse state (JSON-safe). */
export async function saveWarehouseState(uid: string, state: WmsState): Promise<void> {
  const data = JSON.parse(JSON.stringify(state)) as WmsState;
  await setDoc(
    warehouseRef(uid),
    {
      data,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
