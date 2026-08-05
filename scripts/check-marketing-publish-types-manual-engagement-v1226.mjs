import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const publishApi = read("server/marketing/index.ts");
const engagementApi = read("server/_marketing-engagement.ts");
const publishPage = read("src/marketing/pages/PublishPrepPage.tsx");
const engagementPage = read("src/marketing/pages/EngagementPage.tsx");
const resultDetail = read("src/marketing/components/EngagementResultDetail.tsx");
const publishModel = read("shared/marketing-publishing.ts");
const css = read("src/marketing/marketing.css");

const checks = [
  ["one canonical post-type normalizer", publishModel.includes("normalizeMarketingPublishFormat") && publishModel.includes('return "story"') && publishModel.includes('return "reel"') && publishModel.includes('return "short"') && publishModel.includes('return "photo_post"')],
  ["saved schedules preserve the selected publish format", publishApi.includes("format:item.publishFormat") && publishApi.includes("requiredWidth:item.width") && publishApi.includes("resolveMarketingPublishFormat")],
  ["post type is verified against its selected platform", publishApi.includes("نوع النشر المحدد لا يتبع المنصة المختارة أو غير مفعّل") && publishApi.includes("clean(postType.platform_id)!==item.platformId")],
  ["Facebook Reel uses the Reel publishing endpoint", publishApi.includes("/${pageId}/video_reels") && publishApi.includes("upload_phase:'start'") && publishApi.includes("video_state:'PUBLISHED'")],
  ["Facebook Story uses the dedicated Story endpoints", publishApi.includes("/${pageId}/video_stories") && publishApi.includes("/${pageId}/photo_stories")],
  ["Instagram Story is published as STORIES", publishApi.includes("media_type:'STORIES'")],
  ["Instagram Reel is published as REELS", publishApi.includes("media_type:'REELS'") && publishApi.includes("share_to_feed:true")],
  ["Instagram multi-image post is published as CAROUSEL", publishApi.includes("media_type:'CAROUSEL'") && publishApi.includes("is_carousel_item:true")],
  ["Instagram photo post cannot silently become a Reel", publishModel.includes("بوست Instagram يقبل الصور فقط. اختر Reel لنشر الفيديو")],
  ["YouTube Shorts selection is kept in publish metadata", publishApi.includes("youtubeOptionsForFormat") && publishApi.includes("#Shorts") && publishApi.includes("publishFormat,postTypeName")],
  ["successful publishing records every supported platform for engagement", engagementApi.includes("const platform = resultPlatform") && engagementApi.includes("recordPublishedPost") && engagementApi.includes("'facebook','instagram','tiktok','snapchat','youtube'")],
  ["YouTube published videos receive a permanent watch link", engagementApi.includes("https://www.youtube.com/watch?v=") && engagementApi.includes('if (platform === "youtube")')],
  ["YouTube engagement metrics use the official videos endpoint", engagementApi.includes("youtubeVideoStatistics") && engagementApi.includes("/youtube/v3/videos") && engagementApi.includes('url.searchParams.set("part", "statistics,snippet,status")')],
  ["Engagement page can filter and identify YouTube", engagementPage.includes('<option value="youtube">YouTube</option>') && engagementPage.includes("YoutubeLogo") && engagementPage.includes('if (platform === "youtube") return "فيديو YouTube"')],
  ["campaign and agenda result details include YouTube", resultDetail.includes('["facebook", "instagram", "youtube", "tiktok", "snapchat"]')],
  ["publish preparation has a dedicated manual publishing tab", publishPage.includes('type PublishPrepView = "tasks" | "manual"') && publishPage.includes("النشر اليدوي") && publishPage.includes("تجهيز نشر يدوي")],
  ["manual publishing creates a new campaign or agenda and a new creative", publishPage.includes("حملة جديدة") && publishPage.includes("أجندة جديدة") && publishPage.includes("اسم الكرييتيف الجديد") && !publishPage.includes("manualSources") && !publishPage.includes("manualTaskRows")],
  ["manual publishing captures platforms, type, date, caption and hashtags", publishPage.includes("المنصات وأنواع النشر") && publishPage.includes("موعد النشر") && publishPage.includes("Caption") && publishPage.includes("Hashtag")],
  ["manual publishing reuses the canonical save flow", publishPage.includes('action: "save_publish_prep"') && publishPage.includes("saveManual")],
  ["manual publishing styles stay scoped to publish preparation", css.includes(".marketing-manual-publish-panel") && css.includes(".marketing-publish-view-tabs")],
];

let passed = 0;
for (const [label, condition] of checks) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (condition) passed += 1;
}
console.log(`Marketing publish types, manual publishing and engagement checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
