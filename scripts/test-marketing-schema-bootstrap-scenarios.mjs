import fs from "node:fs";

const schema = fs.readFileSync("database/marketing_native_schema.sql", "utf8");
const fail = (message) => { throw new Error(`Marketing bootstrap simulation failed: ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

const legacy = {
  schema: "marketing",
  platforms: [{ id: "legacy-instagram", code: "instagram" }],
  platformPostTypes: [{ id: "legacy-story", platformId: "legacy-instagram", code: "story" }],
  foreignKeyTarget: "marketing.platforms",
};

const native = {
  schema: "marketing_native",
  departments: new Map(),
  creativeTypes: new Map(),
  campaignTypes: new Map(),
  platforms: new Map(),
  postTypes: new Map(),
  categories: new Map(),
  statuses: new Map(),
  attendance: new Map(),
};
let uuidCounter = 0;
const uuid = (prefix) => `${prefix}-${String(++uuidCounter).padStart(4, "0")}`;

for (const [code, name, isContent] of [
  ["content", "قسم المحتوى", true], ["design", "قسم التصميم", false],
  ["photography", "قسم التصوير", false], ["montage", "قسم المونتاج", false],
  ["publishing", "قسم النشر", false],
]) native.departments.set(code, { id: uuid("department"), code, name, isContent });

for (const [name, shortCode, departmentCode] of [
  ["REEL - مواصفات كامله - STUDIO", "M-RL-SPEC-ST", "montage"],
  ["POST", "D-POST", "design"],
  ["تصوير صور السياره", "P-CAR-PHOTO", "photography"],
]) {
  const department = native.departments.get(departmentCode);
  assert(department, `creative type ${name} could not resolve native department ${departmentCode}`);
  native.creativeTypes.set(name, { id: uuid("creative-type"), shortCode, departmentId: department.id });
}

for (const [name, shortCode, prefix] of [
  ["حملة تسويقية", "CMP", "MZJ"], ["حملة عروض", "OFR", "MZJ"],
  ["حملة إطلاق", "LCH", "MZJ"], ["حملة توعوية", "AWR", "MZJ"],
]) native.campaignTypes.set(name, { id: uuid("campaign-type"), shortCode, prefix });

for (const [code, name] of [
  ["instagram", "Instagram"], ["snapchat", "Snapchat"], ["tiktok", "TikTok"],
  ["youtube", "YouTube"], ["whatsapp", "حملات واتساب"],
]) native.platforms.set(code, { id: uuid("platform"), code, name });

const postTypeRows = [
  ["instagram", "reel"], ["instagram", "story"], ["instagram", "post"], ["instagram", "carousel"],
  ["snapchat", "story"], ["snapchat", "video"], ["tiktok", "video"],
  ["youtube", "shorts"], ["youtube", "video"], ["whatsapp", "image"],
  ["whatsapp", "video"], ["whatsapp", "message"],
];
for (const [platformCode, code] of postTypeRows) {
  const parent = native.platforms.get(platformCode);
  assert(parent, `post type ${platformCode}/${code} has no native parent`);
  const key = `${parent.id}:${code}`;
  assert(!native.postTypes.has(key), `duplicate post type unique key ${key}`);
  native.postTypes.set(key, { id: uuid("post-type"), platformId: parent.id, code });
}

for (const row of native.postTypes.values()) {
  assert([...native.platforms.values()].some((platform) => platform.id === row.platformId), `orphan native post type ${row.code}`);
  assert(!legacy.platforms.some((platform) => platform.id === row.platformId), `native post type ${row.code} incorrectly points to legacy platform ID`);
}

for (const [name] of [["العائلية"], ["الفضية"], ["الذهبية"], ["VIP"]]) native.categories.set(name, { id: uuid("category") });
for (const [code, terminal] of [["request_received", false], ["scheduled", false], ["in_progress", false], ["completed", true], ["cancelled", true]]) native.statuses.set(code, { terminal });
native.attendance.set("default", { workStart: "16:00", workEnd: "21:00" });

assert(native.platforms.size === 5, `expected 5 native platforms, found ${native.platforms.size}`);
assert(native.postTypes.size === 12, `expected 12 native post types, found ${native.postTypes.size}`);
assert(native.attendance.size === 1 && native.attendance.has("default"), "attendance singleton seed is invalid");
assert(legacy.foreignKeyTarget === "marketing.platforms", "legacy fixture changed unexpectedly");
assert(schema.includes("create schema if not exists marketing_native"), "native schema creation is missing");
assert(!/\b(?:from|join|into|update|table|sequence|references)\s+marketing\.(?:platforms|platform_post_types|campaigns|tasks)\b/i.test(schema), "canonical schema touches a legacy marketing object");
assert(schema.indexOf("create table if not exists marketing_native.platforms") < schema.indexOf("create table if not exists marketing_native.platform_post_types"), "native parent table is not created first");
assert(schema.indexOf("insert into marketing_native.platforms") < schema.indexOf("insert into marketing_native.platform_post_types"), "native parent seed is not inserted first");
assert(schema.includes("platform_id uuid not null references marketing_native.platforms(id) on delete cascade"), "native post-type FK target is wrong");
assert(schema.includes("from marketing_native.platforms p"), "post-type seed does not read native parent rows");
assert(schema.includes("a foreign key still targets legacy marketing schema"), "runtime rollback guard against legacy FK targets is missing");
for (const seedTable of ["departments", "assignment_actions", "creative_types", "campaign_types", "platforms", "platform_post_types", "package_categories", "request_statuses"]) {
  const seedStart = schema.indexOf(`insert into marketing_native.${seedTable}`);
  assert(seedStart >= 0, `missing seed for ${seedTable}`);
  const seedEnd = schema.indexOf(";", seedStart);
  const seedSql = schema.slice(seedStart, seedEnd + 1);
  assert(/on conflict do nothing;/i.test(seedSql), `seed for ${seedTable} is not non-invasive`);
  assert(!/on conflict[^;]*do update/i.test(seedSql), `seed for ${seedTable} overwrites administrator settings`);
}

console.log("Marketing bootstrap simulations passed: isolated legacy schema, 5 native platforms, 12 FK-valid post types, singleton settings");
