import assert from "node:assert/strict";

const allowedLocations = new Set(["multaqa", "qadisiyah", "hall", "warehouse"]);
const targetBranches = ["multaqa", "hall", "qadisiyah"];
const allowedStatuses = new Set(["available_for_sale", "reserved", "reservation", "has_notes"]);
const excluded = ["حساس", "حساسات", "sensor", "sensors", "كاميرا", "camera", "شاشة", "screen", "مسجل", "recorder", "ريموت", "remote", "فرش", "فرشات", "mats", "طفاية", "extinguisher", "شنطة سلامة", "safety bag", "احتياطي", "spare"];
const norm = (value) => String(value ?? "").trim().toLocaleLowerCase("ar");
const keyOf = (row) => [row.car, row.statement, row.model, row.exterior, row.interior].map(norm).join("|");
function shortages(rows) {
  const valid = rows.filter((row) => allowedLocations.has(row.location) && allowedStatuses.has(row.status) && !excluded.some((word) => norm(row.statement).includes(norm(word))));
  const groups = new Map();
  for (const row of valid) {
    const key = keyOf(row);
    const current = groups.get(key) || { sample: row, locations: new Set(), total: 0 };
    current.locations.add(row.location); current.total += 1; groups.set(key, current);
  }
  const result = [];
  for (const [key, group] of groups) for (const branch of targetBranches) if (!group.locations.has(branch)) result.push({ key, branch, total: group.total });
  return result;
}
const base = { car:"A", statement:"SUV", model:"2026", exterior:"white", interior:"beige", status:"available_for_sale" };
let result = shortages([{...base, location:"warehouse"}]);
assert.deepEqual(result.map((x)=>x.branch).sort(), ["hall","multaqa","qadisiyah"]);
result = shortages([{...base, location:"multaqa"},{...base, location:"qadisiyah"}]);
assert.deepEqual(result.map((x)=>x.branch), ["hall"]);
assert.equal(shortages([{...base, location:"agency"}]).length, 0);
assert.equal(shortages([{...base, location:"warehouse", status:"sold_delivered"}]).length, 0);
assert.equal(shortages([{...base, location:"warehouse", statement:"كاميرا خلفية"}]).length, 0);
assert.equal(shortages([{...base, location:"warehouse"},{...base, location:"warehouse"}]).length, 3);
assert.equal(shortages([{...base, location:"hall"}]).some((x)=>x.branch==="hall"), false);
assert.equal(shortages([{...base, location:"warehouse"},{...base, location:"warehouse", exterior:"black"}]).length, 6);
console.log("Operations shortage business-rule tests passed (warehouse-only +3, branch gaps, agency/status/accessory exclusions, dedupe, and unique color combinations).");
