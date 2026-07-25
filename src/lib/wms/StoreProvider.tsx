import { useEffect, type ReactNode, useState } from "react";
import { isStoreReady, setCloudSync, waitForStore } from "./store";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Hydrates warehouse state after mount:
 * - Electron → local disk via window.db
 * - Web → shared Firestore warehouse for any signed-in user
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, skipAuth, loading: authLoading } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (authLoading) return;

    let cancelled = false;

    async function hydrate() {
      if (window.db) {
        setCloudSync(false);
        await waitForStore();
        if (!cancelled) setReady(true);
        return;
      }

      if (!user) {
        setCloudSync(false);
        if (!cancelled) setReady(false);
        return;
      }

      setReady(false);
      setCloudSync(true);
      await waitForStore();
      if (!cancelled) setReady(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [user, skipAuth, authLoading]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Checking account…
      </div>
    );
  }

  if (!skipAuth && !user) {
    return <>{children}</>;
  }

  if (!ready && !isStoreReady()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading warehouse data…
      </div>
    );
  }

  return <>{children}</>;
}
