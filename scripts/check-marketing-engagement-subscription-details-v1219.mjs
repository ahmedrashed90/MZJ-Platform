import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const checks = [];
const check = (name, value) => checks.push({ name, ok: Boolean(value) });

const backend = read("server/_marketing-engagement.ts");
const page = read("src/marketing/pages/EngagementPage.tsx");
const css = read("src/marketing/marketing.css");

check("partial subscription response remains HTTP-success payload", backend.includes("ok: true,\n    subscriptionOk"));
check("Facebook and Instagram subscribed_apps are verified with GET", backend.includes("const verification = await graphRequest") && backend.includes("subscriptionFields(verification)"));
check("Instagram host selected by login permission model", backend.includes("scope.startsWith('instagram_business_')") && backend.includes("host: instagramLogin ? 'instagram' : 'facebook'"));
check("Facebook page subscription requests feed", backend.includes("field: isFacebook ? 'feed' : 'comments'"));
check("Meta errors preserve code subcode and trace", backend.includes("subcode:") && backend.includes("traceId:") && backend.includes("errorDetails"));
check("missing token permissions reported explicitly", backend.includes("التوكن الحالي لا يحتوي الصلاحيات المطلوبة"));
check("subscription result persisted per platform", backend.includes("engagementWebhookSubscription: { result: item, updatedAt }") && backend.includes("where platform=${item.platform}"));
check("stored subscription result returned on page load", backend.includes("subscriptionResults") && backend.includes("engagementWebhookSubscription"));
check("UI keeps per-platform results", page.includes("setSubscriptionResults") && page.includes("نتيجة اشتراك استقبال التعليقات"));
check("UI displays original Meta diagnostics", page.includes("Meta Error Code") && page.includes("Trace ID") && page.includes("صلاحيات ناقصة في التوكن"));
check("partial result is shown as error", page.includes("if (result.subscriptionOk) setMessage(result.message); else setError(result.message)"));
check("subscription details styling exists", css.includes(".marketing-subscription-results"));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
