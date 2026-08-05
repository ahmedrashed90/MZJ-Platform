import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) console.error(`FAIL: ${name}`);
  else console.log(`PASS: ${name}`);
}

const trackingSchema = read("server/_tracking-schema.ts");
const integrationSchema = read("server/_erpnext-integration-schema.ts");
const normalizer = read("server/_erpnext-sales-order-normalizer.ts");
const endpoint = read("server/integrations/erpnext-sales-order.ts");
const sync = read("server/_erpnext-sales-order-sync.ts");
const trackingIngest = read("server/integrations/tracking-orders.ts");
const operationsApi = read("server/operations/index.ts");
const access = read("shared/access-control.ts");
const accessSchema = read("server/_access-control-schema.ts");
const app = read("src/App.tsx");
const operationsLayout = read("src/operations/OperationsLayout.tsx");
const operationsPage = read("src/operations/pages/SalesOrdersFollowupPage.tsx");
const marketingLayout = read("src/marketing/MarketingLayout.tsx");
const engagement = read("src/marketing/pages/EngagementPage.tsx");
const apiPermissions = read("server/_api-permissions.ts");
const marketingApi = read("server/marketing/index.ts");
const submitWebhook = read("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt");
const updateWebhook = read("integration-assets/MZJ-ERPNext-Sales-Order-Update-After-Submit-Webhook-JSON.txt");
const cancelWebhook = read("integration-assets/MZJ-ERPNext-Sales-Order-Cancel-Webhook-JSON.txt");

check("tracking schema stores advance_paid", trackingSchema.includes("tracking.orders add column if not exists advance_paid"));
check("ERPNext integration schema stores advance_paid", integrationSchema.includes("advance_paid numeric(14,2) not null default 0"));
check("normalizer reads advance_paid aliases", normalizer.includes('["advance_paid", "base_advance_paid", "AdvancePaid"]'));
check("normalizer recognizes update-after-submit", normalizer.includes("isUpdateAfterSubmit") && normalizer.includes("updateAfterSubmitEvent"));
check("normalizer allows update event without Items", normalizer.includes("!isCancellation && !isUpdateAfterSubmit"));
check("normal submit stores advance paid in tracking", trackingIngest.includes("advance_paid=${orderValues.advancePaid}"));
check("endpoint has isolated update-after-submit branch", endpoint.includes("normalized.isUpdateAfterSubmit") && endpoint.includes("updateErpNextSalesOrderAmounts"));
check("amount update function updates existing records", sync.includes("export async function updateErpNextSalesOrderAmounts") && sync.includes("update tracking.orders set") && sync.includes("update integrations.erpnext_sales_orders set"));
const amountFunction = sync.slice(sync.indexOf("export async function updateErpNextSalesOrderAmounts"), sync.indexOf("export async function syncErpNextSalesOrder"));
check("amount update function does not insert", !amountFunction.includes("insert into"));
check("operations API joins stages 6 and 10", operationsApi.includes("st.sort_order=6") && operationsApi.includes("st.sort_order=10"));
check("operations API reads vehicle approvals", operationsApi.includes("operations.vehicle_approvals") && operationsApi.includes("financial_approved") && operationsApi.includes("administrative_approved"));
check("operations API excludes cancelled orders", operationsApi.includes("coalesce(o.is_cancelled,false)=false"));
check("remaining amount uses total including tax minus advance paid", operationsApi.includes("(coalesce(o.total_incl_vat,0)-coalesce(o.advance_paid,0))") && operationsPage.includes("Number(row.total_incl_vat || 0) - Number(row.advance_paid || 0)"));
check("followup completion is stored canonically on tracking orders", trackingSchema.includes("sales_followup_completed_at") && trackingSchema.includes("sales_followup_completed_by"));
check("followup page defaults to incomplete and exposes completed orders", operationsApi.includes("sales_followup_completed_at is null") && operationsApi.includes("sales_followup_completed_at is not null") && operationsPage.includes("الطلبات غير المكتملة") && operationsPage.includes("الطلبات المكتملة"));
check("complete action moves the order without duplicating it", operationsApi.includes("complete_sales_order_followup") && operationsApi.includes("update tracking.orders set") && operationsPage.includes("مكتمل"));
check("operations page uses exact requested labels", [
  "رقم الطلب", "اسم العميل", "رقم الهيكل", "الإجمالي شامل الضريبة", "الدفعة المقدمة", "المتبقي",
  "استيفاء المبالغ المتبقية", "الموافقة المالية", "الموافقة الإدارية", "إتمام عملية التسليم بنجاح",
].every((label) => operationsPage.includes(label)));
check("operations route and tab are permission protected", app.includes("operations.sales_orders_followup.view") && operationsLayout.includes("operations.sales_orders_followup.view"));
check("operations permission is in both catalogs", access.includes("operations.sales_orders_followup.view") && accessSchema.includes("operations.sales_orders_followup.view"));
check("marketing engagement page has separate permission", access.includes("marketing.engagement.view") && accessSchema.includes("marketing.engagement.view") && marketingLayout.includes("marketing.engagement.view"));
check("marketing engagement actions have separate permissions", [
  "marketing.engagement.subscribe", "marketing.engagement.status.view", "marketing.engagement.webhook.view", "marketing.engagement.refresh",
].every((permission) => access.includes(permission) && accessSchema.includes(permission) && engagement.includes(permission)));
check("API gateway uses the new engagement and operations permissions", apiPermissions.includes('engagement: "marketing.engagement.view"') && apiPermissions.includes('sales_orders_followup: "operations.sales_orders_followup.view"') && apiPermissions.includes('refresh_engagement: "marketing.engagement.refresh"') && apiPermissions.includes('subscribe_engagement_webhooks: "marketing.engagement.subscribe"'));
check("marketing backend enforces and filters engagement permissions", marketingApi.includes("marketing.engagement.view") && marketingApi.includes("marketing.engagement.refresh") && marketingApi.includes("marketing.engagement.subscribe") && marketingApi.includes("marketing.engagement.webhook.view") && marketingApi.includes("marketing.engagement.status.view"));
check("submit webhook is full and includes advance paid", submitWebhook.includes('"event": "sales_order.submitted"') && submitWebhook.includes('"advance_paid"') && submitWebhook.includes("custom_رقم_الجوال") && submitWebhook.includes("custom_اسم_المستخدم") && submitWebhook.includes('"items"'));
check("update webhook uses the same full body with update event", updateWebhook.includes('"event": "sales_order.updated_after_submit"') && updateWebhook.includes('"advance_paid"') && updateWebhook.includes("custom_رقم_الجوال") && updateWebhook.includes('"items"'));
check("cancel webhook remains a cancellation webhook", cancelWebhook.includes('"event": "sales_order.cancelled"'));

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
