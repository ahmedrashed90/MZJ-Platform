import fs from "node:fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function expect(file, needle, label = needle) {
  const text = read(file);
  if (!text.includes(needle)) throw new Error(`ERPNext unified link check failed: ${file} missing ${label}`);
}

function reject(file, needle, label = needle) {
  const text = read(file);
  if (text.includes(needle)) throw new Error(`ERPNext unified link check failed: ${file} contains forbidden ${label}`);
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.version !== "1.16.4") throw new Error("ERPNext unified link check failed: package version must be 1.16.4");

expect("api/index.ts", '"integrations/erpnext/sales-order"', "single ERPNext endpoint");
const routeCount = (read("api/index.ts").match(/integrations\/erpnext\/sales-order/g) || []).length;
if (routeCount < 2 || routeCount > 3) throw new Error(`ERPNext unified link check failed: unexpected route occurrence count ${routeCount}`);

expect("server/integrations/erpnext-sales-order.ts", "ingestTrackingOrder(payload)", "canonical tracking ingest");
expect("server/integrations/erpnext-sales-order.ts", "syncErpNextSalesOrder", "unified CRM/operations sync");
expect("server/_erpnext-sales-order-normalizer.ts", 'integrationSource: "erpnext-webhook"');
expect("server/_erpnext-sales-order-normalizer.ts", '"serial_no"', "VIN field alias");
expect("server/_erpnext-sales-order-normalizer.ts", '"custom_internal_color"');
expect("server/_erpnext-sales-order-normalizer.ts", '"custom_external_color"');
expect("server/_erpnext-sales-order-normalizer.ts", 'const actualCustomerName = alternateCustomer.name || accountingCustomerName');
expect("server/_erpnext-sales-order-normalizer.ts", 'const actualCustomerPhone = alternateCustomer.name ? alternateCustomer.phone');

expect("server/_erpnext-sales-order-sync.ts", '=== "to deliver and bill"', "only approved ERP status");
reject("server/_erpnext-sales-order-sync.ts", '=== "completed"', "Completed status automation");
expect("server/_erpnext-sales-order-sync.ts", "next_erp_user_id", "ERP user mapping");
expect("server/_erpnext-sales-order-sync.ts", "next_erp_branch", "ERP branch mapping");
expect("server/_erpnext-sales-order-sync.ts", "branch_mismatch", "strict branch validation");
expect("server/_erpnext-sales-order-sync.ts", "phone_normalized", "CRM phone match");
expect("server/_erpnext-sales-order-sync.ts", "status_label='تم البيع'", "CRM sold status");
expect("server/_erpnext-sales-order-sync.ts", "upper(trim(vin))=upper(trim", "operations VIN match");
expect("server/_erpnext-sales-order-sync.ts", "status_code='under_delivery'", "operations under-delivery status");
expect("server/_erpnext-sales-order-sync.ts", "from_location_id,to_location_id", "location-preserving movement");
expect("server/_erpnext-sales-order-sync.ts", "OPERATIONS_STATUS_PRESERVED", "delivered status preservation");

expect("server/_erpnext-integration-schema.ts", "integrations.erpnext_sales_orders");
expect("server/_erpnext-integration-schema.ts", "integrations.erpnext_sales_order_vehicles");
expect("database/migrations/20260721_erpnext_unified_sales_link_v1164.sql", "next_erp_user_id");
expect("database/migrations/20260721_erpnext_unified_sales_link_v1164.sql", "operations_vehicle_id");

expect("server/users.ts", "nextErpUserId");
expect("server/users.ts", "nextErpBranch");
expect("server/users.ts", "لازم تدخل إيميل مستخدم NEXT ERP واسم الفرع معًا", "paired ERP mapping fields");
expect("src/pages/SettingsPage.tsx", "ID المستخدم في NEXT ERP (الإيميل)");
expect("src/pages/SettingsPage.tsx", "اسم الفرع في NEXT ERP");

expect("server/operations/index.ts", "integrations.erpnext_sales_order_vehicles");
expect("server/operations/index.ts", "where sov.operations_vehicle_id=${id}::uuid", "exact linked vehicle only");
expect("src/operations/components/VehicleDetailModal.tsx", '["sales", "طلب البيع"]');
expect("src/operations/components/VehicleDetailModal.tsx", "مكان السيارة الحالي");

expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"erp_user_id"');
expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"user_name"');
expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"user_phone"');
expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"branch"');
reject("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", "Completed", "second status flow");

console.log("ERPNext unified Sales Order -> Tracking + CRM + Operations v1.16.4 check passed.");
