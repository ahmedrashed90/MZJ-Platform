import fs from "node:fs";

const reads = (file) => fs.readFileSync(file, "utf8");
const operationsApi = reads("server/operations.ts");
const trackingOrders = reads("src/tracking/pages/TrackingOrdersPage.tsx");
const dashboardModal = reads("src/components/OperationsDashboardModal.tsx");
const dashboard = reads("src/pages/DashboardPage.tsx");
const app = reads("src/App.tsx");
const layout = reads("src/tracking/TrackingLayout.tsx");
const manage = reads("src/operations/pages/OperationsManagePage.tsx");
const operationsSchema = reads("server/_operations-schema.ts");

const required = [
  [operationsApi, "tracking.vehicle_stages", "Operations inventory must use native vehicle stages"],
  [operationsApi, "await ensureTrackingSchema()", "Operations API must initialize the tracking schema before joined queries"],
  [operationsApi, "assertVehiclesAccess", "Operations writes must enforce server-side vehicle scope"],
  [trackingOrders, "createPortal", "Tracking delete confirmation must render through a portal"],
  [trackingOrders, "tracking-delete-confirm-backdrop", "Tracking delete confirmation UI is missing"],
  [dashboardModal, "رقم الهيكل", "Dashboard vehicle popup VIN column is missing"],
  [dashboardModal, "تصدير Excel", "Dashboard popup export is missing"],
  [dashboardModal, "طلبات التصوير", "Dashboard request tabs are missing"],
  [dashboard, "طلبات النقل والتصوير", "Dashboard transfer and photography card is missing"],
  [manage, "استبدال كامل", "Excel full replacement mode is missing"],
  [manage, "إضافة فوق الحالي", "Excel append mode is missing"],
  [manage, "تحديث من الشيت", "Excel update mode is missing"],
  [manage, "XLSX.read", "Excel parsing is missing"],
  [operationsApi, "IMPORT_VALIDATION_FAILED", "Safe import validation is missing"],
  [operationsSchema, "operations.import.replace", "Full replacement permission is missing"],
];
for (const [text, needle, message] of required) if (!text.includes(needle)) throw new Error(message);
if (operationsApi.includes("os.is_completed")) throw new Error("Invalid tracking order_stages.is_completed query returned");
if (app.includes('path="delete"') || layout.includes('/tracking/delete')) throw new Error("Obsolete standalone tracking delete route returned");
if (fs.existsSync("src/tracking/pages/TrackingDeletePage.tsx")) throw new Error("Obsolete tracking delete page still exists");
if (!fs.existsSync("database/migrations/013_operations_native_clean.sql")) throw new Error("Operations migration file is missing");
console.log("Operations native rebuild, dashboard drilldowns, database query compatibility, and tracking delete portal checks passed.");
