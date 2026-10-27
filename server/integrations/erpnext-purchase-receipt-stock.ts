/**
 * Dedicated NEXT ERP Purchase Receipt -> Operations inventory intake.
 * This API is deliberately separate from the interactive Operations API and
 * from the existing ERPNext status and WordPress integrations.
 *
 * Contract: POST /api/integrations/erpnext/purchase-receipt-stock
 * Header: X-MZJ-Stock-Key: ERPNEXT_STOCK_SYNC_KEY
 * Body: { receipt, event: 'on_submit', dryRun?: boolean, vehicles: SerialNo[] }
 * Existing VINs (including archived/sold/deleted ones) are NEVER changed.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSql } from '../_db.js';
import { safeSecretEquals } from '../_auth.js';
import { ensureOperationsSchema } from '../_operations-schema.js';

type IncomingVehicle = Record<string, unknown>;
type NormalizedVehicle = {
  vin: string;
  carName: string;
  statement: string;
  agentName: string;
  modelYear: string;
  interiorColor: string;
  exteriorColor: string;
  warehouse: string;
  locationCode: string;
  providedLocationCode: string;
  erpStatus: string;
  statusCode: string;
  stateNote: string;
};

const text = (value: unknown) => String(value ?? '').trim();

// Match NEXT ERP's warehouse names to existing Operations location CODES.
// Never rename either system's locations, create a new location, or interpret
// the NEXT ERP "جميع المخازن - ممزال" display filter as a physical warehouse.
const ERP_WAREHOUSE_LOCATIONS: Record<string, string> = {
  'الصالة - ممزال': 'hall',
  'الوكالات - ممزال': 'agency',
  'خارج الصالة - ممزال': 'hall_out',
  'مستودع عكاظ - ممزال': 'warehouse',
  'معرض القادسية - ممزال': 'qadisiyah',
  'معرض الملتقي - ممزال': 'multaqa',
  // Earlier confirmed NEXT ERP names / spelling variants.
  'الصالة - منزل': 'hall',
  'معرض القادسية': 'qadisiyah',
  'معرض الملتقى - ممزال': 'multaqa',
};

export function mapNextReceiptVehicle(raw: IncomingVehicle): NormalizedVehicle {
  const vin = text(raw.serial_no || raw.name);
  const warehouse = text(raw.warehouse);
  const erpStatus = text(raw.car_status);
  const stateNote = text(raw.detail);
  const locationCode = ERP_WAREHOUSE_LOCATIONS[warehouse] || '';
  // The Worker may provide the resolved code too; verify it against the
  // literal NEXT warehouse name instead of trusting an arbitrary override.
  const providedLocationCode = text(raw.locationCode);
  const statusCode = stateNote
    ? 'has_notes'
    : erpStatus === 'محجوزة'
      ? 'reserved'
      : erpStatus === 'متاحة للحجز'
        ? 'available_for_sale'
        : '';
  return {
    vin,
    carName: text(raw.type),
    statement: text(raw.class),
    agentName: text(raw.agent),
    modelYear: text(raw.model),
    interiorColor: text(raw.custom_color),
    exteriorColor: text(raw.custom_external_color),
    warehouse,
    locationCode,
    providedLocationCode,
    erpStatus,
    statusCode,
    stateNote,
  };
}

function parseRequestBody(body: unknown): Record<string, unknown> | null {
  try {
    const input = typeof body === 'string' ? JSON.parse(body) : body;
    return input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stockApiKey(request: VercelRequest): string {
  const header = request.headers['x-mzj-stock-key'];
  return text(Array.isArray(header) ? header[0] : header);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' });

  const expectedKey = text(process.env.ERPNEXT_STOCK_SYNC_KEY);
  if (!expectedKey) return response.status(503).json({ ok: false, error: 'ERPNEXT_STOCK_SYNC_KEY is not configured' });
  if (!safeSecretEquals(stockApiKey(request), expectedKey)) {
    return response.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const body = parseRequestBody(request.body);
  if (!body) return response.status(400).json({ ok: false, error: 'Invalid JSON object' });
  const receipt = text(body.receipt);
  const event = text(body.event);
  const dryRun = body.dryRun === true;

  if (!receipt || !event || !['on_submit', 'on_cancel'].includes(event)) {
    return response.status(400).json({ ok: false, error: 'Valid receipt and event are required' });
  }
  // Never reverse a sale, delete a vehicle or change inventory history on ERP cancellation.
  if (event === 'on_cancel') {
    return response.status(200).json({ ok: true, receipt, event, ignored: true, reason: 'Cancellation requires manual reconciliation; no vehicle was modified' });
  }

  const inputs = body.vehicles;
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 1000) {
    return response.status(400).json({ ok: false, error: 'vehicles must be an array of 1..1000 Serial No records' });
  }

  const cars = inputs.map((item) => mapNextReceiptVehicle(
    item && typeof item === 'object' && !Array.isArray(item) ? item as IncomingVehicle : {},
  ));
  const errors: { index: number; vin: string; error: string }[] = [];
  const seen = new Set<string>();
  cars.forEach((car, index) => {
    const key = car.vin.toUpperCase();
    if (!car.vin) errors.push({ index, vin: car.vin, error: 'Missing VIN' });
    if (/[\r\n]/.test(car.vin) || car.vin.length > 100) errors.push({ index, vin: car.vin, error: 'Invalid VIN format' });
    if (seen.has(key)) errors.push({ index, vin: car.vin, error: 'Duplicate VIN in payload' });
    seen.add(key);
    if (!car.carName || !car.statement || !car.modelYear) errors.push({ index, vin: car.vin, error: 'Missing car identity' });
    if (!car.locationCode) errors.push({ index, vin: car.vin, error: `Unmapped NEXT warehouse: ${car.warehouse || '(blank)'}` });
    else if (car.providedLocationCode && car.providedLocationCode !== car.locationCode) {
      errors.push({ index, vin: car.vin, error: `NEXT warehouse/locationCode mismatch: ${car.warehouse} -> ${car.providedLocationCode} (expected ${car.locationCode})` });
    }
    if (!car.statusCode) errors.push({ index, vin: car.vin, error: `Unmapped NEXT status: ${car.erpStatus || '(blank)'}` });
  });
  if (errors.length) return response.status(422).json({ ok: false, receipt, dryRun, errors });

  try {
    // Dry-run must remain read-only, including no schema bootstrap side effects.
    if (!dryRun) await ensureOperationsSchema();
    const sql = getSql();
    const locationCodes = [...new Set(cars.map((car) => car.locationCode))];
    const statusCodes = [...new Set(cars.map((car) => car.statusCode))];
    const [locations, statuses] = await Promise.all([
      sql<{ id: string; code: string }[]>`
        select id::text,code from operations.locations
        where code in ${sql(locationCodes)} and is_active=true
      `,
      sql<{ code: string }[]>`
        select code from operations.vehicle_statuses
        where code in ${sql(statusCodes)} and is_active=true
      `,
    ]);
    const locationIds = new Map(locations.map((row) => [row.code, row.id]));
    const activeStatuses = new Set(statuses.map((row) => row.code));
    const invalid = cars.flatMap((car, index) => {
      const error = !locationIds.has(car.locationCode) ? `Inactive or missing location: ${car.locationCode}`
        : !activeStatuses.has(car.statusCode) ? `Inactive or missing status: ${car.statusCode}` : '';
      return error ? [{ index, vin: car.vin, error }] : [];
    });
    if (invalid.length) return response.status(422).json({ ok: false, receipt, dryRun, errors: invalid });

    if (dryRun) {
      const result = [];
      for (const car of cars) {
        const [existing] = await sql<{ id: string; status_code: string }[]>`
          select id::text,status_code from operations.vehicles
          where upper(trim(vin))=upper(trim(${car.vin})) limit 1
        `;
        result.push({
          vin: car.vin,
          action: existing ? 'existing_unchanged' : 'would_insert',
          existingStatus: existing?.status_code || null,
          locationCode: car.locationCode,
          statusCode: car.statusCode,
          stateNote: car.stateNote,
        });
      }
      return response.status(200).json({ ok: true, dryRun: true, receipt, total: cars.length, results: result, writes: 0 });
    }

    // Read-only for existing VINs. An insert and its audit entry commit together.
    const results = await sql.begin(async (tx) => {
      const output: { vin: string; action: string; vehicleId?: string; statusCode?: string }[] = [];
      for (const car of cars) {
        const [existing] = await tx<{ id: string; status_code: string }[]>`
          select id::text,status_code from operations.vehicles
          where upper(trim(vin))=upper(trim(${car.vin})) limit 1 for update
        `;
        if (existing) {
          output.push({ vin: car.vin, action: 'existing_unchanged', vehicleId: existing.id, statusCode: existing.status_code });
          continue;
        }
        const [inserted] = await tx<{ id: string }[]>`
          insert into operations.vehicles(
            vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,
            location_id,status_code,source_type,state_note,has_notes,is_inventory_active,
            created_by_name,updated_by_name
          ) values (
            ${car.vin},${car.carName},${car.statement},${car.agentName || null},
            ${car.exteriorColor || null},${car.interiorColor || null},${car.modelYear},
            ${locationIds.get(car.locationCode)}::uuid,${car.statusCode},'next_erp',
            ${car.stateNote || null},${Boolean(car.stateNote)},true,'NEXT ERP','NEXT ERP'
          ) on conflict(vin) do nothing returning id::text
        `;
        if (!inserted) {
          // A parallel request inserted the VIN first: idempotent, no updates.
          output.push({ vin: car.vin, action: 'existing_unchanged' });
          continue;
        }
        await tx`
          insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
          values (null,'operations','erpnext_purchase_receipt_vehicle_created','vehicle',${inserted.id},
            ${tx.json({ vin: car.vin, receipt, locationCode: car.locationCode, statusCode: car.statusCode, source: 'NEXT ERP' })})
        `;
        output.push({ vin: car.vin, action: 'inserted', vehicleId: inserted.id, statusCode: car.statusCode });
      }
      return output;
    });
    return response.status(200).json({
      ok: true, dryRun: false, receipt, total: results.length,
      inserted: results.filter((row) => row.action === 'inserted').length,
      skipped: results.filter((row) => row.action === 'existing_unchanged').length,
      results,
    });
  } catch (error) {
    console.error('NEXT ERP purchase receipt stock intake failed', { receipt, error });
    return response.status(503).json({ ok: false, error: 'Operations stock intake failed; retry is safe', receipt });
  }
}
