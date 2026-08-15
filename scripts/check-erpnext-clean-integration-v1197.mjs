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
    customer: "CUST-DEALER-001",
    customer_name: "معرض اختبار",
    contact_mobile: "0551234567",
    sales_rep_email: "sales@example.com",
    sales_person: "مندوب الاختبار",
    modified_by: "operations@example.com",
    operations_admin_name: "إداري العمليات",
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
assert.equal(submitted.erpUserId, "sales@example.com", "مندوب البيع يجب أن يأتي مستقلًا عن منفذ Submit");
assert.equal(submitted.erpSubmittedBy, "operations@example.com", "إداري العمليات يجب أن يأتي من منفذ Submit");
assert.equal(submitted.erpSubmittedByName, "إداري العمليات");
assert.equal(submitted.erpCustomerId, "CUST-DEALER-001", "هوية عميل ERP يجب أن تبقى ثابتة لمنع التكرار");

const noPhone = normalizeErpNextSalesOrder({
  event: "sales_order.submitted",
  doc: {
    name: "SAL-ORD-DEALER-NO-PHONE",
    creation: "2026-07-25 02:00:00.000000",
    status: "To Deliver and Bill",
    docstatus: 1,
    customer: "DEALER-002",
    customer_name: "معرض بدون جوال",
    sales_rep_email: "sales@example.com",
    modified_by: "operations@example.com",
    items: [{ idx: 1, item_code: "CAR-C", serial_no: "VIN-003", qty: 1, rate: 90000 }],
  },
});
assert.equal(noPhone.actualCustomerPhoneNormalized, "");
assert.equal(noPhone.erpCustomerId, "DEALER-002");
assert.equal(
  noPhone.warnings.some((warning) => warning.code === "CUSTOMER_PHONE_MISSING"),
  false,
  "غياب الجوال في بيع المعارض لا يجب أن يمنع إنشاء عميل CRM",
);

const noSalesRepFallback = normalizeErpNextSalesOrder({
  event: "sales_order.submitted",
  doc: {
    name: "SAL-ORD-NO-SALES-REP",
    creation: "2026-07-25 02:30:00.000000",
    status: "To Deliver and Bill",
    docstatus: 1,
    customer: "DEALER-003",
    customer_name: "معرض بدون مندوب مربوط",
    owner: "operations-owner@example.com",
    modified_by: "operations-submit@example.com",
    sales_team: [{ sales_person: "مندوب بدون إيميل" }],
    items: [{ idx: 1, item_code: "CAR-D", serial_no: "VIN-004", qty: 1, rate: 85000 }],
  },
});
assert.equal(noSalesRepFallback.erpUserId, "", "owner وmodified_by لا يجوز استخدامهما كمندوب بيع بديل");
assert.equal(noSalesRepFallback.erpSubmittedBy, "operations-submit@example.com");
assert.equal(noSalesRepFallback.warnings.some((warning) => warning.code === "ERP_USER_ID_MISSING"), true);

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
assert.deepEqual(cancelledWithoutItems.warnings, [], "إلغاء مختصر لا يجب أن ينتج تحذيرات عميل أو مندوب غير لازمة");

assert.throws(
  () => normalizeErpNextSalesOrder({ event: "sales_order.submitted", doc: { name: "SAL-ORD-NO-ITEMS", creation, docstatus: 1 } }),
  (error) => error instanceof ErpNextSalesOrderError && error.status === 400 && /Items/.test(error.message),
  "طلب الاعتماد ما زال يتطلب جدول سيارات فعليًا",
);

const syncSource = fs.readFileSync("server/_erpnext-sales-order-sync.ts", "utf8");
const approvalLookup = syncSource.indexOf("const approvalsToDelete");
const approvalEventsDelete = syncSource.indexOf("delete from operations.approval_events", approvalLookup);
const approvalDelete = syncSource.indexOf("delete from operations.vehicle_approvals", approvalEventsDelete);
const deliveredGuard = syncSource.indexOf('if (vehicle.archived_at || clean(vehicle.status_code) === "delivered")', approvalLookup);
assert.ok(
  approvalLookup >= 0 && approvalEventsDelete > approvalLookup && approvalDelete > approvalEventsDelete && deliveredGuard > approvalDelete,
  "يجب مسح دورة الموافقات المرتبطة بالطلب الملغي قبل الحفاظ على حالة السيارة المسلمة أو المؤرشفة",
);

const operationsGate = syncSource.indexOf('const canApplyOperationsLink = eligibleStatus && !order.is_cancelled;');
const crmGate = syncSource.indexOf('const canApplyCrmLink = canApplyOperationsLink');
const operationsCall = syncSource.indexOf('canApplySale: canApplyOperationsLink');
assert.ok(operationsGate >= 0, "ربط العمليات يجب أن يعتمد على حالة الطلب وعدم الإلغاء فقط");
assert.ok(crmGate > operationsGate, "ربط CRM يجب أن يظل مشروطًا بربط مندوب البيع بالمنصة");
assert.ok(operationsCall > crmGate, "تحديث السيارة ودورة الموافقات يجب أن يستخدما بوابة العمليات المستقلة");
assert.equal(syncSource.includes('if (canApplyCrmLink && !normalized.actualCustomerPhoneNormalized)'), false, "رقم الجوال لا يجوز أن يمنع إنشاء عميل CRM لبيع معرض");
assert.equal(syncSource.includes('CRM_CUSTOMER_PHONE_MISSING'), false, "لا يجب إصدار تحذير يمنع CRM بسبب غياب الجوال");
assert.ok(syncSource.includes("channel_code='erpnext'"), "منع التكرار يجب أن يعتمد على هوية عميل ERP");
assert.ok(syncSource.includes("erpCustomerIdentity(normalized)"), "يجب استخدام هوية عميل ERP عند الربط والتحديث");
assert.equal(syncSource.includes('canApplySale: canApplyBusinessLink'), false, "لا يجوز أن يتوقف تحديث العمليات على ربط مندوب CRM");

console.log("PASS: NEXT ERP clean integration runtime checks (sales rep/admin separation + optional phone)");
