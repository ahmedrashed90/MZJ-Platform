import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PlatformSystem, SystemAccessConfig } from "../../shared/access-control";

export type AuthUser = {
  id: string;
  employeeNo: string | null;
  fullName: string;
  email: string | null;
  mobile: string | null;
  roles: string[];
  roleCodes: string[];
  departments: string[];
  departmentCodes: string[];
  branches: string[];
  branchCodes: string[];
  permissions: string[];
  inheritedPermissions: string[];
  directPermissions: string[];
  deniedPermissions: string[];
  systemAccess: Partial<Record<PlatformSystem, SystemAccessConfig>>;
  permissionVersion: number;
};

export type SetupStatus = {
  ok: boolean;
  databaseConfigured: boolean;
  databaseReachable: boolean;
  schemaReady: boolean;
  adminExists: boolean;
  setupKeyConfigured: boolean;
  error?: string;
};

type AuthContextValue = {
  loading: boolean;
  status: SetupStatus | null;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  initialize: (payload: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const statusResponse = await fetch("/api/setup/status", { cache: "no-store", credentials: "include" });
      const statusPayload = await readJson(statusResponse) as SetupStatus;
      setStatus(statusPayload);

      if (statusPayload.databaseReachable && statusPayload.schemaReady && statusPayload.adminExists) {
        const meResponse = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
        const mePayload = await readJson(meResponse);
        setUser(meResponse.ok && mePayload.ok ? mePayload.user : null);
      } else {
        setUser(null);
      }
    } catch {
      setStatus({
        ok: false,
        databaseConfigured: false,
        databaseReachable: false,
        schemaReady: false,
        adminExists: false,
        setupKeyConfigured: false,
        error: "تعذر الاتصال بخدمات المنصة",
      });
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (identifier: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر تسجيل الدخول");
    setUser(payload.user);
  }, []);

  const initialize = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/setup/initialize", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await readJson(response);
    if (!response.ok || !result.ok) throw new Error(result.error || "تعذر تهيئة المنصة");
    setUser(result.user);
    setStatus((current) => current ? { ...current, databaseConfigured: true, databaseReachable: true, schemaReady: true, adminExists: true } : current);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ loading, status, user, refresh, login, initialize, logout }), [loading, status, user, refresh, login, initialize, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
