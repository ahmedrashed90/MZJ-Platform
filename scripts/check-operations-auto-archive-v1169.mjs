import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const expect = (file, needle, label = needle) => {
  if (!read(file).includes(needle)) throw new Error(`Operations automatic archive check failed: ${file} missing ${label}`);
};
const reject = (file, needle, label = needle) => {
  if (read(file).includes(needle)) throw new Error(`Operations automatic archive check failed: ${file} contains forbidden ${label}`);
};

const packageJson = JSON.parse(read("package.json"));
if (packageJson.version !== "1.17.0") throw new Error("Operations automatic archive check failed: package version must be 1.17.0");

expect("server/_operations-auto-archive.ts", "va.financial_approved and va.administrative_approved", "financial and administrative approval gate");
expect("server/_operations-auto-archive.ts", "r.status<>'completed'", "incomplete transfer gate");
expect("server/_operations-auto-archive.ts", "count(vs.id) filter (where vs.status='completed')=count(vs.id)", "100 percent tracking gate");
expect("server/_operations-auto-archive.ts", "for update", "atomic vehicle lock");
reject("server/_operations-auto-archive.ts", "left join operations.locations", "outer join vehicle lock");
expect("server/tracking/orders.ts", "tryArchiveVehicleForTrackingRecord", "tracking completion trigger");
expect("server/operations/index.ts", "const autoArchive = await tryArchiveEligibleVehicle(tx, vehicleId, who)", "approval trigger");
expect("server/operations/index.ts", "next === \"completed\" ? await archiveEligibleItems()", "transfer completion trigger");
expect("server/operations/index.ts", "const autoArchivedVehicleIds = await archiveEligibleItems();", "transfer cancel/delete trigger");
expect("server/operations/index.ts", "for update of v", "manual archive nullable outer join fix");
expect("server/_operations-auto-archive.ts", "is_inventory_active=false", "archive inventory removal");

console.log("Operations automatic vehicle archive v1.16.9 check passed.");
