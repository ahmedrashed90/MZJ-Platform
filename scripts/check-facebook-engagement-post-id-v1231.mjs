import fs from "node:fs";

const backend = fs.readFileSync(new URL("../server/_marketing-engagement.ts", import.meta.url), "utf8");
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

check(
  "Facebook Page post ids are normalized to full pageId_postId form",
  backend.includes('function facebookPostNodeId(accountId: unknown, providerPostId: unknown)')
    && backend.includes('return `${pageId}_${postId}`;'),
);
check(
  "New Facebook published rows persist canonical post ids",
  backend.includes('const canonicalProviderPostId = platform === "facebook" ? facebookPostNodeId(accountId, providerPostId) : providerPostId;')
    && backend.includes('${platform},${accountId},${canonicalProviderPostId},${providerMediaId || null}'),
);
check(
  "Existing Facebook rows are repaired before metrics refresh",
  backend.includes('providerPostId = facebookPostNodeId(pageId, providerPostId);')
    && backend.includes('graphRequest(`/${encodeURIComponent(providerPostId)}`'),
);
check(
  "Successful refresh persists repaired provider post id",
  backend.includes('update marketing.published_posts set provider_post_id=${providerPostId || post.provider_post_id}'),
);
check(
  "Facebook engagement still reads reactions comments and shares from post node",
  backend.includes('fields: "id,permalink_url,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares"'),
);

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
