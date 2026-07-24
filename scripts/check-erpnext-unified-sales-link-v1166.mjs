import fs from "node:fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function expect(file, needle, label = needle) { if (!read(file).includes(needle)) throw new Error(`ERPNext unified link check failed: ${file} missing ${label}`); }
function reject(file, needle, label = needle) { if (read(file).includes(needle)) throw new Error(`ERPNext unified link check failed: ${file} contains forbidden ${label}`); }

const packageJson = JSON.parse(read("package.json"));
const versionParts = String(packageJson.version || "0.0.0").split(".").map(Number);
if (versionParts[0] < 1 || (versionParts[0] === 1 && versionParts[1] < 17)) throw new Error("ERPNext unified link check failed: package version must be 1.17.0 or newer");
expect("api/index.ts", '"integrations/erpnext/sales-order"', "single ERPNext endpoint");
expect("server/integrations/erpnext-sales-order.ts", "ingestTrackingOrder(payload)", "canonical tracking ingest");
expect("server/integrations/erpnext-sales-order.ts", "syncErpNextSalesOrder", "unified CRM/operations sync");
expect("server/_erpnext-sales-order-normalizer.ts", 'integrationSource: "erpnext-webhook"');
expect("server/_erpnext-sales-order-normalizer.ts", '"serial_no"', "VIN field alias");
expect("server/_erpnext-sales-order-normalizer.ts", 'const actualCustomerName = alternateCustomer.name || accountingCustomerName');
expect("server/_erpnext-sales-order-normalizer.ts", 'const actualCustomerPhone = alternateCustomer.name ? alternateCustomer.phone');
expect("server/_erpnext-sales-order-sync.ts", '=== "to deliver and bill"', "only approved ERP status");
reject("server/_erpnext-sales-order-sync.ts", '=== "completed"', "Completed status automation");
expect("server/_erpnext-sales-order-sync.ts", "resolvePlatformUser(normalized.erpUserId)", "Sales Team user resolution");
expect("server/_erpnext-sales-order-normalizer.ts", "resolvePrimarySalesTeamPerson", "primary Sales Team person resolution");
expect("server/_erpnext-sales-order-normalizer.ts", "allocated_percentage", "Sales Team contribution priority");
reject("server/_erpnext-sales-order-normalizer.ts", '"owner", "modified_by", "user", "user_id"', "submitter fallback for salesperson mapping");
reject("server/_erpnext-sales-order-sync.ts", "next_erp_branch", "legacy ERP branch user mapping");
reject("server/_erpnext-sales-order-sync.ts", "branch_mismatch", "ERP branch matching gate");
expect("server/_erpnext-sales-order-sync.ts", "if (!existing)", "create CRM customer when phone is not registered");
expect("server/_erpnext-sales-order-sync.ts", "تم إنشاء العميل تلقائيًا من طلب البيع", "automatic CRM customer creation");
expect("server/_erpnext-sales-order-sync.ts", "status_label='تم البيع'", "CRM sold status");
expect("server/_erpnext-sales-order-sync.ts", "upper(trim(vin))=upper(trim", "operations VIN match");
expect("server/_erpnext-sales-order-sync.ts", "status_code='under_delivery'", "operations under-delivery status");
expect("server/_erpnext-sales-order-sync.ts", "from_location_id,to_location_id", "location-preserving movement");
expect("server/_erpnext-integration-schema.ts", "integrations.erpnext_sales_orders");
expect("server/_erpnext-integration-schema.ts", "integrations.erpnext_sales_order_vehicles");
expect("server/_erpnext-integration-schema.ts", "next_erp_user_id");
reject("server/_erpnext-integration-schema.ts", "core_users_next_erp_branch_idx", "legacy ERP branch index");
expect("server/access-control.ts", "nextErpUserId");
reject("server/access-control.ts", "nextErpBranch", "legacy ERP branch form field");
reject("server/access-control.ts", "next_erp_branch", "legacy ERP branch database field");
expect("src/access-control/UsersPermissionsPanel.tsx", "مندوب NEXT ERP");
reject("src/access-control/UsersPermissionsPanel.tsx", "اسم الفرع في NEXT ERP", "legacy ERP branch UI field");
expect("server/operations/index.ts", "integrations.erpnext_sales_order_vehicles");
expect("src/operations/components/VehicleDetailModal.tsx", '["sales", "طلب البيع"]');
expect("src/operations/components/VehicleDetailModal.tsx", "فرع البيع في NEXT ERP");
expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"erp_user_id"');
expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"user_name"');
expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"user_phone"');
expect("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", '"branch"', "sales branch metadata");
reject("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt", "Completed", "second status flow");
console.log("ERPNext unified Sales Order -> Tracking + CRM + Operations v1.16.9 check passed.");
