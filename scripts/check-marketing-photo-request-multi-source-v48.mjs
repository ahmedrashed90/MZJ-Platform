import fs from "node:fs";

const checks = [];
const check = (label, value) => {
  const ok = Boolean(value);
  checks.push([label, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
};

const page = fs.readFileSync("src/marketing/pages/StockPage.tsx", "utf8");
const server = fs.readFileSync("server/marketing/index.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const createStart = server.indexOf("async function createPhotoRequest");
const createEnd = server.indexOf("async function userColors", createStart);
const createSection = createStart >= 0 && createEnd > createStart ? server.slice(createStart, createEnd) : "";

check("release baseline version remains 1.19.16", packageJson.version === "1.19.16");
check("photo request picker no longer locks additions to the first source location", !page.includes("selectedSourceLocationId") && !page.includes("موجودة في مكان مصدر مختلف. أنشئ لها طلب تصوير مستقل"));
check("selected cars still show each current location", page.includes('{ key: "location", label: "المكان الحالي"'));
check("server photo request no longer rejects mixed source locations", createSection.length > 0 && !createSection.includes("يجب أن تكون كل سيارات طلب التصوير في المكان المصدر نفسه") && !createSection.includes("cars.some((vehicle)=>String(vehicle.location_id)!==String(source.location_id))"));
check("every request vehicle persists its own exact source location", createSection.includes("source_location_id,source_status,item_note") && createSection.includes("${car.location_id}"));
check("photo request creation records all distinct source locations in event metadata", createSection.includes("const sourceLocationIds=[...new Set(cars.map") && createSection.includes("sourceLocationIds,vehicles"));
check("stock request list aggregates all source location names", server.includes("string_agg(source_names.name,'، ' order by source_names.name)") && server.includes("select distinct source_location.name"));
check("stock request vehicle payload exposes its original source location", server.includes("'sourceLocationName',vehicle_source_location.name") && server.includes("vehicle_source_location.id=rv.source_location_id"));
check("marketing request details display a source location for every VIN", page.includes("<th>المكان المصدر</th>") && page.includes('vehicle.sourceLocationName || "—"'));
check("generic operations transfer same-source rule is not changed by this release", server.includes("async function createPhotoRequest") && fs.readFileSync("server/operations/index.ts", "utf8").includes("يجب أن تكون كل سيارات طلب النقل في المكان المصدر نفسه"));
check("no release-specific patch or diff file was added", !fs.readdirSync(".").some((name) => /\.(patch|diff)$/i.test(name)));

const passed = checks.filter(([, ok]) => ok).length;
console.log(`Marketing multi-source photo request v48 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
