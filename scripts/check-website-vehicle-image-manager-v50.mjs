import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const checks = [
  ["src/website/WebsiteLayout.tsx", '/website/images', "Website navigation route"],
  ["src/App.tsx", 'path="images"', "Website nested route"],
  ["src/website/WebsiteImagesPage.tsx", 'اختيار صورة من الجهاز', "Device upload UI"],
  ["src/website/WebsiteImagesPage.tsx", 'حفظ الصور في WordPress', "WordPress save action"],
  ["src/website/api.ts", 'mode: "cors"', "Direct browser to WordPress upload"],
  ["src/website/api.ts", 'FormData', "Multipart device upload"],
  ["server/website.ts", 'image_manager_ticket', "Short-lived upload ticket action"],
  ["server/_website-images.ts", 'createHmac', "HMAC ticket signing"],
  ["server/_website-images.ts", 'MZJ_CARS_BRIDGE_SECRET', "Existing bridge secret reuse"],
];

let failed = false;
for (const [file, needle, label] of checks) {
  const ok = read(file).includes(needle);
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log("PASS - Website Vehicle Image Manager V50 static contract");
