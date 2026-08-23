import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function expect(condition, message) { if (!condition) throw new Error(message); }

const dashboard = read("src/pages/DashboardPage.tsx");
const dashboardData = read("server/_dashboard-data.ts");
const operationsModal = read("src/operations/components/DashboardOperationsModal.tsx");
const settings = read("src/pages/SettingsPage.tsx");
const dataPanel = read("src/settings/DataManagementPanel.tsx");
const dataApi = read("server/data-management.ts");
const api = read("api/index.ts");
const permissions = read("server/_api-permissions.ts");
const trackingModal = read("src/tracking/components/DashboardTrackingOrderModal.tsx");
const crmReports = read("src/crm/pages/CrmReportsPage.tsx");
const styles = read("src/styles.css");

expect(dashboard.includes('crm?.cashSold') && dashboard.includes('crm?.financeSold'), "Department sold totals are not split on the dashboard");
expect(!/title: "خدمة العملاء"[\s\S]{0,650}label: "تم البيع"/.test(dashboard), "Customer service still displays a sold metric");
expect(dashboardData.includes("as cash_sold") && dashboardData.includes("as finance_sold"), "Dashboard SQL does not calculate department sold totals");
expect(dashboardData.includes("is_archived,false)=false and status='completed'"), "Completed tracking count still includes archived requests");
expect(dashboard.includes("DashboardTrackingOrderModal") && dashboard.includes("setTrackingTarget(order)"), "Tracking order details are not opened inside the dashboard");
expect(trackingModal.includes("سجل الإجراءات") && trackingModal.includes("السيارات ومراحل التتبع"), "Inline tracking modal is incomplete");
expect(operationsModal.includes("dashboard-approval-action-first") && operationsModal.indexOf("dashboard-approval-detail-cards") < operationsModal.indexOf("dashboard-approval-more-details"), "Approval actions are not positioned before extended details");
expect(crmReports.includes("crm-report-filter-blocks") && crmReports.includes("crm-report-filter-title-icon"), "Professional CRM filter groups are missing");
expect(settings.includes('key: "data"') && settings.includes("<DataManagementPanel />"), "Data management settings section is missing");
expect(dataPanel.includes("export_customers") && dataPanel.includes("import_customers") && dataPanel.includes("restore_chunk") && dataPanel.includes("reset_test_data"), "Data management UI actions are incomplete");
expect(dataApi.includes("RESET_ROOT_TABLES") && dataApi.includes("platform.superadmin") === false, "Reset implementation is missing or permission leaked into the handler");
expect(dataApi.includes("requireAdmin") && dataApi.includes("database_backup_created") && dataApi.includes("database_backup_restored"), "Protected backup/restore implementation is incomplete");
expect(dataApi.includes('confirmation !== "مسح كل البيانات التجريبية"'), "Destructive reset confirmation is not enforced server-side");
expect(dataApi.includes("duplicates") && dataApi.includes("phone_normalized") && dataApi.includes("originalRow"), "Safe legacy customer import rules are incomplete");
expect(!dataApi.includes('"core.users"') && !dataApi.includes('"core.roles"') && !dataApi.includes('"core.permissions"'), "Destructive reset must not target users, roles, or permissions");
expect(dataApi.includes('const nonCoreTables = tables.filter((table) => table.schema !== "core")'), "Restore must only truncate non-core tables present in the backup");
expect(dataPanel.includes("سيتم استبدال بيانات الأنظمة") && dataPanel.includes("window.confirm"), "Backup restore confirmation is missing");
expect(api.includes('["data-management", dataManagementHandler]'), "Data management API route is not registered");
expect(permissions.includes('route === "data-management"') && permissions.includes('req("platform.superadmin"'), "Data management API is not restricted to the superadmin permission");
expect(styles.includes(".data-management-panel") && styles.includes(".dashboard-tracking-order-modal") && styles.includes(".crm-report-filter-blocks"), "Required professional styling is missing");
expect(!dashboard.includes("/tracking?order="), "Dashboard tracking click still navigates away from the dashboard");

console.log("Dashboard, tracking, filters, import/export, backup/restore, and safe reset checks passed.");
