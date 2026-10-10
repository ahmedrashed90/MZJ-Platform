import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (path) => fs.readFileSync(path, 'utf8');
let passes = 0;
function check(name, statement) {
  assert.ok(statement, name);
  console.log(`PASS ${name}`);
  passes++;
}
const moduleSource = read('server/_marketing-meta-sync.ts');
const moduleJs = ts.transpileModule(moduleSource, {
  fileName: 'server/_marketing-meta-sync.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mockRequire = (id) => {
  if (id === './_db.js') return { withDatabaseAdvisoryLock: async (_, work) => work(), getSql: () => null };
  if (id === './_marketing-schema.js') return { ensureMarketingSchema: async () => {} };
  if (id === './_platform-connections.js') return { decryptPlatformToken: (token) => token };
  throw new Error(`Unexpected import: ${id}`);
};
const mod = { exports: {} };
new Function('require', 'module', 'exports', moduleJs)(mockRequire, mod, mod.exports);
const { normalizePost, numberOrNull } = mod.exports.metaSyncTestHelpers;
const facebook = normalizePost('facebook','page123',{
  id:'page123_789',created_time:'2026-08-23T16:49:47+0000', message:'MZJ Cars',
  permalink_url:'https://www.facebook.com/reel/456/',
  attachments:{data:[{media_type:'video',target:{id:'456'}}]},
  reactions:{summary:{total_count:13}},comments:{summary:{total_count:0}},shares:{count:1},
});
check('Facebook Page Post id is distinct from media/reel id',facebook.providerId==='page123_789'&&facebook.providerMediaId==='456');
check('Facebook reactions/comments/shares exactly preserve Graph counts',facebook.likes===13&&facebook.comments===0&&facebook.shares===1);
const missing = normalizePost('facebook','page123',{id:'page123_123',created_time:'2026-08-26T20:30:03+0000',reactions:{summary:{total_count:0}},comments:{summary:{total_count:0}}});
check('Missing shares stay null rather than become zero',missing.shares===null&&missing.likes===0&&missing.comments===0);
const instagram = normalizePost('instagram','ig123',{id:'18110147486147314',caption:'Suzuki',timestamp:'2026-09-22T20:19:00+0000',media_type:'VIDEO',permalink:'https://instagram.com/reel/a/',like_count:1,comments_count:0});
check('Instagram post and counts normalize from tested Graph fields',instagram.providerId===instagram.providerMediaId&&instagram.likes===1&&instagram.comments===0);
check('Invalid Meta date and post ids are ignored',normalizePost('instagram','ig123',{id:'',timestamp:'nonsense'})===null);
check('Absent and invalid metric values are not fabricated',numberOrNull(undefined)===null&&numberOrNull('xyz')===null&&numberOrNull(0)===0);
const schema=read('server/_marketing-schema.ts');
check('External table lives outside published_posts and CRM event records',schema.includes('create table if not exists marketing.meta_external_posts')&&schema.includes('unique(platform,account_id,provider_post_id)'));
check('Sync progress and daily follower snapshots persisted',schema.includes('create table if not exists marketing.meta_sync_state')&&schema.includes('create table if not exists marketing.meta_follower_snapshots'));
check('External importer writes only to isolated marketing tables',!moduleSource.includes('insert into marketing.published_posts')&&!moduleSource.includes('insert into crm.leads')&&!moduleSource.includes('insert into marketing.post_engagements'));
check('Duplicate post reconciliation includes media id and permalink',moduleSource.includes('pp.provider_media_id in (mp.provider_post_id,mp.provider_media_id)')&&moduleSource.includes('trim(trailing \'/\' from mp.permalink)'));
check('Import advances history by Graph cursor, never stores paging.next URL',moduleSource.includes('paging?.cursors?.after')&&!moduleSource.includes('searchParams.set("access_token"'));
check('Older engagement metrics are rotated after backfill',moduleSource.includes('refreshOlderMetrics(sql, conn)'));
const engagement=read('server/_marketing-engagement.ts');
check('Existing publishing and CRM paths retained',engagement.includes('upsertSocialEngagementAndCrm')&&engagement.includes('recordPublishedPost'));
check('Meta is merged into the engagement view, not campaign results',engagement.includes('const discovered = await externalMetaPosts(sql)')&&engagement.includes('const results = await engagementResultsData(sql)'));
const ui=read('src/marketing/pages/EngagementPage.tsx');
check('UI has source filters, account view, incremental sync and unavailable-metric display',ui.includes('setPostOrigin')&&ui.includes('view === "accounts"')&&ui.includes('sync_meta_engagement')&&ui.includes('optionalCount(row.shares_count)'));
const permissions=read('server/_api-permissions.ts');
check('Sync action uses existing engagement refresh permission',permissions.includes('sync_meta_engagement: "marketing.engagement.refresh"'));
const cron=read('server/internal/meta-engagement-sync.ts');
check('Cron rejects requests without an explicitly configured secret',cron.includes("if (!secret) return response.status(503)")&&cron.includes('safeSecretEquals(token, secret)'));
const vercel=JSON.parse(read('vercel.json'));
check('Meta cron configured every fifteen minutes without changing attendance schedule',vercel.crons.some(x=>x.path==='/api/internal/meta-engagement-sync'&&x.schedule==='*/15 * * * *')&&vercel.crons.some(x=>x.path==='/api/internal/attendance-tick'&&x.schedule==='* * * * *'));
console.log(`\n${passes}/${passes} Meta clean-discovery tests passed`);
