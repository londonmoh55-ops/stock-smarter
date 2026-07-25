import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { isAdminEmail } from "@/lib/auth/admin";
import { upsertUserProfile } from "@/lib/wms/firestoreSync";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  /** Electron desktop skips cloud auth (local disk persistence). */
  skipAuth: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.db);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const skipAuth = isElectronRuntime();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!skipAuth);

  useEffect(() => {
    if (skipAuth) {
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
      if (next?.email) {
        void upsertUserProfile(next.uid, next.email, isAdminEmail(next.email)).catch((err) => {
          console.error("Failed to upsert user profile", err);
        });
      }
    });
  }, [skipAuth]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
  }, []);

  const isAdmin = isAdminEmail(user?.email);

  const value = useMemo(
    () => ({ user, loading, isAdmin, skipAuth, signIn, signUp, signOut }),
    [user, loading, isAdmin, skipAuth, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
