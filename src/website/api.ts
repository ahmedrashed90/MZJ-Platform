async function read(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "تعذر تحميل بيانات الموقع الإلكتروني");
  return payload;
}

export async function websiteStockGet(refresh = false) {
  const suffix = refresh ? "?refresh=1" : "";
  return read(await fetch(`/api/website${suffix}`, { credentials: "include", cache: "no-store" }));
}
