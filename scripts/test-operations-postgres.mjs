import fs from "node:fs/promises";
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL || "";
if (!url) {
  console.error("TEST_DATABASE_URL is required. This script never uses DATABASE_URL.");
  process.exit(2);
}
if (url === process.env.DATABASE_URL) {
  console.error("Refusing to run because TEST_DATABASE_URL matches DATABASE_URL.");
  process.exit(2);
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const migration = await fs.readFile(new URL("../database/migrations/20260720_operations_native.sql", import.meta.url), "utf8");
const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 9)}`;
const vin = `MZJTEST${suffix}`.slice(0, 32);

try {
  await sql.unsafe(migration);
  await sql.unsafe(migration);

  const [shape] = await sql`
    select
      (select count(*)::int from operations.vehicle_statuses) as statuses,
      (select count(*)::int from core.permissions where code like 'operations.%') as operations_permissions,
      to_regclass('operations.vehicle_approval_cycles') is not null as approval_cycles,
      to_regclass('operations.transfer_request_events') is not null as transfer_events,
      to_regclass('audit.vehicle_deletions') is not null as deletion_audit
  `;

  const [location] = await sql`select id::text from operations.locations where is_active=true order by sort_order limit 1`;
  if (!location) throw new Error("No active operations location exists after migration");

  let rollbackWorked = false;
  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into operations.vehicles(vin,location_id,status_code,source_type)
        values (${vin},${location.id}::uuid,'available_for_sale','postgres_test')
      `;
      throw new Error("EXPECTED_ROLLBACK");
    });
  } catch (error) {
    if (String(error?.message) !== "EXPECTED_ROLLBACK") throw error;
  }
  const [rolledBack] = await sql`select count(*)::int as count from operations.vehicles where vin=${vin}`;
  rollbackWorked = Number(rolledBack.count) === 0;

  const result = {
    ok: Boolean(shape.approval_cycles && shape.transfer_events && shape.deletion_audit && rollbackWorked),
    database: "TEST_DATABASE_URL",
    migrationIdempotent: true,
    statuses: Number(shape.statuses),
    operationsPermissions: Number(shape.operations_permissions),
    approvalCycles: Boolean(shape.approval_cycles),
    transferEvents: Boolean(shape.transfer_events),
    vehicleDeletionAudit: Boolean(shape.deletion_audit),
    transactionRollback: rollbackWorked,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
