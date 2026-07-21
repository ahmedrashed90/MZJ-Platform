import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const expect = (file, needle, label = needle) => {
  if (!read(file).includes(needle)) throw new Error(`Tracking deleted release check failed: ${file} missing ${label}`);
};

const packageJson = JSON.parse(read("package.json"));
if (packageJson.version !== "1.17.0") throw new Error("Tracking deleted release check failed: package version must be 1.17.0");
expect("server/_operations-utils.ts", '"DELETED_TRACKING_REQUEST_NOT_FOUND"', "typed deleted-record error code");
expect("server/tracking/delete.ts", 'action === "delete_deleted_record"', "deleted-record action");
expect("server/tracking/delete.ts", "delete from tracking.deleted_orders", "deleted-record removal");
expect("src/tracking/pages/TrackingDeletePage.tsx", "الطلبات المحذوفة", "renamed deleted list");
expect("src/tracking/pages/TrackingDeletePage.tsx", "delete_deleted_record", "deleted-record UI action");
console.log("Tracking deleted-order release v1.16.9 check passed.");
