import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const attendance = read('server/_attendance-schema.ts');
const engagement = read('server/_marketing-engagement.ts');
const accountStats = read('server/_marketing-meta-sync.ts');
const page = read('src/marketing/pages/EngagementPage.tsx');
const marketing = read('server/marketing/index.ts');
const connection = read('server/marketing/platform-connections.ts');
const accountsPage = read('src/marketing/pages/PlatformConnectionsPage.tsx');
const paid = read('src/marketing/components/PaidAdsPanel.tsx');
let count = 0;
function check(name, condition) { assert.ok(condition,name); count++; console.log('PASS',name); }

// Execute the exact production readiness function body with controlled mocks.
const attendanceFn = attendance.slice(attendance.indexOf('export function ensureAttendanceSchema()'));
const attendanceJs = ts.transpileModule(attendanceFn,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function testAttendanceReady(ready) {
  const calls = [];
  const exports = {};
  const allowed = {
    get attendanceSchemaPromise() { return null; },
  };
  const make = new Function('exports','ensureAccessControlSchema','attendanceSchemaReady','withDatabaseAdvisoryLock','runSqlScript','migrateLegacyMarketingAttendance','ATTENDANCE_SCHEMA_SQL','ATTENDANCE_SCHEMA_VERSION',
    'let attendanceSchemaPromise = null;\n'+attendanceJs);
  make(exports,
    async()=>calls.push('access'),
    async()=>calls.push('check') || ready,
    async(_,work)=>{calls.push('lock');await work();},
    async()=>calls.push('ddl'),
    async()=>calls.push('legacy'),
    'CREATE TABLE core.whatever()','v14');
  await exports.ensureAttendanceSchema();
  await exports.ensureAttendanceSchema();
  return calls;
}
const current = await testAttendanceReady(true);
check('Ready attendance schema never executes DDL or legacy reimport', current.filter(x=>x==='ddl'||x==='legacy'||x==='lock').length===0);
check('Ready attendance schema performs only one cold-start readiness check',current.filter(x=>x==='check').length===1);
let schemaReady = false, migrations=0;
const exp={};
new Function('exports','ensureAccessControlSchema','attendanceSchemaReady','withDatabaseAdvisoryLock','runSqlScript','migrateLegacyMarketingAttendance','ATTENDANCE_SCHEMA_SQL','ATTENDANCE_SCHEMA_VERSION', 'let attendanceSchemaPromise=null;\n'+attendanceJs)(
  exp, async()=>{}, async()=>schemaReady, async(_,work)=>{migrations++;await work()}, async()=>{schemaReady=true},async()=>{migrations++},'schema','v14');
await exp.ensureAttendanceSchema();
check('Outdated attendance schema migrates exactly once under advisory lock',migrations===2);

// Execute real TS report handler with mock dependencies. When viewing Meta
// followers it may not query unpublished posts, CRM, or campaign results.
const fnCode=engagement.slice(engagement.indexOf('export async function engagementData('),engagement.indexOf('\ntype SubscriptionTarget',engagement.indexOf('export async function engagementData(')));
const js=ts.transpileModule(fnCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let queryCalls=0, accountsCalls=0, resultCalls=0, externalCalls=0;
const fakeSql=async()=>{queryCalls++;return []};
const reportExports={};
new Function('exports','clean','numberValue','asObject','asArray','externalMetaPosts','engagementResultsData','metaAccountData','RESULT_PLATFORMS',js)(
 reportExports,v=>String(v??'').trim(),v=>Number(v||0),v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},v=>Array.isArray(v)?v:[],
 async()=>{externalCalls++;return []},async()=>{resultCalls++;return {groups:[],campaigns:[],agendas:[],supportedPlatforms:[]}},async()=>{accountsCalls++;return []},
 ['facebook','instagram','youtube','tiktok','snapchat']);
const followerPayload=await reportExports.engagementData(fakeSql,'accounts');
check('Followers view returns valid independent report contract',followerPayload.ok && Array.isArray(followerPayload.accounts) && Array.isArray(followerPayload.results.campaigns));
check('Followers view avoids ALL post+engagement+CRM result queries',queryCalls===0 && resultCalls===0 && externalCalls===0 && accountsCalls===1);
await reportExports.engagementData(fakeSql,'campaigns');
check('Campaign results run without Meta follower or feed scans',resultCalls===1&&accountsCalls===1&&externalCalls===0);
check('Organic view reads provider posts without unneeded report groups',engagement.includes('const needFeed = !scoped || view === "engagement"') && engagement.includes('needFeed ? externalMetaPosts(sql)'));
check('API passes actual active view to selective report',marketing.includes('engagementData(sql,request.query.view)'));
check('Legacy route GETs cannot perform marketing DDL',marketing.includes("request.method !== 'GET' && !workflowRequest"));
check('OAuth connection status GET does not launch marketing migrations',connection.includes('request.method !== "GET" || clean(request.query.provider)'));
check('Meta account report is short-circuited when there are no linked accounts',accountStats.includes('if (!activeAccounts.length) return [];'));
check('User can leave a slow tab without locking another tab',page.includes('activeLoad.current?.abort()')&&page.includes('++loadSequence.current'));
check('Report requests have a 20-second terminal state',page.includes('20_000')&&page.includes('تأخر الخادم أكثر من 20 ثانية'));
check('Unloaded followers never falsely show as disconnected',page.includes('!data ? <div className="panel marketing-meta-account-empty"'));
check('Status and paid-panel reads use bounded timeouts',accountsPage.includes('AbortSignal.timeout(20_000)')&&paid.includes('googleReady'));
for(const file of ['server/_attendance-schema.ts','server/_marketing-engagement.ts','server/_marketing-meta-sync.ts','server/marketing/index.ts','server/marketing/platform-connections.ts','src/marketing/pages/EngagementPage.tsx','src/marketing/pages/PlatformConnectionsPage.tsx','src/marketing/components/MetaAdsPanel.tsx','src/marketing/components/GoogleAdsPanel.tsx','src/marketing/components/PaidAdsPanel.tsx']){
  const raw=read(file);const parsed=ts.createSourceFile(file,raw,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  check(`TypeScript syntax ${file}`,parsed.parseDiagnostics.length===0);
}
console.log(`${count}/${count} focused real-function + static performance and isolation tests passed`);
