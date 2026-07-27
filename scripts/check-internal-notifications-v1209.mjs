import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

const helper = read("server/_notifications.ts");
const endpoint = read("server/notifications.ts");
const api = read("api/index.ts");
const app = read("src/App.tsx");
const bell = read("src/notifications/NotificationBell.tsx");
const center = read("src/notifications/NotificationsCenterPage.tsx");
const schema = read("database/schema.sql");
const runtimeSchema = read("server/_schema.ts");
const migration = read("database/migrations/20260727_internal_notifications.sql");
const crm = read("server/crm/leads.ts");
const manualLeads = read("server/crm/manual-leads.ts");
const inbound = read("server/integrations/[source].ts");
const erp = read("server/_erpnext-sales-order-sync.ts");
const marketing = read("server/marketing/index.ts");
const operations = read("server/operations/index.ts");
const tracking = read("server/tracking/orders.ts");
const trackingIngest = read("server/integrations/tracking-orders.ts");
const layouts = ["src/crm/CrmLayout.tsx", "src/marketing/MarketingLayout.tsx", "src/operations/OperationsLayout.tsx", "src/tracking/TrackingLayout.tsx"].map(read).join("\n");

check("Persistent notifications table exists", /create table if not exists core\.notifications/i.test(schema) && /core\.notifications/i.test(runtimeSchema) && /core\.notifications/i.test(migration));
check("Per-user read state exists", /core\.notification_user_state/i.test(schema) && /primary key\s*\(notification_id,user_id\)/i.test(migration));
check("Notification API is routed", /notificationsHandler/.test(api) && /\["notifications",\s*notificationsHandler\]/.test(api));
check("Notification API requires an authenticated user", /requireUser\(request, response\)/.test(endpoint));
check("Global notification access is restricted to system administrators", /requested === "all" && !admin/.test(helper) && /platform\.superadmin/.test(helper) && /NotificationsRoute/.test(app));
check("Each system has an isolated notification scope", /routeSystem\(location\.pathname\)/.test(bell) && /currentSystem \|\| \(admin \? "all"/.test(bell));
check("Scope filtering remains separate per system", /when 'crm'/.test(helper) && /when 'marketing'/.test(helper) && /when 'operations'/.test(helper) && /when 'tracking'/.test(helper));
check("Direct recipients can receive targeted notifications", /audience_user_ids\)>0/.test(helper) && /any\(n\.audience_user_ids\)/.test(helper));
check("CRM lead events emit real notifications", /emitCrmLeadNotification/.test(crm) && /emitCrmLeadNotification/.test(manualLeads));
check("Inbound customer messages emit only for stored inbound messages", /result\.message\?\.id/.test(inbound) && /emitInboundMessageNotification/.test(inbound));
check("NEXT ERP-created CRM customers emit notifications", /crm-lead-created-next-erp/.test(erp));
check("Marketing campaigns agendas progress and assignments emit notifications", /emitMarketingNotification/.test(marketing) && /progress_threshold/.test(helper) && /task_assigned/.test(helper));
check("Operations requests and workflow actions emit notifications", /emitOperationsNotification/.test(operations) && /request_stage_updated/.test(helper));
check("Tracking creation and stages emit notifications", /emitTrackingNotification/.test(tracking) && /tracking-order-created/.test(trackingIngest));
check("Read and mark-all actions are implemented", /markNotifications/.test(endpoint) && /markAllRead/.test(bell) && /markAll/.test(center));
check("No notification tab was added to any system layout", !/NotificationBell|NotificationsCenter|مركز الإشعارات/.test(layouts));
check("Notification state is database-backed, not localStorage-backed", !/localStorage/.test(helper + endpoint + bell + center));

console.log(`Internal notification regression checks: ${passed}/${passed + failed} passed.`);
if (failed) process.exit(1);
