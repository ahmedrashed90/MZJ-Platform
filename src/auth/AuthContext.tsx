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


type LoginOptions = {
  attendanceCheckIn?: boolean;
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


type AuthFlowError = Error & { code?: string; installerUrl?: string };

function authFlowError(message: string, code?: string, installerUrl?: string): AuthFlowError {
  const error = new Error(message) as AuthFlowError;
  error.code = code;
  error.installerUrl = installerUrl;
  return error;
}

function launchDeviceAgent(agentUrl: string) {
  const link = document.createElement("a");
  link.href = agentUrl;
  link.style.display = "none";
  link.setAttribute("aria-hidden", "true");
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => link.remove(), 0);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pollDeviceChallenge(challengeId: string, pollToken: string, installerUrl?: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await wait(850);
    const params = new URLSearchParams({ view: "challenge", challengeId, pollToken });
    const response = await fetch(`/api/device-agent?${params.toString()}`, { cache: "no-store", credentials: "include" });
    const payload = await readJson(response);
    if (!response.ok || payload?.ok === false) continue;
    if (payload.status === "approved") return;
    if (payload.status === "pending_approval") {
      throw authFlowError("تم تسجيل جهاز العمل وهو في انتظار اعتماد مدير النظام", "DEVICE_AGENT_PENDING_APPROVAL", installerUrl);
    }
    if (payload.status === "revoked") {
      throw authFlowError("هذا الجهاز غير معتمد. تواصل مع مدير النظام", "DEVICE_AGENT_REVOKED", installerUrl);
    }
    if (["expired", "invalid", "consumed"].includes(String(payload.status || ""))) {
      throw authFlowError("انتهت مهلة التحقق من جهاز العمل. أعد تسجيل الدخول", "DEVICE_AGENT_CHALLENGE_EXPIRED", installerUrl);
    }
  }
  throw authFlowError("لم يتم اكتشاف MZJ Device Agent على هذا الجهاز", "DEVICE_AGENT_NOT_RESPONDING", installerUrl);
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
      }),
    });
    const payload = await readJson(response);

    if (response.status === 428 && payload?.code === "DEVICE_AGENT_REQUIRED") {
      const challengeId = String(payload.challengeId || "");
      const pollToken = String(payload.pollToken || "");
      const agentUrl = String(payload.agentUrl || "");
      const installerUrl = String(payload.installerUrl || "/downloads/MZJ-Device-Agent-Setup.exe");
      if (!challengeId || !pollToken || !agentUrl) {
        throw authFlowError("تعذر تجهيز التحقق من جهاز العمل", "DEVICE_AGENT_CHALLENGE_INVALID", installerUrl);
      }

      launchDeviceAgent(agentUrl);
      await pollDeviceChallenge(challengeId, pollToken, installerUrl);

      const completeResponse = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: "complete_device", challengeId, pollToken }),
      });
      const completePayload = await readJson(completeResponse);
      if (!completeResponse.ok || !completePayload?.ok) {
        throw authFlowError(completePayload?.error || "تعذر إكمال تسجيل الدخول من جهاز العمل", completePayload?.code, installerUrl);
      }
      setUser(completePayload.user);
      return;
    }

    if (!response.ok || !payload.ok) {
      throw authFlowError(payload.error || "تعذر تسجيل الدخول", payload?.code, payload?.installerUrl);
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
      throw new Error(payload?.error || "تعذر تسجيل الخروج");
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
