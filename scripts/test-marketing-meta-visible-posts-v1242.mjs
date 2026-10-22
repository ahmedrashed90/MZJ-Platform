import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const ui = fs.readFileSync('src/marketing/pages/EngagementPage.tsx', 'utf8');
const begin = ui.indexOf('function visibleMetaPostIds(');
const end = ui.indexOf('function platformIcon(', begin);
assert.ok(begin >= 0 && end > begin, 'Visible Meta selection lives in the original page');
const snippet = ui.slice(begin, end);
const js = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const select = new Function(`const VISIBLE_META_POSTS_PER_PLATFORM = 5;\n${js}\nreturn visibleMetaPostIds;`)();
const igIds = Array.from({length:7}, (_,index)=>`00000000-0000-4000-8000-${(100+index).toString().padStart(12,'0')}`);
const fbIds = Array.from({length:7}, (_,index)=>`00000000-0000-4000-8000-${(200+index).toString().padStart(12,'0')}`);
const sorted = [
  {id:igIds[0], platform:'instagram', publication_origin:'meta', caption:'سوزوكي'},
  {id:igIds[1], platform:'instagram', publication_origin:'meta', caption:'توسان كومفورت 2026', provider_post_id:'17910769611525659', likes_count:0},
  ...igIds.slice(2).map(id=>({id,platform:'instagram',publication_origin:'meta'})),
  ...fbIds.map(id=>({id,platform:'facebook',publication_origin:'meta'})),
  {id:'00000000-0000-4000-8000-000000000999',platform:'instagram',publication_origin:'system'},
];
const selected = select(sorted);
assert.equal(selected.length,10,'At most five posts per platform are selected');
assert.equal(selected.includes(igIds[1]),true,'The Tucson Reel must be selected on opening the page');
assert.equal(selected.filter(id=>igIds.includes(id)).length,5);
assert.equal(selected.filter(id=>fbIds.includes(id)).length,5);
assert.ok(!selected.includes('00000000-0000-4000-8000-000000000999'),'System posts are not sent to Meta');
console.log('PASS Opening the page includes Tucson and newest five Meta posts from each platform');

const backend=fs.readFileSync('server/_marketing-meta-sync.ts','utf8');
const route=fs.readFileSync('server/marketing/index.ts','utf8');
assert.ok(backend.includes("tryWithDatabaseAdvisoryLock('marketing:meta-visible-metrics'"),'Visible post updates must use their own lock');
assert.ok(backend.includes("tryWithDatabaseAdvisoryLock('marketing:meta-engagement-sync'"),'Archive Cron stays on its original lock');
assert.ok(route.includes('autoRefreshExternalMetaMetrics(sql, arrayValue<string>(initialBody.ids)'),'API must forward exact post IDs');
assert.ok(ui.includes('applyDirectMetaResults(refreshed)'),'The view should immediately show returned Meta metrics');
assert.ok(ui.includes('result.failed || result.deferred || !result.updated'),'Failed partial updates cannot be reported as success');
assert.ok(ui.includes('AUTO_META_RETRY_DELAY_MS'),'A busy refresh should be retried rather than silently abandoned');
console.log('PASS Correct API route, independent locks, immediate display and honest failures');

// Meta frontend refresh response contract: the manual refresh used to declare
// a result without `platform`, despite passing it to applyDirectMetaResults.
// This verifies the shared response alias with the real TS type checker.
const sourceFile = ts.createSourceFile('EngagementPage.tsx', ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const alias = (name) => sourceFile.statements.find((node) => ts.isTypeAliasDeclaration(node) && node.name.text === name)?.getText(sourceFile);
const resultType = alias('DirectMetaResult');
const responseType = alias('DirectMetaRefreshResponse');
assert.ok(resultType && responseType, 'Both Meta results and refresh response must have one shared type contract');
const autoRefresh = ui.slice(ui.indexOf('useEffect(() => {', ui.indexOf('function applyDirectMetaResults(')), ui.indexOf('async function refresh()', ui.indexOf('function applyDirectMetaResults(')));
const manualRefresh = ui.slice(ui.indexOf('async function refreshMetaPost('), ui.indexOf('async function syncMeta('));
assert.match(autoRefresh, /marketingFetch<DirectMetaRefreshResponse>\(/, 'Automatic refresh must use the shared Meta response type');
assert.match(manualRefresh, /marketingFetch<DirectMetaRefreshResponse>\(/, 'Manual post refresh must use the same Meta response type');
assert.match(backend, /results: Array<\{ id\?: string; platform: MetaPlatform;/, 'Backend sends platform on every successful result');
const virtualFile = '/__mzj_typecheck__/meta-refresh-contract.ts';
const virtualSource = `${resultType}\n${responseType}\n` +
  `declare function applyDirectMetaResults(results: DirectMetaResult[]): void;\n` +
  `declare function readMeta(): Promise<DirectMetaRefreshResponse>;\n` +
  `async function verify(): Promise<void> { const response = await readMeta(); applyDirectMetaResults(response.results); }\n`;
const compilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022 };
const host = ts.createCompilerHost(compilerOptions);
const originalGet = host.getSourceFile.bind(host);
const originalFileExists = host.fileExists.bind(host);
const originalRead = host.readFile.bind(host);
host.fileExists = (path) => path === virtualFile || originalFileExists(path);
host.readFile = (path) => path === virtualFile ? virtualSource : originalRead(path);
host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
  name === virtualFile ? ts.createSourceFile(name, virtualSource, languageVersion) : originalGet(name, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram([virtualFile], compilerOptions, host);
const contractErrors = ts.getPreEmitDiagnostics(program).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
assert.deepEqual(contractErrors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, ' ')), [],
  'The actual TypeScript compiler must accept response.results for applyDirectMetaResults');
console.log('PASS Shared TypeScript refresh contract: auto and manual Meta responses match platform-aware results');
