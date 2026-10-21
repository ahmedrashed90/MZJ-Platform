import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const helperPath = "server/_crm-sale-timestamp.ts";
const helperSource = fs.readFileSync(helperPath, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true },
  fileName: helperPath,
}).outputText;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mzj-crm-sale-time-"));
const tempModule = path.join(tempDir, "sale-time.mjs");
fs.writeFileSync(tempModule, transpiled, "utf8");
const { normalizeRiyadhTimestamp, saleTimestampForOrder } = await import(`${pathToFileURL(tempModule).href}?v=${Date.now()}`);

assert.equal(
  normalizeRiyadhTimestamp("2026-08-17 21:26:45.123456"),
  "2026-08-17T18:26:45.123Z",
  "ERPNext naive creation timestamps must be treated as Riyadh-local time",
);
assert.equal(
  saleTimestampForOrder("2026-08-17", "2026-08-17T18:26:45.123Z"),
  "2026-08-17T18:26:45.123Z",
  "sold_at must keep the selected sale date and exact creation time",
);
assert.equal(
  saleTimestampForOrder("2026-08-15", "2026-08-17T18:26:45.123Z"),
  "2026-08-15T18:26:45.123Z",
  "backdated order dates must preserve the actual Riyadh wall-clock time",
);

const sync = fs.readFileSync("server/_erpnext-sales-order-sync.ts", "utf8");
const contacts = fs.readFileSync("server/crm/contacts.ts", "utf8");
const history = fs.readFileSync("server/_crm-sales-history.ts", "utf8");
const crmApi = fs.readFileSync("src/crm/api.ts", "utf8");
const migration = fs.readFileSync("database/migrations/20260817_crm_sales_order_actual_time_v1216.sql", "utf8");

assert(!sync.includes("T12:00:00+03:00"), "ERP sync must not inject a fixed noon timestamp");
assert(sync.includes("saleTimestampForOrder(normalized.orderDate, saleEventAt)") && sync.includes("sales_transaction_event_at"), "ERP sync must resolve and preserve one canonical sale timestamp");
assert(contacts.includes("saleTimestampForOrder(orderDate, order.received_at)"), "CRM-created sales orders must use their actual entry time");
assert(history.includes("saleTimestampForOrder(input.saleAt, latest.sale_at)"), "manual date correction must preserve the original sale time");
assert(crmApi.includes('timeZone: "Asia/Riyadh"'), "CRM date rendering must be fixed to Riyadh timezone");
assert(migration.includes("time '00:00:00'") && migration.includes("time '12:00:00'"), "migration must repair the historical default-time rows");
assert(migration.includes("st.created_at at time zone 'Asia/Riyadh'"), "historical correction must use the transaction entry time");

console.log("CRM sales-order actual-time checks passed: 10/10");
