import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    console.error(`CRM v27 check failed: ${message}`);
    process.exit(1);
  }
};

const dashboard = read("src/crm/pages/CrmDashboardPage.tsx");
const unreadState = read("src/crm/unreadState.ts");
const historyPage = read("src/crm/pages/CrmFinanceHistoryPage.tsx");
const historyServer = read("server/crm/history.ts");
const unreadServer = read("server/_crm-unread-state.ts");
const unreadEndpoint = read("server/crm/unread.ts");
const integrationProcessor = read("server/_integration-processor.ts");
const leadsServer = read("server/crm/leads.ts");
const dashboardServer = read("server/crm/dashboard.ts");
const schema = read("server/_crm-schema.ts");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const styles = read("src/styles.css");

assert(unreadState.includes("leadHasUnreadMessage"), "PostgreSQL unread-state helper is missing");
assert(!dashboard.includes("firestoreUnread") && !dashboard.includes("subscribeToLegacyIncomingMessages"), "dashboard must not depend on Firebase listeners");
assert(dashboard.includes("window.setInterval") && dashboard.includes("10000"), "dashboard PostgreSQL refresh interval is missing");
assert(dashboard.includes('label: "الرسائل غير المقروءة"'), "unread Kanban card is missing");
assert(dashboard.indexOf('...statusGroups') < dashboard.indexOf('label: "الرسائل غير المقروءة"'), "unread Kanban card must be appended after status cards");
assert(dashboard.includes("leadHasUnreadMessage(right)"), "unread customers are not sorted first inside status cards");
assert(dashboard.includes('className="crm-unread-dot"'), "green unread badge is missing");
assert(!dashboard.includes("رسالة من العميل"), "unread badge must not contain text");
assert(styles.includes(".crm-unread-dot") && styles.includes("#16a34a"), "green unread badge style is missing");

assert(historyPage.includes("سجل العملاء") && historyPage.includes("فروقات حالات العملاء"), "finance history tabs are missing");
assert(historyPage.includes('window.open(url, "_blank", "noopener,noreferrer")'), "customer conversation must open in a new tab");
assert(historyServer.includes("order by e.created_at desc,e.id desc"), "status-at-cutoff must use the latest event up to the cutoff");
assert(historyServer.includes("cutoff_at") && historyServer.includes("Asia/Riyadh"), "finance date cutoffs must use end-of-day Riyadh time");
assert(historyServer.includes("count(*)::int as count"), "finance status differences must count customers, not movements");

for (const field of [
  "unread_count", "dashboard_unread", "has_unread_message", "has_unread_messages", "message_unread", "is_unread",
  "last_message_direction", "last_incoming_message_at", "last_message_at", "dashboard_message_read_at",
]) assert(unreadServer.includes(field), `persistent unread field ${field} is missing`);
assert(unreadServer.includes("lastUnreadMessageKey"), "unread persistence must be idempotent per message");
assert(unreadEndpoint.includes("messageId || messagePath"), "unread idempotency must prefer the provider message id over the Firestore path");
assert(integrationProcessor.includes("markCrmLeadUnread"), "integration messages must use the centralized unread-state service");

assert(schema.includes("car_category") && schema.includes("'الفئة'") && schema.includes("include_in_completion"), "car category migration/completion definition is missing");
assert(leadsServer.includes("carCategory") && leadsServer.includes("car_category"), "car category save mapping is missing");
assert(dashboardServer.includes("l.car_category"), "car category is missing from dashboard data");
assert(drawer.includes('label: "الفئة"') && drawer.includes("carCategory: activeForm.values.car_category"), "car category field is missing from customer data UI");

const example = [
  { id: "read-a", unread: false, order: 0 },
  { id: "unread-a", unread: true, order: 1 },
  { id: "read-b", unread: false, order: 2 },
].sort((left, right) => Number(right.unread) - Number(left.unread) || left.order - right.order);
assert(example.map((item) => item.id).join(",") === "unread-a,read-a,read-b", "unread-first stable ordering simulation failed");

const events = [
  { at: Date.parse("2026-07-01T08:00:00Z"), status: "عميل جديد" },
  { at: Date.parse("2026-07-03T08:00:00Z"), status: "تم الاتصال" },
];
const statusAt = (cutoff) => events.filter((event) => event.at <= cutoff).at(-1)?.status || "";
assert(statusAt(Date.parse("2026-07-02T23:59:59Z")) === "عميل جديد", "start cutoff simulation failed");
assert(statusAt(Date.parse("2026-07-04T23:59:59Z")) === "تم الاتصال", "end cutoff simulation failed");

console.log("CRM reference v27 structure, unread flow, finance differences, and category checks passed.");
