import { createHmac, randomBytes } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type WebsiteVehicleImage = {
  id: number;
  url: string;
  thumbUrl: string;
  alt: string;
};

export type WebsiteVehicleImageColor = {
  name: string;
  qty: number;
  images: WebsiteVehicleImage[];
};

export type WebsiteVehicleImageCar = {
  postId: number;
  vehicleId: string;
  title: string;
  stock: number;
  mainImage: WebsiteVehicleImage | null;
  exteriorColors: WebsiteVehicleImageColor[];
  interiorColors: WebsiteVehicleImageColor[];
  missingMain: boolean;
  missingExteriorCount: number;
  missingInteriorCount: number;
  complete: boolean;
  modifiedGmt: string;
};

export type WebsiteVehicleImagesResult = {
  cars: WebsiteVehicleImageCar[];
  updatedAt: string;
  uploadMaxBytes: number;
  uploadUrl: string;
  warning?: string;
};

function bridgeEndpoint() {
  return String(process.env.MZJ_CARS_BRIDGE_URL || "https://mzjcars.com/wp-json/mzj-platform/v2/cars").trim();
}

function managerCarsUrl() {
  const configured = String(process.env.MZJ_CARS_IMAGE_MANAGER_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  try {
    const origin = new URL(bridgeEndpoint()).origin;
    return `${origin}/wp-json/mzj-image-manager/v1/cars`;
  } catch {
    return "https://mzjcars.com/wp-json/mzj-image-manager/v1/cars";
  }
}

function managerUploadUrl() {
  const carsUrl = managerCarsUrl();
  return carsUrl.replace(/\/cars\/?(?:\?.*)?$/, "/upload");
}

function bridgeSecret() {
  return String(process.env.MZJ_CARS_BRIDGE_SECRET || "").trim();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function image(value: unknown): WebsiteVehicleImage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonRecord;
  const id = Math.max(0, Math.trunc(numberValue(row.id)));
  const url = text(row.url);
  if (!id || !url) return null;
  return {
    id,
    url,
    thumbUrl: text(row.thumb_url) || url,
    alt: text(row.alt),
  };
}

function colors(value: unknown): WebsiteVehicleImageColor[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as JsonRecord : {};
    const images = Array.isArray(row.images) ? row.images.map(image).filter((item): item is WebsiteVehicleImage => Boolean(item)) : [];
    return {
      name: text(row.name),
      qty: Math.max(0, Math.trunc(numberValue(row.qty))),
      images,
    };
  }).filter((entry) => entry.name !== "");
}

function mapCar(value: unknown): WebsiteVehicleImageCar | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonRecord;
  const postId = Math.max(0, Math.trunc(numberValue(row.post_id)));
  const title = text(row.title);
  if (!postId || !title) return null;
  const exteriorColors = colors(row.exterior_colors);
  const interiorColors = colors(row.interior_colors);
  const mainImage = image(row.main_image);
  const missingExteriorCount = exteriorColors.filter((color) => color.images.length === 0).length;
  const missingInteriorCount = interiorColors.filter((color) => color.images.length === 0).length;
  const missingMain = !mainImage;
  return {
    postId,
    vehicleId: text(row.vehicle_id).toUpperCase() || `WP-${postId}`,
    title,
    stock: Math.max(0, Math.trunc(numberValue(row.stock))),
    mainImage,
    exteriorColors,
    interiorColors,
    missingMain,
    missingExteriorCount,
    missingInteriorCount,
    complete: !missingMain && missingExteriorCount === 0 && missingInteriorCount === 0,
    modifiedGmt: text(row.modified_gmt),
  };
}

export async function getWebsiteVehicleImages(options: { refresh?: boolean } = {}): Promise<WebsiteVehicleImagesResult> {
  const secret = bridgeSecret();
  if (!secret) throw new Error("MZJ_CARS_BRIDGE_SECRET_NOT_CONFIGURED");

  const endpoint = new URL(managerCarsUrl());
  if (options.refresh) endpoint.searchParams.set("refresh", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.refresh ? 60_000 : 20_000);
  try {
    const response = await fetch(endpoint, {
      headers: {
        "X-MZJ-Bridge-Key": secret,
        "user-agent": "MZJ-Platform/1.0 (+vehicle-image-manager)",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as JsonRecord | null;
    if (!response.ok) {
      const detail = payload && text(payload.message || payload.error);
      throw new Error(detail || `MZJ_IMAGE_MANAGER_HTTP_${response.status}`);
    }
    if (!payload || payload.ok !== true || !Array.isArray(payload.cars)) throw new Error("MZJ_IMAGE_MANAGER_INVALID_RESPONSE");

    const cars = payload.cars.map(mapCar).filter((car): car is WebsiteVehicleImageCar => Boolean(car));
    cars.sort((left, right) => {
      if (left.complete !== right.complete) return left.complete ? 1 : -1;
      const leftMissing = Number(left.missingMain) + left.missingExteriorCount + left.missingInteriorCount;
      const rightMissing = Number(right.missingMain) + right.missingExteriorCount + right.missingInteriorCount;
      if (leftMissing !== rightMissing) return rightMissing - leftMissing;
      return left.vehicleId.localeCompare(right.vehicleId, "en", { numeric: true });
    });

    return {
      cars,
      updatedAt: text(payload.updated_at) || new Date().toISOString(),
      uploadMaxBytes: Math.max(0, Math.trunc(numberValue(payload.upload_max_bytes))),
      uploadUrl: text(payload.upload_url) || managerUploadUrl(),
      warning: text(payload.warning) || undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("انتهت مهلة الاتصال بمدير صور WordPress");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

export function createWebsiteVehicleImageTicket(postId: number) {
  const secret = bridgeSecret();
  if (!secret) throw new Error("MZJ_CARS_BRIDGE_SECRET_NOT_CONFIGURED");
  const normalizedPostId = Math.max(0, Math.trunc(Number(postId) || 0));
  if (!normalizedPostId) throw new Error("السيارة غير محددة");

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    purpose: "vehicle-images",
    post_id: normalizedPostId,
    iat: now,
    exp: now + 300,
    nonce: randomBytes(12).toString("hex"),
  };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return {
    ticket: `${encoded}.${signature}`,
    uploadUrl: managerUploadUrl(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}
