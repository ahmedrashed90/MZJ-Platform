import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const sourcePath = "server/_erpnext-sales-order-normalizer.ts";
let source = fs.readFileSync(sourcePath, "utf8");

source = source
  .replace(
    'import { normalizePhone } from "./_phone-utils.js";',
    `function normalizePhone(value: unknown) {
      let phone = String(value || "")
        .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/[^\\d]/g, "");
      if (phone.startsWith("00")) phone = phone.slice(2);
      if (/^05\\d{8}$/.test(phone)) phone = \`966\${phone.slice(1)}\`;
      else if (/^5\\d{8}$/.test(phone)) phone = \`966\${phone}\`;
      return /^\\d{8,15}$/.test(phone) ? phone : "";
    }`,
  )
  .replace(
    'import { clean, numberValue } from "./_tracking-utils.js";',
    `function clean(value: unknown) { return String(value ?? "").trim(); }
     function numberValue(value: unknown) {
       if (typeof value === "number" && Number.isFinite(value)) return value;
       const normalized = clean(value).replace(/[^\\d.,-]/g, "").replace(/,/g, "");
       const parsed = Number.parseFloat(normalized);
       return Number.isFinite(parsed) ? parsed : 0;
     }`,
  );

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
  },
  fileName: sourcePath,
}).outputText;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mzj-erpnext-normalizer-"));
const tempModule = path.join(tempDir, "normalizer.mjs");
fs.writeFileSync(tempModule, transpiled, "utf8");
const { normalizeErpNextSalesOrder, ErpNextSalesOrderError } = await import(`${pathToFileURL(tempModule).href}?v=${Date.now()}`);

const creation = "2026-07-25 01:15:30.000000";
const submitted = normalizeErpNextSalesOrder({
  event: "sales_order.submitted",
  doc: {
    name: "SAL-ORD-00077",
    creation,
    status: "To Deliver and Bill",
    docstatus: 1,
    customer_name: "عميل اختبار",
    contact_mobile: "0551234567",
    custom_sales_person_email: "sales@example.com",
    items: [
      { idx: 1, item_code: "CAR-A", serial_no: "VIN-001", qty: 1, rate: 100000 },
      { idx: 2, item_code: "CAR-B", serial_no: "VIN-002", qty: 1, rate: 120000 },
      { idx: 3, item_name: "رسوم التسجيل", amount: 500 },
    ],
  },
});

assert.equal(submitted.isCancellation, false);
assert.equal(submitted.payloads.length, 2, "كل سيارات الطلب يجب أن تتحول إلى payloads مستقلة");
assert.equal(submitted.registrationFeeRows, 1);
assert.equal(submitted.payloads[0].sourceInstanceKey, submitted.sourceInstanceKey);
assert.match(submitted.sourceInstanceKey, /^next-erp:sales-order:SAL-ORD-00077:created:/);

const cancelledWithoutItems = normalizeErpNextSalesOrder({
  doc: {
    event: "on_cancel",
    name: "SAL-ORD-00077",
    creation,
    status: "Cancelled",
    docstatus: 2,
  },
});

assert.equal(cancelledWithoutItems.isCancellation, true);
assert.equal(cancelledWithoutItems.payloads.length, 0, "إلغاء الطلب لا يعتمد على وجود جدول Items");
assert.equal(cancelledWithoutItems.sourceInstanceKey, submitted.sourceInstanceKey, "الاعتماد والإلغاء لنفس نسخة NEXT ERP يجب أن يستخدما الهوية نفسها");
assert.deepEqual(cancelledWithoutItems.warnings, [], "إلغاء مختصر لا يجب أن ينتج تحذيرات عميل أو مستخدم غير لازمة");

assert.throws(
  () => normalizeErpNextSalesOrder({ event: "sales_order.submitted", doc: { name: "SAL-ORD-NO-ITEMS", creation, docstatus: 1 } }),
  (error) => error instanceof ErpNextSalesOrderError && error.status === 400 && /Items/.test(error.message),
  "طلب الاعتماد ما زال يتطلب جدول سيارات فعليًا",
);

const syncSource = fs.readFileSync("server/_erpnext-sales-order-sync.ts", "utf8");
const approvalLookup = syncSource.indexOf("const [activeApproval]");
const approvalClose = syncSource.indexOf("'all','cancelled'", approvalLookup);
const deliveredGuard = syncSource.indexOf('if (vehicle.archived_at || clean(vehicle.status_code) === "delivered")', approvalLookup);
assert.ok(approvalLookup >= 0 && approvalClose > approvalLookup && deliveredGuard > approvalClose, "يجب إغلاق دورة الموافقات قبل الحفاظ على حالة السيارة المسلمة أو المؤرشفة");

console.log("PASS: NEXT ERP clean integration runtime checks (v1.19.7 source)");
