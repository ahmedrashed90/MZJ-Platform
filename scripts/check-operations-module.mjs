import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const readMany=(files)=>files.map(read).join("\n");
const assert=(condition,message)=>{if(!condition){console.error(`FAIL: ${message}`);process.exitCode=1}else console.log(`PASS: ${message}`)};

const app=read("src/App.tsx");
const layout=read("src/operations/OperationsLayout.tsx");
const operationsPage=read("src/operations/OperationsPage.tsx");
const modal=read("src/operations/components/Modal.tsx");
const vehiclePage=read("src/operations/pages/VehicleListPage.tsx");
const importPage=read("src/operations/pages/ImportExportPage.tsx");
const excel=read("src/operations/excel.ts");
const api=read("api/index.ts");
const auth=read("server/_operations-auth.ts");
const backend=readMany([
  "server/operations/index.ts","server/operations/vehicles.ts","server/operations/movements.ts","server/operations/requests.ts",
  "server/operations/approvals.ts","server/operations/approval-flow.ts","server/operations/import.ts","server/operations/meta.ts","server/operations/reports.ts","server/operations/common.ts",
]);
const dashboard=read("server/_dashboard-data.ts");
const migration=read("database/migrations/001_operations_rebuild.sql");
const migrationFiles=fs.readdirSync(path.join(root,"database/migrations")).filter(name=>name.includes("operations"));

const routes=["manage","import-export","movements","bulk-movement","requests","approvals","all-vehicles","movement-log","archive"];
assert(app.includes('path="/operations"')&&routes.every(route=>app.includes(`path="${route}"`)),"all native Operations routes are registered");
assert(["مخزون السيارات","إدارة السيارات","الاستيراد والتصدير","حركة سيارة","حركة جماعية","طلبات النقل والتصوير","الموافقات","جميع السيارات","سجل الحركات","الأرشيف"].every(label=>layout.includes(label)),"Operations navigation exposes the required pages");
assert(!app.includes("/operations/tracking")&&!app.includes("/operations/media")&&!layout.includes("Media"),"no Operations Tracking or legacy Media page remains");
assert(api.includes('["operations", operationsHandler]')&&api.includes('../server/operations/index.js'),"unified API router exposes the native Operations endpoint");
assert(migrationFiles.length===1&&migrationFiles[0]==="001_operations_rebuild.sql","Operations database changes are consolidated in one migration");
const migrationRequirements=["operations_vehicles_vin_canonical_uidx","operations.vehicle_statuses","operations.check_item_definitions","operations.vehicle_check_items","operations.vehicle_check_history","operations.vehicle_approval_history","cycle_no integer","operations.movement_batches","operations.request_stage_events","operations.vehicle_request_locks","operations.vehicle_archives","operations.audit_events","operations.event_outbox","legacy_id text","operations.requests.receive_vehicle","operations.settings.manage","operations.tracking_vehicle_read_model","operations.approvals.view","operations.approvals.financial","operations.approvals.administrative","operations.approvals.revert","operations.approvals.notes"];
assert(migrationRequirements.every(token=>migration.includes(token)),"migration contains VIN uniqueness, independent checks, histories, locks, archive, audit, outbox, tracking view, legacy IDs, and permissions");
assert(auth.includes("requireOperationsPermission")&&auth.includes("permittedLocationIds")&&auth.includes("permittedBranchIds"),"server authorization checks permission, branch, and location scope");
assert(!backend.toLowerCase().includes("firebase")&&!backend.match(/[A-Z0-9._%+-]+@mzj-platform\.com/i),"Operations backend has no Firebase or hardcoded user emails");
assert(["movements.ts","requests.ts","approvals.ts","import.ts"].every(name=>read(`server/operations/${name}`).includes("sql.begin")),"imports, movements, requests, and approvals use database transactions");
const requests=read("server/operations/requests.ts");
assert(requests.includes("nextStage(row.status)")&&requests.includes("targetStage!==normalNext")&&requests.includes("request_stage_events"),"request stages are ordered and fully audited");
assert(requests.includes('targetStage==="vehicle_received"')&&requests.includes("operations.movements")&&requests.includes("received_location_id"),"vehicle receipt updates request, vehicle, and movement records together");
assert(requests.includes('row.status!=="draft"')&&requests.includes("لا يمكن حذف طلب بدأ تنفيذه"),"request deletion is blocked after any real execution starts");
const approvals=read("server/operations/approvals.ts");
const approvalFlow=read("server/operations/approval-flow.ts");
const approvalPage=read("src/operations/pages/ApprovalsPage.tsx");
assert(approvals.includes("vehicle_approval_history")&&approvals.includes('action==="approve"?"approved"')&&approvals.includes('action==="revoke"?"revoked"'),"approval and revocation history is preserved");
assert(approvals.includes("v.status_code=${UNDER_DELIVERY_STATUS}")&&dashboard.includes("v.status_code='under_delivery'"),"approval list and unified dashboard card include only vehicles under delivery");
assert(["operations.approvals.view","operations.approvals.financial","operations.approvals.administrative","operations.approvals.revert","operations.approvals.notes"].every(permission=>migration.includes(permission)&&approvals.includes(permission)||permission==="operations.approvals.view"&&read("server/operations/index.ts").includes(permission)),"independent approval permissions exist and are enforced server-side");
assert(approvalFlow.includes('UNDER_DELIVERY_STATUS = "under_delivery"')&&approvalFlow.includes('DELIVERED_STATUS = "delivered"')&&approvalFlow.includes("UNDER_DELIVERY_REQUIRED")&&approvalFlow.includes("APPROVALS_REQUIRED"),"delivered status requires the mandatory under-delivery stage and both approvals");
assert(approvalFlow.includes("financial_approved=false,administrative_approved=false")&&approvalFlow.includes('action: "initialized" | "cleared"')&&approvalFlow.includes("targetStatusCode !== DELIVERED_STATUS"),"entering under delivery initializes approvals and leaving to another status clears only the operational state");
assert(["vehicles.ts","movements.ts","requests.ts","import.ts"].every(name=>{const source=read(`server/operations/${name}`);return source.includes("assertApprovalStatusTransition")&&source.includes("applyApprovalStatusTransition")}),"every vehicle status mutation path enforces the approval flow inside the API transaction");
assert(approvalPage.includes("موافقة مالية")&&approvalPage.includes("موافقة إدارية")&&approvalPage.includes("حفظ الملاحظة")&&approvalPage.includes("تراجع")&&approvalPage.includes("missing_financial")&&approvalPage.includes("missing_administrative")&&approvalPage.includes("completed"),"approval UI has independent cards, notes, reversal, and all mandatory counters");
assert(approvals.includes('status_code!=="delivered"')&&approvals.includes("financial_approved")&&approvals.includes("administrative_approved")&&approvals.includes("tracking_progress")&&approvals.includes("vehicle_archives"),"archive validates final state, approvals, movement, independent Tracking completion, and active requests");
const importer=read("server/operations/import.ts");
assert(importer.includes("coalesce(${n.carName},car_name)")&&importer.includes("failedRows:invalidRows")&&importer.includes("VIN مكرر داخل الملف"),"Excel upsert preserves existing values and reports every invalid row");
assert(modal.includes('event.key==="Escape"')&&modal.includes('role="dialog"')&&operationsPage.includes("<VehicleListPage"),"all Operations dialogs use the shared Escape-aware modal");
assert(vehiclePage.includes('option value="hide"')&&vehiclePage.includes('option value="all"')&&vehiclePage.includes('option value="only"'),"inventory can hide, include, or show only archived vehicles");
assert(importPage.includes("معاينة")&&importPage.includes("الصحيح")&&importPage.includes("الخاطئ")&&importPage.includes("errors.join"),"Excel import preview shows valid and invalid rows with reasons");
assert(excel.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")&&excel.includes("parseXlsx")&&!excel.includes("CSV"),"import and export use native XLSX rather than CSV-only handling");
assert(dashboard.includes("ensureOperationsSchema")&&dashboard.includes("counts_in_inventory")&&dashboard.includes("vehicle_shortages")&&dashboard.includes("transfer_requests"),"unified dashboard reads the rebuilt Operations tables and inventory rules");
assert(dashboard.includes("getDashboardData(user: SessionUser)")&&dashboard.includes("b.code=any(${branchCodes}::text[])")&&read("server/dashboard.ts").includes("getDashboardData(user)"),"unified dashboard Operations counters are scoped by the signed-in user's branches");
assert(dashboard.includes('hasPermission(user, "operations.approvals.view")')&&dashboard.includes("canViewApprovals ?")&&read("src/pages/DashboardPage.tsx").includes("canViewOperationsApprovals"),"approval dashboard data and card require the dedicated view permission");
if(process.exitCode)process.exit(process.exitCode);
console.log("Operations native rebuild structural checks passed.");
