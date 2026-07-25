import { useEffect, type ReactNode, useState } from "react";
import { isStoreReady, waitForStore } from "./store";

/**
 * Hydrates disk state after mount. Shows a brief loading state in Electron
 * so saves don't overwrite disk data before hydration completes.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() =>
    typeof window === "undefined" || !window.db || isStoreReady(),
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.db) {
      setReady(true);
      return;
    }
    if (isStoreReady()) {
      setReady(true);
      return;
    }
    void waitForStore().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading warehouse data…
      </div>
    );
  }

  return <>{children}</>;
}
