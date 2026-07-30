import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const checks = [];
function check(name, value) { checks.push({ name, ok: Boolean(value) }); }

const schema = read('server/_marketing-schema.ts');
const crmSchema = read('server/_crm-schema.ts');
const engagement = read('server/_marketing-engagement.ts');
const webhook = read('server/integrations/meta-engagement-webhook.ts');
const apiWebhook = read('api/meta-engagement-webhook.ts');
const marketing = read('server/marketing/index.ts');
const permissions = read('server/_api-permissions.ts');
const connections = read('server/_platform-connections.ts');
const page = read('src/marketing/pages/EngagementPage.tsx');
const layout = read('src/marketing/MarketingLayout.tsx');
const app = read('src/App.tsx');
const vercel = read('vercel.json');

check('published posts schema', schema.includes('create table if not exists marketing.published_posts'));
check('comments schema is idempotent', schema.includes('unique(platform,provider_comment_id)'));
check('daily engagement snapshots', schema.includes('create table if not exists marketing.engagement_snapshots'));
check('CRM exact Facebook post source', crmSchema.includes("('facebook_post','بوست فيس بوك'"));
check('CRM exact Instagram post source', crmSchema.includes("('instagram_post','بوست انستجرام'"));
check('successful publish registers provider post', marketing.includes('recordPublishedPost(sql,schedule,result)'));
check('engagement report API', marketing.includes("resource==='engagement'"));
check('engagement refresh action', marketing.includes("action==='refresh_engagement'"));
check('webhook subscription action', marketing.includes("action==='subscribe_engagement_webhooks'"));
check('every external comment is normalized', engagement.includes("field) === 'feed'") && engagement.includes("field) === 'comments'"));
check('own account comments excluded', engagement.includes('comment.commenterId === comment.accountId'));
check('comment identity dedupe', engagement.includes('ensureContactIdentity') && engagement.includes('externalId: comment.commenterId'));
check('cash CRM distribution reused', engagement.includes("serviceKey: 'cash'") && engagement.includes("assignCallCenter: false"));
check('new CRM status comes from lifecycle', engagement.includes('classifyConversationService'));
check('exact CRM source codes used', engagement.includes("'facebook_post'") && engagement.includes("'instagram_post'"));
check('campaign name copied to CRM', engagement.includes('campaign_name='));
check('webhook signature HMAC', webhook.includes('x-hub-signature-256') && webhook.includes('createHmac("sha256"'));
check('raw webhook body parser disabled', apiWebhook.includes('bodyParser: false'));
check('dedicated webhook rewrite', vercel.includes('/api/integrations/meta/engagement-webhook'));
check('required Meta comment permissions', connections.includes('pages_manage_metadata') && connections.includes('instagram_manage_comments'));
check('central API permissions mapped', permissions.includes('refresh_engagement: "marketing.publish.now"') && permissions.includes('subscribe_engagement_webhooks: "marketing.connections.manage"'));
check('new engagement page', page.includes('تفاعل النشر') && page.includes('عملاء CRM من التعليقات'));
check('new engagement navigation', layout.includes('/marketing/engagement'));
check('new engagement route', app.includes('EngagementPage') && app.includes('path="engagement"'));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
