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

const notifications = read("server/_notifications.ts");
const operations = read("server/operations/index.ts");
const erpStatus = read("server/integrations/erpnext-vehicle-status.ts");
const inventoryPage = read("src/operations/pages/InventoryPage.tsx");

check("Inventory status notifications are centralized", /export async function emitVehicleInventoryStatusNotification/.test(notifications));
check("Only reserved and available-for-sale status transitions use the dedicated notification", /reserved:\s*"حجز"/.test(notifications) && /available_for_sale:\s*"متاح للبيع"/.test(notifications));
check("Reserved notification title names the exact new status", /تم تغيير حالة السيارة إلى \$\{currentStatusName\}/.test(notifications));
check("Reserved notification contains the booking administrator", /detailLine\("الإداري الذي حجز", reservationAdminName\)/.test(notifications));
check("Vehicle notification keeps full transition details", /detailLine\("الحالة السابقة", previousStatusName\)/.test(notifications) && /detailLine\("الحالة الحالية", currentStatusName\)/.test(notifications) && /detailLine\("المكان", vehicle\.location_name\)/.test(notifications));
check("Responsible user is stored as the notification actor", /actorName:\s*responsibleName/.test(notifications) && /responsibleName/.test(notifications));
check("Direct vehicle edits expose the real status transition", /statusChanged:\s*statusCode !== before\.status_code/.test(operations) && /previousStatusCode:\s*before\.status_code/.test(operations));
check("Bulk movements expose one transition per moved vehicle", /previousStatusCode:\s*v\.status_code/.test(operations) && /currentStatusCode:\s*newStatus/.test(operations));
check("Operations notifications create one vehicle status alert per changed vehicle", /action === "move_vehicles"/.test(notifications) && /statusChangedVehicles/.test(notifications) && /for \(const movedVehicle of statusChangedVehicles\)/.test(notifications));
check("ERPNext status synchronization emits the same native notification", /emitVehicleInventoryStatusNotification/.test(erpStatus) && /result\.changed && result\.statusChanged/.test(erpStatus));
check("ERPNext passes the booking administrator from inventory fields", /reservationAdminName:\s*result\.reservedByName/.test(erpStatus) && /actorName:\s*result\.actorName/.test(erpStatus));
check("Notification retries are deduplicated by the movement or ERP event", /operations-vehicle-inventory-status/.test(notifications) && /eventKey:\s*result\.movementId/.test(erpStatus));
check("Inventory page structure remains untouched by notification wiring", !/emitVehicleInventoryStatusNotification|createNotification/.test(inventoryPage));

console.log(`Vehicle inventory status notification checks: ${passed}/${passed + failed} passed.`);
if (failed) process.exit(1);
