import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=require('typescript');
function exportedModule(source) {
  const sourceJs=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const ctx={exports:{}};
  vm.runInNewContext(sourceJs,ctx,{filename:source});
  return ctx.exports;
}
const {suggestSheetColumn,mapSavedColumns}=exportedModule('shared/lead-forms-sheet-mapping.ts');
const headers=['التاريخ والوقت','اسم العميل','رقم الجوال','اسم السيارة','المصدر','الحالة'];
const auto=headers.map(header=>suggestSheetColumn(header,[]));
assert.equal(JSON.stringify(auto.map(x=>x.source)),JSON.stringify(['submitted_at','name','phone','vehicle','source','fixed']));
assert.equal(auto[5].value,'تم الحفظ');
const swapped=['رقم الجوال','اسم العميل','الحملة','الحالة'];
assert.equal(JSON.stringify(mapSavedColumns(swapped,[],[]).map(x=>x.source)),JSON.stringify(['phone','name','campaign','fixed']));
const saved=auto.map(x=>({...x})); saved[5].value='تم التواصل';
assert.equal(mapSavedColumns(headers,saved,[])[5].value,'تم التواصل');
assert.equal(mapSavedColumns(['اسم العميل','رقم الجوال'],saved,[])[0].source,'name');
assert.equal(suggestSheetColumn('اسم فئة السيارة',[{id:'segment',label:'اسم فئة السيارة',type:'text',required:false,options:[]}]).source,'answers.segment');
const source=readFileSync('server/marketing/lead-forms.ts','utf8');
const ast=ts.createSourceFile('lead-forms.ts',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
const names=new Set(['parseSheetId','safeTab','tabRange','readSheets','listSheetTabs','readSheetHeaders','riyadhSheetTimestamp','mappedLeadValue']);
const selected=ast.statements.filter(x=>ts.isFunctionDeclaration(x)&&x.name&&names.has(x.name.text));
assert.equal(selected.length,names.size);
const snippets=selected.map(x=>source.slice(x.pos,x.end)).join('\n');
const functions=ts.transpileModule(snippets+'\nexports.helpers={parseSheetId,safeTab,tabRange,readSheets,listSheetTabs,readSheetHeaders,riyadhSheetTimestamp,mappedLeadValue};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const requests=[];
const sandbox={exports:{},URL,AbortSignal,googleToken:async()=> 'test-token',
  fetch:async(url,options)=>{
    requests.push({url,options});
    if (url.includes('?fields=sheets(')) return {ok:true,json:async()=>({sheets:[{properties:{title:'Meta'}},{properties:{title:'OpenSouq'}}]})};
    if (url.includes('/values/')) return {ok:true,json:async()=>({values:[headers]})};
    return {ok:false,status:404};
  },
  clean:(v,n=250)=>String(v??'').trim().slice(0,n),FormInputError:class extends Error {}};
sandbox.Intl=Intl; sandbox.Date=Date; vm.runInNewContext(functions,sandbox);
const {parseSheetId,safeTab,tabRange,listSheetTabs,readSheetHeaders,mappedLeadValue}=sandbox.exports.helpers;
assert.equal(parseSheetId('https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrst/edit?gid=3'),'abcdefghijklmnopqrst');
assert.throws(()=>parseSheetId('https://example.com/spreadsheets/d/abcdefghijklmnopqrst/edit'));
assert.equal(safeTab('OpenSouq'),'OpenSouq');
assert.equal(JSON.stringify((await listSheetTabs('abcdefghijklmnopqrst')).map(x=>x.title)),JSON.stringify(['Meta','OpenSouq']));
assert.equal(JSON.stringify(await readSheetHeaders('abcdefghijklmnopqrst','OpenSouq')),JSON.stringify(headers));
assert.ok(requests.every(r=>r.options.headers.Authorization==='Bearer test-token'));
assert.ok(requests.some(r=>r.url.includes('!1%3A1')));
assert.equal(tabRange("Meta's",'1:1'),"'Meta''s'!1:1");
const lead={id:'lead-uuid',form_title:'فورم مثال',created_at:'2026-10-25T12:00:00Z',name:'محمد',phone:'966500000000',answers:{vehicle:'هيونداي'},source:'meta'};
const allowed=new Set(['name','phone','vehicle','source','submitted_at']);
const extra=new Set();
const row=auto.map(col=>col.source==='fixed'?col.value:mappedLeadValue(col.source,lead,allowed,extra,true));
assert.equal(JSON.stringify(row),JSON.stringify(['2026-10-25 15:00:00','محمد','966500000000','هيونداي','meta','تم الحفظ']));
assert.equal(mappedLeadValue('unknown',lead,allowed,extra),'');
assert.ok(source.includes('mapping.some((m,i)=>m.header!==currentHeaders[i])'));
console.log('PASS: mapping sample OpenSouq, reordered sheets, saved mapping, custom question, URL checks, safe write positions.');
