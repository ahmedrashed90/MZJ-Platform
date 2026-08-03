const CRM_SALES_APP_CLASS = "mzj-crm-sales-app";
const CRM_SALES_APP_QUERY = "crmSalesApp";
const CRM_SALES_APP_SESSION_KEY = "mzj.crmSalesApp.active";

function isIosStandalone() {
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function queryRequestsCrmSalesApp() {
  return new URLSearchParams(window.location.search).get(CRM_SALES_APP_QUERY) === "1";
}

function sessionRequestsCrmSalesApp() {
  try {
    return window.sessionStorage.getItem(CRM_SALES_APP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function isCrmSalesAppMode() {
  if (typeof window === "undefined") return false;
  return queryRequestsCrmSalesApp()
    || sessionRequestsCrmSalesApp()
    || isIosStandalone()
    || window.matchMedia("(display-mode: standalone)").matches;
}

export function applyCrmSalesAppEnvironment() {
  if (typeof window === "undefined") return;

  if (queryRequestsCrmSalesApp()) {
    try {
      window.sessionStorage.setItem(CRM_SALES_APP_SESSION_KEY, "1");
    } catch {
      // تستمر النسخة في العمل عبر query أو standalone حتى لو التخزين غير متاح.
    }
  }

  const applyModeClass = () => {
    document.documentElement.classList.toggle(CRM_SALES_APP_CLASS, isCrmSalesAppMode());
  };
  const updateViewportHeight = () => {
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--mzj-crm-sales-app-height", `${Math.round(height)}px`);
  };

  applyModeClass();
  updateViewportHeight();
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", applyModeClass);
  window.visualViewport?.addEventListener("resize", updateViewportHeight);
  window.addEventListener("resize", updateViewportHeight, { passive: true });
  window.addEventListener("orientationchange", updateViewportHeight, { passive: true });

  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/crm-sales-sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error) => console.warn("تعذر تسجيل Service Worker لتطبيق CRM", error));
  }, { once: true });
}
