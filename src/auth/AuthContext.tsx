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


export type AttendanceLoginRequirement = {
  attendanceRequired: true;
  locationRequired: boolean;
  scheduleName?: string | null;
  periodName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  requiredLocationName?: string | null;
};

export class AttendanceLoginRequiredError extends Error {
  requirement: AttendanceLoginRequirement;

  constructor(message: string, requirement: AttendanceLoginRequirement) {
    super(message);
    this.name = "AttendanceLoginRequiredError";
    this.requirement = requirement;
  }
}

type LoginOptions = {
  attendanceCheckIn?: boolean;
  location?: { latitude: number; longitude: number; accuracy?: number | null } | null;
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
  login: (identifier: string, password: string, options?: LoginOptions) => Promise<void>;
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

  useEffect(() => {
    if (!user?.id) return;
    let stopped = false;
    const verifySession = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
        const payload = await readJson(response);
        if (stopped) return;
        if (response.status === 401 || !payload?.ok) {
          if (response.status === 401) setUser(null);
          return;
        }
        if (payload.user) setUser(payload.user);
      } catch {
        // Temporary network errors must not sign the user out locally.
      }
    };
    const interval = window.setInterval(() => { void verifySession(); }, 30000);
    const onVisibility = () => { if (document.visibilityState === "visible") void verifySession(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user?.id]);

  const login = useCallback(async (identifier: string, password: string, options: LoginOptions = {}) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier,
        password,
        attendanceCheckIn: options.attendanceCheckIn === true,
        location: options.location || undefined,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok) {
      if (payload?.code === "ATTENDANCE_REQUIRED" || payload?.code === "ATTENDANCE_LOCATION_REQUIRED") {
        throw new AttendanceLoginRequiredError(payload.error || "سجل الحضور لإكمال الدخول", {
          attendanceRequired: true,
          locationRequired: Boolean(payload.locationRequired),
          scheduleName: payload.scheduleName || null,
          periodName: payload.periodName || null,
          startTime: payload.startTime || null,
          endTime: payload.endTime || null,
          requiredLocationName: payload.requiredLocationName || null,
        });
      }
      throw new Error(payload.error || "تعذر تسجيل الدخول");
    }
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
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    const payload = await readJson(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || "تعذر تسجيل الانصراف وتسجيل الخروج");
    }
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
