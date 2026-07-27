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
const sidebar = read("src/components/Sidebar.tsx");
const settingsPage = read("src/pages/SettingsPage.tsx");
const notificationSettings = read("src/notifications/NotificationSettingsPanel.tsx");
const notificationSettingsEndpoint = read("server/notification-settings.ts");
const preferencesMigration = read("database/migrations/20260728_notification_preferences.sql");
const styles = read("src/styles.css");
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
check("Notification metadata uses a JSON-safe recursive type", /export type NotificationJsonValue/.test(helper) && !/metadata\?: Record<string, unknown>/.test(helper));
check("Notification count queries read the first result row", /const countRow = countRows\[0\]/.test(helper) && /const unreadRow = unreadRows\[0\]/.test(helper));
check("NEXT ERP notification uses normalized customer fields", /normalized\.actualCustomerName/.test(erp) && /normalized\.accountingCustomerName/.test(erp) && !/normalized\.customerName/.test(erp));
check("Notification bell is mounted in the sidebar account area", /<NotificationBell \/>/.test(sidebar) && !/<NotificationBell \/>/.test(app));
check("Unread badge keeps the red visual state", /notification-bell-button>span/.test(styles) && /background: var\(--red\)/.test(styles));
check("New notifications trigger an audible alert", /createAudioContext/.test(bell) && /playNotificationSound/.test(bell));
check("New notifications show a timed in-page card", /notification-toast-card/.test(bell) && /setTimeout\(\(\) => setToastItem\(null\)/.test(bell));
check("Notification preferences are persisted per user", /core\.notification_preferences/.test(helper) && /user_id uuid primary key/.test(preferencesMigration));
check("Notification preferences API is authenticated and routed", /notificationSettingsHandler/.test(api) && /requireUser\(request, response\)/.test(notificationSettingsEndpoint));
check("Notification settings are available from the unified settings page", /key: "notifications"/.test(settingsPage) && /<NotificationSettingsPanel \/>/.test(settingsPage));
check("Notification settings cover sound toast duration and system alerts", /soundEnabled/.test(notificationSettings) && /toastEnabled/.test(notificationSettings) && /toastDurationSeconds/.test(notificationSettings) && /systemAlerts/.test(notificationSettings));
check("Every notification exposes the responsible actor", /actorName = clean\(input\.actorName\) \|\| "النظام"/.test(helper) && /notificationActorName/.test(bell) && /المسؤول:/.test(bell) && /notificationActorName/.test(center) && /المسؤول:/.test(center));

console.log(`Internal notification regression checks: ${passed}/${passed + failed} passed.`);
if (failed) process.exit(1);
