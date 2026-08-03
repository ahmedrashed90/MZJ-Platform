const VERSION = "mzj-crm-sales-app-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// لا يتم تخزين أو إعادة إرسال أي طلبات API. كل عمليات الحفظ Network Only.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawTarget = event.notification?.data?.url || event.notification?.data?.link || "/crm?crmSalesApp=1";
  const target = new URL(rawTarget, self.location.origin);
  target.searchParams.set("crmSalesApp", "1");

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appWindow = windows.find((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
    });
    if (appWindow) {
      await appWindow.navigate(target.href);
      await appWindow.focus();
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

console.info("MZJ CRM sales app service worker", VERSION);
