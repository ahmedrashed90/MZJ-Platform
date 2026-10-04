import { createSign } from "node:crypto";

const DEFAULT_PROJECT_ID = "mzj-workflow";
const DEFAULT_LOGS_COLLECTION = "logs";
const DEFAULT_CARS_COLLECTION = "cars";
const DEFAULT_CUTOFF_AT = "2026-08-01T00:00:00+03:00";

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

type FirestoreFields = Record<string, unknown>;

type LegacyHistoryRow = {
  id: string;
  created_at: string;
  movement_type: string;
  old_status?: string | null;
  new_status?: string | null;
  old_status_name?: string | null;
  new_status_name?: string | null;
  note?: string | null;
  state_note?: string | null;
  shortage_note?: string | null;
  performed_by_name?: string | null;
  performed_by_role?: string | null;
  performed_by_branch?: string | null;
  operations_admin_name?: string | null;
  vehicle_id: string;
  vin: string;
  car_name?: string | null;
  statement?: string | null;
  agent_name?: string | null;
  interior_color?: string | null;
  exterior_color?: string | null;
  model_year?: string | null;
  plate_no?: string | null;
  batch_no?: string | null;
  vehicle_notes?: string | null;
  sensor_status?: string | null;
  camera_status?: string | null;
  ac_status?: string | null;
  radio_status?: string | null;
  screen_status?: string | null;
  remote_status?: string | null;
  mats_status?: string | null;
  extinguisher_status?: string | null;
  safety_bag_status?: string | null;
  spare_tire_status?: string | null;
  financial_approved?: boolean;
  administrative_approved?: boolean;
  from_location_code?: string | null;
  from_location_name?: string | null;
  to_location_code?: string | null;
  to_location_name?: string | null;
  request_no?: string | null;
  transfer_request_id?: string | null;
  batch_id?: string | null;
};

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function legacyServiceAccount() {
  const json = String(process.env.OPERATIONS_LEGACY_FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (json) {
    try {
      const parsed = JSON.parse(json);
      return {
        clientEmail: String(parsed.client_email || "").trim(),
        privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n").trim(),
      };
    } catch {
      throw new Error("OPERATIONS_LEGACY_FIREBASE_SERVICE_ACCOUNT_JSON غير صالح");
    }
  }
  return {
    clientEmail: String(process.env.OPERATIONS_LEGACY_FIREBASE_CLIENT_EMAIL || "").trim(),
    privateKey: String(process.env.OPERATIONS_LEGACY_FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(),
  };
}

async function getLegacyAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.token;
  const account = legacyServiceAccount();
  if (!account.clientEmail || !account.privateKey) return "";

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: account.clientEmail,
    sub: account.clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(account.privateKey))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || "تعذر الحصول على صلاحية قراءة Firebase القديم");
  cachedAccessToken = {
    token: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
  return body.access_token;
}

function parseFirestoreValue(value: any): unknown {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return String(value.stringValue ?? "");
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return String(value.timestampValue ?? "");
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue || 0);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue || 0);
  if (Object.prototype.hasOwnProperty.call(value, "referenceValue")) return String(value.referenceValue ?? "");
  if (value.arrayValue) return (value.arrayValue.values || []).map((item: unknown) => parseFirestoreValue(item));
  if (value.mapValue) return parseFirestoreFields(value.mapValue.fields || {});
  return null;
}

function parseFirestoreFields(fields: Record<string, any>): FirestoreFields {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, parseFirestoreValue(value)]));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function boolCheck(value: unknown) {
  if (value === true) return "ok";
  if (value === false) return "missing";
  return "unknown";
}

function actionLabel(actionValue: unknown) {
  const action = text(actionValue);
  const labels: Record<string, string> = {
    transfer: "نقل مكان",
    admin_approve: "موافقة إدارية",
    financial_approve: "موافقة مالية",
    finance_approve: "موافقة مالية",
    request_transfer_receive_car: "استلام السيارة",
    request_transfer_send_car: "إرسال السيارة",
    request_transfer_receive_order: "استلام طلب النقل",
    request_transfer_finish: "إنهاء طلب النقل",
    archive: "أرشفة السيارة",
    restore: "استعادة السيارة من الأرشيف",
  };
  if (labels[action]) return labels[action];
  if (action.startsWith("request_")) return `طلب نقل - ${action.replace(/^request_/, "")}`;
  return action || "حركة قديمة";
}

function deriveMovementType(log: Record<string, any>) {
  const fromLocation = text(log.fromLocation || log.fromLoc || log.from);
  const toLocation = text(log.toLocation || log.toLoc || log.to);
  const fromStatus = text(log.fromStatus);
  const toStatus = text(log.toStatus);
  const parts: string[] = [];
  if (fromLocation && toLocation && fromLocation !== toLocation) parts.push("نقل مكان");
  if (fromStatus && toStatus && fromStatus !== toStatus) parts.push("تغيير حالة");
  if (text(log.notesMissing || log.noteMissing)) parts.push("حجز/نواقص");
  if (text(log.note)) parts.push("ملاحظة حالة");
  return parts.length ? parts.join(" + ") : actionLabel(log.action);
}

function firestoreHeaders(token: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function runVinQuery(projectId: string, collectionId: string, fieldPath: string, vin: string, token: string) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: firestoreHeaders(token),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: "EQUAL",
            value: { stringValue: vin },
          },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => []) as any;
  if (!response.ok) {
    const message = payload?.error?.message || "تعذر قراءة سجل الحركات القديم";
    throw new Error(message);
  }
  return (Array.isArray(payload) ? payload : [])
    .map((item: any) => item?.document)
    .filter(Boolean)
    .map((document: any) => ({
      id: text(document.name).split("/").pop() || "",
      ...parseFirestoreFields(document.fields || {}),
    }));
}

async function getLegacyCar(projectId: string, collectionId: string, vin: string, token: string) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(collectionId)}/${encodeURIComponent(vin)}`;
  const response = await fetch(endpoint, { method: "GET", headers: firestoreHeaders(token) });
  if (response.status === 404) return {};
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload?.error?.message || "تعذر قراءة بيانات السيارة من النظام القديم");
  return parseFirestoreFields(payload.fields || {});
}

function legacyCutoffMs() {
  const configured = String(process.env.OPERATIONS_LEGACY_CUTOFF_AT || DEFAULT_CUTOFF_AT).trim();
  const parsed = new Date(configured).getTime();
  return Number.isFinite(parsed) ? parsed : new Date(DEFAULT_CUTOFF_AT).getTime();
}

function normalizeLegacyRow(document: Record<string, any>, carValue: FirestoreFields, vin: string): LegacyHistoryRow | null {
  const payload = objectValue(document.payload);
  const rawAt = text(document.at || document.createdAt || document.created_at || payload.at || payload.createdAt);
  const at = new Date(rawAt);
  if (!Number.isFinite(at.getTime())) return null;
  if (at.getTime() >= legacyCutoffMs()) return null;

  const car = objectValue(carValue);
  const checklist = objectValue(car.checklist);
  const approvals = objectValue(car.approvals);
  const fromLocation = text(document.fromLocation || document.fromLoc || document.from || payload.fromLocation || payload.from);
  const toLocation = text(document.toLocation || document.toLoc || document.to || payload.toLocation || payload.to);
  const fromStatus = text(document.fromStatus || payload.fromStatus);
  const toStatus = text(document.toStatus || payload.toStatus);
  const note = text(document.note || payload.note);
  const shortage = text(document.notesMissing || document.noteMissing || payload.notesMissing || payload.noteMissing);
  const actor = text(document.by || payload.by);
  const requestId = text(document.requestId || payload.requestId);

  return {
    id: `legacy:${text(document.id) || `${vin}:${at.getTime()}`}`,
    batch_id: null,
    transfer_request_id: requestId || null,
    request_no: requestId || null,
    created_at: at.toISOString(),
    movement_type: deriveMovementType(document),
    old_status: fromStatus || null,
    new_status: toStatus || null,
    old_status_name: fromStatus || null,
    new_status_name: toStatus || null,
    note: note || actionLabel(document.action),
    state_note: note || null,
    shortage_note: shortage || text(car.notesMissing || car.noteMissing) || null,
    performed_by_name: actor || null,
    performed_by_role: null,
    performed_by_branch: null,
    operations_admin_name: null,
    vehicle_id: `legacy:${vin}`,
    vin,
    car_name: text(document.carName || payload.carName || car.carName) || null,
    statement: text(car.statement) || null,
    agent_name: text(car.agent) || null,
    interior_color: text(car.interiorColor) || null,
    exterior_color: text(car.exteriorColor) || null,
    model_year: text(car.model) || null,
    plate_no: text(car.plate) || null,
    batch_no: text(car.batchName) || null,
    vehicle_notes: text(car.notesLocation || car.noteLocation) || null,
    sensor_status: boolCheck(checklist.sensors ?? checklist.sensor),
    camera_status: boolCheck(checklist.camera),
    ac_status: boolCheck(checklist.ac),
    radio_status: boolCheck(checklist.musajjal ?? checklist.recorder),
    screen_status: boolCheck(checklist.screen),
    remote_status: boolCheck(checklist.remote),
    mats_status: boolCheck(checklist.farshat),
    extinguisher_status: boolCheck(checklist.tafaia),
    safety_bag_status: boolCheck(checklist.shanta),
    spare_tire_status: boolCheck(checklist.spare),
    financial_approved: approvals.financial === true,
    administrative_approved: approvals.admin === true,
    from_location_code: null,
    from_location_name: fromLocation || null,
    to_location_code: null,
    to_location_name: toLocation || null,
  };
}

export async function readLegacyVinHistory(vinValue: string): Promise<{ rows: LegacyHistoryRow[]; warning: string }> {
  const vin = text(vinValue);
  if (!vin) return { rows: [], warning: "" };
  if (String(process.env.OPERATIONS_LEGACY_HISTORY_ENABLED || "true").toLowerCase() === "false") return { rows: [], warning: "" };

  const projectId = String(process.env.OPERATIONS_LEGACY_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
  const logsCollection = String(process.env.OPERATIONS_LEGACY_FIREBASE_LOGS_COLLECTION || DEFAULT_LOGS_COLLECTION).trim();
  const carsCollection = String(process.env.OPERATIONS_LEGACY_FIREBASE_CARS_COLLECTION || DEFAULT_CARS_COLLECTION).trim();

  try {
    const token = await getLegacyAccessToken();
    const [directRows, payloadRows, car] = await Promise.all([
      runVinQuery(projectId, logsCollection, "vin", vin, token),
      runVinQuery(projectId, logsCollection, "payload.vin", vin, token),
      getLegacyCar(projectId, carsCollection, vin, token).catch(() => ({})),
    ]);
    const byId = new Map<string, Record<string, any>>();
    [...directRows, ...payloadRows].forEach((item) => byId.set(text(item.id), item));
    const rows = [...byId.values()]
      .map((item) => normalizeLegacyRow(item, car, vin))
      .filter((item): item is LegacyHistoryRow => Boolean(item))
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
    return { rows, warning: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر قراءة سجل الحركات القديم";
    return { rows: [], warning: message };
  }
}
