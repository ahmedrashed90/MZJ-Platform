async function read(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.detail || payload.message || payload.error || "تعذر تحميل بيانات الموقع الإلكتروني");
  return payload;
}

export async function websiteStockGet(refresh = false) {
  const suffix = refresh ? "?refresh=1" : "";
  return read(await fetch(`/api/website${suffix}`, { credentials: "include", cache: "no-store" }));
}

export async function websiteImagesGet(refresh = false) {
  const params = new URLSearchParams({ scope: "image-manager" });
  if (refresh) params.set("refresh", "1");
  return read(await fetch(`/api/website?${params.toString()}`, { credentials: "include", cache: "no-store" }));
}

export async function websiteImageUploadTicket(postId: number) {
  return read(await fetch("/api/website", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "image_manager_ticket", postId }),
  }));
}

export async function uploadWebsiteVehicleImages(options: {
  uploadUrl: string;
  ticket: string;
  postId: number;
  kind: "main" | "exterior" | "interior";
  color?: string;
  files: File[];
}) {
  const form = new FormData();
  form.append("ticket", options.ticket);
  form.append("post_id", String(options.postId));
  form.append("kind", options.kind);
  if (options.color) form.append("color", options.color);
  options.files.forEach((file) => form.append("images[]", file, file.name));
  return read(await fetch(options.uploadUrl, {
    method: "POST",
    body: form,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  }));
}
