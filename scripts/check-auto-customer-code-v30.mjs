import fs from "node:fs";
const s=fs.readFileSync(new URL("../server/owners-public.ts", import.meta.url),"utf8");
const checks=[
 ["phone action route",s.includes('action === "commerce_customer_by_phone"')],
 ["old customer mode",s.includes('customerMode: "old_customer"')],
 ["new customer mode",s.includes('customerMode: "new_customer"')],
 ["phone legacy lookup",s.includes('findLegacyCustomerCodeByPhone(phone)')],
 ["customer code sms",s.includes('queueCommerceCustomerCodeSms')&&s.includes('customerCodeSmsQueued')],
];
for(const [name,ok] of checks){if(!ok){console.error(`FAIL: ${name}`);process.exit(1)}}
console.log("PASS: platform v30 automatic customer-code contract");
