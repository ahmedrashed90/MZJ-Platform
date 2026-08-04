import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const checks = [];
const check = (name, value) => checks.push({ name, ok: Boolean(value) });

const backend = read("server/_marketing-engagement.ts");
const page = read("src/marketing/pages/EngagementPage.tsx");
const css = read("src/marketing/marketing.css");

check("partial subscription response remains HTTP-success payload", backend.includes("ok: true,\n    subscriptionOk"));
check("direct subscribed_apps calls are verified with GET", backend.includes("const verification = await graphRequest") && backend.includes("subscriptionFields(verification)"));
check("direct Instagram Login uses graph.instagram.com", backend.includes("scope.startsWith('instagram_business_')") && backend.includes("host: instagramLogin ? 'instagram' : 'facebook'"));
check("Facebook subscription remains page feed on graph.facebook.com", backend.includes("field: isFacebook ? 'feed' : 'comments'") && backend.includes("requiredScopes: isFacebook ? ['pages_manage_metadata']"));
check("Facebook Login Instagram avoids invalid IG subscribed_apps POST", backend.includes("verifyInstagramFacebookLoginSubscription") && backend.includes("Page subscription here; no Facebook subscription field or Facebook flow is changed by Instagram"));
check("Facebook Login Instagram performs read-only linked Page verification", backend.includes("graphRequest(`/${encodeURIComponent(pageId)}/subscribed_apps`, 'GET'") && backend.includes("activationMode: 'facebook_page_subscription'"));
check("Meta errors preserve code subcode and trace", backend.includes("subcode:") && backend.includes("traceId:") && backend.includes("errorDetails"));
check("missing token permissions reported explicitly", backend.includes("التوكن الحالي لا يحتوي الصلاحيات المطلوبة"));
check("subscription result persisted per platform", backend.includes("engagementWebhookSubscription: { result: item, updatedAt }") && backend.includes("where platform=${item.platform}"));
check("stored subscription result returned on page load", backend.includes("subscriptionResults") && backend.includes("engagementWebhookSubscription"));
check("UI keeps per-platform results", page.includes("setSubscriptionResults") && page.includes("حالة استقبال التفاعلات من Meta"));
check("UI displays original Meta diagnostics", page.includes("Meta Error Code") && page.includes("Trace ID") && page.includes("صلاحيات ناقصة"));
check("partial result is shown as error", page.includes("if (result.subscriptionOk) setMessage(result.message); else setError(result.message)"));
check("subscription details styling exists", css.includes(".marketing-subscription-results"));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
