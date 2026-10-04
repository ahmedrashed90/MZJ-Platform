import type { MovementHistoryRow } from "./components/MovementHistoryTable";

// Legacy Firebase project used by the previous Operations/Workflow system.
// This module is intentionally READ-ONLY: it only calls Firestore document GET
// and Firestore runQuery endpoints. It never writes, updates, deletes, commits,
// or batches anything in the legacy project.
const LEGACY_FIREBASE = {
  apiKey: "AIzaSyBaor-9gU1XYmTD-3YCP14Kstf7HvMEC_M",
  projectId: "mzj-workflow",
};

const LEGACY_DOCS_BASE = `https://firestore.googleapis.com/v1/projects/${LEGACY_FIREBASE.projectId}/databases/(default)/documents`;
const LEGACY_QUERY_URL = `https://firestore.googleapis.com/v1/projects/${LEGACY_FIREBASE.projectId}/databases/(default)/documents:runQuery?key=${encodeURIComponent(LEGACY_FIREBASE.apiKey)}`;
const LEGACY_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(LEGACY_FIREBASE.apiKey)}`;

export type LegacyHistoryFilters = {
  fromCode?: string;
  fromName?: string;
  toCode?: string;
  toName?: string;
  statusCode?: string;
  statusName?: string;
  user?: string;
};

type PlainDoc = { id: string; path: string; data: Record<string, any> };

type LegacyAuthState = {
  accessToken?: string;
  refreshToken?: string;
  expirationTime?: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function norm(value: unknown) {
  return text(value).toLocaleLowerCase("ar-SA");
}

function sameVin(left: unknown, right: unknown) {
  return norm(left) === norm(right);
}

function toIso(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }
  if (typeof value === "object" && value) {
    const seconds = Number((value as any).seconds ?? (value as any)._seconds);
    const nanos = Number((value as any).nanoseconds ?? (value as any)._nanoseconds ?? 0);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
  }
  return "";
}

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) {
    const output: Record<string, any> = {};
    const fields = value.mapValue?.fields || {};
    Object.entries(fields).forEach(([key, item]) => { output[key] = decodeFirestoreValue(item); });
    return output;
  }
  return null;
}

function decodeFirestoreDocument(document: any): PlainDoc | null {
  if (!document?.name) return null;
  const output: Record<string, any> = {};
  Object.entries(document.fields || {}).forEach(([key, item]) => { output[key] = decodeFirestoreValue(item); });
  const parts = String(document.name).split("/");
  return { id: parts[parts.length - 1] || "", path: document.name, data: output };
}

function readLegacyAuthState(): LegacyAuthState | null {
  if (typeof window === "undefined") return null;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) || "";
      if (!key.startsWith(`firebase:authUser:${LEGACY_FIREBASE.apiKey}:`)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const manager = parsed?.stsTokenManager || {};
      return {
        accessToken: text(manager.accessToken),
        refreshToken: text(manager.refreshToken),
        expirationTime: Number(manager.expirationTime || 0),
      };
    }
  } catch {
    // Ignore local persistence parse errors; public-read rules may still work.
  }
  return null;
}

let memoryToken: { value: string; expiresAt: number } | null = null;

async function legacyAuthToken(): Promise<string> {
  const now = Date.now();
  if (memoryToken?.value && memoryToken.expiresAt > now + 60_000) return memoryToken.value;

  const persisted = readLegacyAuthState();
  const persistedExpiration = Number(persisted?.expirationTime || 0);
  if (persisted?.accessToken && persistedExpiration > now + 60_000) {
    memoryToken = { value: persisted.accessToken, expiresAt: persistedExpiration };
    return persisted.accessToken;
  }
  if (!persisted?.refreshToken) return "";

  try {
    const response = await fetch(LEGACY_REFRESH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: persisted.refreshToken }).toString(),
      cache: "no-store",
    });
    if (!response.ok) return "";
    const payload = await response.json().catch(() => ({}));
    const token = text(payload.access_token);
    const expiresIn = Math.max(60, Number(payload.expires_in || 3600));
    if (token) memoryToken = { value: token, expiresAt: now + expiresIn * 1000 };
    return token;
  } catch {
    return "";
  }
}

async function legacyFetch(url: string, init?: RequestInit) {
  const token = await legacyAuthToken();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(url, { ...init, headers, cache: "no-store" });
}

function firestoreValue(value: string) {
  return { stringValue: value };
}

async function runLegacyQuery(collectionId: string, fieldPath: string, op: "EQUAL" | "ARRAY_CONTAINS", value: string): Promise<PlainDoc[]> {
  const response = await legacyFetch(LEGACY_QUERY_URL, {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath }, op, value: firestoreValue(value) } },
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = text(payload?.error?.message || payload?.error?.status || response.statusText);
    const error = new Error(message || "تعذر قراءة سجل النظام القديم") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const payload = await response.json().catch(() => []);
  return (Array.isArray(payload) ? payload : [])
    .map((item: any) => decodeFirestoreDocument(item?.document))
    .filter(Boolean) as PlainDoc[];
}

async function getLegacyCar(vin: string): Promise<Record<string, any>> {
  const url = `${LEGACY_DOCS_BASE}/cars/${encodeURIComponent(vin)}?key=${encodeURIComponent(LEGACY_FIREBASE.apiKey)}`;
  try {
    const response = await legacyFetch(url);
    if (response.status === 404) return {};
    if (!response.ok) return {};
    const payload = await response.json().catch(() => ({}));
    return decodeFirestoreDocument(payload)?.data || {};
  } catch {
    return {};
  }
}

function checklistStatus(checklist: any, ...keys: string[]) {
  if (!checklist || typeof checklist !== "object") return "unknown";
  for (const key of keys) {
    if (checklist[key] === true) return "ok";
    if (checklist[key] === false) return "missing";
  }
  return "unknown";
}

function baseRow(vin: string, car: Record<string, any>): Omit<MovementHistoryRow, "id" | "created_at" | "movement_type"> {
  const checklist = car.checklist || {};
  const approvals = car.approvals || {};
  return {
    vehicle_id: `legacy:${vin}`,
    vin,
    car_name: text(car.carName || car.car_name),
    statement: text(car.statement),
    agent_name: text(car.agent || car.agentName),
    interior_color: text(car.interiorColor || car.interior_color),
    exterior_color: text(car.exteriorColor || car.exterior_color),
    model_year: text(car.model || car.modelYear || car.model_year),
    plate_no: text(car.plate || car.plateNo || car.plate_no),
    batch_no: text(car.batchName || car.batchNo || car.batch_no),
    vehicle_notes: text(car.notesLocation || car.noteLocation || car.notes || car.vehicle_notes),
    sensor_status: checklistStatus(checklist, "sensors", "sensor"),
    camera_status: checklistStatus(checklist, "camera"),
    ac_status: checklistStatus(checklist, "ac"),
    radio_status: checklistStatus(checklist, "musajjal", "recorder", "radio"),
    screen_status: checklistStatus(checklist, "screen"),
    remote_status: checklistStatus(checklist, "remote"),
    mats_status: checklistStatus(checklist, "farshat", "mats"),
    extinguisher_status: checklistStatus(checklist, "tafaia", "extinguisher"),
    safety_bag_status: checklistStatus(checklist, "shanta", "safety_bag"),
    spare_tire_status: checklistStatus(checklist, "spare", "spare_tire"),
    financial_approved: approvals.financial === true,
    administrative_approved: approvals.admin === true,
  };
}

function actionLabel(action: unknown, payload?: any) {
  const value = text(action);
  if (value === "transfer") return "نقل";
  if (value === "request_create") return "إنشاء طلب نقل";
  if (value === "request_step") {
    const step = Number(payload?.step || 0);
    if (step === 1) return "تم استلام الطلب";
    if (step === 2) return "تم إرسال السيارة";
    if (step === 3) return "تم استلام السيارة";
    if (step === 4) return "تم الانتهاء";
    return "تحديث طلب نقل";
  }
  if (value === "request_transfer_receive_car") return "تم استلام السيارة";
  if (value === "admin_approve") return "موافقة إدارية";
  if (value === "financial_approve") return "موافقة مالية";
  if (value === "archive") return "أرشفة";
  if (value === "restore") return "استعادة من الأرشيف";
  return value || "حركة من النظام القديم";
}

function logBelongsToVin(data: any, vin: string) {
  if (sameVin(data?.vin, vin)) return true;
  if (sameVin(data?.payload?.vin, vin)) return true;
  if (Array.isArray(data?.payload?.vins) && data.payload.vins.some((item: unknown) => sameVin(item, vin))) return true;
  return false;
}

function logRows(vin: string, car: Record<string, any>, docs: PlainDoc[]) {
  const base = baseRow(vin, car);
  return docs
    .filter((doc) => logBelongsToVin(doc.data, vin))
    .map((doc): MovementHistoryRow | null => {
      const item = doc.data || {};
      const payload = item.payload || {};
      const createdAt = toIso(item.at || item.createdAt || item.updatedAt);
      if (!createdAt) return null;
      const fromLocation = text(item.fromLocation || item.fromLoc || item.from || payload.fromLocation || payload.from);
      const toLocation = text(item.toLocation || item.toLoc || item.to || payload.toLocation || payload.to);
      const oldStatus = text(item.fromStatus || item.oldStatus || payload.fromStatus || payload.oldStatus);
      const newStatus = text(item.toStatus || item.newStatus || payload.toStatus || payload.newStatus);
      const action = text(item.action);
      return {
        ...base,
        id: `legacy-log:${doc.id}`,
        batch_id: text(item.batchId || payload.batchId) || null,
        transfer_request_id: text(item.requestId || payload.requestId) || null,
        request_no: text(item.requestNo || payload.requestNo) || null,
        created_at: createdAt,
        movement_type: `قديم — ${actionLabel(action, payload)}`,
        old_status: oldStatus || null,
        new_status: newStatus || null,
        old_status_name: oldStatus || null,
        new_status_name: newStatus || null,
        note: text(item.note || payload.note) || null,
        state_note: actionLabel(action, payload),
        shortage_note: text(item.notesMissing || item.noteMissing || payload.notesMissing || payload.noteMissing) || null,
        performed_by_name: text(item.by || item.createdBy || payload.by || payload.createdBy) || null,
        performed_by_role: null,
        performed_by_branch: null,
        operations_admin_name: null,
        from_location_code: fromLocation || null,
        from_location_name: fromLocation || null,
        to_location_code: toLocation || null,
        to_location_name: toLocation || null,
      };
    })
    .filter(Boolean) as MovementHistoryRow[];
}

function transferRows(vin: string, car: Record<string, any>, docs: PlainDoc[], existingLogs: MovementHistoryRow[]) {
  const base = baseRow(vin, car);
  const loggedRequestIds = new Set(existingLogs.map((row) => text(row.transfer_request_id)).filter(Boolean));
  return docs
    .filter((doc) => Array.isArray(doc.data?.vins) && doc.data.vins.some((item: unknown) => sameVin(item, vin)))
    .map((doc): MovementHistoryRow | null => {
      if (loggedRequestIds.has(doc.id)) return null;
      const item = doc.data || {};
      const createdAt = toIso(item.createdAt || item.at);
      if (!createdAt) return null;
      const toLocation = text(item.toLocation);
      const toStatus = text(item.toStatus || item.selectedStatus);
      return {
        ...base,
        id: `legacy-transfer:${doc.id}`,
        batch_id: null,
        transfer_request_id: doc.id,
        request_no: null,
        created_at: createdAt,
        movement_type: "قديم — نقل",
        old_status: null,
        new_status: toStatus || null,
        old_status_name: null,
        new_status_name: toStatus || null,
        note: text(item.note) || "حركة نقل من النظام القديم",
        state_note: null,
        shortage_note: text(item.notesMissing) || null,
        performed_by_name: text(item.createdBy) || null,
        performed_by_role: null,
        performed_by_branch: null,
        operations_admin_name: null,
        from_location_code: null,
        from_location_name: null,
        to_location_code: toLocation || null,
        to_location_name: toLocation || null,
      };
    })
    .filter(Boolean) as MovementHistoryRow[];
}

function requestRows(vin: string, car: Record<string, any>, docs: PlainDoc[], existingLogs: MovementHistoryRow[]) {
  const base = baseRow(vin, car);
  const logKeys = new Set<string>();
  existingLogs.forEach((row) => {
    const requestId = text(row.transfer_request_id);
    if (!requestId) return;
    const label = norm(row.state_note || row.movement_type);
    if (label.includes("إنشاء طلب")) logKeys.add(`${requestId}:create`);
    if (label.includes("استلام الطلب")) logKeys.add(`${requestId}:1`);
    if (label.includes("إرسال السيارة")) logKeys.add(`${requestId}:2`);
    if (label.includes("استلام السيارة")) logKeys.add(`${requestId}:3`);
    if (label.includes("الانتهاء")) logKeys.add(`${requestId}:4`);
  });

  const rows: MovementHistoryRow[] = [];
  const steps = [
    { key: "createdAt", by: "createdBy", step: "create", label: "إنشاء طلب نقل" },
    { key: "step1At", by: "step1By", step: "1", label: "تم استلام الطلب" },
    { key: "step2At", by: "step2By", step: "2", label: "تم إرسال السيارة" },
    { key: "step3At", by: "step3By", step: "3", label: "تم استلام السيارة" },
    { key: "step4At", by: "step4By", step: "4", label: "تم الانتهاء" },
  ];

  docs.forEach((doc) => {
    const item = doc.data || {};
    const vins = Array.isArray(item.vins) ? item.vins : [];
    const items = Array.isArray(item.items) ? item.items : [];
    const belongs = vins.some((entry: unknown) => sameVin(entry, vin)) || items.some((entry: any) => sameVin(entry?.vin, vin));
    if (!belongs) return;
    const itemForVin = items.find((entry: any) => sameVin(entry?.vin, vin)) || {};
    const fromLocation = text(itemForVin.fromLocation || (Array.isArray(item.fromLocations) && item.fromLocations.length === 1 ? item.fromLocations[0] : ""));
    const toLocation = text(item.toLocation);

    steps.forEach((step) => {
      if (logKeys.has(`${doc.id}:${step.step}`)) return;
      const createdAt = toIso(item[step.key]);
      if (!createdAt) return;
      rows.push({
        ...base,
        id: `legacy-request:${doc.id}:${step.step}`,
        batch_id: null,
        transfer_request_id: doc.id,
        request_no: null,
        created_at: createdAt,
        movement_type: `قديم — ${step.label}`,
        old_status: null,
        new_status: null,
        old_status_name: null,
        new_status_name: null,
        note: text(item.type) === "photo" ? `${step.label} — طلب تصوير` : step.label,
        state_note: step.label,
        shortage_note: text(itemForVin.note || item.notesMissing) || null,
        performed_by_name: text(item[step.by]) || null,
        performed_by_role: null,
        performed_by_branch: null,
        operations_admin_name: null,
        from_location_code: fromLocation || null,
        from_location_name: fromLocation || null,
        to_location_code: toLocation || null,
        to_location_name: toLocation || null,
      });
    });
  });

  return rows;
}

function matchesLegacyFilters(row: MovementHistoryRow, filters: LegacyHistoryFilters) {
  const fromAllowed = [filters.fromCode, filters.fromName].map(norm).filter(Boolean);
  const toAllowed = [filters.toCode, filters.toName].map(norm).filter(Boolean);
  const statusAllowed = [filters.statusCode, filters.statusName].map(norm).filter(Boolean);
  if (fromAllowed.length && !fromAllowed.includes(norm(row.from_location_code || row.from_location_name))) return false;
  if (toAllowed.length && !toAllowed.includes(norm(row.to_location_code || row.to_location_name))) return false;
  if (statusAllowed.length && !statusAllowed.includes(norm(row.new_status || row.new_status_name))) return false;
  if (filters.user) {
    const needle = norm(filters.user);
    const haystack = norm(`${row.performed_by_name || ""} ${row.operations_admin_name || ""}`);
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function uniqueDocs(items: PlainDoc[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.path || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function looksLikeLegacyVinSearch(value: string) {
  const candidate = text(value);
  return candidate.length >= 4 && candidate.length <= 40 && /^[A-Za-z0-9-]+$/.test(candidate);
}

export async function loadLegacyMovementHistory(vinInput: string, filters: LegacyHistoryFilters = {}): Promise<MovementHistoryRow[]> {
  const vin = text(vinInput);
  if (!looksLikeLegacyVinSearch(vin)) return [];

  try {
    const [directLogs, payloadVinLogs, payloadVinsLogs, requests, transfers, car] = await Promise.all([
      runLegacyQuery("logs", "vin", "EQUAL", vin),
      runLegacyQuery("logs", "payload.vin", "EQUAL", vin),
      runLegacyQuery("logs", "payload.vins", "ARRAY_CONTAINS", vin),
      runLegacyQuery("requests", "vins", "ARRAY_CONTAINS", vin),
      runLegacyQuery("transfers", "vins", "ARRAY_CONTAINS", vin),
      getLegacyCar(vin),
    ]);

    const logs = logRows(vin, car, uniqueDocs([...directLogs, ...payloadVinLogs, ...payloadVinsLogs]));
    const generated = [
      ...logs,
      ...transferRows(vin, car, transfers, logs),
      ...requestRows(vin, car, requests, logs),
    ]
      .filter((row) => matchesLegacyFilters(row, filters))
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

    const seen = new Set<string>();
    return generated.filter((row) => {
      const key = `${row.id}|${row.created_at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر قراءة سجل النظام القديم";
    if (/permission|denied|unauth|credential|401|403/i.test(message)) {
      throw new Error("تعذر قراءة سجل النظام القديم: صلاحيات Firebase القديم لا تسمح بالقراءة من هذه الجلسة");
    }
    throw new Error(`تعذر قراءة سجل النظام القديم: ${message}`);
  }
}
