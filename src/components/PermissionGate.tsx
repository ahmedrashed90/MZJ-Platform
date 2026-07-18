import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ShieldWarning } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

export function hasPermission(user: { permissions?: string[] } | null | undefined, code: string) {
  return Boolean(user?.permissions?.includes(code));
}

export function hasAnyPermission(user: { permissions?: string[] } | null | undefined, codes: string[]) {
  return codes.some((code) => hasPermission(user, code));
}

export function PermissionGate({ permission, children, fallback = null }: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  const { user } = useAuth();
  return hasPermission(user, permission) ? <>{children}</> : <>{fallback}</>;
}

export function PermissionRoute({ permission, children, redirectTo }: { permission: string; children: ReactNode; redirectTo?: string }) {
  const { user } = useAuth();
  if (hasPermission(user, permission)) return <>{children}</>;
  if (redirectTo) return <Navigate to={redirectTo} replace />;
  return (
    <section className="panel access-denied-panel">
      <ShieldWarning size={52} weight="duotone" />
      <div>
        <h1>غير مصرح بالدخول</h1>
        <p>لا يمتلك حسابك الصلاحية المطلوبة لفتح هذه الصفحة.</p>
        <code>{permission}</code>
      </div>
    </section>
  );
}

export function AnyPermissionRoute({ permissions, children, redirectTo }: { permissions: string[]; children: ReactNode; redirectTo?: string }) {
  const { user } = useAuth();
  if (hasAnyPermission(user, permissions)) return <>{children}</>;
  if (redirectTo) return <Navigate to={redirectTo} replace />;
  return (
    <section className="panel access-denied-panel">
      <ShieldWarning size={52} weight="duotone" />
      <div><h1>غير مصرح بالدخول</h1><p>لا يمتلك حسابك أيًا من الصلاحيات المطلوبة لفتح هذه الصفحة.</p></div>
    </section>
  );
}
