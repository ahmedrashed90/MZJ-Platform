'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports) {
  const code = ts.transpileModule(read(file), { fileName:file, reportDiagnostics:true, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX} });
  assert.equal(code.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  const module={exports:{}};
  new Function('require','module','exports',code.outputText)(name=>imports[name]||{},module,module.exports);
  return module.exports;
}
const {hasPreparationPostLink:linked,preparationLinesByMissingLink:sort,preparationReturnAnchor:anchor,preparationLinesByDate:dateSort} = load('src/marketing/workflow/campaignOverview.tsx',{});
const row=(id,day,other={})=>({id,scheduled_on:day,platform_name:'Google',post_type_name:'Video',...other});
const original=Object.freeze([
 row('done-early','2026-11-01',{effective_post_url:'https://example.com/1'}),
 row('edit','2026-11-25'),row('same-day','2026-11-25'),row('previous','2026-11-20'),
 row('done-late','2026-11-26',{manual_post_url:'https://example.com/2'}),
 row('later','2026-11-26',{manual_post_url:'  ',published_ready:true}),row('undated',''),
 row('paid','2026-11-24',{strategy_campaign_link:{campaignId:'1'}}),
]);
const ids=rows=>rows.map(r=>r.id);
assert.deepEqual(ids(sort(original)),['previous','paid','edit','same-day','later','undated','done-early','done-late']);
assert.equal(dateSort(original)[0].id,'done-early','Report/date-only order remains independent');
assert.equal(linked({effective_post_url:' ',manual_post_url:'https://example.com/'}),true);
assert.equal(linked({effective_post_url:' ',manual_post_url:' '}),false);
assert.equal(original[0].id,'done-early');
const pos={id:'edit',day:'2026-11-25',linked:false,nearbyIds:['same-day','later','undated','done-early','done-late','paid','previous']};
assert.equal(anchor(sort(original),pos),'edit');
const changed=sort(original.map(r=>r.id==='edit'?{...r,manual_post_url:'https://example.com/new'}:r));
assert.equal(anchor(changed,pos),'same-day');
assert.equal(anchor(changed.filter(r=>r.id!=='same-day'),pos),'later');
assert.equal(anchor(changed.filter(linked),pos),'edit');
assert.equal(anchor([],pos),'');
console.log('PASS: missing URLs first, date order per group, real manual/automatic URLs only; same-day return after saving');
// Exercise the actual Products tab's click/close behavior, with a controlled React state stub.
let selection=null;
const fixture={itemId:'requirement-1',taskId:'task-1',assignmentNo:'TSK-001-02',taskNo:'TSK-001',ideaName:'Example',mediaKind:'image',readiness:50,publishOn:'2026-11-25',category:'Example'};
const element=(type,props)=>({type,props:props||{}});
const detail=()=>null;
const productOrder=load('src/marketing/workflow/strategyProductOrder.ts',{});
const {StrategyProductsTab}=load('src/marketing/workflow/StrategyDrafts.tsx',{
 'react':{useState:()=>[selection,next=>{selection=next;}]},
 'react/jsx-runtime':{jsx:element,jsxs:element},
 './api':{useWorkQuery:()=>({data:{rows:[fixture]},reload:async()=>{}}),showDate:String},
 './components':{W:{noData:'empty'},WorkAlert:()=>null,Empty:()=>null},
 './strategyProductOrder':productOrder,'./TaskDetail':{TaskDetail:detail},
});
function find(node, predicate) {
 if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));
 if(!node||typeof node!=='object')return [];
 return [...(predicate(node)?[node]:[]),...find(node.props?.children,predicate)];
}
let view=StrategyProductsTab({search:''});
const [button]=find(view,n=>n.type==='button'&&n.props.className==='mkw-assignment-open');
assert.ok(button);button.props.onClick();
view=StrategyProductsTab({search:''});
const [popup]=find(view,n=>n.type===detail);
assert.ok(popup);assert.equal(popup.props.id,'task-1');assert.deepEqual(popup.props.onlyItems,['requirement-1']);assert.equal(popup.props.focusItemId,'requirement-1');assert.equal(popup.props.popup,true);
popup.props.onClose();assert.equal(find(StrategyProductsTab({search:''}),n=>n.type===detail).length,0);
console.log('PASS: assignment opens the exact requirement in a local popup and closes without routing');
const dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx');
assert.match(dashboard,/onClick=\{event => openChooserLine\(line, event\)\}/);
assert.doesNotMatch(dashboard,/setSelectPlan\(''\);\s*(?:if \(line|setPrepareId\(line)/);
assert.match(dashboard,/level=\{selectPlan \? 1 : 0\}/);
assert.match(dashboard,/body\.scrollTop = row/);
assert.match(dashboard,/table\.scrollLeft = position\.left/);
assert.match(read('src/marketing/workflow/PublishPage.tsx'),/await query\.reload\(\); await onChanged\(\)/);
assert.match(read('src/marketing/workflow/TaskDetail.tsx'),/className=\{popup \? "mkw-modal" : "mkw-fullscreen"\}/);
assert.match(read('src/components/Modal.tsx'),/useEscapeToClose\(open, onClose\)/);
assert.match(read('src/components/useEscapeToClose.ts'),/openOverlayStack\.at\(-1\) !== id/);
console.log('PASS: chooser stays mounted, child is layered, restoration uses scroll offsets, existing Escape stack remains in use');
