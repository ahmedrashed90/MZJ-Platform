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
check('general engagement schema is idempotent', schema.includes('create table if not exists marketing.post_engagements') && schema.includes('unique(platform,engagement_type,provider_event_id)'));
check('legacy comments migrate into unified engagement table', schema.includes('from marketing.post_comments pc') && schema.includes("pc.platform,'comment'"));
check('daily engagement snapshots', schema.includes('create table if not exists marketing.engagement_snapshots'));
check('CRM exact Facebook post source', crmSchema.includes("('facebook_post','بوست فيس بوك'"));
check('CRM exact Instagram post source', crmSchema.includes("('instagram_post','بوست انستجرام'"));
check('successful publish registers provider post', marketing.includes('recordPublishedPost(sql,schedule,result)'));
check('engagement report API', marketing.includes("resource==='engagement'"));
check('engagement refresh action', marketing.includes("action==='refresh_engagement'"));
check('webhook subscription action', marketing.includes("action==='subscribe_engagement_webhooks'"));
check('Facebook comments reactions and shares are normalized', engagement.includes("item === 'comment'") && engagement.includes("item === 'reaction'") && engagement.includes("item === 'share'"));
check('Instagram comments are normalized independently', engagement.includes("object === 'instagram' && field === 'comments'") && engagement.includes("platform: 'instagram', engagementType: 'comment'"));
check('direct and changes webhook payloads supported', engagement.includes('function normalizedChanges') && engagement.includes('entry?.field'));
check('own account interactions excluded', engagement.includes('item.actorId === item.accountId'));
check('engagement identity dedupe', engagement.includes('ensureContactIdentity') && engagement.includes('externalId: item.actorId'));
check('cash CRM distribution reused', engagement.includes("serviceKey: 'cash'") && engagement.includes("assignCallCenter: false"));
check('new CRM status comes from lifecycle', engagement.includes('classifyConversationService'));
check('exact CRM source selected by event platform', engagement.includes("item.platform === 'facebook' ? 'facebook_post' : 'instagram_post'") && engagement.includes("item.platform === 'facebook' ? 'بوست فيس بوك' : 'بوست انستجرام'"));
check('campaign name copied to CRM', engagement.includes('campaign_name='));
check('webhook signature HMAC', webhook.includes('x-hub-signature-256') && webhook.includes('createHmac("sha256"'));
check('raw webhook body parser disabled', apiWebhook.includes('bodyParser: false'));
check('dedicated webhook rewrite', vercel.includes('/api/integrations/meta/engagement-webhook'));
check('required Meta comment permissions', connections.includes('pages_manage_metadata') && connections.includes('instagram_manage_comments'));
check('central API permissions mapped', permissions.includes('refresh_engagement: "marketing.publish.now"') && permissions.includes('subscribe_engagement_webhooks: "marketing.connections.manage"'));
check('engagement page uses unified event list', page.includes('data?.engagements') && page.includes('التفاعلات والعملاء'));
check('new engagement navigation', layout.includes('/marketing/engagement'));
check('new engagement route', app.includes('EngagementPage') && app.includes('path="engagement"'));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
