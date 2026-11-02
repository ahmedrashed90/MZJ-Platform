/** Regression: Excel uses the selected date range and exactly the visible campaign filters. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
function transpile(path) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    fileName: path, reportDiagnostics: true,
    compilerOptions: {target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX},
  });
  assert.equal(output.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0, `${path} transpiles`);
  return output.outputText;
}
function load(path, mocks = {}) {
  const module={exports:{}};
  const sandbox={module,exports:module.exports, require:dep=>{
    if (Object.hasOwn(mocks,dep)) return mocks[dep];
    throw new Error(`Unexpected dependency ${dep}`);
  }, TextEncoder,Uint8Array,Uint32Array,DataView,Blob,Date,String,Number,Math,Promise,Map,Set,JSON,Intl,console,URLSearchParams,AbortController,window:{setTimeout,clearTimeout}};
  vm.runInNewContext(transpile(path),sandbox,{filename:path});
  return module.exports;
}
const exporter=load('src/marketing/reporting/exportCampaignReport.ts');
const row=(platform,id,name,spend,leads,interactions)=>({
  key:`${platform}:a:${id}`,platform,platformName: platform==='meta'?'Meta Ads':'Google Ads',
  accountId:'a',accountName:'MZJ الحساب الإعلاني',campaignId:id,campaignName:name,managerName:'',
  currency:'SAR',sourceCurrency:'SAR',exchangeRate:1,status:'ACTIVE',spend,leads,
  costPerLead:leads>0?spend/leads:null,interactions,clicks:12,interactionsDefinition:'engagements',
});
const rows=[row('meta','101','سوناتا Sonata',800,10,600),row('google','102','كريتا Creta',0,0,0),row('meta','103','توسان Tucson',null,null,null)];
const providers=[{platform:'meta',name:'Meta Ads',status:'ready',campaignCount:2,incomplete:false,warnings:[],note:''}];
const picked=exporter.filterCampaignReportRows(rows,'meta','سوناتا');
assert.equal(picked.length,1);
assert.equal(picked[0].campaignId,'101');
assert.equal(exporter.filterCampaignReportRows(rows,'all','').length,3);
assert.throws(()=>exporter.campaignReportXlsx([],providers,'2026-10-01','2026-10-26'), /لا توجد حملات/);
function storedEntry(buffer,name) {
  let cursor=0;
  while (cursor+30<buffer.length && buffer.readUInt32LE(cursor)===0x04034b50) {
    const nameSize=buffer.readUInt16LE(cursor+26),extra=buffer.readUInt16LE(cursor+28),size=buffer.readUInt32LE(cursor+18);
    const file=buffer.subarray(cursor+30,cursor+30+nameSize).toString('utf8');
    const start=cursor+30+nameSize+extra;
    if(file===name)return buffer.subarray(start,start+size).toString('utf8');
    cursor=start+size;
  }
  throw new Error(`Missing Excel entry: ${name}`);
}
const binary=Buffer.from(await exporter.campaignReportXlsx(rows,providers,'2026-10-12','2026-10-20').arrayBuffer());
const xml=storedEntry(binary,'xl/worksheets/sheet1.xml');
// Office (unlike tolerant parsers) rejects worksheets with mergeCells before autoFilter.
// Verify CT_Worksheet's top-level sequence so Excel does not repair/remove sheet1.xml.
const worksheetOrder=[...xml.matchAll(/<(sheetPr|dimension|sheetViews|sheetFormatPr|cols|sheetData|autoFilter|mergeCells|printOptions|pageMargins|pageSetup)\b/g)].map(match=>match[1]);
assert.deepEqual(worksheetOrder, [
  'sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData',
  'autoFilter','mergeCells','printOptions','pageMargins','pageSetup',
], 'Excel requires the worksheet elements in OOXML CT_Worksheet schema order');
assert(xml.includes('sqref="A7"'), 'The frozen pane includes a selection for Excel');
assert(xml.includes('<dimension ref="A1:I'), 'The worksheet publishes its populated dimension');
assert(xml.includes('خصومات البطاقة'), 'Billing and advertising spend are not silently equated');
console.log('PASS strict Office worksheet structure: autoFilter precedes mergeCells; freeze and dimension are valid');
assert.equal((xml.match(/<row r="(?:7|8|9)" /g)||[]).length,3,'Three campaigns exported as three genuine data rows');
assert(xml.includes('سوناتا Sonata') && xml.includes('كريتا Creta') && xml.includes('توسان Tucson'));
assert(xml.includes('<c r="E7" s="5"><v>800</v></c>') && xml.includes('<c r="F7" s="4"><v>10</v></c>'));
assert(xml.includes('<c r="F8" s="4"><v>0</v></c>'), 'A measured zero remains numeric');
assert(xml.includes('<c r="F9" s="6" t="inlineStr">'), 'Unavailable metrics stay missing instead of zero');
const specialName = 'حملة <VIP> & حملة';
const specialXml=storedEntry(Buffer.from(await exporter.campaignReportXlsx([row('meta','104',specialName,120,3,9)],providers,'2026-10-01','2026-10-26').arrayBuffer()),'xl/worksheets/sheet1.xml');
assert(specialXml.includes('حملة &lt;VIP&gt; &amp; حملة'), 'Campaign names preserve special characters safely in Excel');
console.log('PASS spreadsheet XML includes all filtered campaigns, numeric metrics, Arabic names, and literal special characters');
let hookIndex=0,refIndex=0;
const states=[], refs=[];
const react={
  useState(initial){const i=hookIndex++;if(!(i in states)) states[i]=typeof initial==='function'?initial():initial;
    return [states[i], value=>{states[i]=typeof value==='function'?value(states[i]):value}];},
  useRef(initial){const i=refIndex++;if(!(i in refs))refs[i]={current:initial};return refs[i];},
  useMemo(fn){return fn();},useCallback(fn){return fn;},useEffect(){},
};
let exported=[],fetches=[];
const oldReport={ok:true,from:'2026-10-01',to:'2026-10-10',generatedAt:new Date().toISOString(),providers,rows:[rows[1]]};
const requestedReport={...oldReport,from:'2026-10-12',to:'2026-10-20',rows};
const page=load('src/marketing/components/CampaignReportPage.tsx',{
  react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},
  '@phosphor-icons/react':{},recharts:{},
  '../api':{marketingFetch:async(url)=>{fetches.push(url);return requestedReport;},marketingLocalDateKey:()=> '2026-10-26',marketingQuery:query=>'?'+new URLSearchParams(query).toString()},
  '../reporting/exportCampaignReport':{filterCampaignReportRows:exporter.filterCampaignReportRows,
    downloadCampaignReportXlsx:(r,p,from,to)=>{if(!r.length)throw Error('لا توجد حملات مطابقة');exported.push({r,p,from,to});},printCampaignReportPdf:()=>{}},
});
const treeNodes=root=>{
  const all=[]; const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(n&&typeof n==='object'&&'props'in n){all.push(n);walk(n.props.children);}};
  walk(root);return all;
};
const textOf=n=>typeof n==='string'?n:Array.isArray(n)?n.map(textOf).join(' '):n&&typeof n==='object'?textOf(n.props?.children):'';
const render=()=>{hookIndex=0;refIndex=0;return treeNodes(page.CampaignReportPage());};
render();
states[3]=oldReport; // Loaded data (useState #4), before changing date inputs.
states[0]='2026-10-12';states[1]='2026-10-20';
let nodes=render();
let button=nodes.find(n=>n.type==='button'&&textOf(n.props.children).includes('تصدير Excel'));
assert(button,'Excel export button exists');
button.props.onClick();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(fetches.length,1,'Changing the selected date range triggers a fresh report fetch');
assert(fetches[0].includes('dateFrom=2026-10-12')&&fetches[0].includes('dateTo=2026-10-20'));
assert.equal(exported.length,1);
assert.equal(exported[0].r.length,3,'Export includes campaigns fetched for newly selected dates');
assert.equal(exported[0].from,'2026-10-12');
assert.equal(states[2].from,'2026-10-12','Rendered date is synchronized with the downloaded date');
console.log('PASS Excel uses newly selected dates even if "عرض التقرير" was not clicked');
states[4]='meta';states[5]='سوناتا';
nodes=render();button=nodes.find(n=>n.type==='button'&&textOf(n.props.children).includes('تصدير Excel'));
button.props.onClick();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(fetches.length,1,'No extra provider read for already loaded date range');
assert.equal(exported.length,2);
assert.equal(exported[1].r.length,1,'Export matches the platform and search filters');
assert.equal(exported[1].r[0].campaignId,'101');
console.log('PASS Excel uses exactly the table/chart platform and search filters');
states[5]='بحث-غير-موجود';
nodes=render();button=nodes.find(n=>n.type==='button'&&textOf(n.props.children).includes('تصدير Excel'));
button.props.onClick();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(exported.length,2,'Empty filters do not download a blank file');
assert.match(states[8], /لا توجد حملات/);
console.log('PASS Empty campaign selection shows an error rather than silently downloading a blank workbook');
// A permitted manual refresh must bypass the paid-provider server cache.
// The ordinary date-filtered Excel export must not do that automatically.
states[3] = {...requestedReport, canRefreshReport:true};
nodes=render();
const refreshButton = nodes.find(n=>n.type==='button' && textOf(n.props.children).trim()==='تحديث');
assert(refreshButton,'Campaign report refresh button exists');
const fetchCountBeforeRefresh = fetches.length;
refreshButton.props.onClick();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(fetches.length,fetchCountBeforeRefresh+1,'Manual refresh fetches a new paid campaign report');
assert(fetches[fetches.length-1].includes('refresh=true'),'Manual refresh sends refresh=true to authorized campaign report API');
console.log('PASS authorized manual refresh explicitly requests fresh paid provider metrics');
