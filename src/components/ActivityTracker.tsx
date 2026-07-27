import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const titles: Record<string, string> = {
  "/": "الداش بورد",
  "/reports": "التقارير",
  "/database": "قاعدة البيانات",
  "/settings": "الإعدادات",
  "/activity": "سجل النشاط",
  "/help": "المساعدة",
  "/crm": "CRM",
  "/marketing": "التسويق",
  "/operations": "العمليات",
  "/tracking": "التراكينج",
};

function systemCode(pathname: string) {
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/marketing")) return "marketing";
  if (pathname.startsWith("/operations")) return "operations";
  if (pathname.startsWith("/tracking")) return "tracking";
  return "core";
}

function pageTitle(pathname: string) {
  const exact = titles[pathname];
  if (exact) return exact;
  const root = `/${pathname.split("/").filter(Boolean)[0] || ""}`;
  return titles[root] || document.title || "منصة MZJ";
}

export function ActivityTracker() {
  const { user } = useAuth();
  const location = useLocation();
  const lastKey = useRef("");

  useEffect(() => {
    if (!user) return;
    const key = `${user.id}:${location.pathname}:${location.search}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    const timer = window.setTimeout(() => {
      void fetch("/api/activity", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "page_view",
          path: `${location.pathname}${location.search}`,
          title: pageTitle(location.pathname),
          systemCode: systemCode(location.pathname),
        }),
      }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search, user]);

  return null;
}
